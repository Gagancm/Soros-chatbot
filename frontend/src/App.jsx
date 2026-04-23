import { Routes, Route } from 'react-router-dom'
import { AppShell } from './components/AppShell.jsx'
import { ChatPage } from './pages/ChatPage.jsx'
import { AboutPage } from './pages/AboutPage.jsx'
import { AnalyticsPage } from './pages/AnalyticsPage.jsx'
import { HistoryPage } from './pages/HistoryPage.jsx'
import './App.css'

function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<ChatPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/pairs" element={<AnalyticsPage />} />
        <Route path="/financials" element={<AnalyticsPage />} />
        <Route path="/about" element={<AboutPage />} />
      </Route>
    </Routes>
  )
}

export default App
