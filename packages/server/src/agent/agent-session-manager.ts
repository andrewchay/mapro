/**
 * Agent 会话管理器（服务端最小化版本）
 *
 * 负责 Agent 会话的 CRUD 操作和消息持久化。
 * - 会话索引：{configDir}/agent-sessions.json（轻量元数据）
 * - 消息存储：{configDir}/agent-sessions/{id}.jsonl（JSONL 格式，逐行追加）
 *
 * 阶段 B P1 迁移范围：仅包含 CRUD + 消息读写。
 * 不包含 fork/rewind/snapshot/moveToWorkspace/migrateChat 等复杂操作。
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, unlinkSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { AgentSessionMeta, AgentMessage, SDKMessage } from '@ma-proma/shared'
import {
  getAgentSessionsIndexPath,
  getAgentSessionsDir,
  getAgentSessionMessagesPath,
  getAgentSessionWorkspacePath,
  getSdkConfigDir,
} from '../context/config-paths.ts'
import { readJsonFileSafe, writeJsonFileAtomic } from '../utils/safe-file.ts'
import type { AppContext } from '../context/types.ts'

/**
 * 工作区解析器抽象
 *
 * 阶段 B P1 不迁移 agent-workspace-manager，通过注入 resolver 保持解耦。
 */
export interface AgentWorkspaceSnapshot {
  id: string
  slug: string
  name?: string
}

export interface AgentWorkspaceResolver {
  getById(id: string): AgentWorkspaceSnapshot | undefined
}

/**
 * 会话管理器依赖
 */
export interface AgentSessionManagerDeps {
  context: AppContext
  workspaceResolver?: AgentWorkspaceResolver
}

/**
 * 会话索引文件格式
 */
interface AgentSessionsIndex {
  version: number
  sessions: AgentSessionMeta[]
}

/** 当前索引版本 */
const INDEX_VERSION = 1

/** 单条 SDKMessage 序列化后最大长度（UTF-16 code units，超出则截断内容） */
const MAX_SDK_MESSAGE_LENGTH = 256 * 1024
/** 截断后保留的预览文本长度 */
const TRUNCATED_PREVIEW_LENGTH = 2000

export class AgentSessionManager {
  private context: AppContext
  private workspaceResolver?: AgentWorkspaceResolver

  constructor(deps: AgentSessionManagerDeps) {
    this.context = deps.context
    this.workspaceResolver = deps.workspaceResolver
    if (typeof process !== 'undefined' && !process.env.CLAUDE_CONFIG_DIR) {
      process.env.CLAUDE_CONFIG_DIR = getSdkConfigDir(this.context)
    }
  }

  private readIndex(): AgentSessionsIndex {
    const indexPath = getAgentSessionsIndexPath(this.context)
    const data = readJsonFileSafe<AgentSessionsIndex>(indexPath)
    if (data) return data
    return { version: INDEX_VERSION, sessions: [] }
  }

  private writeIndex(index: AgentSessionsIndex): void {
    const indexPath = getAgentSessionsIndexPath(this.context)
    try {
      writeJsonFileAtomic(indexPath, index)
    } catch (error) {
      console.error('[Agent 会话] 写入索引文件失败:', error)
      throw new Error('写入 Agent 会话索引失败')
    }
  }

  /**
   * 获取所有会话（按 updatedAt 降序）
   */
  listAgentSessions(): AgentSessionMeta[] {
    const index = this.readIndex()
    return index.sessions.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /**
   * 获取单个会话的元数据
   */
  getAgentSessionMeta(id: string): AgentSessionMeta | undefined {
    const index = this.readIndex()
    return index.sessions.find((s) => s.id === id)
  }

  /**
   * 创建新会话
   */
  createAgentSession(title?: string, channelId?: string, workspaceId?: string): AgentSessionMeta {
    const index = this.readIndex()
    const now = Date.now()

    const meta: AgentSessionMeta = {
      id: randomUUID(),
      title: title || '新 Agent 会话',
      channelId,
      workspaceId,
      createdAt: now,
      updatedAt: now,
    }

    index.sessions.push(meta)
    this.writeIndex(index)

    // 确保消息目录存在
    getAgentSessionsDir(this.context)

    // 若有工作区，创建 session 级别子文件夹并初始化 .claude / .context
    if (workspaceId && this.workspaceResolver) {
      const ws = this.workspaceResolver.getById(workspaceId)
      if (ws) {
        this.initializeSessionWorkspace(ws.slug, meta.id)
      }
    }

    console.log(`[Agent 会话] 已创建会话: ${meta.title} (${meta.id})`)
    return meta
  }

  private initializeSessionWorkspace(workspaceSlug: string, sessionId: string): void {
    const sessionDir = getAgentSessionWorkspacePath(this.context, workspaceSlug, sessionId)

    const claudeDir = join(sessionDir, '.claude')
    if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true })
    const settingsPath = join(claudeDir, 'settings.json')
    let sdkSettings: Record<string, unknown> = {}
    try {
      sdkSettings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    } catch { /* 文件不存在或解析失败 */ }
    let needsWrite = false
    if (sdkSettings.plansDirectory !== '.context') {
      sdkSettings.plansDirectory = '.context'
      needsWrite = true
    }
    if (sdkSettings.skipWebFetchPreflight !== true) {
      sdkSettings.skipWebFetchPreflight = true
      needsWrite = true
    }
    if (needsWrite) {
      writeFileSync(settingsPath, JSON.stringify(sdkSettings, null, 2))
    }

