import { useState } from 'react'

export function SettingsPanel() {
  const [open, setOpen] = useState(false)
  const [apiBaseUrl, setApiBaseUrl] = useState('http://localhost:8000')

  const handleSave = () => setOpen(false)

  return (
    <div className="settings-panel">
      <button
        className="sidebar__nav-item"
        title="Settings"
        type="button"
        onClick={() => setOpen(!open)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        <span className="sidebar__nav-label">Settings</span>
      </button>
      {open && (
        <div className="settings-panel__card">
          <div className="settings-panel__section">
            <label htmlFor="api-base-url">API base URL</label>
            <input
              id="api-base-url"
              type="text"
              value={apiBaseUrl}
              onChange={(e) => setApiBaseUrl(e.target.value)}
              placeholder="http://localhost:8000"
            />
            <p className="settings-panel__hint">
              Endpoint: <code>{apiBaseUrl || 'http://localhost:8000'}/api/rag</code>
            </p>
          </div>
          <div className="settings-panel__actions">
            <button type="button" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" onClick={handleSave}>Save</button>
          </div>
        </div>
      )}
    </div>
  )
}
