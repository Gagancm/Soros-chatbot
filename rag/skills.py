"""
Skill definitions and handlers for Gemini function-calling.
Each skill wraps existing analysis capabilities or adds new Soros-specific logic.
"""

import warnings

import numpy as np
import pandas as pd
import yfinance as yf
import google.generativeai as genai

from .market_data import get_market_snapshot as _raw_snapshot

warnings.filterwarnings("ignore", category=FutureWarning)

try:
    from statsmodels.tsa.stattools import coint as _coint
except ImportError:
    _coint = None


# ──────────────────────────────────────────────────────────
# Gemini tool declarations
# ──────────────────────────────────────────────────────────

SKILL_DEFINITIONS = [
    genai.protos.Tool(
        function_declarations=[
            genai.protos.FunctionDeclaration(
                name="get_market_snapshot",
                description=(
                    "Fetch real-time market data for a stock ticker: latest price, "
                    "20-day and 50-day moving averages, 6-month range, and annualized volatility."
                ),
                parameters=genai.protos.Schema(
                    type=genai.protos.Type.OBJECT,
                    properties={
                        "ticker": genai.protos.Schema(
                            type=genai.protos.Type.STRING,
                            description="Stock ticker symbol, e.g. AAPL, TSLA, NVDA",
                        )
                    },
                    required=["ticker"],
                ),
            ),
            genai.protos.FunctionDeclaration(
                name="analyze_financials",
                description=(
                    "Analyze a company's key financial ratios through a Soros-style "
                    "fundamental lens: gross margin, net margin, debt-to-equity, and more."
                ),
                parameters=genai.protos.Schema(
                    type=genai.protos.Type.OBJECT,
                    properties={
                        "symbol": genai.protos.Schema(
                            type=genai.protos.Type.STRING,
                            description="Stock ticker symbol, e.g. AAPL, MSFT, GOOGL",
                        )
                    },
                    required=["symbol"],
                ),
            ),
            genai.protos.FunctionDeclaration(
                name="run_pairs_backtest",
                description=(
                    "Test statistical cointegration between two stocks and compute "
                    "the current z-score of their price spread to identify mean-reversion "
                    "opportunities, a strategy Soros used in his macro plays."
                ),
                parameters=genai.protos.Schema(
                    type=genai.protos.Type.OBJECT,
                    properties={
                        "ticker1": genai.protos.Schema(
                            type=genai.protos.Type.STRING,
                            description="First stock ticker symbol",
                        ),
                        "ticker2": genai.protos.Schema(
                            type=genai.protos.Type.STRING,
                            description="Second stock ticker symbol",
                        ),
                        "period": genai.protos.Schema(
                            type=genai.protos.Type.STRING,
                            description="Lookback period: '1y' or '2y'. Defaults to '1y'.",
                        ),
                    },
                    required=["ticker1", "ticker2"],
                ),
            ),
            genai.protos.FunctionDeclaration(
                name="calculate_position_size",
                description=(
                    "Calculate a Soros-style position size using the Kelly criterion and "
                    "asymmetric risk management. Returns recommended allocation, Kelly fraction, "
                    "and maximum risk-adjusted loss."
                ),
                parameters=genai.protos.Schema(
                    type=genai.protos.Type.OBJECT,
                    properties={
                        "portfolio_value": genai.protos.Schema(
                            type=genai.protos.Type.NUMBER,
                            description="Total portfolio value in dollars",
                        ),
                        "conviction": genai.protos.Schema(
                            type=genai.protos.Type.NUMBER,
                            description=(
                                "Conviction level from 0.0 (no conviction) to 1.0 (maximum). "
                                "Soros famously sized positions according to conviction."
                            ),
                        ),
                        "stop_loss_pct": genai.protos.Schema(
                            type=genai.protos.Type.NUMBER,
                            description="Stop-loss as a decimal, e.g. 0.05 means 5% below entry",
                        ),
                    },
                    required=["portfolio_value", "conviction", "stop_loss_pct"],
                ),
            ),
            genai.protos.FunctionDeclaration(
                name="assess_reflexivity",
                description=(
                    "Score a stock's reflexivity based on Soros's core theory: "
                    "whether market price momentum is diverging from earnings fundamentals, "
                    "creating a self-reinforcing or self-correcting dynamic."
                ),
                parameters=genai.protos.Schema(
                    type=genai.protos.Type.OBJECT,
                    properties={
                        "ticker": genai.protos.Schema(
                            type=genai.protos.Type.STRING,
                            description="Stock ticker symbol, e.g. TSLA, NVDA, AMZN",
                        )
                    },
                    required=["ticker"],
                ),
            ),
        ]
    )
]


