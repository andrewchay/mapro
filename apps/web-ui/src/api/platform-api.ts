/**
 * PlatformAPI 抽象接口
 *
 * 用于隔离桌面端（window.electronAPI）与 Web 端（fetch/WebSocket）的实现差异。
 * 阶段 A 先实现 Web 端版本。
 */

import type {
  Campaign,
  CampaignKOLPoolItem,
  KOLContentTracking,
  ChatMessage,
  FileAttachment,
  AppSettings,
  UserProfile,
  AgentSessionMeta,
  AgentWorkspace,
  WorkspaceCapabilities,
  AgentMessage,
  AgentStreamPayload,
  MAProEvent,
  Channel,
  ChannelCreateInput,
  ChannelUpdateInput,
  ChannelTestResult,
  FetchModelsInput,
  FetchModelsResult,
  CampaignWorkflowStepId,
  CampaignWorkflow,
  WorkspaceFileEntry,
  CampaignBrief,
  SaveCampaignBriefInput,
  ContentAudit,
  CreateContentAuditInput,
  CreateContentTrackingInput,
  UpdateContentTrackingDataInput,
  AddPaidDataInput,
  UpdateAnalysisInput,
} from '@ma-proma/shared'

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
  attachments?: FileAttachment[]
}

export interface ChatStreamEvent {
  type: 'chunk' | 'reasoning' | 'done' | 'error'
  delta?: string
  content?: string
  reasoning?: string
  error?: string
}

export interface CreateAgentSessionInput {
  title?: string
  workspaceId?: string
}

export type AgentStreamEvent =
  | { type: 'payload'; payload: AgentStreamPayload }
  | { type: 'mapro_event'; event: MAProEvent }
  | { type: 'complete' }
  | { type: 'error'; error: string }

export interface ReadWorkspaceFileResult {
  content: string
  mediaType?: string
}

export interface ReadWorkspaceFileBase64Result {
  data: string
  encoding: 'base64'
  mediaType?: string
}

export interface PlatformAPI {
  listCampaigns(): Promise<Campaign[]>
  getCampaignById(id: string): Promise<Campaign | null>
  createCampaign(input: CreateCampaignInput): Promise<Campaign>
  listContentTracking(campaignId: string): Promise<KOLContentTracking[]>
  getPoolKOLs(campaignId: string): Promise<CampaignKOLPoolItem[]>

  // KOL Brief
  getCampaignBrief(campaignId: string, kolId: string): Promise<CampaignBrief | null>
  saveCampaignBrief(
    input: Omit<SaveCampaignBriefInput, 'content'> & { campaignId: string; content?: string; autoGenerate?: boolean },
  ): Promise<CampaignBrief>

  // 内容追踪
  addContentTracking(input: CreateContentTrackingInput): Promise<KOLContentTracking>
  updateContentTrackingData(input: UpdateContentTrackingDataInput): Promise<KOLContentTracking | null>
  addContentPaidData(input: AddPaidDataInput): Promise<KOLContentTracking | null>
  updateContentTrackingAnalysis(input: UpdateAnalysisInput): Promise<KOLContentTracking | null>
  deleteContentTracking(id: string): Promise<boolean>
  analyzeContentPerformance(
    platform: string,
    priceTier: string,
    followersRange: string,
    ctr: number,
    engagementRate: number,
    cpm: number,
    cpe: number,
  ): Promise<{ grade: 'excellent' | 'good' | 'normal' | 'poor'; comparison: Record<string, unknown> }>

  // 内容审核
  listContentAudits(campaignId: string): Promise<ContentAudit[]>
  createContentAudit(input: CreateContentAuditInput): Promise<ContentAudit>

  sendChatMessage(input: ChatSendInput, onEvent: (event: ChatStreamEvent) => void): void

  // 工作区文件
  listWorkspaceFiles(scope: string, id: string, dir?: string, recursive?: boolean): Promise<WorkspaceFileEntry[]>
  readWorkspaceFile(
    scope: string,
    id: string,
    path: string,
    format?: 'text' | 'base64',
  ): Promise<ReadWorkspaceFileResult | ReadWorkspaceFileBase64Result>
  writeWorkspaceFile(scope: string, id: string, path: string, content: string): Promise<void>
  uploadWorkspaceFile(scope: string, id: string, path: string, file: File): Promise<void>
  deleteWorkspaceFile(scope: string, id: string, path: string): Promise<void>

  // Campaign 工作流
  getCampaignWorkflow(campaignId: string): Promise<CampaignWorkflow>
  validateCampaignStep(campaignId: string, stepId: CampaignWorkflowStepId): Promise<unknown>
  completeCampaignStep(
    campaignId: string,
    stepId: CampaignWorkflowStepId,
    messages?: AgentMessage[],
  ): Promise<{ success: boolean; workflow: CampaignWorkflow; reason?: string }>
  resetCampaignWorkflow(campaignId: string): Promise<CampaignWorkflow>

  // Campaign 产物预览
  listCampaignArtifacts(campaignId: string, stepId: CampaignWorkflowStepId): Promise<WorkspaceFileEntry[]>
  readCampaignArtifact(
    campaignId: string,
    stepId: CampaignWorkflowStepId,
    filePath: string,
    format?: 'text' | 'base64',
  ): Promise<ReadWorkspaceFileResult | ReadWorkspaceFileBase64Result>

  // 附件
  uploadAttachment(scope: string, id: string, file: File): Promise<FileAttachment>
  getAttachmentUrl(scope: string, id: string, fileId: string): string
  deleteAttachment(scope: string, id: string, fileId: string): Promise<void>
  listAttachments(scope: string, id: string): Promise<FileAttachment[]>

  // 设置与用户档案
  getSettings(): Promise<AppSettings>
  updateSettings(updates: Partial<AppSettings>): Promise<AppSettings>
  getUserProfile(): Promise<UserProfile>
  updateUserProfile(updates: Partial<UserProfile>): Promise<UserProfile>

  // 渠道管理
  listChannels(): Promise<Channel[]>
  getChannel(id: string): Promise<Channel | null>
  createChannel(input: ChannelCreateInput): Promise<Channel>
  updateChannel(id: string, input: ChannelUpdateInput): Promise<Channel>
  deleteChannel(id: string): Promise<void>
  testChannel(id: string): Promise<ChannelTestResult>
  fetchModels(input: FetchModelsInput): Promise<FetchModelsResult>
  testChannelDirect(input: FetchModelsInput): Promise<ChannelTestResult>

  // Agent
  listAgentSessions(): Promise<AgentSessionMeta[]>
  createAgentSession(input: CreateAgentSessionInput): Promise<AgentSessionMeta>
  getAgentSession(id: string): Promise<{ session: AgentSessionMeta; messages: AgentMessage[] }>
  deleteAgentSession(id: string): Promise<void>
  listAgentWorkspaces(): Promise<AgentWorkspace[]>
  getWorkspaceCapabilities(slug: string): Promise<WorkspaceCapabilities>
  sendAgentMessage(
    sessionId: string,
    userMessage: string,
    onEvent: (event: AgentStreamEvent) => void,
  ): () => void
  respondAgentPermission(
    sessionId: string,
    requestId: string,
    behavior: 'allow' | 'deny',
    alwaysAllow: boolean,
  ): void
  respondAgentAskUser(sessionId: string, requestId: string, answers: Record<string, string>): void
  respondAgentExitPlanMode(
    sessionId: string,
    requestId: string,
    action: 'approve_auto' | 'approve_edit' | 'deny' | 'feedback',
    feedback?: string,
  ): void
}
