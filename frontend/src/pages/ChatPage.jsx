import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
import { ChatHistory } from '../components/ChatHistory.jsx'
import { ChatInput } from '../components/ChatInput.jsx'
import { CustomSelect } from '../components/CustomSelect.jsx'
import { VideoBackground } from '../components/VideoBackground.tsx'

const DEFAULT_API_BASE = 'http://localhost:8000'
const MODEL_PROVIDER_OPTIONS = [
  { value: 'gemini', label: 'Gemini' },
  { value: 'local', label: 'Local' },
]
const LOCAL_MODEL_OPTIONS = [
  { value: 'Qwen/Qwen2.5-3B-Instruct', label: 'Qwen 3B' },
  { value: 'microsoft/Phi-3.5-mini-instruct', label: 'Phi-3.5' },
]

const FEATURES = [
  {
    tint: 'orange',
    tag: 'Ask',
    title: 'Ask Soros anything',
    desc: 'Reflexivity, macro theses, and risk framing.',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>
      </svg>
    ),
    prompt: 'Explain reflexivity in your own words',
  },
  {
    tint: 'purple',
    tag: 'Analyze',
    title: 'Pairs & spread analysis',
    desc: 'Cointegration, z-scores, backtest P&L.',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
    ),
    prompt: 'Walk me through how you would set up a pairs trade',
  },
  {
    tint: 'green',
    tag: 'Research',
    title: 'Financial diagnostics',
    desc: 'Live ratios, margins, red flags.',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
      </svg>
    ),
    prompt: 'What are the main risk signals you watch in a company?',
  },
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
      if (chatId && messages.length >= 2) saveChatNow(chatId, messages)
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
        .then((data) => { if (data?.messages) setMessages(data.messages) })
        .catch(() => {})
    }
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  const hasStartedChat = messages.length > 0

  useEffect(() => {
    if (!hasStartedChat) {
      document.body.classList.add('has-video-bg')
      return () => document.body.classList.remove('has-video-bg')
    }
    document.body.classList.remove('has-video-bg')
    return undefined
  }, [hasStartedChat])

  const handleChipClick = (mode) => {
    if (mode === 'files') { fileInputRef.current?.click(); return }
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
      const res = await fetch(`${DEFAULT_API_BASE}/api/upload`, { method: 'POST', body: formData })
      if (!res.ok) {
        const detail = await res.json().catch(() => null)
        throw new Error(detail?.detail || 'Upload failed')
      }
      const data = await res.json()
      setAttachedFile({
        filename: data.filename, rows: data.rows, columns: data.columns,
        column_names: data.column_names, text_summary: data.text_summary, file_id: data.file_id,
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
    if (file) { currentFileContext = file.text_summary; setFileContext(file.text_summary) }

    const userMessage = {
      role: 'user',
      content: text || `Analyze the uploaded file: ${file?.filename || attachedFile?.filename}`,
      ...(file && { file: { filename: file.filename, rows: file.rows, columns: file.columns } }),
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
    if (!currentChatId) { currentChatId = crypto.randomUUID(); setChatId(currentChatId) }

    if (isGreeting) { saveChatNow(currentChatId, nextMessages); return }

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
          history: nextMessages.slice(0, -1)
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => ({ role: m.role, content: m.content })),
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
          ...(data.sources?.length ? { sources: data.sources } : {}),
        },
      ]
      setMessages(updated)
      saveChatNow(currentChatId, updated)
      setAttachedFile(null)
    } catch (err) {
      console.error(err)
      setError(err.message || 'Unexpected error.')
      setMessages([
        ...nextMessages,
        { role: 'assistant', content: 'There was an error talking to the backend. Please check the server status and try again.' },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="chat-page">
      {!hasStartedChat && createPortal(
        <VideoBackground topOffset={80} />,
        document.body,
      )}
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
          <div className="chat-welcome__inner">
            <div className="chat-welcome__sprite">
              <div className="chat-welcome__sprite-glow" />
              <img
                className="chat-welcome__sprite-frame chat-welcome__sprite-frame--idle"
                src="/assets/soros-pixel-art.png"
                alt="Soros"
              />
              <img
                className="chat-welcome__sprite-frame chat-welcome__sprite-frame--money"
                src="/assets/soros-money.png"
                alt="Soros throwing money"
              />
            </div>
            <h2 className="chat-welcome__greet">Hello, Investor</h2>
            <h1 className="chat-welcome__heading">Let&apos;s make your research easier.</h1>
            <p className="chat-welcome__sub">
              Chat about markets, reflexivity, pairs trading, and company financials.
            </p>

            <div className="chat-bottom-bar" style={{ padding: '8px 0 0', width: '100%', maxWidth: 760 }}>
              <div className="chat-bottom-bar__inner">
                <ChatInput
                  onSend={handleSend}
                  disabled={isLoading}
                  attachedFile={attachedFile}
                  onRemoveFile={() => { setAttachedFile(null); setFileContext(null) }}
                  onAttachClick={() => fileInputRef.current?.click()}
                  modelProvider={modelProvider}
                  setModelProvider={setModelProvider}
                  localModelName={localModelName}
                  setLocalModelName={setLocalModelName}
                  modelProviderOptions={MODEL_PROVIDER_OPTIONS}
                  localModelOptions={LOCAL_MODEL_OPTIONS}
                />
              </div>
            </div>

            <div className="features-grid">
              {FEATURES.map((f) => (
                <button
                  key={f.title}
                  type="button"
                  className={`feature-card feature-card--${f.tint}`}
                  onClick={() => handleSend(f.prompt)}
                >
                  <div className="feature-card__top">
                    <span className="feature-card__icon">{f.icon}</span>
                    <span className="feature-card__tag">{f.tag}</span>
                  </div>
                  <h3 className="feature-card__title">{f.title}</h3>
                  <p className="feature-card__desc">{f.desc}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {hasStartedChat && (
        <>
          <ChatHistory messages={messages} isLoading={isLoading} />
          <div className="chat-bottom-bar">
            <div className="chat-bottom-bar__inner">
              <ChatInput
                onSend={handleSend}
                disabled={isLoading}
                attachedFile={attachedFile}
                onRemoveFile={() => { setAttachedFile(null); setFileContext(null) }}
                onAttachClick={() => fileInputRef.current?.click()}
                modelProvider={modelProvider}
                setModelProvider={setModelProvider}
                localModelName={localModelName}
                setLocalModelName={setLocalModelName}
                modelProviderOptions={MODEL_PROVIDER_OPTIONS}
                localModelOptions={LOCAL_MODEL_OPTIONS}
                activeMode={activeMode}
                onChipClick={handleChipClick}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
