/**
 * Web 端 PlatformAPI 实现
 */

import type { Campaign, KOLContentTracking } from '@ma-proma/shared'
import type { CreateCampaignInput, PlatformAPI } from './platform-api.ts'

const API_BASE = import.meta.env.VITE_API_BASE || '/api'

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
    // 阶段 A 后端暂未实现内容追踪 API，先返回空数组
    // 后续接入：/campaigns/${campaignId}/content-tracking
    console.log('[webAPI] 内容追踪 API 待接入，campaignId:', campaignId)
    return []
  },
}
