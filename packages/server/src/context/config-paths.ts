/**
 * 无平台依赖的配置路径工具
 *
 * 所有路径函数都接收 AppContext，不直接依赖 Electron 或 Node.js os.homedir()。
 * 阶段 A 用于支撑 Campaign 纯数据服务在 Web 服务端运行。
 */

import { join, basename } from 'node:path'
import { mkdirSync, existsSync } from 'node:fs'
import type { AppContext } from './types.ts'

/**
 * 获取配置目录名称
 *
 * 优先读取 MAPRO_DEV 环境变量；若 AppContext 支持 isPackaged() 则据此判断。
 */
export function getConfigDirName(context: AppContext): string {
  if (process.env.MAPRO_DEV === '1') {
    return '.mapro-dev'
  }
  return context.isPackaged() ? '.mapro' : '.mapro-dev'
}

/**
 * 获取配置目录路径
 */
export function getConfigDir(context: AppContext): string {
  const configDir = context.getConfigDir()
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true })
  }
  return configDir
}

/**
 * 获取 Campaign 数据库文件路径
 */
export function getCampaignDbPath(context: AppContext): string {
  return join(getConfigDir(context), 'campaign-database.sqlite')
}

/**
 * 获取渠道配置文件路径
 */
export function getChannelsPath(context: AppContext): string {
  return join(getConfigDir(context), 'channels.json')
}

/**
 * 获取对话索引文件路径
 */
export function getConversationsIndexPath(context: AppContext): string {
  return join(getConfigDir(context), 'conversations.json')
}

/**
 * 获取对话消息目录路径
 */
export function getConversationsDir(context: AppContext): string {
  const dir = join(getConfigDir(context), 'conversations')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * 获取指定对话的消息文件路径
 */
export function getConversationMessagesPath(context: AppContext, id: string): string {
  return join(getConversationsDir(context), `${id}.jsonl`)
}

/**
 * 获取附件存储根目录路径
 */
export function getAttachmentsDir(context: AppContext): string {
  const dir = join(getConfigDir(context), 'attachments')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * 获取 Agent 会话索引文件路径
 */
export function getAgentSessionsIndexPath(context: AppContext): string {
  return join(getConfigDir(context), 'agent-sessions.json')
}

/**
 * 获取 Agent 会话消息目录路径
 */
export function getAgentSessionsDir(context: AppContext): string {
  const dir = join(getConfigDir(context), 'agent-sessions')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * 获取 Agent 工作区根目录路径
 */
export function getAgentWorkspacesDir(context: AppContext): string {
  const dir = join(getConfigDir(context), 'agent-workspaces')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * 获取指定 Agent 工作区的目录路径
 */
export function getAgentWorkspacePath(context: AppContext, slug: string): string {
  const dir = join(getAgentWorkspacesDir(context), slug)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * 获取资源路径（用于读取 bundled resources）
 */
export function getResourcesPath(context: AppContext): string {
  return context.getResourcesPath()
}

/**
 * 获取 KOL 数据库文件路径
 */
export function getKolDbPath(context: AppContext): string {
  return join(getConfigDir(context), 'kol-database.sqlite')
}
