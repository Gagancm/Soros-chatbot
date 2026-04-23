import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
import { ChatHistory } from '../components/ChatHistory.jsx'
import { ChatInput } from '../components/ChatInput.jsx'
import { CustomSelect } from '../components/CustomSelect.jsx'

const DEFAULT_API_BASE = 'http://localhost:8000'
const MODEL_PROVIDER_OPTIONS = [
  { value: 'gemini', label: 'Gemini' },
  { value: 'local', label: 'Local' },
]
const LOCAL_MODEL_OPTIONS = [
  { value: 'Qwen/Qwen2.5-3B-Instruct', label: 'Qwen 3B' },
  { value: 'microsoft/Phi-3.5-mini-instruct', label: 'Phi-3.5' },
]

export function ChatPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [messages, setMessages] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [apiBaseUrl] = useState(DEFAULT_API_BASE)
  const [chatId, setChatId] = useState(null)
  const [attachedFile, setAttachedFile] = useState(null)
  const [fileContext, setFileContext] = useState(null)
  const [activeMode, setActiveMode] = useState(null)
  const [modelProvider, setModelProvider] = useState('gemini')
  const [localModelName, setLocalModelName] = useState(LOCAL_MODEL_OPTIONS[0].value)
  const fileInputRef = useRef(null)
  const saveTimeout = useRef(null)

  const ragEndpoint = useMemo(
    () => `${apiBaseUrl || DEFAULT_API_BASE}/api/rag`,
    [apiBaseUrl],
  )

  const saveChatNow = useCallback((id, msgs) => {
    if (!id || msgs.length < 2) return
    clearTimeout(saveTimeout.current)

    const firstUser = msgs.find((m) => m.role === 'user')
    const title = firstUser
      ? firstUser.content.slice(0, 60) + (firstUser.content.length > 60 ? '...' : '')
      : 'Untitled chat'

    fetch(`${DEFAULT_API_BASE}/api/history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, title, messages: msgs }),
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const loadId = searchParams.get('chat')
    const newFlag = searchParams.get('new')

    if (newFlag) {
      if (chatId && messages.length >= 2) {
        saveChatNow(chatId, messages)
      }
      clearTimeout(saveTimeout.current)
      setMessages([])
      setChatId(null)
      setError(null)
      setIsLoading(false)
      setAttachedFile(null)
      setFileContext(null)
      setActiveMode(null)
      setModelProvider('gemini')
      setLocalModelName(LOCAL_MODEL_OPTIONS[0].value)
      setSearchParams({}, { replace: true })
      return
    }

    if (loadId) {
      setChatId(loadId)
      fetch(`${DEFAULT_API_BASE}/api/history/${loadId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.messages) setMessages(data.messages)
        })
        .catch(() => {})
    }
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  const hasStartedChat = messages.length > 0

  const handleChipClick = (mode) => {
    if (mode === 'files') {
      fileInputRef.current?.click()
      return
    }
    // Toggle — click again to deactivate
    setActiveMode((prev) => (prev === mode ? null : mode))
  }

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    setIsLoading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch(`${DEFAULT_API_BASE}/api/upload`, {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const detail = await res.json().catch(() => null)
        throw new Error(detail?.detail || 'Upload failed')
      }

      const data = await res.json()
      setAttachedFile({
        filename: data.filename,
        rows: data.rows,
        columns: data.columns,
        column_names: data.column_names,
        text_summary: data.text_summary,
        file_id: data.file_id,
      })
      setFileContext(data.text_summary)
    } catch (err) {
      setError(err.message || 'Failed to upload file')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSend = async (text, file) => {
    setError(null)

    let currentFileContext = fileContext
    if (file) {
      currentFileContext = file.text_summary
      setFileContext(file.text_summary)
    }

    const userMessage = {
      role: 'user',
      content: text || `Analyze the uploaded file: ${file?.filename || attachedFile?.filename}`,
      ...(file && {
        file: { filename: file.filename, rows: file.rows, columns: file.columns },
      }),
    }

    const isGreeting = !hasStartedChat && /^(hi|hello|hey|howdy|yo|sup|greetings|good\s*(morning|afternoon|evening))[\s!.,?]*$/i.test(text.trim())

    let nextMessages
    if (isGreeting) {
      nextMessages = [
        userMessage,
        {
          role: 'assistant',
          content:
            "Welcome. Ask me about George Soros's investment philosophy, risk thinking, and macro views. You can also upload files for analysis. Answers are educational only and not financial advice.",
        },
      ]
    } else {
      nextMessages = [...messages, userMessage]
    }
    setMessages(nextMessages)

    let currentChatId = chatId
    if (!currentChatId) {
      currentChatId = crypto.randomUUID()
      setChatId(currentChatId)
    }

    // For greetings, just show the welcome message — no API call needed
    if (isGreeting) {
      saveChatNow(currentChatId, nextMessages)
      return
    }

    setIsLoading(true)

    try {
      const res = await fetch(ragEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage.content,
          file_context: currentFileContext || null,
          mode: activeMode || null,
          model_provider: modelProvider,
          local_model_name: modelProvider === 'local' ? localModelName : null,
        }),
      })

      if (!res.ok) {
        const detail = await res.json().catch(() => null)
        throw new Error(detail?.detail || `Request failed with status ${res.status}`)
      }

      const data = await res.json()
      const reply = data.reply || 'No reply from backend.'
      const updated = [
        ...nextMessages,
        {
          role: 'assistant',
          content: reply,
          ...(data.skills_used?.length ? { skills_used: data.skills_used } : {}),
        },
      ]
      setMessages(updated)
      saveChatNow(currentChatId, updated)
      setAttachedFile(null)
    } catch (err) {
      console.error(err)
      setError(err.message || 'Unexpected error.')
      const updated = [
        ...nextMessages,
        {
          role: 'assistant',
          content: 'There was an error talking to the backend. Please check the server status and try again.',
        },
      ]
      setMessages(updated)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="chat-page">
      {error && createPortal(
        <div className="page-error">
          <span>{error}</span>
          <button className="page-error__close" type="button" onClick={() => setError(null)}>✕</button>
        </div>,
        document.body
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />

      {!hasStartedChat && (
        <div className="chat-welcome">
          <div className="chat-welcome__glow" />
          <div className="chat-welcome__sprite">
            <img
              className="chat-welcome__frame chat-welcome__frame--idle"
              src="/assets/soros-pixel-art.png"
              alt="Soros"
            />
            <img
              className="chat-welcome__frame chat-welcome__frame--money"
              src="/assets/soros-money.png"
              alt="Soros throwing money"
            />
          </div>
          <h1 className="chat-welcome__heading">
            THINK LIKE <em>SOROS.</em>
          </h1>
          <p className="chat-welcome__sub">
            Ask about reflexivity, macro strategy, risk management, and the philosophy behind legendary trades.
          </p>
        </div>
      )}

      {hasStartedChat && (
        <ChatHistory messages={messages} isLoading={isLoading} />
      )}

      <div className="chat-bottom-bar">
        <div className="feature-chips">
          {['files', 'charts', 'research', 'analytics'].map((mode) => (
            <button
              key={mode}
              className={`feature-chip ${activeMode === mode ? 'feature-chip--active' : ''}`}
              type="button"
              onClick={() => handleChipClick(mode)}
            >
              <div className="feature-chip__icon">
                {mode === 'files' && (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                )}
                {mode === 'charts' && (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="20" x2="18" y2="10" />
                    <line x1="12" y1="20" x2="12" y2="4" />
                    <line x1="6" y1="20" x2="6" y2="14" />
                  </svg>
                )}
                {mode === 'research' && (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                )}
                {mode === 'analytics' && (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                )}
              </div>
              <span className="feature-chip__label">{mode.charAt(0).toUpperCase() + mode.slice(1)}</span>
            </button>
          ))}
          <div className="model-selects">
            <CustomSelect
              options={MODEL_PROVIDER_OPTIONS}
              value={modelProvider}
              onChange={setModelProvider}
              disabled={isLoading}
            />
            {modelProvider === 'local' && (
              <CustomSelect
                options={LOCAL_MODEL_OPTIONS}
                value={localModelName}
                onChange={setLocalModelName}
                disabled={isLoading}
              />
            )}
          </div>
        </div>

        <ChatInput
          onSend={handleSend}
          disabled={isLoading}
          attachedFile={attachedFile}
          onRemoveFile={() => { setAttachedFile(null); setFileContext(null) }}
        />
      </div>
    </div>
  )
}
