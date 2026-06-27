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
} from './context/config-paths.ts'
export { SqliteDatabase } from './context/sqlite-adapter.ts'
export {
  CampaignRepository,
  CampaignQueryService,
  CampaignCommandService,
  CampaignWorkflowService,
  CampaignArtifactValidator,
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
export { LocalFileProvider } from './files/index.ts'
export type { DbProvider, DbQueryResult, DbTransaction } from './db/index.ts'
export { SqliteDbProvider, PostgresDbProvider } from './db/index.ts'
export { readJsonFileSafe, writeJsonFileAtomic } from './utils/safe-file.ts'
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
