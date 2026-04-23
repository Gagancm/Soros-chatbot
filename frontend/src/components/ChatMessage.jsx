import ReactMarkdown from 'react-markdown'

export function ChatMessage({ message, lifted }) {
  const isUser = message.role === 'user'

  return (
    <div className={`chat-message ${isUser ? 'chat-message--user' : 'chat-message--assistant'}${lifted ? ' chat-message--loading' : ''}`}>
      <div className="chat-message__avatar">
        {isUser ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        ) : (
          <span style={{ fontSize: '0.7rem', fontWeight: 700 }}>S</span>
        )}
      </div>
      <div className="chat-message__body">
        <div className="chat-message__role">{isUser ? 'You' : 'Soros Advisor'}</div>

        {/* File attachment badge */}
        {message.file && (
          <div className="chat-message__file-badge">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span>{message.file.filename}</span>
            <span className="chat-message__file-meta">
              {message.file.rows} rows · {message.file.columns} cols
            </span>
          </div>
        )}

        {/* Skill invocation badge */}
        {message.skills_used?.length > 0 && (
          <div className="chat-message__skill-badges">
            {message.skills_used.map((skill) => (
              <span key={skill} className="chat-message__skill-badge">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
                {skill.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        )}

        <div className="chat-message__content">
          {isUser ? (
            <p>{message.content}</p>
          ) : (
            <ReactMarkdown>{message.content}</ReactMarkdown>
          )}
        </div>
      </div>
    </div>
  )
}
