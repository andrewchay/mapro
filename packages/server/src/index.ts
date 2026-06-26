/**
 * @ma-proma/server
 *
 * MAPro 服务端共享业务逻辑入口。
 * 阶段 A 先导出 Campaign 相关服务和上下文抽象。
 */

export type { AppContext, CryptoProvider, EventSink, UserContext } from './context/index.ts'
export {
  getConfigDir,
  getConfigDirName,
  getCampaignDbPath,
  getChannelsPath,
  getConversationsIndexPath,
  getConversationsDir,
  getConversationMessagesPath,
  getAttachmentsDir,
  getAgentSessionsIndexPath,
  getAgentSessionsDir,
  getAgentWorkspacesDir,
  getAgentWorkspacePath,
  getResourcesPath,
} from './context/config-paths.ts'
export { SqliteDatabase } from './context/sqlite-adapter.ts'
export { CampaignRepository, CampaignQueryService } from './campaign/index.ts'
