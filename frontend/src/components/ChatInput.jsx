import { useRef, useState } from 'react'
import { CustomSelect } from './CustomSelect.jsx'

const I = {
  sparkle: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6z"/>
    </svg>
  ),
  attach: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
    </svg>
  ),
  browse: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>
  ),
  voice: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/>
    </svg>
  ),
  send: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
    </svg>
  ),
}

export function ChatInput({
  onSend, disabled, attachedFile, onRemoveFile, onAttachClick,
  modelProvider, setModelProvider, localModelName, setLocalModelName,
  modelProviderOptions, localModelOptions,
}) {
  const [value, setValue] = useState('')
  const textareaRef = useRef(null)

  const handleSubmit = (e) => {
    e.preventDefault()
    const trimmed = value.trim()
    if ((!trimmed && !attachedFile) || disabled) return
    onSend(trimmed, attachedFile)
    setValue('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e) }
  }

  const handleChange = (e) => {
    setValue(e.target.value)
    const t = textareaRef.current
    if (t) { t.style.height = 'auto'; t.style.height = `${Math.min(t.scrollHeight, 160)}px` }
  }

  return (
    <div className="chat-input-wrapper">
      {attachedFile && (
        <div className="chat-input__file-preview">
          <div className="chat-input__file-info">
            {I.attach}
            <span className="chat-input__file-name">{attachedFile.filename}</span>
            <span className="chat-input__file-meta">{attachedFile.rows} rows · {attachedFile.columns} cols</span>
          </div>
          <button className="chat-input__file-remove" type="button" onClick={onRemoveFile}>✕</button>
        </div>
      )}

      <form className="chat-input" onSubmit={handleSubmit}>
        <div className="chat-input__main">
          <span className="chat-input__sparkle">{I.sparkle}</span>
          <textarea
            ref={textareaRef}
            className="chat-input__textarea"
            placeholder={attachedFile ? 'Ask about your uploaded file…' : 'Ask a question or give a command…'}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            rows={1}
          />
        </div>

        <div className="chat-input__actions">
          <div className="chat-input__actions-left">
            <button type="button" className="input-pill" onClick={onAttachClick} disabled={disabled} title="Attach file">
              {I.attach}<span>Attach</span>
            </button>
            <button type="button" className="input-pill" disabled title="Browse prompts (coming soon)">
              {I.browse}<span>Browse Prompts</span>
            </button>
            <button type="button" className="input-pill" disabled title="Voice records (coming soon)">
              {I.voice}<span>Voice Records</span>
            </button>
          </div>

          <div className="chat-input__actions-right">
            {modelProviderOptions && (
              <CustomSelect
                options={modelProviderOptions}
                value={modelProvider}
                onChange={setModelProvider}
                disabled={disabled}
              />
            )}
            {modelProvider === 'local' && localModelOptions && (
              <CustomSelect
                options={localModelOptions}
                value={localModelName}
                onChange={setLocalModelName}
                disabled={disabled}
              />
            )}
            <button
              className="chat-input__send"
              type="submit"
              disabled={disabled || (!value.trim() && !attachedFile)}
              title="Send"
            >
              {I.send}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
