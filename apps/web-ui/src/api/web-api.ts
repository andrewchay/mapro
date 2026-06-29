/**
 * Web 端 PlatformAPI 实现
 *
 * Agent WebSocket 按 sessionId 隔离，避免切换会话后响应发到错误连接。
 */

import type {
  Campaign,
  CampaignKOLPoolItem,
  KOLContentTracking,
  FileAttachment,
  AppSettings,
  UserProfile,
  AgentSessionMeta,
  AgentWorkspace,
  WorkspaceCapabilities,
  AgentMessage,
  Channel,
  ChannelCreateInput,
  ChannelUpdateInput,
  ChannelTestResult,
  FetchModelsInput,
  FetchModelsResult,
  CampaignWorkflow,
  CampaignWorkflowStepId,
  WorkspaceFileEntry,
  CampaignBrief,
  ContentAudit,
  CreateContentAuditInput,
  CreateContentTrackingInput,
  UpdateContentTrackingDataInput,
  AddPaidDataInput,
  UpdateAnalysisInput,
} from '@ma-proma/shared'
import type {
  CreateCampaignInput,
  PlatformAPI,
  ChatSendInput,
  ChatStreamEvent,
  CreateAgentSessionInput,
  ReadWorkspaceFileResult,
  ReadWorkspaceFileBase64Result,
} from './platform-api.ts'

import { fileToBase64 } from '../lib/file-utils.ts'
import {
  sendAgentMessage,
  respondAgentPermission,
  respondAgentAskUser,
  respondAgentExitPlanMode,
} from './agent-websocket-client.ts'
import { getApiToken } from './api-token.ts'

const API_BASE = import.meta.env.VITE_API_BASE || '/api'
const WS_BASE = import.meta.env.VITE_WS_BASE || 'ws://localhost:8081'

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getApiToken()
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HTTP ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

