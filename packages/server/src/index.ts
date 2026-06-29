/**
 * @ma-proma/server
 *
 * MAPro 服务端共享业务逻辑入口。
 * 阶段 A 导出 Campaign / Chat 服务和上下文抽象。
 * 阶段 B 导出 Transport / SecretsStore / FileProvider / DbProvider 抽象层。
 */

export type { AppContext, CryptoProvider, EventSink, UserContext } from './context/index.ts'
export {
  getConfigDir,
  getConfigDirName,
  getCampaignDbPath,
  getKolDbPath,
  getChannelsPath,
  getConversationsIndexPath,
  getConversationsDir,
  getConversationMessagesPath,
  getAttachmentsDir,
  getAttachmentDirForScope,
  resolveAttachmentPathForScope,
  getAgentSessionsIndexPath,
  getAgentSessionsDir,
  getAgentSessionMessagesPath,
  getAgentWorkspacesIndexPath,
  getAgentWorkspacesDir,
  getAgentWorkspacePath,
  getAgentSessionWorkspacePath,
  getWorkspaceMcpPath,
  getWorkspaceSkillsDir,
  getInactiveSkillsDir,
  getDefaultSkillsDir,
  getSdkConfigDir,
  parseSkillVersion,
  getResourcesPath,
  getAgentAuditLogsDir,
  getAgentAuditLogPath,
  getSettingsPath,
  getUserProfilePath,
} from './context/config-paths.ts'
export { SqliteDatabase } from './context/sqlite-adapter.ts'
export {
  CampaignRepository,
  CampaignQueryService,
  CampaignCommandService,
  CampaignWorkflowService,
  CampaignArtifactValidator,
  ContentAuditService,
  STEP_DIR_MAP,
} from './campaign/index.ts'
export { KOLDatabaseRepository } from './kol/index.ts'
export type { ChatProviderConfig, ChatSendInput, ChatStreamEvent } from './chat/index.ts'
export { loadChatConfig, ChatService, InMemoryChatHistory } from './chat/index.ts'

// 阶段 B 新增抽象层
export type { RendererTransport, TransportMessage, TransportContext } from './transport/index.ts'
export { WebSocketTransport } from './transport/index.ts'
export type { SecretsStore } from './secrets/index.ts'
export { ServerSecretsStore } from './secrets/index.ts'
export type { FileProvider, FileEntry, FileFilter, FileReadResult, PickedFile } from './files/index.ts'
export { LocalFileProvider, AttachmentService } from './files/index.ts'
export type { SaveAttachmentInput, AttachmentMeta } from './files/index.ts'
export {
  WorkspaceFileService,
  WorkspaceFileError,
  type WorkspaceScope,
} from './workspace/workspace-file-service.ts'
export type { WorkspaceFileEntry } from '@ma-proma/shared'
export type { DbProvider, DbQueryResult, DbTransaction } from './db/index.ts'
export { SqliteDbProvider, PostgresDbProvider } from './db/index.ts'
export { readJsonFileSafe, writeJsonFileAtomic } from './utils/safe-file.ts'
export {
  getAppSettings,
  updateAppSettings,
  validateSettingsPatch,
  type SettingsPatchResult,
} from './settings/settings-service.ts'
export { getUserProfile, updateUserProfile } from './settings/user-profile-service.ts'
export {
  listChannels,
  getChannelById,
  createChannel,
  updateChannel,
  deleteChannel,
  testChannel,
  testChannelDirect,
  fetchModels,
  type FetchFn,
} from './channels/channel-service.ts'
export { validateChannelBaseUrl } from './channels/url-safety.ts'
export {
  AgentSessionManager,
  type AgentSessionManagerDeps,
  type AgentWorkspaceResolver,
  type AgentWorkspaceSnapshot,
} from './agent/agent-session-manager.ts'
export {
  AgentWorkspaceManager,
  type AgentWorkspaceManagerDeps,
} from './agent/agent-workspace-manager.ts'
export { ChatToolConfigService, type ChatToolConfigServiceDeps } from './agent/chat-tool-config.ts'
export {
  ClaudeAgentAdapter,
  type ClaudeAgentQueryOptions,
} from './agent/adapters/claude-agent-adapter.ts'
export { AgentEventBus } from './agent/agent-event-bus.ts'
export {
  buildAgentEnvironment,
  type AgentRunEnv,
  type AgentRunOptions,
  type AgentRunResult,
  type AgentRunCallbacks,
  type AgentRunner,
} from './agent/agent-runner.ts'

// Agent 权限与交互服务
export {
  AgentPermissionService,
  AgentAskUserService,
  AgentExitPlanService,
  validateToolInput,
  estimateTokenCount,
  WRITE_CONTENT_TOKEN_THRESHOLD,
  AgentAuditLogger,
  sanitizeToolInput,
  type AgentAuditEntry,
  type AgentAuditEventType,
  type AgentAuditLoggerOptions,
  resolveAgentResourceLimits,
  buildDockerResourceArgs,
  buildNativeUlimitCommand,
  parseMemoryString,
  DEFAULT_AGENT_RESOURCE_LIMITS,
  type AgentResourceLimits,
  type ResolvedAgentResourceLimits,
  AgentToolBlocklist,
  agentToolBlocklist,
  type ToolBlocklistConfig,
  type ToolBlocklistResult,
} from './agent/index.ts'
export type {
  PermissionResult,
  CanUseToolOptions,
  PermissionUpdate,
  ExitPlanPermissionResult,
  ExitPlanModeCallbacks,
} from './agent/index.ts'
