import os
import sys
import io
import json
import uuid
import asyncio

from dotenv import load_dotenv
load_dotenv()
import math
from pathlib import Path
from datetime import datetime
from typing import Optional, Literal

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import numpy as np
import pandas as pd
import yfinance as yf
import google.generativeai as genai
from arcis.fastapi import ArcisMiddleware

try:
    from statsmodels.tsa.stattools import coint
except ImportError:
    coint = None

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from rag import create_default_rag_service, RAGService
from local_llm import (
    build_local_prompt,
    generate_local_with_limits,
    normalize_model_provider,
    LocalModelBusyError,
    LocalModelTimeoutError,
)

# Paths
_BASE = Path(__file__).resolve().parent
HISTORY_DIR = _BASE / "data" / "history"
UPLOADS_DIR = _BASE / "data" / "uploads"
HISTORY_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

# RAG singleton
_rag: RAGService | None = None
_rag_err: str | None = None

SAFETY_MSG = (
    "I appreciate your question, but I'm unable to provide a response "
    "on this particular topic. Please try rephrasing your question to "
    "focus on Soros's general investment philosophy, reflexivity theory, "
    "or macro-economic concepts."
)

MODE_BOOST = {
    "charts": (
        "\n\n[MODE: CHARTS]\n"
        "Focus on trends, price action, technical signals, moving averages, "
        "support/resistance levels. Describe what a chart would reveal and "
        "what Soros would read from it. Reference specific numbers."
    ),
    "research": (
        "\n\n[MODE: DEEP RESEARCH]\n"
        "Go in-depth. Cover historical parallels, multiple angles, contrarian "
        "viewpoints, interconnected macro factors. Write 3-4 detailed paragraphs. "
        "Cite specific events, dates, and Soros quotes where relevant."
    ),
    "analytics": (
        "\n\n[MODE: ANALYTICS]\n"
        "Focus on quantitative analysis: ratios, percentages, statistical patterns. "
        "If file data is present, extract key metrics and trends. Present numbers "
        "clearly and flag anomalies Soros would notice."
    ),
}

GEN_CONFIG = genai.types.GenerationConfig(
    temperature=0.4, top_p=0.9, top_k=40, max_output_tokens=1024,
)


# --- Models ---

class RAGRequest(BaseModel):
    message: str
    file_context: Optional[str] = None
    mode: Optional[str] = None
    model_provider: Optional[Literal["gemini", "local"]] = None
    local_model_name: Optional[str] = None

class RAGResponse(BaseModel):
    reply: str

class PairsRequest(BaseModel):
    stock1: str
    stock2: str
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    z_threshold: float = 1.0
    exit_z: float = 0.25
    rolling_window: int = 60

class ChatSaveRequest(BaseModel):
    id: Optional[str] = None
    title: str
    messages: list[dict[str, str]]


# --- Helpers ---

def _boot_rag():
    global _rag, _rag_err
    if _rag or _rag_err:
        return
    try:
        _rag = create_default_rag_service()
    except Exception as exc:
        _rag_err = str(exc)


def _gemini():
    key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    if not key:
        raise RuntimeError("Set GOOGLE_API_KEY or GEMINI_API_KEY env var.")
    genai.configure(api_key=key)
    name = os.getenv("GEMINI_MODEL_NAME", "models/gemini-2.5-flash")
    return genai.GenerativeModel(name)


def _generate_gemini_reply(prompt: str) -> str:
    resp = _gemini().generate_content(prompt, generation_config=GEN_CONFIG)
    text = _extract_text(resp)
    if not text:
        return SAFETY_MSG
    return text


def _build_full_prompt(req: "RAGRequest", result: dict) -> str:
    prompt = result["prompt"]
    if req.file_context:
        prompt += f"\n\n[CONTEXT - UPLOADED FILE DATA]\n{req.file_context}"
    if req.mode in MODE_BOOST:
        prompt += MODE_BOOST[req.mode]
    return prompt


async def _generate_local_with_limits(prompt: str, local_model_name: Optional[str]) -> str:
    try:
        return await generate_local_with_limits(prompt, local_model_name)
    except LocalModelBusyError as exc:
        raise HTTPException(429, detail=str(exc))
    except LocalModelTimeoutError as exc:
        raise HTTPException(504, detail=str(exc))


