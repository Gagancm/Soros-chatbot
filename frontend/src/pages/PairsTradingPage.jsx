import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, AreaChart, Area, ReferenceLine, ComposedChart,
} from 'recharts'

const DEFAULT_API_BASE = 'http://localhost:8000'

const C = {
  primary: '#FF5832',
  primarySoft: '#FFB657',
  mid: '#FF8E40',
  mean: '#8F8F97',
  band: '#FFE3C9',
  good: '#2F9E56',
  bad: '#D14444',
  alt: '#6C4FE0',
}

function ChartTooltip({ active, payload, label, valueFormat }) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip__label">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="chart-tooltip__row">
          <span className="chart-tooltip__row-name" style={{ color: p.color }}>{p.name}</span>
          <span className="chart-tooltip__row-val">
            {valueFormat ? valueFormat(p.value) : (typeof p.value === 'number' ? p.value.toFixed(2) : p.value)}
          </span>
        </div>
      ))}
    </div>
  )
}

export function PairsTradingPage() {
  return (
    <div className="page-layout">
      <div className="page-layout__header">
        <div>
          <h1 className="page-layout__title">Pairs Trading</h1>
          <p className="page-layout__intro">
            Statistical arbitrage with cointegration tests, rolling-window z-scores, and a
            cumulative P&amp;L backtest on live market data.
          </p>
        </div>
      </div>
      <PairsTradingContent />
    </div>
  )
}

