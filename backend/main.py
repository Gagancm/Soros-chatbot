import os
import re
import sys
import io
import json
import uuid
import asyncio
import logging
import threading

from dotenv import load_dotenv
load_dotenv()
import math
from pathlib import Path
from datetime import datetime
from typing import Optional, Literal

logger = logging.getLogger("soros")
if not logger.handlers:
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

_CHAT_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

def _safe_chat_id(chat_id: str) -> str:
    if not chat_id or not _CHAT_ID_RE.match(chat_id):
        raise HTTPException(400, detail="Invalid chat id.")
    return chat_id

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
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
from rag.skills import SKILL_DEFINITIONS, execute_skill
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
_rag_lock = threading.Lock()

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

class HistoryMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str = Field(max_length=20_000)

class RAGRequest(BaseModel):
    message: str = Field(min_length=1, max_length=8_000)
    file_context: Optional[str] = Field(default=None, max_length=200_000)
    mode: Optional[str] = None
    model_provider: Optional[Literal["gemini", "local"]] = None
    local_model_name: Optional[str] = Field(default=None, max_length=200)
    history: Optional[list[HistoryMessage]] = Field(default=None, max_length=100)

class RAGResponse(BaseModel):
    reply: str
    skills_used: Optional[list[str]] = None
    sources: Optional[list[dict]] = None

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
    with _rag_lock:
        if _rag or _rag_err:
            return
        try:
            _rag = create_default_rag_service()
            logger.info("RAG service initialized.")
        except Exception as exc:
            _rag_err = str(exc)
            logger.exception("RAG init failed: %s", exc)


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


def _generate_gemini_with_skills(
    prompt: str,
    history: list[dict] | None = None,
) -> tuple[str, list[str]]:
    """Agentic tool-calling loop. Returns (reply_text, skills_invoked)."""
    key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    if not key:
        raise RuntimeError("Set GOOGLE_API_KEY or GEMINI_API_KEY env var.")
    genai.configure(api_key=key)
    model_name = os.getenv("GEMINI_MODEL_NAME", "models/gemini-2.5-flash")

    # Convert history to Gemini format (role: "user"/"model")
    gemini_history = []
    for msg in (history or []):
        role = "model" if msg["role"] == "assistant" else "user"
        gemini_history.append({"role": role, "parts": [msg["content"]]})

    model = genai.GenerativeModel(model_name, tools=SKILL_DEFINITIONS)
    chat = model.start_chat(history=gemini_history)
    skills_invoked: list[str] = []

    response = chat.send_message(prompt, generation_config=GEN_CONFIG)

    for _ in range(3):
        fn_calls = [
            part.function_call
            for part in (getattr(response, "parts", []) or [])
            if getattr(getattr(part, "function_call", None), "name", "")
        ]

        if not fn_calls:
            text = _extract_text(response)
            return (text or SAFETY_MSG), skills_invoked

        fn_response_parts = []
        for fn in fn_calls:
            skill_name = fn.name
            skills_invoked.append(skill_name)
            result = execute_skill(skill_name, dict(fn.args))
            fn_response_parts.append(
                genai.protos.Part(
                    function_response=genai.protos.FunctionResponse(
                        name=skill_name,
                        response=result,
                    )
                )
            )

        response = chat.send_message(fn_response_parts, generation_config=GEN_CONFIG)

    text = _extract_text(response)
    return (text or SAFETY_MSG), skills_invoked


def _build_full_prompt(req: "RAGRequest", result: dict) -> str:
    prompt = result["prompt"]
    if req.file_context:
        prompt += f"\n\n[CONTEXT - UPLOADED FILE DATA]\n{req.file_context}"
    if req.mode in MODE_BOOST:
        prompt += MODE_BOOST[req.mode]
    ticker = result.get("ticker")
    if ticker:
        prompt += (
            f"\n\n[SKILL INSTRUCTIONS]\n"
            f"The user mentioned ticker {ticker}. You have tools available. "
            f"You MUST call at least one relevant tool before responding:\n"
            f"- assess_reflexivity('{ticker}') — to score Soros reflexivity\n"
            f"- get_market_snapshot('{ticker}') — for live price/MA/volatility\n"
            f"- analyze_financials('{ticker}') — for fundamental ratios\n"
            f"Call the most relevant tool(s) first, then synthesize the results "
            f"into your educational response."
        )
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


