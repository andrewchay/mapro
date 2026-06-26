/**
 * PlatformAPI 抽象接口
 *
 * 用于隔离桌面端（window.electronAPI）与 Web 端（fetch/WebSocket）的实现差异。
 * 阶段 A 先实现 Web 端版本。
 */

import type { Campaign, KOLContentTracking, ChatMessage } from '@ma-proma/shared'

export interface CreateCampaignInput {
  name: string
  brand: string
  platform: string
  budget?: number
  durationMonths?: number
  targetCity?: string[]
  targetAudience?: string
}

export interface ChatSendInput {
  conversationId: string
  messages: ChatMessage[]
  userMessage: string
  systemMessage?: string
  thinkingEnabled?: boolean
}

export interface ChatStreamEvent {
  type: 'chunk' | 'reasoning' | 'done' | 'error'
  delta?: string
  content?: string
  reasoning?: string
  error?: string
}

export interface PlatformAPI {
  listCampaigns(): Promise<Campaign[]>
  getCampaignById(id: string): Promise<Campaign | null>
  createCampaign(input: CreateCampaignInput): Promise<Campaign>
  listContentTracking(campaignId: string): Promise<KOLContentTracking[]>
  sendChatMessage(input: ChatSendInput, onEvent: (event: ChatStreamEvent) => void): void
}
