import { Routes, Route } from 'react-router-dom'
import { AppShell } from './components/AppShell.jsx'
import { ChatPage } from './pages/ChatPage.jsx'
import { AboutPage } from './pages/AboutPage.jsx'
import { PairsTradingPage } from './pages/PairsTradingPage.jsx'
import { FinancialsPage } from './pages/FinancialsPage.jsx'
import { HistoryPage } from './pages/HistoryPage.jsx'
import './App.css'

function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<ChatPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/pairs" element={<PairsTradingPage />} />
        <Route path="/financials" element={<FinancialsPage />} />
        <Route path="/about" element={<AboutPage />} />
      </Route>
    </Routes>
  )
}

export default App
