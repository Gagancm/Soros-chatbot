import os
from pathlib import Path
from typing import Optional

from pydantic import BaseModel
from sentence_transformers import SentenceTransformer, util
import torch
import pandas as pd

from .ticker_utils import extract_ticker
from .market_data import get_market_snapshot


class RAGConfig(BaseModel):
    data_path: Path
    min_similarity: float = 0.40
    top_k: int = 5


SYSTEM_INSTRUCTIONS = """
You are NOT a financial advisor and you MUST NOT provide financial advice.
Your role is to provide **educational, historical, philosophical, and conceptual commentary**
inspired by George Soros's published ideas.

## MANDATORY REINTERPRETATION RULE
If the user asks ANY question that could be interpreted as requesting financial advice or
stock evaluation (e.g., "How is TSLA doing?", "Should I buy Nvidia?", "What does Soros
think of AAPL?", "Is this stock good?"), you MUST IMMEDIATELY rewrite the question
internally as:

    "Explain how Soros's general ideas (reflexivity, market psychology,
     narrative formation, imbalances, perception vs reality) could be applied
     to thinking about an asset LIKE THIS in a purely educational way."

You MUST answer only the reinterpreted educational version, NOT the literal financial
question the user typed.

You are NOT allowed to provide:
- Buy/sell/hold recommendations
- Performance evaluations ("the stock is doing well/bad")
- Forecasts or price targets
- Personalized or actionable financial guidance

## Allowed Content
- Macro concepts (sentiment, narratives, liquidity, psychology)
- Soros's ideas (reflexivity, feedback loops, imbalances)
- Historical analogies
- General conceptual framing
- Educational explanation of risks and uncertainties

## Required Output Style
Respond with a single coherent answer in 1-2 paragraphs (at least 5-7 sentences).
Weave together three elements naturally:
- A Soros-flavored framing of the question (educational only)
- Soros-style reasoning (reflexivity, perception vs reality, psychology)
- Risk/uncertainty factors and what Soros would watch next

Keep your tone analytical, philosophical, and general.
Never output investment advice.
Never treat the question literally when it appears financial.
Always answer the safe, reinterpreted educational version of the question.
Paraphrase the context in your own words and avoid copying long phrases.
""".strip()


class RAGService:
    def __init__(self, config: RAGConfig):
        self.config = config
        self._df = self._load(config.data_path)
        self._corpus = [
            f"Question: {q}\nAnswer: {a}"
            for q, a in zip(self._df["Question"].astype(str), self._df["Answer"].astype(str))
        ]
        self._model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
        self._embeddings = self._model.encode(self._corpus, convert_to_tensor=True, show_progress_bar=False)

    @staticmethod
    def _load(path: Path) -> pd.DataFrame:
        if not path.exists():
            raise FileNotFoundError(f"Q&A dataset not found: {path}")

        df = pd.read_excel(path)
        renames = {
            "Questions": "Question",
            "questions": "Question",
            "question": "Question",
            "Answers": "Answer",
            "answers": "Answer",
            "answer": "Answer",
            "Labels": "Label",
            "labels": "Label",
            "label": "Label",
        }
        for old, new in renames.items():
            if old in df.columns and new not in df.columns:
                df.rename(columns={old: new}, inplace=True)

        missing = {"Question", "Answer"} - set(df.columns)
        if missing:
            raise ValueError(f"Missing columns: {missing}")

        cols = ["Question", "Answer"] + (["Label"] if "Label" in df.columns else [])
        return df[cols].dropna(subset=["Question", "Answer"]).reset_index(drop=True)

    def retrieve(self, query: str, top_k: Optional[int] = None):
        query = (query or "").strip()
        if not query:
            return []

        k = min(top_k or self.config.top_k, len(self._corpus))
        q_emb = self._model.encode(query, convert_to_tensor=True)
        scores = util.cos_sim(q_emb, self._embeddings)[0]
        top = torch.topk(scores, k=k)

        if float(top.values[0]) < self.config.min_similarity:
            return []

        results = []
        for score, idx in zip(top.values, top.indices):
            row = self._df.iloc[int(idx)]
            results.append({
                "score": float(score),
                "question": str(row["Question"]),
                "answer": str(row["Answer"]),
                "label": str(row.get("Label", "")),
            })
        return results

    @staticmethod
    def build_prompt(question: str, items: list, snapshot: Optional[str] = None) -> str:
        if items:
            ctx = "\n\n".join(f"Q: {i['question']}\nA: {i['answer']}" for i in items)
        else:
            ctx = "No relevant Soros Q&A found for this question."

        market = snapshot or "No specific ticker detected. Question may be general or macro-oriented."

        return f"""{SYSTEM_INSTRUCTIONS}

[CONTEXT - SOROS Q&A]
{ctx}

[CONTEXT - MARKET SNAPSHOT]
{market}

[USER QUESTION]
{question}

[INSTRUCTIONS TO THE MODEL]
Using the information above as primary grounding, provide one coherent answer
that blends Soros-style framing, reasoning, and risk/uncertainty watchouts. Keep it concise,
educational, and readable.""".strip()

    def build_rag_request(self, query: str):
        query = (query or "").strip()
        if not query:
            return {"question": query, "prompt": "", "retrieved": [], "error": "Empty question."}

        items = self.retrieve(query)
        if not items:
            return {
                "question": query, "prompt": "", "retrieved": [], "error": (
                    "This topic isn't covered in the Soros knowledge base. "
                    "Try asking about his investing philosophy, risk management, "
                    "macro views, or personal history."
                ),
            }

        snapshot = None
        ticker = extract_ticker(query)
        if ticker:
            try:
                snapshot = get_market_snapshot(ticker)
            except Exception:
                pass

        return {
            "question": query,
            "prompt": self.build_prompt(query, items, snapshot),
            "retrieved": items,
            "ticker": ticker,
            "error": None,
        }


def create_default_rag_service() -> RAGService:
    base = Path(__file__).resolve().parent
    path = os.getenv("SOROS_QA_PATH")
    data = Path(path) if path else base / "data" / "Soros_Questions.xlsx"
    return RAGService(RAGConfig(data_path=data))
