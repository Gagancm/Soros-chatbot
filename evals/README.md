# RAG Evaluation

This folder contains a lightweight evaluation framework for the Soros Advisor RAG pipeline.

The goal is to measure whether the retrieval layer returns relevant knowledge-base examples for representative user questions.

## Files

- golden_questions.csv: benchmark questions with expected labels and keywords
- evaluate_rag.py: retrieval evaluation script
- results/rag_eval_summary.csv: summary metrics generated after running evaluation
- results/rag_eval_details.csv: question-level retrieval results

## Metrics

Label Match@1:
Checks whether the top retrieved result belongs to the expected label.

Label Match@5:
Checks whether any of the top 5 retrieved results belong to the expected label.

Keyword Match@5:
Checks whether the retrieved question/answer text contains at least one expected keyword.

Average Top Score:
Average similarity score of the top retrieved result.

Average Latency:
Average retrieval time per question in milliseconds.

## Run Evaluation

From the project root, run:

python evals/evaluate_rag.py

Optional:

python evals/evaluate_rag.py --top-k 5

## Purpose

This evaluation helps track whether changes to the Q&A corpus, embeddings, or retrieval logic improve the chatbot's grounding quality.