def _py(v):
    """Coerce numpy / pandas scalars to native Python types for JSON."""
    if v is None:
        return None
    if isinstance(v, (bool,)):
        return bool(v)
    try:
        import numpy as np
        if isinstance(v, np.bool_):
            return bool(v)
        if isinstance(v, np.integer):
            return int(v)
        if isinstance(v, np.floating):
            fv = float(v)
            return None if (fv != fv) else fv  # drop NaN
    except Exception:
        pass
    if isinstance(v, float):
        return None if (v != v) else v
    return v


def _cell(df: pd.DataFrame, key: str, col: int = 0):
    try:
        if col < len(df.columns):
            v = df.loc[key, df.columns[col]]
            if pd.isna(v):
                return 0
            return _py(v)
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
        if df is None or df.empty:
            return []
        sub = df.iloc[:, :years].fillna("N/A")
        # Handle both Timestamp columns and plain strings
        try:
            sub.columns = sub.columns.strftime("%Y-%m-%d")
        except AttributeError:
            sub.columns = [str(c)[:10] for c in sub.columns]
        rows = sub.reset_index().rename(columns={"index": "Item"}).to_dict(orient="records")
        # Coerce every cell to a JSON-safe scalar
        clean = []
        for r in rows:
            clean.append({k: (_py(v) if v != "N/A" else "N/A") for k, v in r.items()})
        return clean
    except Exception as exc:
        print(f"[_stmt_json] error: {exc}")
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
_cors_env = os.getenv("CORS_ORIGINS", "").strip()
_cors_origins = [o.strip() for o in _cors_env.split(",") if o.strip()] or ["*"]
# Browsers reject Access-Control-Allow-Credentials=true with Allow-Origin=*; only
# allow credentials when an explicit origin list is configured.
_cors_allow_credentials = _cors_origins != ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=_cors_allow_credentials,
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
        raise HTTPException(503, detail=f"RAG unavailable: {_rag_err}")

    if req.mode and req.mode not in MODE_BOOST:
        raise HTTPException(
            400, detail=f"Invalid mode '{req.mode}'. Allowed: {sorted(MODE_BOOST)}"
        )

    result = _rag.build_rag_request(req.message)
    provider = normalize_model_provider(req.model_provider)

    if result.get("error"):
        # RAG miss: local model has no fallback; Gemini can still try skills
        if provider == "local":
            return RAGResponse(reply=result["error"])
        prompt = (
            f"You are a Soros-inspired financial advisor assistant.\n"
            f"The user asked: {req.message}\n\n"
            f"No relevant Soros Q&A was found for this topic. "
            f"Use your available tools if the question concerns market data, "
            f"financial analysis, position sizing, or reflexivity. "
            f"Otherwise explain what topics you can help with."
        )
    else:
        prompt = _build_full_prompt(req, result)

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
            return RAGResponse(reply=text)
        else:
            # Keep last 10 messages (5 turns) to stay within token budget
            history = [m.model_dump() for m in (req.history or [])[-10:]]
            text, skills = await asyncio.to_thread(
                _generate_gemini_with_skills, prompt, history
            )
            sources = [
                {"question": item["question"], "score": round(item["score"], 3)}
                for item in (result.get("retrieved") or [])[:3]
            ]
            return RAGResponse(
                reply=text,
                skills_used=skills if skills else None,
                sources=sources if sources else None,
            )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Generation failed")
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

