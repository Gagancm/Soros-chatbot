import { useState } from 'react'
import { createPortal } from 'react-dom'

const DEFAULT_API_BASE = 'http://localhost:8000'

export function FinancialsPage() {
  const [symbol, setSymbol] = useState('AAPL')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setData(null)
    setIsLoading(true)

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
      setError(err.message || 'Error calling /api/financials. Make sure the backend is running.')
    } finally {
      setIsLoading(false)
    }
  }

  const renderMeets = (meets) => {
    if (meets === true) return <span className="fin-badge fin-badge--pass">Pass</span>
    if (meets === false) return <span className="fin-badge fin-badge--fail">Fail</span>
    return <span className="fin-badge fin-badge--na">N/A</span>
  }

  const renderStatement = (title, rows) => {
    if (!rows || rows.length === 0) return null
    const cols = Object.keys(rows[0]).filter((k) => k !== 'Item')
    return (
      <details className="fin-details">
        <summary>{title}</summary>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th>Item</th>
                {cols.map((c) => <th key={c}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  <td className="fin-table__item">{row.Item}</td>
                  {cols.map((c) => (
                    <td key={c} className="fin-table__num">
                      {typeof row[c] === 'number' ? row[c].toLocaleString() : row[c]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    )
  }

  return (
    <div className="page-layout">
      <div className="page-layout__header">
        <div>
          <h1 className="page-layout__title">Financials &amp; Risk</h1>
          <p className="page-layout__intro">
            Soros-style risk diagnostics — gross margin resilience, leverage, liquidity,
            and capital discipline from live financial statements.
          </p>
        </div>
      </div>

      <form className="page-card page-card--stagger-1" onSubmit={handleSubmit}>
        <div className="page-form__row">
          <div className="page-form__field">
            <label htmlFor="symbol">Ticker symbol</label>
            <input id="symbol" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
          </div>
          <div className="page-form__actions">
            <button type="submit" disabled={isLoading}>
              {isLoading ? 'Loading...' : 'Fetch financials'}
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
          {/* Ratios card */}
          <div className="page-card page-card--stagger-2">
            <h2 className="page-card__heading">{data.symbol} — Risk Ratios</h2>
            {data.demoData && (
              <p className="page-card__hint" style={{ color: 'var(--accent)' }}>
                Live data unavailable — showing demo estimates.
              </p>
            )}
            <div className="fin-table-wrap">
              <table className="fin-table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Value</th>
                    <th>Rule</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.ratios || []).map((r, i) => (
                    <tr key={i}>
                      <td>{r.name}</td>
                      <td className="fin-table__num">{r.value}</td>
                      <td>{r.rule}</td>
                      <td>{renderMeets(r.meets)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Financial statements */}
          <div className="page-card page-card--stagger-3">
            <h2 className="page-card__heading">Financial Statements</h2>
            {renderStatement('Income Statement', data.incomeStatement)}
            {renderStatement('Balance Sheet', data.balanceSheet)}
            {renderStatement('Cash Flow', data.cashFlow)}
          </div>
        </>
      )}
    </div>
  )
}
