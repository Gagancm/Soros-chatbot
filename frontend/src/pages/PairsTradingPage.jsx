import { useState } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'

const DEFAULT_API_BASE = 'http://localhost:8000'

export function PairsTradingPage() {
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

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setResult(null)
    setIsLoading(true)

    try {
      const body = {
        stock1,
        stock2,
        start_date: startDate || null,
        end_date: endDate || null,
        z_threshold: Number(zThreshold),
        exit_z: Number(exitZ),
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

  return (
    <div className="page-layout">
      <div className="page-layout__header">
        <div>
          <h1 className="page-layout__title">Pairs Trading</h1>
          <p className="page-layout__intro">
            Statistical arbitrage analysis with cointegration tests, spread z-scores,
            and cumulative P&amp;L — powered by live market data.
          </p>
        </div>
      </div>

      <form className="page-card page-card--stagger-1" onSubmit={handleSubmit}>
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
            <label htmlFor="z-threshold">Entry Z</label>
            <input id="z-threshold" type="number" step="0.1" min="0.5" max="3.0" value={zThreshold} onChange={(e) => setZThreshold(e.target.value)} />
          </div>
          <div className="page-form__field">
            <label htmlFor="exit-z">Exit Z</label>
            <input id="exit-z" type="number" step="0.05" min="0" max="2.0" value={exitZ} onChange={(e) => setExitZ(e.target.value)} />
          </div>
          <div className="page-form__field">
            <label htmlFor="rolling-window">Window</label>
            <input id="rolling-window" type="number" step="5" min="10" max="252" value={rollingWindow} onChange={(e) => setRollingWindow(e.target.value)} />
          </div>
        </div>

        <div className="page-form__row">
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
              {isLoading ? 'Running backtest...' : 'Run analysis'}
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

      {result && (
        <>
          {/* Summary stats */}
          <div className="page-card page-card--stagger-2">
            <h2 className="page-card__heading">
              {result.symbols.A} / {result.symbols.B} — Summary
            </h2>
            <div className="pairs-stats">
              <div className="pairs-stat">
                <span className="pairs-stat__label">Hedge ratio</span>
                <span className="pairs-stat__value">{result.hedgeRatio?.toFixed(4) ?? 'N/A'}</span>
              </div>
              <div className="pairs-stat">
                <span className="pairs-stat__label">Cointegration p</span>
                <span className={`pairs-stat__value ${result.cointegrationPValue != null && result.cointegrationPValue < 0.05 ? 'pairs-stat__value--good' : 'pairs-stat__value--bad'}`}>
                  {result.cointegrationPValue?.toFixed(4) ?? 'N/A'}
                </span>
              </div>
              <div className="pairs-stat">
                <span className="pairs-stat__label">Latest Z</span>
                <span className="pairs-stat__value">{result.latestZScore?.toFixed(2) ?? 'N/A'}</span>
              </div>
              <div className="pairs-stat">
                <span className="pairs-stat__label">Trades</span>
                <span className="pairs-stat__value">{result.trades}</span>
              </div>
              <div className="pairs-stat">
                <span className="pairs-stat__label">Cumulative return</span>
                <span className={`pairs-stat__value ${result.cumulativeReturn != null && result.cumulativeReturn >= 0 ? 'pairs-stat__value--good' : 'pairs-stat__value--bad'}`}>
                  {result.cumulativeReturn != null ? `${(result.cumulativeReturn * 100).toFixed(2)}%` : 'N/A'}
                </span>
              </div>
              <div className="pairs-stat">
                <span className="pairs-stat__label">Status</span>
                <span className="pairs-stat__value">{result.cointegrationInterpretation}</span>
              </div>
            </div>
          </div>

          {/* Soros insight */}
          {result.sorosInsight && (
            <div className="page-card page-card--stagger-3 pairs-insight">
              <h2 className="page-card__heading">Soros Insight</h2>
              <ReactMarkdown>{result.sorosInsight}</ReactMarkdown>
            </div>
          )}

          {/* Data series */}
          <div className="page-card page-card--stagger-4">
            <h2 className="page-card__heading">Backtest Data</h2>
            <p className="page-card__hint">
              Date range: {result.dateRange.start} to {result.dateRange.end}
              &nbsp;·&nbsp;{result.spreadSeries?.length ?? 0} data points
            </p>

            <details className="pairs-details">
              <summary>Spread series</summary>
              <div className="pairs-table-wrap">
                <table className="pairs-table">
                  <thead>
                    <tr><th>Date</th><th>Spread</th><th>Mean</th><th>Upper</th><th>Lower</th></tr>
                  </thead>
                  <tbody>
                    {(result.spreadSeries || []).slice(-30).map((r) => (
                      <tr key={r.date}>
                        <td>{r.date}</td>
                        <td>{r.spread?.toFixed(2) ?? '–'}</td>
                        <td>{r.mean?.toFixed(2) ?? '–'}</td>
                        <td>{r.entryUpper?.toFixed(2) ?? '–'}</td>
                        <td>{r.entryLower?.toFixed(2) ?? '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>

            <details className="pairs-details">
              <summary>P&amp;L series</summary>
              <div className="pairs-table-wrap">
                <table className="pairs-table">
                  <thead>
                    <tr><th>Date</th><th>Cumulative Return</th></tr>
                  </thead>
                  <tbody>
                    {(result.pnlSeries || []).slice(-30).map((r) => (
                      <tr key={r.date}>
                        <td>{r.date}</td>
                        <td className={r.cumulativeReturn >= 0 ? 'pairs-stat__value--good' : 'pairs-stat__value--bad'}>
                          {r.cumulativeReturn != null ? `${(r.cumulativeReturn * 100).toFixed(2)}%` : '–'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>

            <details className="pairs-details">
              <summary>Z-score history</summary>
              <div className="pairs-table-wrap">
                <table className="pairs-table">
                  <thead>
                    <tr><th>Date</th><th>Z-score</th></tr>
                  </thead>
                  <tbody>
                    {(result.zHistory || []).slice(-30).map((r) => (
                      <tr key={r.date}>
                        <td>{r.date}</td>
                        <td>{r.z?.toFixed(2) ?? '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        </>
      )}
    </div>
  )
}