# ──────────────────────────────────────────────────────────
# Skill handler implementations
# ──────────────────────────────────────────────────────────

def _skill_get_market_snapshot(ticker: str) -> dict:
    ticker = ticker.upper().strip()
    return {"ticker": ticker, "snapshot": _raw_snapshot(ticker)}


def _skill_analyze_financials(symbol: str) -> dict:
    symbol = symbol.upper().strip()

    def _cell(df, key):
        try:
            v = df.loc[key, df.columns[0]]
            return None if pd.isna(v) else float(v)
        except Exception:
            return None

    def _pct(num, den):
        if num is not None and den and den != 0:
            return round(num / den * 100, 2)
        return None

    try:
        stk = yf.Ticker(symbol)

        def _get(names):
            for n in names:
                try:
                    s = getattr(stk, n, pd.DataFrame())
                    if callable(s):
                        s = s()
                    if s is not None and not s.empty:
                        return s
                except Exception:
                    continue
            return pd.DataFrame()

        inc = _get(["financials", "income_stmt"])
        bal = _get(["balance_sheet", "get_balance_sheet"])

        if inc.empty:
            return {"error": f"No financial data found for {symbol}"}

        gp   = _cell(inc, "Gross Profit")
        rev  = _cell(inc, "Total Revenue")
        ni   = _cell(inc, "Net Income")
        tl   = _cell(bal, "Total Liabilities Net Minority Interest")
        te   = _cell(bal, "Total Equity Gross Minority Interest")
        oi   = _cell(inc, "Operating Income")
        intx = _cell(inc, "Interest Expense")
        sga  = _cell(inc, "Selling General And Administration")

        gross_margin = _pct(gp, rev)
        net_margin   = _pct(ni, rev)
        debt_equity  = round(tl / te, 2) if tl is not None and te and te != 0 else None
        int_coverage = _pct(intx, oi)
        sga_ratio    = _pct(sga, gp)

        criteria = {}
        if gross_margin is not None:
            criteria["gross_margin_pct"] = {
                "value": gross_margin, "rule": "> 40%", "meets": gross_margin >= 40,
            }
        if net_margin is not None:
            criteria["net_margin_pct"] = {
                "value": net_margin, "rule": "> 20%", "meets": net_margin >= 20,
            }
        if debt_equity is not None:
            criteria["debt_to_equity"] = {
                "value": debt_equity, "rule": "< 1.0", "meets": debt_equity < 1.0,
            }
        if int_coverage is not None:
            criteria["interest_expense_pct_of_op_income"] = {
                "value": int_coverage, "rule": "< 15%", "meets": int_coverage < 15,
            }
        if sga_ratio is not None:
            criteria["sga_pct_of_gross_profit"] = {
                "value": sga_ratio, "rule": "< 30%", "meets": sga_ratio < 30,
            }

        met = sum(1 for c in criteria.values() if c.get("meets"))
        total = len(criteria)

        return {
            "symbol": symbol,
            "soros_criteria_met": f"{met}/{total}",
            "ratios": criteria,
            "note": "Educational analysis only. Not investment advice.",
        }
    except Exception as exc:
        return {"error": str(exc)}