def _demo_financials(symbol: str) -> dict:
    """Fallback when yfinance is rate-limited or returns empty data."""
    years = ["2024-09-30", "2023-09-30", "2022-09-30", "2021-09-30"]
    rev  = [391035_000_000, 383285_000_000, 394328_000_000, 365817_000_000]
    gp   = [180683_000_000, 169148_000_000, 170782_000_000, 152836_000_000]
    oi   = [123216_000_000, 114301_000_000, 119437_000_000, 108949_000_000]
    ni   = [ 93736_000_000,  96995_000_000,  99803_000_000,  94680_000_000]
    inc_rows = [
        {"Item": "Total Revenue",    **{y: rev[i] for i, y in enumerate(years)}},
        {"Item": "Gross Profit",     **{y: gp[i]  for i, y in enumerate(years)}},
        {"Item": "Operating Income", **{y: oi[i]  for i, y in enumerate(years)}},
        {"Item": "Net Income",       **{y: ni[i]  for i, y in enumerate(years)}},
    ]
    bal_rows = [
        {"Item": "Cash And Cash Equivalents", **{y: 50_000_000_000 for y in years}},
        {"Item": "Current Debt",              **{y: 20_000_000_000 for y in years}},
        {"Item": "Total Liabilities Net Minority Interest", **{y: 300_000_000_000 for y in years}},
        {"Item": "Total Equity Gross Minority Interest",    **{y: 70_000_000_000 for y in years}},
    ]
    cf_rows = [
        {"Item": "Capital Expenditure", **{y: -10_000_000_000 for y in years}},
    ]
    ratios = [
        {"name": "Gross Margin (resilience)",                 "value": "46.21%", "rule": "> 40%",    "meets": True},
        {"name": "Operating Margin",                          "value": "31.51%", "rule": "> 20%",    "meets": True},
        {"name": "Net Margin (profit capture)",               "value": "23.97%", "rule": "> 20%",    "meets": True},
        {"name": "Debt to Equity (leverage)",                 "value": "4.29",   "rule": "< 1.00",   "meets": False},
        {"name": "Cash vs Current Debt (liquidity)",          "value": "Cash > Debt", "rule": "Cash > Debt", "meets": True},
        {"name": "CapEx / Net Income (cash demands)",         "value": "10.67%", "rule": "< 25%",    "meets": True},
    ]
    return {
        "symbol": symbol, "ratios": ratios,
        "incomeStatement": inc_rows, "balanceSheet": bal_rows, "cashFlow": cf_rows,
        "demoData": True,
    }


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
            print(f"[financials] {symbol}: yfinance returned empty — serving demo fallback")
            return _demo_financials(symbol)

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
            if not isinstance(val, (int, float)) or isinstance(val, bool):
                return None
            try:
                if op == ">=": return bool(val >= thresh)
                if op == "<=": return bool(val <= thresh)
                return bool(val < thresh)
            except Exception:
                return None

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
            cash_ok = bool(cash > cdebt)
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
        import traceback
        print(f"[financials] {symbol}: {exc}\n{traceback.format_exc()}")
        # Fall back to demo data rather than 500'ing the UI
        return _demo_financials(symbol)


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
    cid = _safe_chat_id(chat_id)
    fp = HISTORY_DIR / f"{cid}.json"
    if not fp.exists():
        raise HTTPException(404, detail="Chat not found.")
    return json.loads(fp.read_text(encoding="utf-8"))


@app.post("/api/history")
async def save_chat(req: ChatSaveRequest):
    cid = _safe_chat_id(req.id) if req.id else str(uuid.uuid4())
    data = {
        "id": cid, "title": req.title, "messages": req.messages,
        "updatedAt": datetime.utcnow().isoformat() + "Z",
    }
    payload = json.dumps(data, ensure_ascii=False, indent=2)
    await asyncio.to_thread(
        (HISTORY_DIR / f"{cid}.json").write_text, payload, encoding="utf-8"
    )
    return data


@app.delete("/api/history/{chat_id}")
async def delete_chat(chat_id: str):
    cid = _safe_chat_id(chat_id)
    fp = HISTORY_DIR / f"{cid}.json"
    if fp.exists():
        fp.unlink()
    return {"ok": True}


@app.get("/health")
async def health():
    _boot_rag()
    return {"status": "ok" if _rag else "error", "rag_error": _rag_err}