def _float(val) -> Optional[float]:
    try:
        v = val.item() if hasattr(val, "item") else val
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else f
    except Exception:
        return None


def _cell(df: pd.DataFrame, key: str, col: int = 0):
    try:
        if col < len(df.columns):
            v = df.loc[key, df.columns[col]]
            return 0 if pd.isna(v) else v
    except KeyError:
        pass
    return None


def _ratio(num, den):
    if isinstance(num, (int, float)) and isinstance(den, (int, float)) and den != 0:
        return num / den
    return None


def _fmt(val, pct=False):
    if val is None:
        return "N/A"
    try:
        return f"{float(val):.2%}" if pct else f"{float(val):,.2f}"
    except (ValueError, TypeError):
        return "N/A"


def _stmt_json(df: pd.DataFrame, years=4):
    try:
        sub = df.iloc[:, :years].fillna("N/A")
        sub.columns = sub.columns.strftime("%Y-%m-%d")
        return sub.reset_index().rename(columns={"index": "Item"}).to_dict(orient="records")
    except Exception:
        return []


def _get_stmt(ticker, names):
    for n in names:
        try:
            s = getattr(ticker, n, pd.DataFrame())
            if callable(s):
                s = s()
            if s is not None and not s.empty:
                return s
        except Exception:
            continue
    return pd.DataFrame()


def _extract_text(response):
    text = getattr(response, "text", None)
    if text:
        return text.strip()

    feedback = getattr(response, "prompt_feedback", None)
    if feedback and getattr(feedback, "block_reason", None):
        return None

    for cand in getattr(response, "candidates", []) or []:
        if str(getattr(cand, "finish_reason", "")) == "SAFETY":
            return None
        content = getattr(cand, "content", None)
        if not content:
            continue
        for part in getattr(content, "parts", []) or []:
            t = getattr(part, "text", None)
            if t:
                return t.strip()
    return None


# --- App ---

app = FastAPI(title="Soros v3")

app.add_middleware(ArcisMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _startup():
    _boot_rag()


# --- RAG ---

@app.post("/api/rag", response_model=RAGResponse)
async def rag_chat(req: RAGRequest):
    _boot_rag()
    if not _rag:
        raise HTTPException(500, detail=f"RAG unavailable: {_rag_err}")

    result = _rag.build_rag_request(req.message)
    if result.get("error"):
        return RAGResponse(reply=result["error"])

    prompt = _build_full_prompt(req, result)
    provider = normalize_model_provider(req.model_provider)

    try:
        if provider == "local":
            text = await _generate_local_with_limits(
                build_local_prompt(
                    message=req.message,
                    file_context=req.file_context,
                    mode=req.mode,
                    ticker=result.get("ticker"),
                    retrieved=result.get("retrieved") or [],
                    enabled_modes=set(MODE_BOOST),
                ),
                req.local_model_name,
            )
        else:
            text = await asyncio.to_thread(_generate_gemini_reply, prompt)
        return RAGResponse(reply=text)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, detail=f"Generation failed: {exc}")


# --- Pairs Trading ---