    const contextDir = join(sessionDir, '.context')
    if (!existsSync(contextDir)) mkdirSync(contextDir, { recursive: true })
  }

  /**
   * 更新会话元数据
   */
  updateAgentSessionMeta(
    id: string,
    updates: Partial<
      Pick<
        AgentSessionMeta,
        | 'title'
        | 'channelId'
        | 'sdkSessionId'
        | 'workspaceId'
        | 'pinned'
        | 'archived'
        | 'attachedDirectories'
        | 'attachedFiles'
        | 'forkSourceDir'
        | 'forkSourceSdkSessionId'
        | 'resumeAtMessageUuid'
        | 'stoppedByUser'
        | 'permissionMode'
      >
    >,
  ): AgentSessionMeta {
    const index = this.readIndex()
    const idx = index.sessions.findIndex((s) => s.id === id)

    if (idx === -1) {
      throw new Error(`Agent 会话不存在: ${id}`)
    }

    const existing = index.sessions[idx]!
    const isStoppedByUserOnly = Object.keys(updates).every((k) => k === 'stoppedByUser')
    const autoUnarchive = existing.archived && !('archived' in updates) && !isStoppedByUserOnly
    const updated: AgentSessionMeta = {
      ...existing,
      ...updates,
      ...(autoUnarchive ? { archived: false } : {}),
      updatedAt: Date.now(),
    }

    index.sessions[idx] = updated
    this.writeIndex(index)

    console.log(`[Agent 会话] 已更新会话: ${updated.title} (${updated.id})`)
    return updated
  }

  /**
   * 删除会话
   */
  deleteAgentSession(id: string): void {
    const index = this.readIndex()
    const idx = index.sessions.findIndex((s) => s.id === id)

    if (idx === -1) {
      console.warn(`[Agent 会话] 会话不存在，跳过删除: ${id}`)
      return
    }

    const removed = index.sessions.splice(idx, 1)[0]!
    this.writeIndex(index)

    // 删除消息文件
    const filePath = getAgentSessionMessagesPath(this.context, id)
    if (existsSync(filePath)) {
      try {
        unlinkSync(filePath)
      } catch (error) {
        console.warn(`[Agent 会话] 删除消息文件失败 (${id}):`, error)
      }
    }

    // 清理 session 工作目录
    if (removed.workspaceId && this.workspaceResolver) {
      const ws = this.workspaceResolver.getById(removed.workspaceId)
      if (ws) {
        try {
          const sessionDir = getAgentSessionWorkspacePath(this.context, ws.slug, id)
          if (existsSync(sessionDir)) {
            rmSync(sessionDir, { recursive: true, force: true })
            console.log(`[Agent 会话] 已清理 session 工作目录: ${sessionDir}`)
          }
        } catch (error) {
          console.warn(`[Agent 会话] 清理 session 工作目录失败 (${id}):`, error)
        }
      }
    }

    console.log(`[Agent 会话] 已删除会话: ${removed.title} (${removed.id})`)
  }

  /**
   * 读取会话的所有消息
   */
  getAgentSessionMessages(id: string): AgentMessage[] {
    const filePath = getAgentSessionMessagesPath(this.context, id)

    if (!existsSync(filePath)) {
      return []
    }

    try {
      const raw = readFileSync(filePath, 'utf-8')
      const lines = raw.split('\n').filter((line) => line.trim())
      return lines.map((line) => JSON.parse(line) as AgentMessage)
    } catch (error) {
      console.error(`[Agent 会话] 读取消息失败 (${id}):`, error)
      return []
    }
  }

  /**
   * 追加一条消息到会话的 JSONL 文件
   */
  appendAgentMessage(id: string, message: AgentMessage): void {
    const filePath = getAgentSessionMessagesPath(this.context, id)

    try {
      const line = JSON.stringify(message) + '\n'
      appendFileSync(filePath, line, 'utf-8')

      const index = this.readIndex()
      const idx = index.sessions.findIndex((s) => s.id === id)
      if (idx !== -1) {
        const session = index.sessions[idx]!
        session.updatedAt = Date.now()
        if (session.archived) session.archived = false
        this.writeIndex(index)
      }
    } catch (error) {
      console.error(`[Agent 会话] 追加消息失败 (${id}):`, error)
      throw new Error('追加 Agent 消息失败')
    }
  }

  /**
   * 追加 SDKMessage 到会话的 JSONL 文件
   */
  appendSDKMessages(id: string, messages: SDKMessage[]): void {
    if (messages.length === 0) return

    const filePath = getAgentSessionMessagesPath(this.context, id)

    try {
      const lines =
        messages
          .map((m) => {
            const serialized = JSON.stringify(m)
            if (serialized.length <= MAX_SDK_MESSAGE_LENGTH) return serialized
            const sanitized = JSON.stringify(this.sanitizeOversizedMessage(m, serialized.length))
            if (sanitized.length > MAX_SDK_MESSAGE_LENGTH) {
              console.warn(
                `[Agent 会话] 消息截断后仍超限 (${(sanitized.length / 1024).toFixed(0)}K chars), session=${id}`,
              )
            }
            return sanitized
          })
          .join('\n') + '\n'
      appendFileSync(filePath, lines, 'utf-8')
    } catch (error) {
      console.error(`[Agent 会话] 追加 SDKMessage 失败 (${id}):`, error)
      throw new Error('追加 SDKMessage 失败')
    }
  }

  /**
   * 截断超大 SDKMessage 的内容，保留元数据结构。
   */
  private sanitizeOversizedMessage(msg: SDKMessage, originalLength: number): SDKMessage {
    const truncationNote = `\n[内容已截断: 原始 ${(originalLength / 1024).toFixed(0)}K chars 超出存储限制]`
    const truncationThreshold = MAX_SDK_MESSAGE_LENGTH / 2

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clone: any = JSON.parse(JSON.stringify(msg))
    const content = clone.message?.content
    if (Array.isArray(content)) {
      for (let i = 0; i < content.length; i++) {
        const block = content[i]
        if (!block || typeof block !== 'object') continue

        if (block.type === 'text' && typeof block.text === 'string' && block.text.length > truncationThreshold) {
          block.text = block.text.slice(0, TRUNCATED_PREVIEW_LENGTH) + truncationNote
        }

        if (block.type === 'tool_result') {
          if (typeof block.content === 'string' && block.content.length > truncationThreshold) {
            block.content = block.content.slice(0, TRUNCATED_PREVIEW_LENGTH) + truncationNote
          }
          if (Array.isArray(block.content)) {
            block.content = block.content.map((item: Record<string, unknown>) => {
              if (item?.type === 'image' && (item.source as Record<string, unknown>)?.data) {
                const dataLen = String((item.source as Record<string, unknown>).data).length
                return { type: 'image', _truncated: true, _originalLength: dataLen }
              }
              return item
            })
          }
        }
      }
    }

    if (
      clone.error &&
      typeof clone.error === 'object' &&
      typeof clone.error.message === 'string' &&
      clone.error.message.length > truncationThreshold
    ) {
      clone.error.message = clone.error.message.slice(0, TRUNCATED_PREVIEW_LENGTH) + truncationNote
    }

    return clone as SDKMessage
  }

  /**
   * 读取会话的所有 SDKMessage（兼容旧 AgentMessage 格式）
   */
  getAgentSessionSDKMessages(id: string): SDKMessage[] {
    const filePath = getAgentSessionMessagesPath(this.context, id)

    if (!existsSync(filePath)) {
      return []
    }

    try {
      const raw = readFileSync(filePath, 'utf-8')
      const lines = raw.split('\n').filter((line) => line.trim())
      return lines.map((line) => {
        const parsed = JSON.parse(line)
        if ('role' in parsed && !('type' in parsed)) {
          return convertLegacyMessage(parsed as AgentMessage)
        }
        return parsed as SDKMessage
      })
    } catch (error) {
      console.error(`[Agent 会话] 读取 SDKMessage 失败 (${id}):`, error)
      return []
    }
  }
}

