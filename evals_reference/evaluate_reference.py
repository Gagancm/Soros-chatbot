"""
End-to-end generation evaluation: RAG vs. baseline (plain Gemini, no context).

Complements evals/evaluate_rag.py (which tests the retrieval layer).
This script tests whether retrieved context improves final answer quality,
using automatic reference-based metrics — no extra LLM API calls for scoring.

Metrics:
- semantic_sim   : cosine similarity between response and reference answer
                   (sentence-transformers all-MiniLM-L6-v2, same model as RAG)
- rouge1_recall  : fraction of reference unigrams present in the response
- concept_cov    : fraction of key Soros concepts mentioned in the response

Usage (from project root):
    python evals_reference/evaluate_reference.py
    python evals_reference/evaluate_reference.py --n 30 --seed 7
"""

import argparse
import csv
import os
import re
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import google.generativeai as genai
from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer, util

# ── Environment & path setup ─────────────────────────────────────────────────

PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / "backend" / ".env")
load_dotenv(PROJECT_ROOT / ".env")
sys.path.insert(0, str(PROJECT_ROOT))

from rag import create_default_rag_service

# ── Soros concept vocabulary ──────────────────────────────────────────────────

SOROS_CONCEPTS = [
    "reflexivity", "reflexive",
    "feedback", "fallibility", "fallible",
    "perception", "misconception", "bias",
    "boom-bust", "boom bust", "bubble",
    "quantum fund", "quantum",
    "pound", "sterling", "black wednesday",
    "open society",
    "karl popper", "popper",
    "macro", "short",
    "uncertainty", "risk management",
]

# ── Prompts ───────────────────────────────────────────────────────────────────

BASELINE_PROMPT = """\
You are a knowledgeable assistant about George Soros's investment philosophy.
Answer the following question accurately and concisely.
Do not provide financial advice.

Question: {question}"""

# ── Helpers ───────────────────────────────────────────────────────────────────

def _gemini():
    key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    if not key:
        raise RuntimeError("Set GOOGLE_API_KEY or GEMINI_API_KEY in the environment.")
    genai.configure(api_key=key)
    name = os.getenv("GEMINI_MODEL_NAME", "models/gemini-2.5-flash")
    return genai.GenerativeModel(name)


GEN_CONFIG = genai.types.GenerationConfig(temperature=0.3, max_output_tokens=512)


def _call(model, prompt: str) -> str:
    for attempt in range(3):
        try:
            resp = model.generate_content(prompt, generation_config=GEN_CONFIG)
            return (getattr(resp, "text", "") or "").strip()
        except Exception as e:
            if "429" in str(e) and attempt < 2:
                time.sleep(10 * (attempt + 1))
            else:
                return f"[ERROR: {e}]"
    return "[ERROR: max retries]"


def rag_response(rag_service, question: str, model) -> str:
    result = rag_service.build_rag_request(question)
    if result.get("error"):
        return f"[RAG MISS: {result['error']}]"
    return _call(model, result["prompt"])


def baseline_response(question: str, model) -> str:
    return _call(model, BASELINE_PROMPT.format(question=question))


# ── Metrics (local, no API calls) ────────────────────────────────────────────

def _tokenize(text: str) -> set[str]:
    return set(re.findall(r"\b[a-z]+\b", text.lower()))


def semantic_sim(response: str, reference: str, embed_model) -> float | None:
    if not response or not reference or response.startswith("["):
        return None
    vecs = embed_model.encode([response, reference], convert_to_tensor=True)
    return round(float(util.cos_sim(vecs[0], vecs[1])), 4)


def rouge1_recall(response: str, reference: str) -> float | None:
    if not response or not reference or response.startswith("["):
        return None
    ref_tokens = _tokenize(reference)
    if not ref_tokens:
        return None
    return round(len(ref_tokens & _tokenize(response)) / len(ref_tokens), 4)


def concept_cov(response: str) -> float | None:
    if not response or response.startswith("["):
        return None
    resp_lower = response.lower()
    hits = sum(1 for c in SOROS_CONCEPTS if c in resp_lower)
    return round(hits / len(SOROS_CONCEPTS), 4)


# ── Output ────────────────────────────────────────────────────────────────────

