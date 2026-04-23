import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { PairsTradingContent } from './PairsTradingPage.jsx'
import { FinancialsContent } from './FinancialsPage.jsx'

const VIEWS = [
  { id: 'pairs',      label: 'Pairs Trading' },
  { id: 'financials', label: 'Financials' },
]

export function AnalyticsPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const initial =
    searchParams.get('view') ||
    (location.pathname.startsWith('/financials') ? 'financials' : 'pairs')

  const [view, setView] = useState(initial)

  useEffect(() => {
    const urlView = searchParams.get('view')
    if (urlView && urlView !== view) setView(urlView)
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSwitch = (id) => {
    setView(id)
    if (location.pathname === '/analytics') {
      setSearchParams({ view: id }, { replace: true })
    } else {
      navigate(id === 'financials' ? '/financials' : '/pairs')
    }
  }

  const titleMap = { pairs: 'Pairs Trading', financials: 'Financials & Risk' }
  const introMap = {
    pairs: 'Cointegration tests, rolling z-scores, and cumulative P&L backtests on live market data.',
    financials: 'Margin, leverage, and liquidity metrics from live financial statements.',
  }

  return (
    <div className="page-layout">
      <div className="segmented">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            className={`segmented__item${view === v.id ? ' segmented__item--active' : ''}`}
            onClick={() => handleSwitch(v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div className="page-layout__header">
        <div>
          <h1 className="page-layout__title">{titleMap[view]}</h1>
          <p className="page-layout__intro">{introMap[view]}</p>
        </div>
      </div>

      {view === 'pairs' && <PairsTradingContent />}
      {view === 'financials' && <FinancialsContent />}
    </div>
  )
}