/**
 * 将旧的 AgentMessage 转换为近似的 SDKMessage（向后兼容）
 */
function convertLegacyMessage(legacy: AgentMessage): SDKMessage {
  if (legacy.role === 'user') {
    return {
      type: 'user',
      message: {
        content: [{ type: 'text', text: legacy.content }],
      },
      parent_tool_use_id: null,
      _legacy: true,
      _createdAt: legacy.createdAt,
    } as unknown as SDKMessage
  }

  if (legacy.role === 'assistant') {
    return {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: legacy.content }],
        model: legacy.model,
      },
      parent_tool_use_id: null,
      _legacy: true,
      _createdAt: legacy.createdAt,
    } as unknown as SDKMessage
  }

  if (legacy.role === 'status') {
    return {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: legacy.content }],
      },
      parent_tool_use_id: null,
      error: { message: legacy.content, errorType: legacy.errorCode },
      _legacy: true,
      _createdAt: legacy.createdAt,
      _errorCode: legacy.errorCode,
      _errorTitle: legacy.errorTitle,
      _errorDetails: legacy.errorDetails,
      _errorCanRetry: legacy.errorCanRetry,
      _errorActions: legacy.errorActions,
    } as unknown as SDKMessage
  }

  return {
    type: 'system',
    subtype: 'init',
    _legacy: true,
    _createdAt: legacy.createdAt,
  } as unknown as SDKMessage
}