def write_results(metrics: dict, rows: list[dict], output_dir: Path):
    output_dir.mkdir(parents=True, exist_ok=True)

    summary_path = output_dir / "reference_eval_summary.csv"
    details_path = output_dir / "reference_eval_details.csv"

    with summary_path.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["metric", "value"])
        for key, value in metrics.items():
            writer.writerow([key, value])

    with details_path.open("w", newline="") as f:
        fieldnames = [
            "question", "reference_answer",
            "rag_reply", "baseline_reply",
            "rag_semantic_sim", "base_semantic_sim",
            "rag_rouge1_recall", "base_rouge1_recall",
            "rag_concept_cov", "base_concept_cov",
        ]
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    return summary_path, details_path


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Evaluate end-to-end generation quality: RAG vs. baseline."
    )
    parser.add_argument("--n",          type=int,   default=20,
                        help="Questions to sample (default 20)")
    parser.add_argument("--seed",       type=int,   default=42,
                        help="Random seed (default 42)")
    parser.add_argument("--delay",      type=float, default=1.5,
                        help="Seconds between API calls (default 1.5)")
    parser.add_argument("--output-dir", default="evals_reference/results",
                        help="Directory where results will be written")
    args = parser.parse_args()

    # Load Q&A corpus
    qa_path = PROJECT_ROOT / "rag" / "data" / "Soros_Questions.xlsx"
    df = pd.read_excel(qa_path)
    df.columns = [c.strip() for c in df.columns]
    col_map = {c.lower(): c for c in df.columns}
    df.rename(columns={
        col_map.get("questions", "questions"): "Question",
        col_map.get("answers",   "answers"):   "Answer",
    }, inplace=True)
    df = df[["Question", "Answer"]].dropna().reset_index(drop=True)

    n = min(args.n, len(df))
    sample = df.sample(n, random_state=args.seed).reset_index(drop=True)

    model       = _gemini()
    rag_svc     = create_default_rag_service()
    embed_model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")

    dims    = ["semantic_sim", "rouge1_recall", "concept_cov"]
    rows    = []
    totals  = {f"rag_{d}": [] for d in dims}
    totals |= {f"base_{d}": [] for d in dims}

    for idx, row in sample.iterrows():
        q   = str(row["Question"])
        ref = str(row["Answer"])
        print(f"[{idx+1:>2}/{n}] {q[:75]}{'…' if len(q) > 75 else ''}")

        rag_reply  = rag_response(rag_svc, q, model);  time.sleep(args.delay)
        base_reply = baseline_response(q, model);       time.sleep(args.delay)

        rec = {
            "question":         q,
            "reference_answer": ref[:300],
            "rag_reply":        rag_reply[:400],
            "baseline_reply":   base_reply[:400],
            "rag_semantic_sim":   semantic_sim(rag_reply,  ref, embed_model),
            "base_semantic_sim":  semantic_sim(base_reply, ref, embed_model),
            "rag_rouge1_recall":  rouge1_recall(rag_reply,  ref),
            "base_rouge1_recall": rouge1_recall(base_reply, ref),
            "rag_concept_cov":    concept_cov(rag_reply),
            "base_concept_cov":   concept_cov(base_reply),
        }
        rows.append(rec)

        for d in dims:
            if rec[f"rag_{d}"]  is not None: totals[f"rag_{d}"].append(rec[f"rag_{d}"])
            if rec[f"base_{d}"] is not None: totals[f"base_{d}"].append(rec[f"base_{d}"])

    # Aggregate metrics
    metrics = {"total_questions": n, "seed": args.seed}
    for d in dims:
        metrics[f"rag_{d}"]       = round(np.mean(totals[f"rag_{d}"]),  4) if totals[f"rag_{d}"]  else None
        metrics[f"base_{d}"]      = round(np.mean(totals[f"base_{d}"]), 4) if totals[f"base_{d}"] else None
        metrics[f"delta_{d}"]     = round(metrics[f"rag_{d}"] - metrics[f"base_{d}"], 4) \
                                    if metrics[f"rag_{d}"] and metrics[f"base_{d}"] else None

    summary_path, details_path = write_results(
        metrics, rows, PROJECT_ROOT / args.output_dir
    )

    print("\nGeneration Evaluation Summary (RAG vs Baseline)")
    print("------------------------------------------------")
    for key, value in metrics.items():
        print(f"{key}: {value}")

    print(f"\nSaved summary to: {summary_path}")
    print(f"Saved details to: {details_path}")


if __name__ == "__main__":
    main()
