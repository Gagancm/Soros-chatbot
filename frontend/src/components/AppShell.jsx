import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { SettingsPanel } from './SettingsPanel.jsx'

export function AppShell() {
  const navigate = useNavigate()

  const handleNewChat = (e) => {
    e.preventDefault()
    // Navigate with a unique timestamp to force ChatPage to reset
    navigate(`/?new=${Date.now()}`)
  }

  return (
    <div className="app-shell">
      {/* Icon sidebar */}
      <aside className="app-shell__icon-sidebar">
        <div className="app-shell__icon-logo">S</div>

        <nav className="app-shell__icon-nav">
          <button
            className="app-shell__icon-link app-shell__icon-link--pink"
            title="New Chat"
            type="button"
            onClick={handleNewChat}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <NavLink to="/history" className="app-shell__icon-link app-shell__icon-link--purple" title="History">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </NavLink>
          <NavLink to="/pairs" className="app-shell__icon-link app-shell__icon-link--purple" title="Pairs Trading">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </NavLink>
          <NavLink to="/financials" className="app-shell__icon-link app-shell__icon-link--purple" title="Financials">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          </NavLink>
          <NavLink to="/about" className="app-shell__icon-link app-shell__icon-link--purple" title="About">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          </NavLink>
        </nav>
        <div className="app-shell__icon-footer">
          <SettingsPanel />
        </div>
      </aside>

      {/* Main content */}
      <main className="app-shell__main">
        <section className="app-shell__content">
          <Outlet />
        </section>
      </main>
    </div>
  )
}
