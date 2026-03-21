export function AboutPage() {
  return (
    <div className="page-layout">
      <div className="page-layout__header">
        <div>
          <h1 className="page-layout__title">About Soros Advisor</h1>
          <p className="page-layout__intro">
            An educational chatbot exploring George Soros&apos;s investment philosophy through
            Retrieval-Augmented Generation.
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
        <h2 className="page-card__heading">The stack</h2>
        <p className="page-card__text">
          The frontend is a React single-page app with a chat interface, pairs trading analytics,
          and financial risk diagnostics. The backend serves a RAG pipeline with semantic search
          over Soros&apos;s published thinking.
        </p>
      </div>

      <div className="page-card page-card--disclaimer page-card--stagger-3">
        <p className="page-card__text">
          <strong>Disclaimer:</strong> Nothing produced by this system is investment advice. Always
          do your own research and consult qualified financial professionals before making
          investment decisions.
        </p>
      </div>
    </div>
  )
}
