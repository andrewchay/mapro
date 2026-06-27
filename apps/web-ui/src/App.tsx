import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Layout } from './components/Layout.tsx'
import { CampaignListPage } from './pages/CampaignListPage.tsx'
import { CampaignDetailPage } from './pages/CampaignDetailPage.tsx'
import { ChatPage } from './pages/ChatPage.tsx'
import { AgentPage } from './pages/AgentPage.tsx'

export function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<CampaignListPage />} />
          <Route path="/campaigns/:id" element={<CampaignDetailPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/agent" element={<AgentPage />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}
