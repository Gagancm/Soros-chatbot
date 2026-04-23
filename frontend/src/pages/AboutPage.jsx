export function AboutPage() {
  return (
    <div className="page-layout">
      <div className="page-layout__header">
        <div>
          <h1 className="page-layout__title">About Soros Advisor</h1>
          <p className="page-layout__intro">
            An educational chatbot exploring George Soros&apos;s investment philosophy through
            Retrieval-Augmented Generation over a curated Q&amp;A corpus.
          </p>
        </div>
      </div>

      <div className="page-card page-card--stagger-1">
        <h2 className="page-card__heading">How it works</h2>
        <p className="page-card__text">
          A curated Soros Q&amp;A corpus is embedded with a sentence-transformer model and used to
          retrieve relevant answers, which are then summarized and reframed by an LLM. The backend
          strictly enforces a &quot;no financial advice&quot; policy and focuses on educational,
          historical, and conceptual explanations only.
        </p>
      </div>

      <div className="page-card page-card--stagger-2">
        <h2 className="page-card__heading">What&apos;s inside</h2>
        <div className="pairs-stats">
          <div className="pairs-stat">
            <span className="pairs-stat__label">Chat</span>
            <span className="pairs-stat__value" style={{ fontSize: 14 }}>RAG + skill routing</span>
          </div>
          <div className="pairs-stat">
            <span className="pairs-stat__label">Pairs Trading</span>
            <span className="pairs-stat__value" style={{ fontSize: 14 }}>Cointegration + Z-score</span>
          </div>
          <div className="pairs-stat">
            <span className="pairs-stat__label">Financials</span>
            <span className="pairs-stat__value" style={{ fontSize: 14 }}>Live ratios &amp; statements</span>
          </div>
          <div className="pairs-stat">
            <span className="pairs-stat__label">Models</span>
            <span className="pairs-stat__value" style={{ fontSize: 14 }}>Gemini + local LLMs</span>
          </div>
        </div>
      </div>

      <div className="page-card page-card--stagger-3">
        <h2 className="page-card__heading">The stack</h2>
        <p className="page-card__text">
          React 19 + Vite frontend with React Router. FastAPI backend running a sentence-transformer
          retrieval pipeline, Gemini and local HuggingFace models for generation, yfinance for market
          data, and statsmodels for cointegration tests.
        </p>
      </div>

      <div className="page-card page-card--disclaimer page-card--stagger-4">
        <p className="page-card__text">
          <strong>Disclaimer:</strong> Nothing produced by this system is investment advice. Always
          do your own research and consult qualified financial professionals before making
          investment decisions.
        </p>
      </div>
    </div>
  )
}
