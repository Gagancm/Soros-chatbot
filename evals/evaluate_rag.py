"""
RAG evaluation script for the Soros Advisor project.

This script evaluates the retrieval layer using a small golden-question set.
It does not call Gemini or generate final answers. It only checks whether the
RAG retriever returns relevant examples from the Soros Q&A knowledge base.

Metrics:
- Label Match@1: top retrieved item has the expected label
- Label Match@5: any of the top 5 retrieved items has the expected label
- Keyword Match@5: retrieved content contains one or more expected keywords
- Average Top Score: average similarity score of the top retrieved result
- No Retrieval Count: number of questions where the retriever returned no results
"""

import argparse
import csv
import sys
import time
from pathlib import Path

import pandas as pd

# Allow running this file from the project root.
PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from rag.rag_service import RAGConfig, RAGService


def normalize(value):
    return str(value or "").strip().lower()


def keyword_match(retrieved_items, expected_keywords):
    keywords = [
        normalize(word)
        for word in str(expected_keywords).replace("|", ";").split(";")
        if normalize(word)
    ]

    if not keywords:
        return False

    combined_text = " ".join(
        f"{item.get('question', '')} {item.get('answer', '')} {item.get('label', '')}"
        for item in retrieved_items
    ).lower()

    return any(keyword in combined_text for keyword in keywords)


def evaluate(golden_path, data_path, top_k):
    service = RAGService(
        RAGConfig(
            data_path=Path(data_path),
            top_k=top_k,
            min_similarity=0.0,
        )
    )

    golden_df = pd.read_csv(golden_path)

    rows = []
    label_at_1_hits = 0
    label_at_5_hits = 0
    keyword_hits = 0
    no_retrieval_count = 0
    top_scores = []
    total_latency = 0.0

    for _, row in golden_df.iterrows():
        question = str(row["question"])
        expected_label = str(row["expected_label"])
        expected_keywords = str(row.get("expected_keywords", ""))

        start = time.perf_counter()
        retrieved = service.retrieve(question, top_k=top_k)
        latency_ms = round((time.perf_counter() - start) * 1000, 2)
        total_latency += latency_ms

        if not retrieved:
            no_retrieval_count += 1
            result = {
                "question": question,
                "expected_label": expected_label,
                "top_label": "",
                "top_score": "",
                "label_match_at_1": False,
                "label_match_at_5": False,
                "keyword_match_at_5": False,
                "latency_ms": latency_ms,
            }
            rows.append(result)
            continue

        retrieved_labels = [item.get("label", "") for item in retrieved]
        top_label = retrieved_labels[0]
        top_score = round(float(retrieved[0].get("score", 0.0)), 4)

        label_match_at_1 = normalize(top_label) == normalize(expected_label)
        label_match_at_5 = any(
            normalize(label) == normalize(expected_label)
            for label in retrieved_labels
        )
        keyword_match_at_5 = keyword_match(retrieved, expected_keywords)

        label_at_1_hits += int(label_match_at_1)
        label_at_5_hits += int(label_match_at_5)
        keyword_hits += int(keyword_match_at_5)
        top_scores.append(top_score)

        result = {
            "question": question,
            "expected_label": expected_label,
            "top_label": top_label,
            "top_score": top_score,
            "label_match_at_1": label_match_at_1,
            "label_match_at_5": label_match_at_5,
            "keyword_match_at_5": keyword_match_at_5,
            "latency_ms": latency_ms,
        }
        rows.append(result)

    total = len(golden_df)

    metrics = {
        "total_questions": total,
        "label_match_at_1": round(label_at_1_hits / total, 4),
        "label_match_at_5": round(label_at_5_hits / total, 4),
        "keyword_match_at_5": round(keyword_hits / total, 4),
        "average_top_score": round(sum(top_scores) / len(top_scores), 4) if top_scores else 0,
        "average_latency_ms": round(total_latency / total, 2),
        "no_retrieval_count": no_retrieval_count,
    }

    return metrics, rows


def write_results(metrics, rows, output_dir):
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    metrics_path = output_dir / "rag_eval_summary.csv"
    details_path = output_dir / "rag_eval_details.csv"

    with metrics_path.open("w", newline="") as file:
        writer = csv.writer(file)
        writer.writerow(["metric", "value"])
        for key, value in metrics.items():
            writer.writerow([key, value])

    with details_path.open("w", newline="") as file:
        fieldnames = [
            "question",
            "expected_label",
            "top_label",
            "top_score",
            "label_match_at_1",
            "label_match_at_5",
            "keyword_match_at_5",
            "latency_ms",
        ]
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    return metrics_path, details_path


def main():
    parser = argparse.ArgumentParser(description="Evaluate Soros Advisor RAG retrieval quality.")
    parser.add_argument(
        "--golden",
        default="evals/golden_questions.csv",
        help="Path to golden questions CSV.",
    )
    parser.add_argument(
        "--data",
        default="rag/data/Soros_Questions.xlsx",
        help="Path to Soros Q&A Excel dataset.",
    )
    parser.add_argument(
        "--top-k",
        type=int,
        default=5,
        help="Number of retrieved items to evaluate.",
    )
    parser.add_argument(
        "--output-dir",
        default="evals/results",
        help="Directory where evaluation results will be written.",
    )

    args = parser.parse_args()

    metrics, rows = evaluate(args.golden, args.data, args.top_k)
    metrics_path, details_path = write_results(metrics, rows, args.output_dir)

    print("\nRAG Evaluation Summary")
    print("----------------------")
    for key, value in metrics.items():
        print(f"{key}: {value}")

    print(f"\nSaved summary to: {metrics_path}")
    print(f"Saved details to: {details_path}")


if __name__ == "__main__":
    main()
