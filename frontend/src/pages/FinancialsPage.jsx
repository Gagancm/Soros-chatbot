import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, LineChart, Line,
} from 'recharts'

const DEFAULT_API_BASE = 'http://localhost:8000'

const C = { primary: '#FF5832', alt: '#6C4FE0', mid: '#FFB657', good: '#2F9E56', bad: '#D14444' }

function ChartTooltip({ active, payload, label, valueFormat }) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip__label">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="chart-tooltip__row">
          <span className="chart-tooltip__row-name" style={{ color: p.color }}>{p.name}</span>
          <span className="chart-tooltip__row-val">
            {valueFormat ? valueFormat(p.value) : (typeof p.value === 'number' ? p.value.toLocaleString() : p.value)}
          </span>
        </div>
      ))}
    </div>
  )
}

const fmtCompact = (n) => {
  if (n == null || Number.isNaN(n)) return '–'
  const a = Math.abs(n)
  if (a >= 1e12) return `${(n / 1e12).toFixed(1)}T`
  if (a >= 1e9)  return `${(n / 1e9).toFixed(1)}B`
  if (a >= 1e6)  return `${(n / 1e6).toFixed(1)}M`
  if (a >= 1e3)  return `${(n / 1e3).toFixed(1)}K`
  return n.toFixed(2)
}

function findRow(rows, ...patterns) {
  if (!rows?.length) return null
  for (const p of patterns) {
    const re = new RegExp(p, 'i')
    const hit = rows.find((r) => re.test(r.Item))
    if (hit) return hit
  }
  return null
}

function buildPeriodSeries(incomeStatement) {
  if (!incomeStatement?.length) return { revenue: [], margins: [], growth: null, latest: {} }
  const rev = findRow(incomeStatement, 'total\\s*revenue', 'revenue')
  const ni  = findRow(incomeStatement, 'net\\s*income')
  const gp  = findRow(incomeStatement, 'gross\\s*profit')
  const op  = findRow(incomeStatement, 'operating\\s*income')
  if (!rev) return { revenue: [], margins: [], growth: null, latest: {} }
  const cols = Object.keys(rev).filter((k) => k !== 'Item').reverse()
  const revenue = cols.map((c) => ({
    period: c.length > 10 ? c.slice(0, 7) : c,
    revenue: typeof rev[c] === 'number' ? rev[c] : null,
    netIncome: ni && typeof ni[c] === 'number' ? ni[c] : null,
  }))
  const margins = cols.map((c) => {
    const r = rev[c]
    const gross = gp?.[c], oper = op?.[c], net = ni?.[c]
    const pct = (v) => (typeof v === 'number' && typeof r === 'number' && r !== 0) ? (v / r) * 100 : null
    return {
      period: c.length > 10 ? c.slice(0, 7) : c,
      grossMargin: pct(gross),
      operatingMargin: pct(oper),
      netMargin: pct(net),
    }
  })

  // YoY revenue growth latest vs previous
  let growth = null
  if (revenue.length >= 2) {
    const latest = revenue[revenue.length - 1]?.revenue
    const prev = revenue[revenue.length - 2]?.revenue
    if (typeof latest === 'number' && typeof prev === 'number' && prev !== 0) {
      growth = ((latest - prev) / Math.abs(prev)) * 100
    }
  }
  const latest = margins[margins.length - 1] || {}
  return { revenue, margins, growth, latest }
}

