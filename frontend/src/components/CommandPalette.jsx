import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const API_BASE = 'http://localhost:8000'

const I = {
  search: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  arrow: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>,
  chat: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>,
  pairs: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
  finance: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
  info: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>,
  history: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  plus: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
}

const NAV_ITEMS = [
  { id: 'nav-chat',    group: 'Navigation', title: 'Chat With AI',   hint: 'Main chat', icon: I.chat,    to: '/' },
  { id: 'nav-analyze', group: 'Navigation', title: 'Analytics',      hint: 'Pairs trading & financials', icon: I.pairs, to: '/analytics' },
  { id: 'nav-pairs',   group: 'Navigation', title: 'Pairs Trading',  hint: 'Jump to pairs view', icon: I.pairs,   to: '/pairs' },
  { id: 'nav-fin',     group: 'Navigation', title: 'Financials',     hint: 'Jump to financials view', icon: I.finance, to: '/financials' },
  { id: 'nav-history', group: 'Navigation', title: 'History',        hint: 'All past chats', icon: I.history, to: '/history' },
  { id: 'nav-about',   group: 'Navigation', title: 'About',          hint: 'App info',       icon: I.info,    to: '/about' },
]

export function CommandPalette({ open, onClose, onNavigate, onNewChat }) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [chats, setChats] = useState([])
  const inputRef = useRef(null)
  const listRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setCursor(0)
    setTimeout(() => inputRef.current?.focus(), 10)
    fetch(`${API_BASE}/api/history`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setChats(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [open])

  const items = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const actions = [
      { id: 'act-new', group: 'Actions', title: 'Start new chat', hint: 'Clear the conversation', icon: I.plus, action: 'new' },
    ]

    const matchesNav = NAV_ITEMS.filter((n) =>
      !needle || n.title.toLowerCase().includes(needle) || n.hint.toLowerCase().includes(needle)
    )
    const matchesActions = actions.filter((a) =>
      !needle || a.title.toLowerCase().includes(needle) || a.hint.toLowerCase().includes(needle)
    )

    const chatItems = chats
      .filter((c) => !needle || c.title?.toLowerCase().includes(needle))
      .slice(0, 8)
      .map((c) => ({
        id: `chat-${c.id}`,
        group: 'Conversations',
        title: c.title || 'Untitled',
        hint: `${c.messageCount ?? 0} messages`,
        icon: I.chat,
        chatId: c.id,
      }))

    return [...matchesNav, ...matchesActions, ...chatItems]
  }, [query, chats])

  useEffect(() => { setCursor(0) }, [query])

  useEffect(() => {
    if (!open) return
    const el = listRef.current?.querySelector(`[data-idx="${cursor}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursor, open])

  const runItem = (item) => {
    if (!item) return
    if (item.to) onNavigate?.(item.to)
    else if (item.chatId) onNavigate?.(`/?chat=${item.chatId}`)
    else if (item.action === 'new') onNewChat?.()
    onClose?.()
  }

  const handleKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose?.() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, items.length - 1)) }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)) }
    else if (e.key === 'Enter')     { e.preventDefault(); runItem(items[cursor]) }
  }

  if (!open) return null

  // Build grouped display while preserving flat index
  let runningIdx = 0
  const groups = []
  for (const group of ['Navigation', 'Actions', 'Conversations']) {
    const groupItems = items.filter((it) => it.group === group)
    if (!groupItems.length) continue
    groups.push({
      name: group,
      items: groupItems.map((it) => ({ ...it, _idx: items.indexOf(it) })),
    })
    runningIdx += groupItems.length
  }
  void runningIdx

  return createPortal(
    <div className="cmdk-overlay" onClick={onClose}>
      <div className="cmdk" onClick={(e) => e.stopPropagation()} onKeyDown={handleKey}>
        <div className="cmdk__header">
          <span className="cmdk__search-icon">{I.search}</span>
          <input
            ref={inputRef}
            className="cmdk__input"
            placeholder="Search pages, actions, chats…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="cmdk__kbd">ESC</span>
        </div>

        <div className="cmdk__list" ref={listRef}>
          {items.length === 0 && (
            <div className="cmdk__empty">No results for “{query}”.</div>
          )}
          {groups.map((g) => (
            <div key={g.name} className="cmdk__group">
              <div className="cmdk__group-label">{g.name}</div>
              {g.items.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  data-idx={it._idx}
                  className={`cmdk__item${cursor === it._idx ? ' cmdk__item--active' : ''}`}
                  onMouseEnter={() => setCursor(it._idx)}
                  onClick={() => runItem(it)}
                >
                  <span className="cmdk__item-icon">{it.icon}</span>
                  <span className="cmdk__item-text">
                    <span className="cmdk__item-title">{it.title}</span>
                    <span className="cmdk__item-hint">{it.hint}</span>
                  </span>
                  <span className="cmdk__item-arrow">{I.arrow}</span>
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="cmdk__footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>ESC</kbd> close</span>
        </div>
      </div>
    </div>,
    document.body
  )
}
