import { mock } from 'bun:test'
import type { PlatformAPI } from '../api/platform-api.ts'

/**
 * 共享 webAPI mock 对象。
 *
 * 由于 Bun 的 mock.module 在进程内是全局的，所有 React 组件测试必须共享同一个 mock 对象，
 * 否则后加载的测试文件会覆盖前一个的 mock，导致方法缺失。
 * 每个测试在 beforeEach 中重置并配置自己关心的方法。
 */
export const mockWebAPI: Record<keyof PlatformAPI, ReturnType<typeof mock>> = {
  listCampaigns: mock(async () => []),
  getCampaignById: mock(async () => null),
  createCampaign: mock(async () => ({})),
  listContentTracking: mock(async () => []),
  getPoolKOLs: mock(async () => []),

  getCampaignBrief: mock(async () => null),
  saveCampaignBrief: mock(async () => ({ id: 'b1', campaignId: 'c1', kolId: 'k1', kolName: 'KOL', content: '', aiGenerated: false, status: 'draft', createdAt: 0, updatedAt: 0 })),

  addContentTracking: mock(async () => ({ id: 't1', campaignId: 'c1', kolId: 'k1', kolName: 'KOL', platform: 'xiaohongshu', contentUrl: '', contentType: 'organic', publishDate: '', exposure: 0, views: 0, likes: 0, saves: 0, comments: 0, shares: 0, cpm: 0, cpe: 0, ctr: 0, engagementRate: 0, dataSource: 'manual', collectedAt: 0, performanceGrade: 'pending', benchmarkComparison: '', aiAnalysis: '', recommendations: '', paidData: '', paidSpend: 0, paidExposure: 0, paidViews: 0, paidLikes: 0, phase: 1, testGroup: '', noteType: '', cost: 0, isOrganic: true, createdAt: 0, updatedAt: 0 })),
  updateContentTrackingData: mock(async () => null),
  addContentPaidData: mock(async () => null),
  updateContentTrackingAnalysis: mock(async () => null),
  deleteContentTracking: mock(async () => true),
  analyzeContentPerformance: mock(async () => ({ grade: 'good' as const, comparison: {} })),

  listContentAudits: mock(async () => []),
  createContentAudit: mock(async () => ({ auditId: 'a1', campaignId: 'c1', kolId: 'k1', kolName: 'KOL', contentUrl: '', platform: 'xiaohongshu', auditStatus: 'passed', complianceScore: 80, brandAlignmentScore: 80, qualityScore: 80, overallScore: 80, auditReport: '', auditor: 'ai', createdAt: 0, updatedAt: 0 })),

  sendChatMessage: mock(() => () => {}),

  getSettings: mock(async () => ({ themeMode: 'dark' })),
  updateSettings: mock(async () => ({ themeMode: 'dark' })),
  getUserProfile: mock(async () => ({ userName: '用户', avatar: '🧑‍💻' })),
  updateUserProfile: mock(async () => ({ userName: '用户', avatar: '🧑‍💻' })),

  listChannels: mock(async () => []),
  getChannel: mock(async () => null),
  createChannel: mock(async () => ({ id: 'ch-1', name: 'Test', provider: 'openai', baseUrl: '', apiKey: '', models: [], enabled: true, createdAt: 0, updatedAt: 0 })),
  updateChannel: mock(async () => ({ id: 'ch-1', name: 'Test', provider: 'openai', baseUrl: '', apiKey: '', models: [], enabled: true, createdAt: 0, updatedAt: 0 })),
  deleteChannel: mock(async () => {}),
  testChannel: mock(async () => ({ success: true, message: 'ok' })),
  fetchModels: mock(async () => ({ success: true, message: 'ok', models: [] })),
  testChannelDirect: mock(async () => ({ success: true, message: 'ok' })),

  uploadAttachment: mock(async () => ({ id: 'test', filename: 'test.txt', mediaType: 'text/plain', localPath: 'chat/test/test.txt', size: 0 })),
  getAttachmentUrl: mock(() => '/api/attachments/chat/test/test.txt'),
  deleteAttachment: mock(async () => {}),
  listAttachments: mock(async () => []),

  listWorkspaceFiles: mock(async () => []),
  readWorkspaceFile: mock(async () => ({ content: '' })),
  writeWorkspaceFile: mock(async () => {}),
  uploadWorkspaceFile: mock(async () => {}),
  deleteWorkspaceFile: mock(async () => {}),

  getCampaignWorkflow: mock(async () => ({ campaignId: 'test', currentStepIndex: -1, steps: [], createdAt: 0, updatedAt: 0 })),
  validateCampaignStep: mock(async () => ({})),
  completeCampaignStep: mock(async () => ({ success: true, workflow: { campaignId: 'test', currentStepIndex: -1, steps: [], createdAt: 0, updatedAt: 0 } })),
  resetCampaignWorkflow: mock(async () => ({ campaignId: 'test', currentStepIndex: -1, steps: [], createdAt: 0, updatedAt: 0 })),
  listCampaignArtifacts: mock(async () => []),
  readCampaignArtifact: mock(async () => ({ content: '' })),

  listAgentSessions: mock(async () => []),
  createAgentSession: mock(async () => ({})),
  getAgentSession: mock(async () => ({ session: null, messages: [] })),
  deleteAgentSession: mock(async () => {}),
  listAgentWorkspaces: mock(async () => []),
  getWorkspaceCapabilities: mock(async () => ({ mcpServers: [], skills: [] })),

  sendAgentMessage: mock(() => () => {}),
  respondAgentPermission: mock(() => {}),
  respondAgentAskUser: mock(() => {}),
  respondAgentExitPlanMode: mock(() => {}),
} as unknown as Record<keyof PlatformAPI, ReturnType<typeof mock>>

/** 重置所有 mock 调用记录 */
export function resetMockWebAPI(): void {
  for (const fn of Object.values(mockWebAPI)) {
    fn.mockClear?.()
    fn.mockReset?.()
  }
}