function buildWebSocketUrl(base: string): string {
  const token = getApiToken()
  if (!token) return base
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}token=${encodeURIComponent(token)}`
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

  async getCampaignBrief(campaignId: string, kolId: string) {
    try {
      const { brief } = await fetchApi<{ brief: CampaignBrief }>(`/campaigns/${campaignId}/briefs/${kolId}`)
      return brief ?? null
    } catch (error) {
      if (error instanceof Error && error.message.includes('404')) {
        return null
      }
      throw error
    }
  },

  async saveCampaignBrief(input) {
    const { brief } = await fetchApi<{ brief: CampaignBrief }>(`/campaigns/${input.campaignId}/briefs`, {
      method: 'POST',
      body: JSON.stringify({
        kolId: input.kolId,
        kolName: input.kolName,
        content: input.content,
        aiGenerated: input.aiGenerated,
        autoGenerate: input.autoGenerate,
      }),
    })
    return brief
  },

  async addContentTracking(input: CreateContentTrackingInput) {
    const { tracking } = await fetchApi<{ tracking: KOLContentTracking }>(`/campaigns/${input.campaignId}/content-tracking`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
    return tracking
  },

  async updateContentTrackingData(input: UpdateContentTrackingDataInput) {
    const { tracking } = await fetchApi<{ tracking: KOLContentTracking }>(`/campaigns/content-tracking/${input.id}/data`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
    return tracking ?? null
  },

  async addContentPaidData(input: AddPaidDataInput) {
    const { tracking } = await fetchApi<{ tracking: KOLContentTracking }>(`/campaigns/content-tracking/${input.id}/paid`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
    return tracking ?? null
  },

  async updateContentTrackingAnalysis(input: UpdateAnalysisInput) {
    const { tracking } = await fetchApi<{ tracking: KOLContentTracking }>(`/campaigns/content-tracking/${input.id}/analysis`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
    return tracking ?? null
  },

  async deleteContentTracking(id: string) {
    await fetchApi<void>(`/campaigns/content-tracking/${id}`, { method: 'DELETE' })
    return true
  },

  async analyzeContentPerformance(platform, priceTier, followersRange, ctr, engagementRate, cpm, cpe) {
    const { result } = await fetchApi<{ result: { grade: 'excellent' | 'good' | 'normal' | 'poor'; comparison: Record<string, unknown> } }>(
      '/campaigns/content-tracking/analyze',
      {
        method: 'POST',
        body: JSON.stringify({ platform, priceTier, followersRange, ctr, engagementRate, cpm, cpe }),
      },
    )
    return result
  },

  async listContentAudits(campaignId: string) {
    const { audits } = await fetchApi<{ audits: ContentAudit[] }>(`/campaigns/${campaignId}/content-audits`)
    return audits
  },

  async createContentAudit(input: CreateContentAuditInput) {
    const { audit } = await fetchApi<{ audit: ContentAudit }>(`/campaigns/${input.campaignId}/content-audits`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
    return audit
  },

  sendChatMessage(input: ChatSendInput, onEvent: (event: ChatStreamEvent) => void) {
    const ws = new WebSocket(buildWebSocketUrl(WS_BASE))

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

  // 设置与用户档案
  async getSettings(): Promise<AppSettings> {
    const { settings } = await fetchApi<{ settings: AppSettings }>('/settings')
    return settings
  },

  async updateSettings(updates: Partial<AppSettings>): Promise<AppSettings> {
    const { settings } = await fetchApi<{ settings: AppSettings }>('/settings', {
      method: 'PATCH',
      body: JSON.stringify(updates),
    })
    return settings
  },

  async getUserProfile(): Promise<UserProfile> {
    const { profile } = await fetchApi<{ profile: UserProfile }>('/user-profile')
    return profile
  },

  async updateUserProfile(updates: Partial<UserProfile>): Promise<UserProfile> {
    const { profile } = await fetchApi<{ profile: UserProfile }>('/user-profile', {
      method: 'PATCH',
      body: JSON.stringify(updates),
    })
    return profile
  },

  // 渠道管理
  async listChannels(): Promise<Channel[]> {
    const { channels } = await fetchApi<{ channels: Channel[] }>('/channels')
    return channels
  },

  async getChannel(id: string): Promise<Channel | null> {
    try {
      const { channel } = await fetchApi<{ channel: Channel }>(`/channels/${id}`)
      return channel ?? null
    } catch (error) {
      if (error instanceof Error && error.message.includes('404')) {
        return null
      }
      throw error
    }
  },

  async createChannel(input: ChannelCreateInput): Promise<Channel> {
    const { channel } = await fetchApi<{ channel: Channel }>('/channels', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    return channel
  },

  async updateChannel(id: string, input: ChannelUpdateInput): Promise<Channel> {
    const { channel } = await fetchApi<{ channel: Channel }>(`/channels/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
    return channel
  },

  async deleteChannel(id: string): Promise<void> {
    await fetchApi<void>(`/channels/${id}`, { method: 'DELETE' })
  },

  async testChannel(id: string): Promise<ChannelTestResult> {
    const { result } = await fetchApi<{ result: ChannelTestResult }>(`/channels/${id}/test`, {
      method: 'POST',
    })
    return result
  },

  async fetchModels(input: FetchModelsInput): Promise<FetchModelsResult> {
    const { result } = await fetchApi<{ result: FetchModelsResult }>('/channels/fetch-models', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    return result
  },

  async testChannelDirect(input: FetchModelsInput): Promise<ChannelTestResult> {
    const { result } = await fetchApi<{ result: ChannelTestResult }>('/channels/test-direct', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    return result
  },

  // 工作区文件
  async listWorkspaceFiles(scope: string, id: string, dir = '', recursive = false): Promise<WorkspaceFileEntry[]> {
    const params = new URLSearchParams()
    if (dir) params.set('dir', dir)
    if (recursive) params.set('recursive', 'true')
    const query = params.toString() ? `?${params.toString()}` : ''
    const { files } = await fetchApi<{ files: WorkspaceFileEntry[] }>(`/workspace-files/${scope}/${id}${query}`)
    return files
  },

  async readWorkspaceFile(
    scope: string,
    id: string,
    path: string,
    format: 'text' | 'base64' = 'text',
  ): Promise<ReadWorkspaceFileResult | ReadWorkspaceFileBase64Result> {
    const encodedPath = encodeURIComponent(path).replace(/%2F/g, '/')
    const query = format === 'base64' ? '?format=base64' : ''
    const res = await fetchApi<ReadWorkspaceFileResult | ReadWorkspaceFileBase64Result>(
      `/workspace-files/${scope}/${id}/${encodedPath}${query}`,
    )
    return res
  },

  async writeWorkspaceFile(scope: string, id: string, path: string, content: string): Promise<void> {
    const encodedPath = encodeURIComponent(path).replace(/%2F/g, '/')
    await fetchApi<void>(`/workspace-files/${scope}/${id}/${encodedPath}`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    })
  },

  async uploadWorkspaceFile(scope: string, id: string, path: string, file: File): Promise<void> {
    const data = await fileToBase64(file)
    const encodedPath = encodeURIComponent(path).replace(/%2F/g, '/')
    await fetchApi<void>(`/workspace-files/${scope}/${id}/upload/${encodedPath}`, {
      method: 'POST',
      body: JSON.stringify({
        filename: file.name,
        mediaType: file.type || 'application/octet-stream',
        data,
      }),
    })
  },

  async deleteWorkspaceFile(scope: string, id: string, path: string): Promise<void> {
    const encodedPath = encodeURIComponent(path).replace(/%2F/g, '/')
    await fetchApi<void>(`/workspace-files/${scope}/${id}/${encodedPath}`, { method: 'DELETE' })
  },

  async getCampaignWorkflow(campaignId: string): Promise<CampaignWorkflow> {
    const { workflow } = await fetchApi<{ workflow: CampaignWorkflow }>(`/campaigns/${campaignId}/workflow`)
    return workflow
  },

  async validateCampaignStep(campaignId: string, stepId: CampaignWorkflowStepId): Promise<unknown> {
    const { result } = await fetchApi<{ result: unknown }>(`/campaigns/${campaignId}/workflow/steps/${stepId}/validate`, {
      method: 'POST',
    })
    return result
  },

  async completeCampaignStep(
    campaignId: string,
    stepId: CampaignWorkflowStepId,
    messages?: AgentMessage[],
  ): Promise<{ success: boolean; workflow: CampaignWorkflow; reason?: string }> {
    const { result } = await fetchApi<{ result: { success: boolean; workflow: CampaignWorkflow; reason?: string } }>(
      `/campaigns/${campaignId}/workflow/steps/${stepId}/complete`,
      {
        method: 'POST',
        body: JSON.stringify({ messages: messages ?? [] }),
      },
    )
    return result
  },

  async resetCampaignWorkflow(campaignId: string): Promise<CampaignWorkflow> {
    const { workflow } = await fetchApi<{ workflow: CampaignWorkflow }>(`/campaigns/${campaignId}/workflow/reset`, {
      method: 'POST',
    })
    return workflow
  },

  async listCampaignArtifacts(campaignId: string, stepId: CampaignWorkflowStepId): Promise<WorkspaceFileEntry[]> {
    const { files } = await fetchApi<{ files: WorkspaceFileEntry[] }>(`/campaigns/${campaignId}/workflow/artifacts/${stepId}`)
    return files
  },

  async readCampaignArtifact(
    campaignId: string,
    stepId: CampaignWorkflowStepId,
    filePath: string,
    format: 'text' | 'base64' = 'text',
  ): Promise<ReadWorkspaceFileResult | ReadWorkspaceFileBase64Result> {
    const encodedPath = encodeURIComponent(filePath).replace(/%2F/g, '/')
    const query = format === 'base64' ? '?format=base64' : ''
    const res = await fetchApi<ReadWorkspaceFileResult | ReadWorkspaceFileBase64Result>(
      `/campaigns/${campaignId}/workflow/artifacts/${stepId}/${encodedPath}${query}`,
    )
    return res
  },

  // 附件
  async uploadAttachment(scope: string, id: string, file: File): Promise<FileAttachment> {
    const data = await fileToBase64(file)
    const { attachment } = await fetchApi<{ attachment: FileAttachment }>(`/attachments/${scope}/${id}`, {
      method: 'POST',
      body: JSON.stringify({
        filename: file.name,
        mediaType: file.type || 'application/octet-stream',
        data,
      }),
    })
    return attachment
  },

  getAttachmentUrl(scope: string, id: string, fileId: string): string {
    return `${API_BASE}/attachments/${scope}/${id}/${fileId}`
  },

  async deleteAttachment(scope: string, id: string, fileId: string): Promise<void> {
    await fetchApi<void>(`/attachments/${scope}/${id}/${fileId}`, { method: 'DELETE' })
  },

  async listAttachments(scope: string, id: string): Promise<FileAttachment[]> {
    const { attachments } = await fetchApi<{ attachments: FileAttachment[] }>(`/attachments/${scope}/${id}`)
    return attachments
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

  sendAgentMessage,
  respondAgentPermission,
  respondAgentAskUser,
  respondAgentExitPlanMode,
}