def _skill_run_pairs_backtest(ticker1: str, ticker2: str, period: str = "1y") -> dict:
    if _coint is None:
        return {"error": "statsmodels not installed — cointegration test unavailable"}

    sym_a, sym_b = ticker1.upper().strip(), ticker2.upper().strip()
    if not sym_a or not sym_b:
        return {"error": "Both ticker symbols are required"}

    try:
        raw = yf.download([sym_a, sym_b], period=period, auto_adjust=False, progress=False)
        if raw is None or raw.empty:
            return {"error": "Failed to download price data"}

        if isinstance(raw.columns, pd.MultiIndex):
            prices = raw.get("Adj Close", raw.get("Close"))
        elif "Adj Close" in raw.columns:
            prices = raw["Adj Close"]
        else:
            prices = raw["Close"]

        if sym_a not in prices.columns or sym_b not in prices.columns:
            return {"error": f"No data for one or both symbols: {sym_a}, {sym_b}"}

        sa = prices[sym_a].dropna()
        sb = prices[sym_b].dropna()
        common = sa.index.intersection(sb.index)
        if len(common) < 30:
            return {"error": "Need at least 30 overlapping trading days"}
        sa, sb = sa.loc[common], sb.loc[common]

        beta = float(np.polyfit(sb.values, sa.values, 1)[0])

        la = np.log(sa.replace(0, np.nan)).dropna()
        lb = np.log(sb.replace(0, np.nan)).dropna()
        ix = la.index.intersection(lb.index)
        _, p_val, _ = _coint(la.loc[ix], lb.loc[ix], trend="c")
        p_val = round(float(p_val), 4)

        spread = sa - beta * sb
        mu = spread.rolling(60, min_periods=20).mean()
        sigma = spread.rolling(60, min_periods=20).std().replace(0, np.nan)
        z = ((spread - mu) / sigma).dropna()
        latest_z = round(float(z.iloc[-1]), 3) if not z.empty else None

        cointegrated = bool(p_val < 0.05)
        signal = "Neutral — spread near equilibrium"
        if latest_z is not None:
            if latest_z > 1.5:
                signal = f"Spread extended: SHORT {sym_a} / LONG {sym_b}"
            elif latest_z < -1.5:
                signal = f"Spread compressed: LONG {sym_a} / SHORT {sym_b}"
            elif abs(latest_z) < 0.3:
                signal = "Mean-reversion complete — consider exiting the pair"

        return {
            "pair": f"{sym_a} / {sym_b}",
            "period": period,
            "hedge_ratio": round(beta, 4),
            "cointegration_p_value": p_val,
            "cointegrated": cointegrated,
            "cointegration_note": (
                "Statistically cointegrated — pair trading supported (p < 0.05)"
                if cointegrated else
                "Not cointegrated — pair trading carries higher risk"
            ),
            "latest_z_score": latest_z,
            "signal": signal,
        }
    except Exception as exc:
        return {"error": str(exc)}


def _skill_calculate_position_size(
    portfolio_value: float,
    conviction: float,
    stop_loss_pct: float,
) -> dict:
    conviction = max(0.0, min(1.0, float(conviction)))
    stop_loss_pct = max(0.001, abs(float(stop_loss_pct)))
    portfolio_value = max(1.0, float(portfolio_value))

    # Kelly fraction with assumed 2:1 reward/risk ratio
    kelly = max(0.0, conviction - (1 - conviction) / 2.0)
    half_kelly = kelly * 0.5  # fractional Kelly for safety

    # Risk-based sizing: risk budget / stop-loss = position size
    risk_budget = portfolio_value * half_kelly
    position_from_risk = risk_budget / stop_loss_pct if stop_loss_pct > 0 else 0.0

    # Hard cap at 30% of portfolio
    recommended = round(min(position_from_risk, portfolio_value * 0.30), 2)
    pct_portfolio = round(recommended / portfolio_value * 100, 1)
    max_loss = round(recommended * stop_loss_pct, 2)

    if conviction >= 0.75:
        rationale = "High conviction — Soros would press hard; 'go for the jugular' territory."
    elif conviction >= 0.50:
        rationale = "Moderate conviction — size in, leave room to add as thesis confirms."
    else:
        rationale = "Low conviction — toe-in-the-water; wait for confirming signals before adding."

    return {
        "portfolio_value_usd": portfolio_value,
        "conviction": conviction,
        "stop_loss_pct": f"{stop_loss_pct:.1%}",
        "kelly_fraction": round(kelly, 4),
        "half_kelly_fraction": round(half_kelly, 4),
        "recommended_position_usd": recommended,
        "pct_of_portfolio": pct_portfolio,
        "max_loss_if_stopped_usd": max_loss,
        "soros_rationale": rationale,
        "note": "Educational only. Kelly criterion with 2:1 reward/risk assumption. Not investment advice.",
    }


