import { ChatMessage } from './ChatMessage.jsx'

export function ChatHistory({ messages, isLoading }) {
  return (
    <div className="chat-history">
      {messages.length === 0 && (
        <div className="chat-history__empty">
          <h2>Ask about Soros&apos;s philosophy</h2>
          <p>For example: &quot;How does Soros think about risk and reflexivity?&quot;</p>
        </div>
      )}
      {messages.map((msg, idx) => {
        const isLastUser = isLoading && msg.role === 'user' && idx === messages.length - 1
        return <ChatMessage key={idx} message={msg} lifted={isLastUser} />
      })}
      {isLoading && (
        <div className="chat-message chat-message--assistant chat-message--loading">
          <div className="chat-message__avatar">
            <span style={{ fontSize: '0.7rem', fontWeight: 700 }}>S</span>
          </div>
          <div className="chat-message__body">
            <div className="chat-message__role">Soros Advisor</div>
            <div className="chat-message__content">
              <div className="chat-message__typing">
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