function StatementCard({ title, rows, accent = 'primary' }) {
  const [expanded, setExpanded] = useState(false)
  if (!rows || rows.length === 0) return null
  const cols = Object.keys(rows[0]).filter((k) => k !== 'Item')
  const visible = expanded ? rows : rows.slice(0, 6)
  return (
    <div className="page-card fin-stmt">
      <div className="fin-stmt__head">
        <h3 className="fin-stmt__title">
          <span className={`fin-stmt__dot fin-stmt__dot--${accent}`} />
          {title}
        </h3>
        <span className="fin-stmt__meta">{rows.length} line items · {cols.length} periods</span>
      </div>
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Item</th>
              {cols.map((c) => <th key={c}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => (
              <tr key={i}>
                <td className="data-table__item">{row.Item}</td>
                {cols.map((c) => (
                  <td key={c} className="data-table__num">
                    {typeof row[c] === 'number' ? row[c].toLocaleString() : row[c]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 6 && (
        <button className="fin-stmt__toggle" type="button" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Show less' : `Show all ${rows.length} rows`}
        </button>
      )}
    </div>
  )
}

// Group ratios by category based on name
function categorize(ratios) {
  const g = { Profitability: [], 'Cost discipline': [], 'Leverage & liquidity': [] }
  for (const r of ratios || []) {
    const n = r.name.toLowerCase()
    if (/margin/.test(n)) g.Profitability.push(r)
    else if (/sg&a|r&d|depreciation/.test(n)) g['Cost discipline'].push(r)
    else g['Leverage & liquidity'].push(r)
  }
  return g
}

export function FinancialsPage() {
  return (
    <div className="page-layout">
      <div className="page-layout__header">
        <div>
          <h1 className="page-layout__title">Financials &amp; Risk</h1>
          <p className="page-layout__intro">
            Margin, leverage, and liquidity metrics from live financial statements.
          </p>
        </div>
      </div>
      <FinancialsContent />
    </div>
  )
}

export function FinancialsContent() {
  const [symbol, setSymbol] = useState('AAPL')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null); setData(null); setIsLoading(true)
    try {
      const sym = symbol.trim().toUpperCase()
      const res = await fetch(`${DEFAULT_API_BASE}/api/financials/${encodeURIComponent(sym)}`)
      if (!res.ok) {
        const detail = await res.json().catch(() => null)
        throw new Error(detail?.detail || `Request failed with status ${res.status}`)
      }
      setData(await res.json())
    } catch (err) {
      console.error(err)
      setError(err.message || 'Error calling /api/financials.')
    } finally {
      setIsLoading(false)
    }
  }

  const { revenue: revenueSeries, margins: marginSeries, growth, latest } = useMemo(
    () => buildPeriodSeries(data?.incomeStatement), [data],
  )

  const ratioSummary = useMemo(() => {
    const rows = data?.ratios || []
    return {
      pass: rows.filter((r) => r.meets === true).length,
      fail: rows.filter((r) => r.meets === false).length,
      na:   rows.filter((r) => r.meets == null).length,
      total: rows.length,
    }
  }, [data])

  const leverageRatio = useMemo(() => {
    const r = (data?.ratios || []).find((x) => /debt\s*to\s*equity/i.test(x.name))
    return r?.value ?? '–'
  }, [data])

  const groupedRatios = useMemo(() => categorize(data?.ratios), [data])

  const renderMeets = (meets) => {
    if (meets === true)  return <span className="fin-badge fin-badge--pass">Pass</span>
    if (meets === false) return <span className="fin-badge fin-badge--fail">Fail</span>
    return <span className="fin-badge fin-badge--na">N/A</span>
  }


  return (
    <>
      <form className="page-card page-card--stagger-1 fin-lookup" onSubmit={handleSubmit}>
        <div className="page-form__row" style={{ margin: 0 }}>
          <div className="page-form__field" style={{ flex: 3 }}>
            <label htmlFor="symbol">Ticker symbol</label>
            <input id="symbol" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="e.g. AAPL, MSFT, NVDA" />
          </div>
          <div className="page-form__actions">
            <button type="submit" disabled={isLoading}>
              {isLoading ? 'Loading…' : 'Fetch financials'}
            </button>
          </div>
        </div>
      </form>

      {error && createPortal(
        <div className="page-error">
          <span>{error}</span>
          <button className="page-error__close" type="button" onClick={() => setError(null)}>✕</button>
        </div>,
        document.body
      )}

      {data && (
        <>
          {/* Key metrics strip — at-a-glance summary */}
          <div className="page-card page-card--stagger-2">
            <div className="fin-hero">
              <div className="fin-hero__ticker">
                <span className="fin-hero__symbol">{data.symbol}</span>
                {data.demoData && <span className="fin-hero__tag">Demo data</span>}
              </div>
              <div className="fin-hero__score">
                <span className="fin-hero__score-pass">{ratioSummary.pass}</span>
                <span className="fin-hero__score-sep">/</span>
                <span className="fin-hero__score-total">{ratioSummary.total}</span>
                <span className="fin-hero__score-label">checks passing</span>
              </div>
            </div>

            <div className="stats-grid" style={{ marginTop: 14 }}>
              <div className="stat-tile">
                <span className="stat-tile__label">Gross margin</span>
                <span className="stat-tile__value">{latest.grossMargin != null ? `${latest.grossMargin.toFixed(1)}%` : '–'}</span>
              </div>
              <div className="stat-tile">
                <span className="stat-tile__label">Operating margin</span>
                <span className="stat-tile__value">{latest.operatingMargin != null ? `${latest.operatingMargin.toFixed(1)}%` : '–'}</span>
              </div>
              <div className="stat-tile">
                <span className="stat-tile__label">Net margin</span>
                <span className="stat-tile__value">{latest.netMargin != null ? `${latest.netMargin.toFixed(1)}%` : '–'}</span>
              </div>
              <div className="stat-tile">
                <span className="stat-tile__label">Revenue YoY</span>
                <span className={`stat-tile__value ${growth != null ? (growth >= 0 ? 'stat-tile__value--good' : 'stat-tile__value--bad') : ''}`}>
                  {growth != null ? `${growth >= 0 ? '+' : ''}${growth.toFixed(1)}%` : '–'}
                </span>
              </div>
              <div className="stat-tile">
                <span className="stat-tile__label">Debt / Equity</span>
                <span className="stat-tile__value">{leverageRatio}</span>
              </div>
              <div className="stat-tile">
                <span className="stat-tile__label">Health</span>
                <span className="stat-tile__value" style={{ fontSize: 14 }}>
                  {ratioSummary.pass >= ratioSummary.total - 1 ? '🟢 Strong' :
                   ratioSummary.pass >= Math.ceil(ratioSummary.total * 0.6) ? '🟡 Mixed' : '🔴 Weak'}
                </span>
              </div>
            </div>
          </div>

          {/* Charts side-by-side */}
          <div className="chart-grid">
            {revenueSeries.length > 0 && (
              <div className="page-card page-card--stagger-3">
                <h2 className="page-card__heading">Revenue &amp; Net Income</h2>
                <p className="page-card__hint">Top line vs bottom line across reported periods.</p>
                <div className="chart-wrap">
                  <ResponsiveContainer>
                    <BarChart data={revenueSeries} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={fmtCompact} width={44} />
                      <Tooltip content={<ChartTooltip valueFormat={(v) => fmtCompact(v)} />} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="revenue" name="Revenue" fill={C.primary} radius={[6, 6, 0, 0]} />
                      <Bar dataKey="netIncome" name="Net Income" fill={C.mid} radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {marginSeries.length > 0 && (
              <div className="page-card page-card--stagger-4">
                <h2 className="page-card__heading">Margin trend</h2>
                <p className="page-card__hint">Gross / operating / net margin.</p>
                <div className="chart-wrap">
                  <ResponsiveContainer>
                    <LineChart data={marginSeries} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v?.toFixed(0)}%`} width={44} />
                      <Tooltip content={<ChartTooltip valueFormat={(v) => (v == null ? '–' : `${v.toFixed(2)}%`)} />} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line type="monotone" dataKey="grossMargin" name="Gross" stroke={C.mid} strokeWidth={2} dot={{ r: 3 }} />
                      <Line type="monotone" dataKey="operatingMargin" name="Operating" stroke={C.primary} strokeWidth={2} dot={{ r: 3 }} />
                      <Line type="monotone" dataKey="netMargin" name="Net" stroke={C.alt} strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>

          {/* Ratios by category */}
          <div className="fin-ratio-grid">
            {Object.entries(groupedRatios).map(([group, items]) => (
              items.length > 0 && (
                <div key={group} className="page-card fin-ratio-card">
                  <h3 className="fin-ratio-card__title">{group}</h3>
                  <ul className="fin-ratio-list">
                    {items.map((r, i) => (
                      <li key={i} className="fin-ratio-row">
                        <div className="fin-ratio-row__main">
                          <span className="fin-ratio-row__name">{r.name.replace(/\s*\(.*?\)\s*$/, '')}</span>
                          <span className="fin-ratio-row__rule">Rule {r.rule}</span>
                        </div>
                        <div className="fin-ratio-row__right">
                          <span className="fin-ratio-row__value">{r.value}</span>
                          {renderMeets(r.meets)}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            ))}
          </div>

          {/* Statements — each in its own card */}
          <h2 className="fin-stmt-heading">Financial statements</h2>
          <StatementCard title="Income Statement" rows={data.incomeStatement} accent="primary" />
          <StatementCard title="Balance Sheet"    rows={data.balanceSheet}    accent="alt" />
          <StatementCard title="Cash Flow"        rows={data.cashFlow}        accent="good" />
        </>
      )}
    </>
  )
}