@app.post("/api/pairs")
async def pairs_trade(req: PairsRequest):
    sym_a, sym_b = req.stock1.strip().upper(), req.stock2.strip().upper()
    if not sym_a or not sym_b:
        raise HTTPException(400, detail="Both symbols required.")

    today = pd.Timestamp.today().normalize()

    if req.start_date and req.end_date:
        try:
            start = pd.to_datetime(req.start_date).normalize()
            end = pd.to_datetime(req.end_date).normalize()
        except Exception:
            raise HTTPException(400, detail="Invalid date format. Use YYYY-MM-DD.")
        end = min(end, today)
        if start >= end:
            start = end - pd.Timedelta(days=365)
    else:
        end = today
        start = end - pd.Timedelta(days=365)

    # Fetch prices
    try:
        raw = yf.download([sym_a, sym_b], start=start, end=end, auto_adjust=False, progress=False)
        if raw is None or raw.empty:
            raise HTTPException(429, detail="Price data unavailable, retry shortly.")
        prices = raw.get("Adj Close", raw.get("Close", raw))
        if isinstance(raw.columns, pd.MultiIndex):
            prices = raw.get("Adj Close", raw.get("Close"))
        elif "Adj Close" in raw:
            prices = raw["Adj Close"]
        if isinstance(prices, pd.Series):
            prices = prices.to_frame()
    except HTTPException:
        raise
    except Exception as exc:
        if "Too Many Requests" in str(exc):
            raise HTTPException(429, detail="Rate limited, retry shortly.")
        raise HTTPException(500, detail=f"Download failed: {exc}")

    if prices is None or prices.empty or prices.isna().all().any():
        raise HTTPException(404, detail="No price data for one or both symbols.")
    for s in [sym_a, sym_b]:
        if s not in prices.columns:
            raise HTTPException(404, detail=f"No data for {s}.")

    sa, sb = prices[sym_a].dropna(), prices[sym_b].dropna()
    common = sa.index.intersection(sb.index)
    if len(common) < 30:
        raise HTTPException(404, detail="Need 30+ overlapping trading days.")
    sa, sb = sa.loc[common], sb.loc[common]

    beta = float(np.polyfit(sb.values, sa.values, 1)[0])

    # Cointegration
    p_val = coint_stat = None
    if coint and len(sa) >= 30:
        try:
            la = np.log(sa.replace(0, np.nan)).dropna()
            lb = np.log(sb.replace(0, np.nan)).dropna()
            ix = la.index.intersection(lb.index)
            stat, pv, _ = coint(la.loc[ix], lb.loc[ix], trend="c")
            p_val, coint_stat = float(pv), float(stat)
        except Exception:
            pass

    # Spread + z-score
    spread = sa - beta * sb
    win = req.rolling_window
    half = max(2, win // 2)
    rm = spread.rolling(win, min_periods=half).mean()
    rs = spread.rolling(win, min_periods=half).std().replace(0, np.nan)
    z = (spread - rm) / rs.fillna(rs.mean() or 1e-9)

    ret_a, ret_b = sa.pct_change().fillna(0), sb.pct_change().fillna(0)
    eu, el = rm + req.z_threshold * rs, rm - req.z_threshold * rs

    # Series for frontend
    spread_out = [
        {"date": str(t.date()), "spread": _float(spread[t]), "mean": _float(rm[t]),
         "entryUpper": _float(eu[t]), "entryLower": _float(el[t])}
        for t in spread.index
    ]

    # Backtest
    pos, trades, cum = 0, 0, 1.0
    z_out, pnl_out = [], []
    for i in range(1, len(z)):
        dt = str(z.index[i].date())
        zv = _float(z.iloc[i])
        z_out.append({"date": dt, "z": zv})
        if zv is not None:
            if pos == 0:
                if zv > req.z_threshold:
                    pos, trades = -1, trades + 1
                elif zv < -req.z_threshold:
                    pos, trades = 1, trades + 1
            elif abs(zv) < req.exit_z:
                pos = 0
        pnl = pos * (float(ret_a.iloc[i]) - beta * float(ret_b.iloc[i]))
        cum *= (1 + pnl)
        pnl_out.append({"date": dt, "cumulativeReturn": _float(cum - 1)})

    price_out = [
        {"date": str(t.date()), "priceA": _float(sa[t]), "priceB": _float(sb[t])}
        for t in sa.index[-300:]
    ]

    # Soros insight
    insight = None
    try:
        prompt = (
            f"You are George Soros. Pairs trade backtest: {sym_a} vs {sym_b}, "
            f"{start.date()} to {end.date()}, hedge ratio {beta:.4f}, "
            f"coint p-value {p_val}, {trades} trades, "
            f"cumulative return {_float(cum - 1)}. "
            f"Give 3 bullet insights and one action (cut/press/hedge/wait). "
            f"Reflect reflexivity and risk."
        )
        r = _gemini().generate_content(prompt)
        insight = getattr(r, "text", "").strip() or None
    except Exception:
        pass

    out = {
        "symbols": {"A": sym_a, "B": sym_b},
        "dateRange": {"start": str(start.date()), "end": str(end.date())},
        "hedgeRatio": _float(beta),
        "cointegrationPValue": _float(p_val),
        "cointegrationTestStatistic": _float(coint_stat),
        "cointegrationInterpretation": (
            "Cointegrated (p < 0.05)" if p_val is not None and p_val < 0.05
            else "Not cointegrated (p >= 0.05)" if p_val is not None
            else "Cointegration test unavailable"
        ),
        "latestZScore": _float(z.iloc[-1]) if len(z) else None,
        "trades": trades,
        "cumulativeReturn": _float(cum - 1),
        "entryZ": req.z_threshold, "exitZ": req.exit_z, "rollingWindow": win,
        "zHistory": z_out[-200:],
        "spreadSeries": spread_out[-300:],
        "pnlSeries": pnl_out[-300:],
        "priceSeries": price_out,
    }
    if insight:
        out["sorosInsight"] = insight
    return out


# --- Financials ---

@app.get("/api/financials/{symbol}")
async def financials(symbol: str):
    symbol = symbol.strip().upper()
    if not symbol:
        raise HTTPException(400, detail="Symbol required.")

    try:
        stock = yf.Ticker(symbol)
        inc = _get_stmt(stock, ["financials", "income_stmt", "get_income_stmt"])
        bal = _get_stmt(stock, ["balance_sheet", "get_balance_sheet"])
        cf = _get_stmt(stock, ["cashflow", "get_cashflow"])

        if inc.empty or bal.empty:
            raise HTTPException(404, detail=f"No financial data for {symbol}.")

        # Pull values
        gp = _cell(inc, "Gross Profit")
        rev = _cell(inc, "Total Revenue")
        sga = _cell(inc, "Selling General And Administration")
        rd = _cell(inc, "Research And Development")
        dep = _cell(inc, "Reconciled Depreciation")
        intx = _cell(inc, "Interest Expense")
        oi = _cell(inc, "Operating Income")
        ni = _cell(inc, "Net Income")
        cash = _cell(bal, "Cash And Cash Equivalents")
        cdebt = _cell(bal, "Current Debt")
        tl = _cell(bal, "Total Liabilities Net Minority Interest")
        te = _cell(bal, "Total Equity Gross Minority Interest")
        capex = _cell(cf, "Capital Expenditure")

        def check(val, op, thresh):
            if not isinstance(val, (int, float)):
                return None
            return val >= thresh if op == ">=" else val <= thresh if op == "<=" else val < thresh

        ratios = [
            {"name": "Gross Margin (resilience)", "value": _fmt(_ratio(gp, rev), pct=True),
             "rule": "> 40%", "meets": check(_ratio(gp, rev), ">=", 0.40)},
            {"name": "SG&A / Gross Profit (cost discipline)", "value": _fmt(_ratio(sga, gp), pct=True),
             "rule": "< 30%", "meets": check(_ratio(sga, gp), "<=", 0.30)},
            {"name": "R&D / Gross Profit (innovation spend)", "value": _fmt(_ratio(rd, gp), pct=True),
             "rule": "< 30%", "meets": check(_ratio(rd, gp), "<=", 0.30)},
            {"name": "Depreciation / Gross Profit (asset intensity)", "value": _fmt(_ratio(dep, gp), pct=True),
             "rule": "< 10%", "meets": check(_ratio(dep, gp), "<=", 0.10)},
            {"name": "Interest Exp / Operating Income (debt burden)", "value": _fmt(_ratio(intx, oi), pct=True),
             "rule": "< 15%", "meets": check(_ratio(intx, oi), "<=", 0.15)},
            {"name": "Net Margin (profit capture)", "value": _fmt(_ratio(ni, rev), pct=True),
             "rule": "> 20%", "meets": check(_ratio(ni, rev), ">=", 0.20)},
            {"name": "Debt to Equity (leverage)", "value": _fmt(_ratio(tl, te)),
             "rule": "< 1.00", "meets": check(_ratio(tl, te), "<", 1.00)},
        ]

        # Cash vs debt
        cash_ok = None
        if isinstance(cash, (int, float)) and isinstance(cdebt, (int, float)):
            cash_ok = cash > cdebt
        ratios.append({
            "name": "Cash vs Current Debt (liquidity)",
            "value": "Cash > Debt" if cash_ok else ("Debt >= Cash" if cash_ok is False else "N/A"),
            "rule": "Cash > Debt", "meets": cash_ok,
        })

        # CapEx ratio
        cx = _ratio(abs(capex) if isinstance(capex, (int, float)) else None, ni)
        ratios.append({
            "name": "CapEx / Net Income (cash demands)", "value": _fmt(cx, pct=True),
            "rule": "< 25%", "meets": check(cx, "<", 0.25),
        })

        return {
            "symbol": symbol, "ratios": ratios,
            "incomeStatement": _stmt_json(inc),
            "balanceSheet": _stmt_json(bal),
            "cashFlow": _stmt_json(cf) if not cf.empty else [],
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, detail=f"Error processing {symbol}: {exc}")


# --- File Upload ---

def _parse_file(content: bytes, name: str):
    ext = Path(name).suffix.lower()
    if ext in (".xlsx", ".xls"):
        df = pd.read_excel(io.BytesIO(content))
    elif ext == ".csv":
        df = pd.read_csv(io.BytesIO(content))
    else:
        raise ValueError(f"Unsupported: {ext}")

    lines = [
        f"File: {name}",
        f"Shape: {df.shape[0]} rows x {df.shape[1]} columns",
        f"Columns: {', '.join(df.columns.astype(str))}",
        "", "Column types:",
    ]
    for col in df.columns:
        lines.append(f"  - {col} ({df[col].dtype}, {int(df[col].isna().sum())} nulls)")

    nums = df.select_dtypes(include="number").columns.tolist()
    if nums:
        lines += ["", "Numeric summary:", df[nums].describe().round(2).to_string()]

    lines += ["", "Sample (first 10 rows):", df.head(10).fillna("N/A").to_string(index=False)]

    summary = "\n".join(lines)
    if len(summary) > 4000:
        summary = summary[:4000] + "\n... (truncated)"

    return {
        "filename": name, "rows": df.shape[0], "columns": df.shape[1],
        "column_names": df.columns.tolist(), "text_summary": summary,
    }


@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(400, detail="No file provided.")
    ext = Path(file.filename).suffix.lower()
    if ext not in (".xlsx", ".xls", ".csv"):
        raise HTTPException(400, detail=f"Unsupported type '{ext}'. Use .xlsx, .xls, or .csv.")

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(400, detail="File too large (max 10MB).")

    try:
        result = _parse_file(content, file.filename)
    except Exception as exc:
        raise HTTPException(400, detail=f"Parse failed: {exc}")

    fid = str(uuid.uuid4())
    (UPLOADS_DIR / f"{fid}{ext}").write_bytes(content)
    result["file_id"] = fid
    return result


# --- Chat History ---

@app.get("/api/history")
async def list_chats():
    chats = []
    for fp in HISTORY_DIR.glob("*.json"):
        try:
            d = json.loads(fp.read_text(encoding="utf-8"))
            chats.append({
                "id": d["id"], "title": d["title"],
                "messageCount": len(d.get("messages", [])),
                "updatedAt": d.get("updatedAt", ""),
            })
        except Exception:
            continue
    chats.sort(key=lambda c: c["updatedAt"], reverse=True)
    return chats


@app.get("/api/history/{chat_id}")
async def get_chat(chat_id: str):
    fp = HISTORY_DIR / f"{chat_id}.json"
    if not fp.exists():
        raise HTTPException(404, detail="Chat not found.")
    return json.loads(fp.read_text(encoding="utf-8"))


@app.post("/api/history")
async def save_chat(req: ChatSaveRequest):
    cid = req.id or str(uuid.uuid4())
    data = {
        "id": cid, "title": req.title, "messages": req.messages,
        "updatedAt": datetime.utcnow().isoformat() + "Z",
    }
    (HISTORY_DIR / f"{cid}.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return data


@app.delete("/api/history/{chat_id}")
async def delete_chat(chat_id: str):
    fp = HISTORY_DIR / f"{chat_id}.json"
    if fp.exists():
        fp.unlink()
    return {"ok": True}


@app.get("/health")
async def health():
    _boot_rag()
    return {"status": "ok" if _rag else "error", "rag_error": _rag_err}
