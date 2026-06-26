/**
 * Web 端 PlatformAPI 实现
 */

import type { Campaign, CampaignKOLPoolItem, KOLContentTracking } from '@ma-proma/shared'
import type { CreateCampaignInput, PlatformAPI, ChatSendInput, ChatStreamEvent } from './platform-api.ts'

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
        if (message.type === 'chat-stream-event') {
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
}
