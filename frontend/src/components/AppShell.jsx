import { useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { CommandPalette } from './CommandPalette.jsx'

const API_BASE = 'http://localhost:8000'

const I = {
  menu: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>,
  search: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  plus: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  chat: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>,
  pairs: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
  finance: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
  info: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>,
  history: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  chevron: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>,
}

const bucketFor = (iso) => {
  if (!iso) return 'Older'
  const d = new Date(iso); const now = new Date()
  const sod = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const ts = d.getTime()
  if (ts >= sod) return 'Today'
  if (ts >= sod - 24 * 3600e3) return 'Yesterday'
  const m = d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
  return m
}

export function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const [recent, setRecent] = useState([])
  const [historyOpen, setHistoryOpen] = useState(true)
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const load = () =>
      fetch(`${API_BASE}/api/history`)
        .then((r) => (r.ok ? r.json() : []))
        .then((data) => setRecent(Array.isArray(data) ? data : []))
        .catch(() => {})
    load()
    const id = setInterval(load, 15000)
    return () => clearInterval(id)
  }, [])

  const handleNewChat = (e) => { e.preventDefault(); navigate(`/?new=${Date.now()}`) }

  const grouped = useMemo(() => {
    const out = {}
    for (const c of recent) {
      const b = bucketFor(c.updatedAt)
      ;(out[b] ||= []).push(c)
    }
    // keep ordering: Today, Yesterday, then rest as they come
    const ordered = []
    if (out.Today)     { ordered.push({ name: 'Today', items: out.Today }); delete out.Today }
    if (out.Yesterday) { ordered.push({ name: 'Yesterday', items: out.Yesterday }); delete out.Yesterday }
    Object.entries(out).forEach(([name, items]) => ordered.push({ name, items }))
    return ordered
  }, [recent])

  const titleMap = {
    '/': 'Soros',
    '/history': 'History',
    '/analytics': 'Analytics',
    '/pairs': 'Analytics',
    '/financials': 'Analytics',
    '/about': 'About',
  }
  const pageTitle = titleMap[location.pathname] || 'Soros'

  return (
    <div className={`app-shell${collapsed ? ' app-shell--collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar__top">
          <span className="sidebar__brand">SOROS</span>
          <button
            className="sidebar__collapse"
            type="button"
            title={collapsed ? 'Expand' : 'Collapse'}
            onClick={() => setCollapsed((v) => !v)}
          >
            {I.menu}
          </button>
        </div>

        {!collapsed && (
          <button
            type="button"
            className="sidebar__search sidebar__search--button"
            onClick={() => setPaletteOpen(true)}
          >
            {I.search}
            <span className="sidebar__search-placeholder">search</span>
            <span className="sidebar__search-kbd">⌘K</span>
          </button>
        )}

        <nav className="sidebar__nav">
          <NavLink end to="/" className="sidebar__nav-item">
            {I.chat}<span className="sidebar__nav-label">Chat With AI</span>
          </NavLink>
          <NavLink
            to="/analytics"
            className={({ isActive }) =>
              `sidebar__nav-item${isActive || location.pathname === '/pairs' || location.pathname === '/financials' ? ' sidebar__nav-item--active' : ''}`
            }
          >
            {I.pairs}<span className="sidebar__nav-label">Analytics</span>
          </NavLink>
          <NavLink to="/about" className="sidebar__nav-item">
            {I.info}<span className="sidebar__nav-label">About</span>
          </NavLink>

          <button
            type="button"
            className={`sidebar__nav-item${location.pathname === '/history' ? ' sidebar__nav-item--active' : ''}`}
            onClick={() => { setHistoryOpen((v) => !v); if (location.pathname !== '/history') navigate('/history') }}
          >
            {I.history}<span className="sidebar__nav-label">History</span>
          </button>
        </nav>

        {!collapsed && historyOpen && (
          <div className="sidebar__history-wrap">
            {grouped.length === 0 && (
              <div className="sidebar__history-item" style={{ fontStyle: 'italic', color: 'var(--text-dim)' }}>
                No conversations yet
              </div>
            )}
            {grouped.map((g) => (
              <div key={g.name} className="sidebar__history-group">
                <div className="sidebar__history-date">{g.name}</div>
                {g.items.slice(0, 6).map((c) => (
                  <NavLink
                    key={c.id}
                    to={`/?chat=${c.id}`}
                    className="sidebar__history-item"
                    title={c.title}
                  >
                    {c.title || 'Untitled'}
                  </NavLink>
                ))}
              </div>
            ))}
          </div>
        )}

      </aside>

      <main className="app-main">
        <header className="app-header">
          <div className="app-header__brand">
            <h1 className="app-header__title">{pageTitle.toUpperCase()}</h1>
          </div>
          <div className="app-header__actions">
            <button className="btn-primary" type="button" onClick={handleNewChat}>
              {I.plus}<span>New Chat</span>
            </button>
          </div>
        </header>

        <div className="app-content">
          <Outlet />
        </div>
      </main>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNavigate={(path) => navigate(path)}
        onNewChat={() => navigate(`/?new=${Date.now()}`)}
      />

      <nav className="mobile-nav">
        <button className="mobile-nav__link" type="button" onClick={handleNewChat}>
          {I.plus}<span>New</span>
        </button>
        <NavLink end to="/" className="mobile-nav__link">{I.chat}<span>Chat</span></NavLink>
        <NavLink to="/history" className="mobile-nav__link">{I.history}<span>History</span></NavLink>
        <NavLink to="/analytics" className="mobile-nav__link">{I.pairs}<span>Analytics</span></NavLink>
        <NavLink to="/about" className="mobile-nav__link">{I.info}<span>About</span></NavLink>
      </nav>
    </div>
  )
}
