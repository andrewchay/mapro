/**
 * 无平台依赖的配置路径工具
 *
 * 所有路径函数都接收 AppContext，不直接依赖 Electron 或 Node.js os.homedir()。
 * 阶段 A 用于支撑 Campaign 纯数据服务在 Web 服务端运行。
 */

import { join, basename } from 'node:path'
import { mkdirSync, existsSync, readFileSync } from 'node:fs'
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
 * 获取应用设置文件路径
 */
export function getSettingsPath(context: AppContext): string {
  return join(getConfigDir(context), 'settings.json')
}

/**
 * 获取用户档案文件路径
 */
export function getUserProfilePath(context: AppContext): string {
  return join(getConfigDir(context), 'user-profile.json')
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
 * 获取指定 scope 与 id 的附件目录路径
 *
 * 调用方应自行校验 scope / id 不包含路径分隔符或特殊字符。
 */
export function getAttachmentDirForScope(context: AppContext, scope: string, id: string): string {
  return join(getAttachmentsDir(context), scope, id)
}

/**
 * 解析附件相对路径为完整路径
 *
 * 调用方应自行校验 scope / id / fileId 不包含路径分隔符或特殊字符。
 */
export function resolveAttachmentPathForScope(
  context: AppContext,
  scope: string,
  id: string,
  fileId: string,
): string {
  return join(getAttachmentDirForScope(context, scope, id), fileId)
}

/**
 * 获取 Chat 工具配置文件路径
 */
export function getChatToolsConfigPath(context: AppContext): string {
  return join(getConfigDir(context), 'chat-tools.json')
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

/**
 * 获取指定 Agent 会话的消息文件路径
 */
export function getAgentSessionMessagesPath(context: AppContext, id: string): string {
  return join(getAgentSessionsDir(context), `${id}.jsonl`)
}

/**
 * 获取 Agent 工作区索引文件路径
 */
export function getAgentWorkspacesIndexPath(context: AppContext): string {
  return join(getConfigDir(context), 'agent-workspaces.json')
}

/**
 * 获取指定会话在工作区下的独立工作目录
 */
export function getAgentSessionWorkspacePath(
  context: AppContext,
  workspaceSlug: string,
  sessionId: string,
): string {
  const dir = join(getAgentWorkspacePath(context, workspaceSlug), sessionId)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * 获取指定工作区的 MCP 配置文件路径
 */
export function getWorkspaceMcpPath(context: AppContext, slug: string): string {
  return join(getAgentWorkspacePath(context, slug), 'mcp.json')
}

/**
 * 获取指定工作区的 Skills 目录路径
 */
export function getWorkspaceSkillsDir(context: AppContext, slug: string): string {
  const dir = join(getAgentWorkspacePath(context, slug), 'skills')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * 获取工作区不活跃 Skills 目录路径
 */
export function getInactiveSkillsDir(context: AppContext, slug: string): string {
  const dir = join(getAgentWorkspacePath(context, slug), 'skills-inactive')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * 获取默认 Skills 模板目录路径
 */
export function getDefaultSkillsDir(context: AppContext): string {
  const dir = join(getConfigDir(context), 'default-skills')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * 从 SKILL.md 的 YAML frontmatter 中解析 version 字段
 */
export function parseSkillVersion(skillDir: string): string {
  const skillMdPath = join(skillDir, 'SKILL.md')
  if (!existsSync(skillMdPath)) return '0.0.0'

  try {
    const content = readFileSync(skillMdPath, 'utf-8')
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/)
    if (!fmMatch?.[1]) return '0.0.0'

    const versionMatch = fmMatch[1].match(/^version:\s*(.+)$/m)
    if (versionMatch?.[1]) {
      const version = versionMatch[1].trim()
      if (/^\d+\.\d+\.\d+$/.test(version)) return version
    }
  } catch {
    // 解析失败时按旧版本处理
  }

  return '0.0.0'
}

/**
 * 获取 SDK 独立配置目录路径
 */
export function getSdkConfigDir(context: AppContext): string {
  const dir = join(getConfigDir(context), 'sdk-config')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * 获取 Agent 审计日志目录路径
 */
export function getAgentAuditLogsDir(context: AppContext): string {
  const dir = join(getConfigDir(context), 'logs')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * 获取指定日期的 Agent 审计日志文件路径
 */
export function getAgentAuditLogPath(context: AppContext, date: Date = new Date()): string {
  const dateStr = date.toISOString().slice(0, 10)
  return join(getAgentAuditLogsDir(context), `agent-audit-${dateStr}.jsonl`)
}
