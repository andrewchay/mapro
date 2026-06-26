/**
 * PlatformAPI 抽象接口
 *
 * 用于隔离桌面端（window.electronAPI）与 Web 端（fetch）的实现差异。
 * 阶段 A 先实现 Web 端版本。
 */

import type { Campaign, KOLContentTracking } from '@ma-proma/shared'

export interface CreateCampaignInput {
  name: string
  brand: string
  platform: string
  budget?: number
  durationMonths?: number
  targetCity?: string[]
  targetAudience?: string
}

export interface PlatformAPI {
  listCampaigns(): Promise<Campaign[]>
  getCampaignById(id: string): Promise<Campaign | null>
  createCampaign(input: CreateCampaignInput): Promise<Campaign>
  listContentTracking(campaignId: string): Promise<KOLContentTracking[]>
}
