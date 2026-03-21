# Soros Advisor

An educational RAG-powered chatbot for exploring George Soros's investment philosophy, macro strategy, and risk management principles.

## Project Structure

```
├── backend/          # FastAPI server, API endpoints, file uploads
├── frontend/         # React SPA (Vite), chat UI, analytics pages
├── rag/              # RAG pipeline, embeddings, market data utils
│   └── data/         # Q&A corpus (Excel)
└── README.md
```

## Quick Start

### Prerequisites

- Python 3.10+
- Node.js 18+
- A Google Gemini API key

### Backend

```bash
cd backend
pip install -r requirements.txt
```

Set your API key (pick one):

```bash
export GOOGLE_API_KEY=your-key-here
# or
export GEMINI_API_KEY=your-key-here
```

Start the server:

```bash
uvicorn main:app --reload
```

The API runs at `http://localhost:8000`. Verify with `GET /health`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Opens at `http://localhost:5173`.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GOOGLE_API_KEY` / `GEMINI_API_KEY` | Yes | — | Gemini API key for LLM generation |
| `SOROS_QA_PATH` | No | `rag/data/Soros_Questions.xlsx` | Path to Q&A corpus |
| `GEMINI_MODEL_NAME` | No | `models/gemini-2.5-flash` | Gemini model to use |

## RAG Pipeline

The retrieval-augmented generation pipeline works in three stages:

1. **Retrieval** — User query is embedded with `all-MiniLM-L6-v2` and matched against the Q&A corpus via cosine similarity (top-5, threshold 0.40)
2. **Augmentation** — If a stock ticker is mentioned, real-time market data (price, moving averages, volatility) is fetched and appended as context
3. **Generation** — Retrieved context + user query is sent to Gemini for response generation (temp 0.4, max 1024 tokens)

### Updating the Knowledge Base

The Q&A corpus lives at `rag/data/Soros_Questions.xlsx` with columns:

| Column | Required | Description |
|---|---|---|
| `Question` | Yes | The question text |
| `Answer` | Yes | The answer text |
| `Label` | No | Optional category label |

To add new knowledge:

1. Open `rag/data/Soros_Questions.xlsx`
2. Add new rows with question-answer pairs
3. Restart the backend — embeddings regenerate automatically on startup

### File Upload (Runtime)

Users can upload CSV/XLSX files (max 10MB) through the chat UI. These files are used as conversation context for analysis — they are **not** added to the RAG corpus.

## API Endpoints

### Chat & RAG

| Endpoint | Method | Description |
|---|---|---|
| `POST /api/rag` | POST | Query the RAG pipeline. Body: `{ "message": "...", "file_context": "...", "mode": "charts\|research\|analytics" }` |
| `POST /api/upload` | POST | Upload CSV/XLSX file for analysis (multipart/form-data) |

### Financial Analysis

| Endpoint | Method | Description |
|---|---|---|
| `GET /api/financials/{symbol}` | GET | Financial statements, risk ratios, and diagnostics |
| `POST /api/pairs` | POST | Pairs trading backtest with cointegration analysis |

### Chat History

| Endpoint | Method | Description |
|---|---|---|
| `GET /api/history` | GET | List all saved conversations |
| `GET /api/history/{id}` | GET | Retrieve a specific conversation |
| `POST /api/history` | POST | Save/update a conversation |
| `DELETE /api/history/{id}` | DELETE | Delete a conversation |

### Health

| Endpoint | Method | Description |
|---|---|---|
| `GET /health` | GET | Server status and RAG availability |

## Query Modes

The `/api/rag` endpoint supports optional `mode` parameter:

- **`charts`** — Focuses on technical analysis, price action, moving averages
- **`research`** — Deep multi-angle analysis with historical parallels
- **`analytics`** — Quantitative metrics, ratios, statistical patterns

## Tech Stack

**Backend:** FastAPI, Uvicorn, Gemini API, sentence-transformers, yfinance, pandas, statsmodels

**Frontend:** React 19, Vite, React Router, react-markdown

## Data Directories

| Directory | Purpose |
|---|---|
| `rag/data/` | Q&A corpus |
| `backend/data/history/` | Saved chat conversations (JSON) |
| `backend/data/uploads/` | User-uploaded files |

## Disclaimer

This is an educational tool. Nothing produced by this system is investment advice. Always do your own research and consult qualified financial professionals before making investment decisions.
