import { useState } from 'react'

export function ChatInput({ onSend, disabled, attachedFile, onRemoveFile }) {
  const [value, setValue] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    const trimmed = value.trim()
    if ((!trimmed && !attachedFile) || disabled) return
    onSend(trimmed, attachedFile)
    setValue('')
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  return (
    <div className="chat-input-wrapper">
      {/* Attached file preview */}
      {attachedFile && (
        <div className="chat-input__file-preview">
          <div className="chat-input__file-info">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span className="chat-input__file-name">{attachedFile.filename}</span>
            <span className="chat-input__file-meta">
              {attachedFile.rows} rows · {attachedFile.columns} cols
            </span>
          </div>
          <button className="chat-input__file-remove" type="button" onClick={onRemoveFile}>
            ✕
          </button>
        </div>
      )}

      <form className="chat-input" onSubmit={handleSubmit}>
        <textarea
          className="chat-input__textarea"
          placeholder={attachedFile ? 'Ask about your uploaded file...' : 'Ask me anything ...'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
        />
        <button
          className="chat-input__button"
          type="submit"
          disabled={disabled || (!value.trim() && !attachedFile)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
        </button>
      </form>
    </div>
  )
}
