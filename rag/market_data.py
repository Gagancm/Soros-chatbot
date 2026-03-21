import warnings
import yfinance as yf
import pandas as pd

warnings.filterwarnings("ignore", category=FutureWarning, module="yfinance")


def _to_float(x):
    try:
        if hasattr(x, "item"):
            return float(x.item())
        return float(x)
    except Exception:
        if isinstance(x, (pd.Series, list)):
            return float(x.iloc[-1])
        return float("nan")


def get_market_snapshot(ticker: str, period: str = "6mo") -> str:
    """Fetch a clean market snapshot for a given ticker."""
    ticker = ticker.upper().strip()

    try:
        data = yf.download(ticker, period=period, interval="1d", progress=False, auto_adjust=False)
    except Exception as e:
        return f"Error fetching data for {ticker}: {e}"

    if data.empty:
        return f"No market data available for {ticker}."

    if isinstance(data.columns, pd.MultiIndex):
        close = data["Close"].iloc[:, 0].dropna()
    else:
        close = data["Close"].dropna()

    if close.empty:
        return f"No valid close prices for {ticker}."

    last_price = _to_float(close.iloc[-1])
    ma20 = _to_float(close.rolling(20).mean().iloc[-1])
    ma50 = _to_float(close.rolling(50).mean().iloc[-1])
    high_period = _to_float(close.max())
    low_period = _to_float(close.min())

    returns = close.pct_change().dropna()
    if not returns.empty:
        vol = _to_float(returns.std() * (252 ** 0.5))
        vol_str = f"{vol:.2%}"
    else:
        vol_str = "N/A"

    return "\n".join([
        f"Ticker: {ticker}",
        f"Latest close: {last_price:.2f}",
        f"20-day MA: {ma20:.2f}",
        f"50-day MA: {ma50:.2f}",
        f"{period} range: {low_period:.2f} – {high_period:.2f}",
        f"Annualized volatility: {vol_str}",
    ])
