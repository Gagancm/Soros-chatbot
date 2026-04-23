import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { NavLink } from 'react-router-dom'

const DEFAULT_API_BASE = 'http://localhost:8000'

const bucketFor = (iso) => {
  if (!iso) return 'Older'
  const d = new Date(iso)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const ts = d.getTime()
  if (ts >= startOfToday) return 'Today'
  if (ts >= startOfToday - 24 * 3600 * 1000) return 'Yesterday'
  if (ts >= startOfToday - 7 * 24 * 3600 * 1000) return 'Previous 7 days'
  if (ts >= startOfToday - 30 * 24 * 3600 * 1000) return 'Previous 30 days'
  return 'Older'
}

const BUCKET_ORDER = ['Today', 'Yesterday', 'Previous 7 days', 'Previous 30 days', 'Older']

export function HistoryPage() {
  const [chats, setChats] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')

  useEffect(() => { fetchHistory() }, [])

  const fetchHistory = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch(`${DEFAULT_API_BASE}/api/history`)
      if (!res.ok) throw new Error('Failed to load history')
      setChats(await res.json())
    } catch (err) {
      console.error(err)
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  const handleDelete = async (e, chatId) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      await fetch(`${DEFAULT_API_BASE}/api/history/${chatId}`, { method: 'DELETE' })
      setChats((prev) => prev.filter((c) => c.id !== chatId))
    } catch (err) {
      console.error(err)
    }
  }

  const formatTime = (iso) => {
    if (!iso) return ''
    try {
      const d = new Date(iso)
      const now = new Date()
      const diffMin = Math.floor((now - d) / 60000)
      if (diffMin < 1) return 'Just now'
      if (diffMin < 60) return `${diffMin}m ago`
      const diffHr = Math.floor(diffMin / 60)
      if (diffHr < 24) return `${diffHr}h ago`
      const diffDay = Math.floor(diffHr / 24)
      if (diffDay < 7) return `${diffDay}d ago`
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    } catch { return '' }
  }

  const filtered = useMemo(
    () => chats.filter((c) => c.title.toLowerCase().includes(search.toLowerCase())),
    [chats, search],
  )

  const grouped = useMemo(() => {
    const out = {}
    for (const c of filtered) {
      const b = bucketFor(c.updatedAt)
      ;(out[b] ||= []).push(c)
    }
    return BUCKET_ORDER.filter((b) => out[b]?.length).map((b) => ({ name: b, items: out[b] }))
  }, [filtered])

  return (
    <div className="page-layout">
      <div className="page-layout__header">
        <div>
          <h1 className="page-layout__title">History</h1>
          <p className="page-layout__intro">
            Browse and continue your previous conversations.
          </p>
        </div>
        <NavLink to="/" className="page-layout__action-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New chat
        </NavLink>
      </div>

      <div className="history-search page-card--stagger-1">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          placeholder="Search your chats..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {isLoading && (
        <div className="history-empty page-card--stagger-2">Loading conversations...</div>
      )}

      {error && createPortal(
        <div className="page-error">
          <span>{error}</span>
          <button className="page-error__close" type="button" onClick={() => setError(null)}>✕</button>
        </div>,
        document.body
      )}

      {!isLoading && !error && filtered.length === 0 && (
        <div className="history-empty page-card--stagger-2">
          {chats.length === 0
            ? 'No conversations yet. Start chatting to build your history.'
            : 'No chats match your search.'}
        </div>
      )}

      {!isLoading && grouped.map((group, gi) => (
        <div key={group.name} className={`page-card--stagger-${Math.min(gi + 2, 5)}`}>
          <div className="history-section-label">{group.name} · {group.items.length}</div>
          <div className="history-list" style={{ marginTop: 10 }}>
            {group.items.map((chat, i) => (
              <NavLink
                to={`/?chat=${chat.id}`}
                key={chat.id}
                className="history-item"
                style={{ animationDelay: `${0.03 * i}s` }}
              >
                <div className="history-item__left">
                  <span className="history-item__title">{chat.title}</span>
                  <span className="history-item__meta">
                    {chat.messageCount} messages · {formatTime(chat.updatedAt)}
                  </span>
                </div>
                <button
                  className="history-item__delete"
                  title="Delete chat"
                  onClick={(e) => handleDelete(e, chat.id)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