def _skill_assess_reflexivity(ticker: str) -> dict:
    ticker = ticker.upper().strip()

    try:
        stk = yf.Ticker(ticker)
        info = stk.info or {}

        hist = stk.history(period="1y")
        if hist.empty:
            return {"error": f"No price history available for {ticker}"}

        price_12m = float(
            (hist["Close"].iloc[-1] - hist["Close"].iloc[0]) / hist["Close"].iloc[0]
        )

        pe_ratio   = info.get("trailingPE") or info.get("forwardPE")
        eps_growth = info.get("earningsGrowth")
        peg_ratio  = info.get("trailingPegRatio") or info.get("pegRatio")

        score = 50
        signals = []

        if price_12m > 0.50:
            score += 20
            signals.append(f"Strong 12-month price momentum: {price_12m:.1%}")
        elif price_12m > 0.20:
            score += 10
            signals.append(f"Positive 12-month momentum: {price_12m:.1%}")
        elif price_12m < -0.20:
            score -= 20
            signals.append(f"Negative 12-month momentum: {price_12m:.1%}")

        if pe_ratio is not None:
            if pe_ratio > 50:
                score += 15
                signals.append(f"Elevated P/E ({pe_ratio:.1f}x) — narrative premium present")
            elif pe_ratio < 12:
                score -= 15
                signals.append(f"Low P/E ({pe_ratio:.1f}x) — potential undervaluation")

        if eps_growth is not None:
            gap = price_12m - eps_growth
            if gap > 0.40:
                score += 15
                signals.append(
                    f"Price ({price_12m:.1%}) outrunning earnings growth ({eps_growth:.1%}) — reflexivity gap"
                )
            elif gap < -0.30:
                score -= 10
                signals.append(
                    f"Earnings ({eps_growth:.1%}) outpacing price ({price_12m:.1%}) — potential reversion"
                )

        if peg_ratio is not None and peg_ratio > 3.0:
            score += 10
            signals.append(f"High PEG ratio ({peg_ratio:.1f}) — speculative premium above growth")

        score = max(0, min(100, score))

        if score >= 65:
            direction = "Self-Reinforcing (Bullish Reflexivity)"
            interpretation = (
                "Bullish bias is pushing prices higher, reinforcing the narrative — a classic "
                "Soros reflexivity loop. These loops eventually reverse sharply when the "
                "prevailing bias is challenged by reality."
            )
        elif score <= 35:
            direction = "Self-Correcting (Bearish Reflexivity)"
            interpretation = (
                "Price decline reinforces negative sentiment despite fundamentals, potentially "
                "overshooting to the downside. Soros would look for the catalyst that breaks "
                "the loop and allows fundamentals to reassert."
            )
        else:
            direction = "Neutral / Transitional"
            interpretation = (
                "No dominant reflexivity signal. The market is not yet in a self-reinforcing "
                "trend. Soros would watch for a trigger that could initiate a loop in either direction."
            )

        return {
            "ticker": ticker,
            "reflexivity_score": score,
            "direction": direction,
            "interpretation": interpretation,
            "signals": signals,
            "price_momentum_12m": f"{price_12m:.1%}",
            "pe_ratio": round(float(pe_ratio), 1) if pe_ratio else None,
            "eps_growth": f"{eps_growth:.1%}" if eps_growth is not None else "N/A",
            "peg_ratio": round(float(peg_ratio), 2) if peg_ratio else None,
            "note": "Educational analysis based on Soros reflexivity theory. Not investment advice.",
        }
    except Exception as exc:
        return {"error": str(exc)}


# ──────────────────────────────────────────────────────────
# Dispatcher
# ──────────────────────────────────────────────────────────

_HANDLERS: dict = {
    "get_market_snapshot": lambda args: _skill_get_market_snapshot(**args),
    "analyze_financials":  lambda args: _skill_analyze_financials(**args),
    "run_pairs_backtest":  lambda args: _skill_run_pairs_backtest(**args),
    "calculate_position_size": lambda args: _skill_calculate_position_size(**args),
    "assess_reflexivity":  lambda args: _skill_assess_reflexivity(**args),
}


def execute_skill(name: str, args: dict) -> dict:
    handler = _HANDLERS.get(name)
    if not handler:
        return {"error": f"Unknown skill: {name!r}"}
    try:
        return handler(args)
    except Exception as exc:
        return {"error": f"Skill '{name}' raised: {exc}"}