export function PairsTradingContent() {
  const [stock1, setStock1] = useState('SPY')
  const [stock2, setStock2] = useState('IWM')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [zThreshold, setZThreshold] = useState(1.0)
  const [exitZ, setExitZ] = useState(0.25)
  const [rollingWindow, setRollingWindow] = useState(60)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null); setResult(null); setIsLoading(true)
    try {
      const body = {
        stock1, stock2,
        start_date: startDate || null, end_date: endDate || null,
        z_threshold: Number(zThreshold), exit_z: Number(exitZ),
        rolling_window: Number(rollingWindow),
      }
      const res = await fetch(`${DEFAULT_API_BASE}/api/pairs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => null)
        throw new Error(detail?.detail || `Request failed with status ${res.status}`)
      }
      setResult(await res.json())
    } catch (err) {
      console.error(err)
      setError(err.message || 'Error calling /api/pairs. Make sure the backend is running.')
    } finally {
      setIsLoading(false)
    }
  }

  const spreadData = useMemo(() => (result?.spreadSeries || []).map((r) => ({
    date: r.date, spread: r.spread, mean: r.mean, upper: r.entryUpper, lower: r.entryLower,
  })), [result])

  const zData = useMemo(() => (result?.zHistory || []).map((r) => ({ date: r.date, z: r.z })), [result])

  const pnlData = useMemo(() => (result?.pnlSeries || []).map((r) => ({
    date: r.date, pnl: (r.cumulativeReturn ?? 0) * 100,
  })), [result])

  const priceData = useMemo(() => {
    const s = result?.priceSeries
    if (!s || !s.length) return []
    const base = s[0]
    return s.map((r) => ({
      date: r.date,
      a: base.a ? (r.a / base.a) * 100 : null,
      b: base.b ? (r.b / base.b) * 100 : null,
    }))
  }, [result])

  return (
    <>
      <form className="page-card page-card--stagger-1" onSubmit={handleSubmit}>
        <h2 className="page-card__heading">Backtest inputs</h2>
        <div className="page-form__row">
          <div className="page-form__field">
            <label htmlFor="stock1">Stock A</label>
            <input id="stock1" value={stock1} onChange={(e) => setStock1(e.target.value.toUpperCase())} />
          </div>
          <div className="page-form__field">
            <label htmlFor="stock2">Stock B</label>
            <input id="stock2" value={stock2} onChange={(e) => setStock2(e.target.value.toUpperCase())} />
          </div>
          <div className="page-form__field">
            <label htmlFor="start-date">Start date</label>
            <input id="start-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="page-form__field">
            <label htmlFor="end-date">End date</label>
            <input id="end-date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <div className="page-form__actions">
            <button type="submit" disabled={isLoading}>
              {isLoading ? 'Running…' : 'Run analysis'}
            </button>
          </div>
        </div>

        <button type="button" className="advanced-toggle" onClick={() => setShowAdvanced((v) => !v)}>
          {showAdvanced ? '− Hide advanced' : '+ Show advanced'}
        </button>

        {showAdvanced && (
          <div className="page-form__row">
            <div className="page-form__field">
              <label htmlFor="z-threshold">Entry Z</label>
              <input id="z-threshold" type="number" step="0.1" min="0.5" max="3.0" value={zThreshold} onChange={(e) => setZThreshold(e.target.value)} />
            </div>
            <div className="page-form__field">
              <label htmlFor="exit-z">Exit Z</label>
              <input id="exit-z" type="number" step="0.05" min="0" max="2.0" value={exitZ} onChange={(e) => setExitZ(e.target.value)} />
            </div>
            <div className="page-form__field">
              <label htmlFor="rolling-window">Rolling window (days)</label>
              <input id="rolling-window" type="number" step="5" min="10" max="252" value={rollingWindow} onChange={(e) => setRollingWindow(e.target.value)} />
            </div>
          </div>
        )}
      </form>

      {error && createPortal(
        <div className="page-error">
          <span>{error}</span>
          <button className="page-error__close" type="button" onClick={() => setError(null)}>✕</button>
        </div>,
        document.body
      )}

      {result && (
        <>
          <div className="page-card page-card--stagger-2">
            <h2 className="page-card__heading">{result.symbols.A} / {result.symbols.B} Summary</h2>
            <div className="stats-grid">
              <div className="stat-tile">
                <span className="stat-tile__label">Hedge ratio</span>
                <span className="stat-tile__value">{result.hedgeRatio?.toFixed(4) ?? 'N/A'}</span>
              </div>
              <div className="stat-tile">
                <span className="stat-tile__label">Cointegration p</span>
                <span className={`stat-tile__value ${result.cointegrationPValue != null && result.cointegrationPValue < 0.05 ? 'stat-tile__value--good' : 'stat-tile__value--bad'}`}>
                  {result.cointegrationPValue?.toFixed(4) ?? 'N/A'}
                </span>
              </div>
              <div className="stat-tile">
                <span className="stat-tile__label">Latest Z</span>
                <span className="stat-tile__value">{result.latestZScore?.toFixed(2) ?? 'N/A'}</span>
              </div>
              <div className="stat-tile">
                <span className="stat-tile__label">Trades</span>
                <span className="stat-tile__value">{result.trades}</span>
              </div>
              <div className="stat-tile">
                <span className="stat-tile__label">Cumulative return</span>
                <span className={`stat-tile__value ${result.cumulativeReturn != null && result.cumulativeReturn >= 0 ? 'stat-tile__value--good' : 'stat-tile__value--bad'}`}>
                  {result.cumulativeReturn != null ? `${(result.cumulativeReturn * 100).toFixed(2)}%` : 'N/A'}
                </span>
              </div>
              <div className="stat-tile">
                <span className="stat-tile__label">Status</span>
                <span className="stat-tile__value" style={{ fontSize: 14 }}>{result.cointegrationInterpretation}</span>
              </div>
            </div>
          </div>

          <div className="chart-grid">
            {priceData.length > 0 && (
              <div className="page-card page-card--stagger-3">
                <h2 className="page-card__heading">Normalized price</h2>
                <p className="page-card__hint">Rebased to 100 at backtest start.</p>
                <div className="chart-wrap">
                  <ResponsiveContainer>
                    <LineChart data={priceData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} />
                      <YAxis tick={{ fontSize: 10 }} domain={['auto', 'auto']} width={40} />
                      <Tooltip content={<ChartTooltip valueFormat={(v) => v?.toFixed(2)} />} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <ReferenceLine y={100} stroke="var(--text-dim)" strokeDasharray="3 3" />
                      <Line type="monotone" dataKey="a" name={result.symbols.A} stroke={C.primary} strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="b" name={result.symbols.B} stroke={C.alt} strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            <div className="page-card page-card--stagger-4">
              <h2 className="page-card__heading">Spread with bands</h2>
              <p className="page-card__hint">Mean-reverting spread and entry bands.</p>
              <div className="chart-wrap">
                <ResponsiveContainer>
                  <ComposedChart data={spreadData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="bandFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C.primary} stopOpacity={0.12} />
                        <stop offset="100%" stopColor={C.primary} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} />
                    <YAxis tick={{ fontSize: 10 }} width={40} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Area type="monotone" dataKey="upper" name="Upper band" stroke={C.band} strokeWidth={1} strokeDasharray="3 3" fill="url(#bandFill)" />
                    <Area type="monotone" dataKey="lower" name="Lower band" stroke={C.band} strokeWidth={1} strokeDasharray="3 3" fill="url(#bandFill)" />
                    <Line type="monotone" dataKey="mean" name="Mean" stroke={C.mean} strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
                    <Line type="monotone" dataKey="spread" name="Spread" stroke={C.primary} strokeWidth={2.2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="page-card page-card--stagger-5">
              <h2 className="page-card__heading">Z-score history</h2>
              <p className="page-card__hint">±{zThreshold} triggers entry, exit near mean.</p>
              <div className="chart-wrap">
                <ResponsiveContainer>
                  <AreaChart data={zData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="zFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C.primary} stopOpacity={0.4} />
                        <stop offset="100%" stopColor={C.primary} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} />
                    <YAxis tick={{ fontSize: 10 }} width={40} />
                    <Tooltip content={<ChartTooltip />} />
                    <ReferenceLine y={Number(zThreshold)} stroke={C.good} strokeDasharray="4 4" />
                    <ReferenceLine y={-Number(zThreshold)} stroke={C.bad} strokeDasharray="4 4" />
                    <ReferenceLine y={0} stroke="var(--text-dim)" />
                    <Area type="monotone" dataKey="z" name="Z-score" stroke={C.primary} strokeWidth={2} fill="url(#zFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="page-card">
              <h2 className="page-card__heading">Cumulative P&amp;L</h2>
              <p className="page-card__hint">Strategy return across trades.</p>
              <div className="chart-wrap">
                <ResponsiveContainer>
                  <AreaChart data={pnlData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="pnlFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C.good} stopOpacity={0.4} />
                        <stop offset="100%" stopColor={C.good} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v.toFixed(0)}%`} width={40} />
                    <Tooltip content={<ChartTooltip valueFormat={(v) => `${v.toFixed(2)}%`} />} />
                    <ReferenceLine y={0} stroke="var(--text-dim)" />
                    <Area type="monotone" dataKey="pnl" name="Cumulative return" stroke={C.good} strokeWidth={2} fill="url(#pnlFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {result.sorosInsight && (
            <div className="page-card pairs-insight">
              <h2 className="page-card__heading">Soros Insight</h2>
              <ReactMarkdown>{result.sorosInsight}</ReactMarkdown>
            </div>
          )}
        </>
      )}
    </>
  )
}
