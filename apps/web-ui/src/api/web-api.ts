/**
 * Web 端 PlatformAPI 实现
 */

import type {
  Campaign,
  CampaignKOLPoolItem,
  KOLContentTracking,
  AgentSessionMeta,
  AgentWorkspace,
  WorkspaceCapabilities,
  AgentMessage,
} from '@ma-proma/shared'
import type {
  CreateCampaignInput,
  PlatformAPI,
  ChatSendInput,
  ChatStreamEvent,
  CreateAgentSessionInput,
  AgentStreamEvent,
} from './platform-api.ts'

const API_BASE = import.meta.env.VITE_API_BASE || '/api'
const WS_BASE = import.meta.env.VITE_WS_BASE || 'ws://localhost:8081'

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HTTP ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

export const webAPI: PlatformAPI = {
  async listCampaigns() {
    const { campaigns } = await fetchApi<{ campaigns: Campaign[] }>('/campaigns')
    return campaigns
  },

  async getCampaignById(id: string) {
    const { campaign } = await fetchApi<{ campaign: Campaign }>(`/campaigns/${id}`)
    return campaign ?? null
  },

  async createCampaign(input: CreateCampaignInput) {
    const { campaign } = await fetchApi<{ campaign: Campaign }>('/campaigns', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    return campaign
  },

  async listContentTracking(campaignId: string) {
    const { tracking } = await fetchApi<{ tracking: KOLContentTracking[] }>(`/campaigns/${campaignId}/content-tracking`)
    return tracking
  },

  async getPoolKOLs(campaignId: string) {
    const { pool } = await fetchApi<{ pool: CampaignKOLPoolItem[] }>(`/campaigns/${campaignId}/kol-pool`)
    return pool
  },

  sendChatMessage(input: ChatSendInput, onEvent: (event: ChatStreamEvent) => void) {
    const ws = new WebSocket(WS_BASE)

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'chat', payload: input }))
    }

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data)
        if (message.channel === 'chat-stream-event') {
          onEvent(message.data as ChatStreamEvent)
          if (message.data?.type === 'done' || message.data?.type === 'error') {
            ws.close()
          }
        }
      } catch (error) {
        console.error('[webAPI] WebSocket 消息解析失败:', error)
      }
    }

    ws.onerror = (error) => {
      console.error('[webAPI] WebSocket 错误:', error)
      onEvent({ type: 'error', error: 'WebSocket 连接失败' })
    }

    ws.onclose = () => {
      // 连接关闭
    }
  },

  // Agent
  async listAgentSessions() {
    const { sessions } = await fetchApi<{ sessions: AgentSessionMeta[] }>('/agent/sessions')
    return sessions
  },

  async createAgentSession(input: CreateAgentSessionInput) {
    const { session } = await fetchApi<{ session: AgentSessionMeta }>('/agent/sessions', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    return session
  },

  async getAgentSession(id: string) {
    return fetchApi<{ session: AgentSessionMeta; messages: AgentMessage[] }>(`/agent/sessions/${id}`)
  },

  async deleteAgentSession(id: string) {
    await fetchApi<void>(`/agent/sessions/${id}`, { method: 'DELETE' })
  },

  async listAgentWorkspaces() {
    const { workspaces } = await fetchApi<{ workspaces: AgentWorkspace[] }>('/agent/workspaces')
    return workspaces
  },

  async getWorkspaceCapabilities(slug: string) {
    const { capabilities } = await fetchApi<{ capabilities: WorkspaceCapabilities }>(`/agent/workspaces/${slug}/capabilities`)
    return capabilities
  },

  sendAgentMessage(sessionId: string, userMessage: string, onEvent: (event: AgentStreamEvent) => void) {
    const ws = new WebSocket(WS_BASE)

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'agent:send', payload: { sessionId, userMessage } }))
    }

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data)
        if (message.channel === 'agent:stream:event') {
          onEvent({ type: 'payload', payload: message.data.payload })
        } else if (message.channel === 'agent:stream:complete') {
          onEvent({ type: 'complete' })
          ws.close()
        } else if (message.channel === 'agent:stream:error') {
          onEvent({ type: 'error', error: message.data.error || '未知错误' })
          ws.close()
        }
      } catch (error) {
        console.error('[webAPI] Agent WebSocket 消息解析失败:', error)
      }
    }

    ws.onerror = (error) => {
      console.error('[webAPI] Agent WebSocket 错误:', error)
      onEvent({ type: 'error', error: 'WebSocket 连接失败' })
    }

    return () => {
      try {
        ws.send(JSON.stringify({ type: 'agent:stop', payload: { sessionId } }))
      } catch {
        // ws 可能已关闭
      }
      ws.close()
    }
  },
}
