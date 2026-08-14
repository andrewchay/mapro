/**
 * 飞书 Bridge 服务
 *
 * 核心职责：
 * - 通过 WebSocket 长连接接收飞书消息
 * - 路由命令或转发用户消息到 Agent/Chat 服务
 * - 监听 AgentEventBus 事件，累积完整回复后发送到飞书
 * - 管理聊天绑定（chatId ↔ sessionId）
 * - 智能通知路由：桌面发起的会话根据在场状态决定是否发飞书通知
 */

import { BrowserWindow } from 'electron'
import type {
  AgentStreamPayload,
  AgentSendInput,
  FeishuBridgeState,
  FeishuChatBinding,
  FeishuTestResult,
  FeishuNotifyMode,
  FeishuNotificationSentPayload,
  FeishuMention,
  FeishuGroupInfo,
  FeishuGroupMember,
  FeishuMessageContext,
  FeishuChatMessage,
  FeishuUpdateBindingInput,
  FeishuBotConfig,
} from '@ma-proma/shared'
import { FEISHU_IPC_CHANNELS, AGENT_IPC_CHANNELS } from '@ma-proma/shared'
import { getDecryptedBotAppSecret } from './feishu-config'
import { agentEventBus, runAgentHeadless, stopAgent, isAgentSessionActive } from './agent-service'
import { createAgentSession, listAgentSessions, getAgentSessionMeta } from './agent-session-manager'
import {
  listAgentWorkspacesByUpdatedAt,
  getAgentWorkspace,
  getWorkspaceCapabilities,
} from './agent-workspace-manager'
import { getFeishuBotBindingsPath, getWorkspaceFilesDir, getConfigDir } from './config-paths'
import { writeFileSync, readFileSync, existsSync, readdirSync, mkdirSync, appendFileSync, statSync } from 'node:fs'
import { basename, extname, join, dirname } from 'node:path'
import { regenerateDraftReviewVizCsv } from './draft-review-csv-viz'
import { extractTextFromFile, isSupportedDocumentExtension } from './document-parser'
import {
  inferImageMediaType as inferImageMediaTypeShared,
  saveImageToSession as saveImageToSessionShared,
  saveFileToSession as saveFileToSessionShared,
  inferExtension,
} from './bridge-attachment-utils'
import { getSettings } from './settings-service'
import { presenceService } from './feishu-presence'
import { getToolCredentials } from './chat-tool-config'
import { executeGroupNicknameFetchTask } from './browser-automation/browser-automation-service.ts'
import { loadClaudeAgentSdk } from './claude-sdk-loader'
import {
  buildAgentReplyCard,
  buildNotificationCard,
  buildErrorCard,
  buildSessionListCard,
  buildWorkspaceSwitchedCard,
  buildWorkspaceListCard,
  buildHelpCard,
  accumulateToolStart,
  splitLongContent,
} from './feishu-message'
import type { ToolSummary, FormattedAgentResult, WorkspaceListItem } from './feishu-message'

// ===== 类型定义 =====

/** 飞书图片附件（已下载，待保存到 session 工作目录） */
interface FeishuImageAttachment {
  /** 飞书 image_key */
  imageKey: string
  /** 图片二进制数据 */
  data: Buffer
  /** MIME 类型 */
  mediaType: string
}

/** 飞书文件附件（已下载，待保存到 session 工作目录） */
interface FeishuFileAttachment {
  /** 飞书 file_key */
  fileKey: string
  /** 原始文件名 */
  fileName: string
  /** 文件二进制数据 */
  data: Buffer
}

/** 会话累积缓冲 */
interface SessionBuffer {
  text: string
  toolSummaries: Map<string, ToolSummary>
  startedAt: number
  /** 是否有未应答的 AskUser 请求（用于 headless 场景） */
  hasPendingAskUser: boolean
  /** 最近一次 AskUser 的问题摘要（用于最终回复中提示用户） */
  lastAskUserSummary?: string
}

/** draft-review-state.jsonl 单条记录（版本与存档由 bridge 入库时确定性写入，审核字段由 Agent 回填） */
interface DraftReviewStateRecord {
  /** 飞书群 chatId，作为 (群, 达人) 版本累计维度 */
  groupId: string
  /** 达人名 */
  influencer: string
  /** 版本号（bridge 按 (群, 达人) 自动递增，唯一事实源） */
  version: number
  /** 三态判定：red | yellow | green（Agent 审核后回填） */
  verdict?: string
  /** 文字审核总分（Agent 回填） */
  textScore?: number
  /** 图片审核总分（Agent 回填） */
  imageScore?: number
  /** 稿件全文存档路径（draft-archives/{达人名}/{达人名}_v{N}.md） */
  archivePath: string
  /** 入库时间戳 */
  ts: number
}

/** 稿件审核反馈 CSV 待写入记录（session 完成时与 bot 回复一并落盘到工作区 draft-review-feedback.csv） */
interface PendingDraftFeedback {
  /** 达人名 */
  influencer: string
  /** 稿件文字部分（docx 内容 / 文件抽取文本 / 消息文本，兜底从归档补全） */
  textPart: string
  /** 稿件图片部分（飞书图片附件文件名列表，无则空） */
  imagePart: string
}

/**
 * 群角色名单（用户手动维护，按群隔离）
 *
 * 通过群内指令「名单：Account-姓名、执行-姓名」由 bridge 确定性录入，
 * 作为 Agent 红卡 @执行 / 黄卡·绿卡·审核失败 @Account 判定的最高优先依据
 * （其次才是成员名称前缀 Account- / 执行-）。
 * 名字按通讯录姓名精确匹配群成员 openId，匹配不到时 @ 降级为文字点名。
 */
interface GroupRoleList {
  /** 我方关键人（黄卡/绿卡/审核失败 @Account） */
  accountNames: string[]
  /** 第三方执行方（红卡 @执行） */
  executorNames: string[]
  /** 名单更新时间戳 */
  updatedAt: number
}

/**
 * 群审核口径（用户可维护，按群隔离）
 *
 * 通过群内指令「口径：...」由 bridge 确定性录入，
 * 稿件审核消息转发时确定性注入 `[本群审核口径: ...]`，
 * 作为审核判定的最高优先依据（优先于 brief 旧措辞），
 * 不依赖 Agent 从 SKILL.md 记得该规则。
 */
interface GroupAuditStandard {
  /** 口径文本（注入消息的原始内容） */
  content: string
  /** 口径更新时间戳 */
  updatedAt: number
}

/**
 * 从文本中提取飞书云文档链接的 document_id
 *
 * 支持 feishu.cn 与 larksuite.com 域名下的 docx 链接（群内分享云文档通常以纯文本链接形式到达）：
 *   https://ycnrbets30wp.feishu.cn/docx/C5pZd6lqToY4QWxceTtcGV1hnqh
 * 返回 null 表示文本中不含云文档链接。
 */
function extractDocxDocumentId(text: string): string | null {
  const match = text.match(/(?:https?:\/\/)?[\w.-]*feishu\.cn\/docx\/([A-Za-z0-9_-]+)/i)
  if (match?.[1]) return match[1]
  const larkMatch = text.match(/(?:https?:\/\/)?[\w.-]*larksuite\.com\/docx\/([A-Za-z0-9_-]+)/i)
  if (larkMatch?.[1]) return larkMatch[1]
  return null
}

// ===== Bridge =====

class FeishuBridge {
  /** Bot 配置（构造时注入，workspace 切换时同步更新） */
  private botConfig: FeishuBotConfig

  /** SDK Client（发消息用） */
  private client: InstanceType<typeof import('@larksuiteoapi/node-sdk').Client> | null = null
  /** WebSocket Client */
  private wsClient: InstanceType<typeof import('@larksuiteoapi/node-sdk').WSClient> | null = null

  /** 连接状态 */
  private status: FeishuBridgeState = { status: 'disconnected', activeBindings: 0 }

  /** Bot 自身的 open_id（连接时获取，用于群聊 @Bot 精确检测） */
  private botOpenId: string | null = null

  /** chatId → 绑定信息 */
  private chatBindings = new Map<string, FeishuChatBinding>()
  /** sessionId → chatId（反向索引） */
  private sessionToChat = new Map<string, string>()
  /** sessionId → 文本累积缓冲 */
  private sessionBuffers = new Map<string, SessionBuffer>()
  /** sessionId → 通知模式 */
  private sessionNotifyModes = new Map<string, FeishuNotifyMode>()
  /** 默认通知目标 chatId（最后一个与 Bot 交互的飞书聊天） */
  private defaultNotifyChatId: string | null = null

  /** chatId → 待合并的图片（纯图片消息暂存，等待后续文本一起发送） */
  private pendingImages = new Map<string, FeishuImageAttachment[]>()
  /** chatId → 待合并的文件（纯文件消息暂存，等待后续文本一起发送） */
  private pendingFiles = new Map<string, FeishuFileAttachment[]>()
  /** sessionId → 待写入 CSV 的稿件审核反馈（稿件信息在 handleUserMessage 收集，bot 回复在 session 完成时写入工作区 CSV） */
  private pendingDraftFeedback = new Map<string, PendingDraftFeedback>()

  /** chatId → 最近收到的用户消息 ID（用于群聊 thread reply） */
  private lastUserMessageId = new Map<string, string>()
  /** chatId → 群聊信息缓存 */
  private groupInfoCache = new Map<string, FeishuGroupInfo>()
  /** open_id → 用户显示名称缓存 */
  private userNameCache = new Map<string, string>()
  /** 正在进行的群昵称抓取（防止同一群重复触发） */
  private nicknameFetchesInFlight = new Set<string>()
  /** chatId → 最近一次群昵称抓取尝试时间戳（成功/失败都记录，避免频繁重试） */
  private lastNicknameFetchAt = new Map<string, number>()
  /** 群昵称抓取冷却时间（毫秒）：1 分钟 */
  private static readonly NICKNAME_FETCH_COOLDOWN_MS = 60_000
  /** 群信息缓存有效期（毫秒）：1 小时 */
  private static readonly GROUP_CACHE_TTL = 3600_000
  /**
   * 默认群审核口径（与 ma-draft-review SKILL.md Step 4 一致）
   * 用户可通过群内指令「口径：...」按群覆盖，未维护时使用此默认值。
   */
  private static readonly DEFAULT_AUDIT_STANDARD =
    '字数 200 字左右即可，不按 brief 字数要求（如 300 字），不强制扩充，不计分、不构成红卡；' +
    '关键词埋点正文语义体现即达标，不强求标题/前 15 字；' +
    '话题标签 #忘本美学、#vonbon忘本甄果 必须植入（缺失即红卡），数量不限'
  /** chatId → 群角色名单缓存（用户手动维护，按群隔离） */
  private groupRoleCache = new Map<string, GroupRoleList>()
  /** chatId → 群审核口径缓存（用户可维护，按群隔离） */
  private auditStandardCache = new Map<string, GroupAuditStandard>()

  /** 消息去重（防止 SDK WebSocket 重复投递） */
  private recentMessageIds = new Set<string>()
  /** 事件去重（防止网关超时重投） */
  private recentEventIds = new Set<string>()
  /** chatId 级处理锁（防止 bot 回复触发的事件重入） */
  private processingChats = new Set<string>()
  private static readonly DEDUP_MAX = 200

  /** EventBus 监听器取消函数 */
  private eventBusUnsubscribe: (() => void) | null = null

  constructor(botConfig: FeishuBotConfig) {
    this.botConfig = botConfig
  }

  /** 获取 Bot 配置 */
  getBotConfig(): FeishuBotConfig {
    return this.botConfig
  }

  // ===== 生命周期 =====

  async start(): Promise<void> {
    const { appId, appSecret } = this.botConfig
    if (!appId || !appSecret) {
      throw new Error('请先配置 App ID 和 App Secret')
    }

    this.updateStatus({ status: 'connecting' })

    try {
      const plainSecret = getDecryptedBotAppSecret(this.botConfig.id)
      const lark = await import('@larksuiteoapi/node-sdk')

      // 创建 SDK Client
      this.client = new lark.Client({
        appId,
        appSecret: plainSecret,
        appType: lark.AppType.SelfBuild,
      })

      // 获取 Bot 自身的 open_id（用于群聊 @Bot 精确检测）
      try {
        const botInfoResp = await this.client.request<{
          code?: number
          bot?: { open_id?: string; app_name?: string }
          data?: { bot?: { open_id?: string; app_name?: string } }
        }>({
          method: 'GET',
          url: 'https://open.feishu.cn/open-apis/bot/v3/info/',
        })
        console.log('[飞书 Bridge] Bot info 响应:', JSON.stringify(botInfoResp, null, 2))
        // 飞书 API 返回 bot 在顶层，Lark SDK 可能包装在 data 下，兼容两种
        this.botOpenId = botInfoResp?.bot?.open_id ?? botInfoResp?.data?.bot?.open_id ?? null
        if (this.botOpenId) {
          console.log(`[飞书 Bridge] Bot open_id: ${this.botOpenId}`)
        } else {
          console.warn('[飞书 Bridge] 未能获取 Bot open_id，群聊 @Bot 检测将使用回退策略')
        }
      } catch (error) {
        console.warn('[飞书 Bridge] 获取 Bot info 失败（非致命）:', error)
      }

      // 创建事件分发器
      // 重要：回调必须立即返回，不能 await 长时间操作
      // SDK 需要回调返回后发送 ACK 给飞书网关，否则网关会超时重投事件
      const eventDispatcher = new lark.EventDispatcher({}).register({
        'im.message.receive_v1': (data: Record<string, unknown>) => {
          this.handleFeishuMessage(data).catch((error) => {
            console.error('[飞书 Bridge] 处理消息异常:', error)
          })
        },
      })

      // 创建 WebSocket 长连接
      this.wsClient = new lark.WSClient({
        appId,
        appSecret: plainSecret,
        loggerLevel: lark.LoggerLevel.warn,
      })

      await this.wsClient.start({ eventDispatcher })

      // 注册 EventBus 监听器
      this.eventBusUnsubscribe = agentEventBus.on((sessionId, payload) => {
        this.handleAgentPayload(sessionId, payload)
      })

      // 恢复之前的聊天绑定
      this.loadBindings()

      this.updateStatus({ status: 'connected', connectedAt: Date.now() })
      console.log('[飞书 Bridge] 已连接')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.updateStatus({ status: 'error', errorMessage: message })
      console.error('[飞书 Bridge] 启动失败:', error)
    }
  }

  stop(): void {
    // 取消 EventBus 监听
    this.eventBusUnsubscribe?.()
    this.eventBusUnsubscribe = null

    // 关闭 WebSocket 连接
    if (this.wsClient) {
      try {
        this.wsClient.close({ force: true })
      } catch {
        // 忽略关闭时的错误
      }
      this.wsClient = null
    }
    this.client = null

    // 清理状态
    this.chatBindings.clear()
    this.sessionToChat.clear()
    this.sessionBuffers.clear()
    this.sessionNotifyModes.clear()
    this.recentMessageIds.clear()
    this.recentEventIds.clear()
    this.processingChats.clear()
    this.lastUserMessageId.clear()
    this.groupInfoCache.clear()
    this.userNameCache.clear()
    this.nicknameFetchesInFlight.clear()
    this.lastNicknameFetchAt.clear()
    this.groupRoleCache.clear()
    this.auditStandardCache.clear()
    this.pendingDraftFeedback.clear()
    this.defaultNotifyChatId = null
    this.botOpenId = null

    this.updateStatus({ status: 'disconnected', activeBindings: 0 })
    console.log('[飞书 Bridge] 已停止')
  }

  async restart(): Promise<void> {
    this.stop()
    await this.start()
  }

  // ===== 绑定持久化 =====

  /** 从磁盘恢复聊天绑定（应用重启后延续之前的会话） */
  private loadBindings(): void {
    const bindingsPath = getFeishuBotBindingsPath(this.botConfig.id)
    if (!existsSync(bindingsPath)) return

    try {
      const raw = readFileSync(bindingsPath, 'utf-8')
      const bindings = JSON.parse(raw) as FeishuChatBinding[]
      const appSettings = getSettings()

      for (const b of bindings) {
        // 验证对应会话仍然存在
        const session = getAgentSessionMeta(b.sessionId)
        if (session) {
          // 同步最新的渠道和模型设置（用户可能已更改）
          if (appSettings.agentChannelId) {
            b.channelId = appSettings.agentChannelId
          }
          if (appSettings.agentModelId) {
            b.modelId = appSettings.agentModelId
          }
          this.chatBindings.set(b.chatId, b)
          this.sessionToChat.set(b.sessionId, b.chatId)
        }
      }
      if (this.chatBindings.size > 0) {
        console.log(`[飞书 Bridge] 已恢复 ${this.chatBindings.size} 个聊天绑定`)
        this.updateStatus({ activeBindings: this.chatBindings.size })
      }
    } catch (error) {
      console.error('[飞书 Bridge] 加载绑定失败:', error)
    }
  }

  /** 持久化聊天绑定到磁盘 */
  private saveBindings(): void {
    try {
      const bindings = Array.from(this.chatBindings.values())
      const bindingsPath = getFeishuBotBindingsPath(this.botConfig.id)
      writeFileSync(bindingsPath, JSON.stringify(bindings, null, 2), 'utf-8')
    } catch (error) {
      console.error('[飞书 Bridge] 保存绑定失败:', error)
    }
  }

  // ===== 状态查询 =====

  getStatus(): FeishuBridgeState {
    return { ...this.status }
  }

  listBindings(): FeishuChatBinding[] {
    return Array.from(this.chatBindings.values())
  }

  /** 更新绑定的工作区/会话（从设置页调用） */
  updateBinding(input: FeishuUpdateBindingInput): FeishuChatBinding | null {
    const binding = this.chatBindings.get(input.chatId)
    if (!binding) return null

    if (input.workspaceId !== undefined) {
      binding.workspaceId = input.workspaceId
    }
    if (input.sessionId !== undefined) {
      // 清理旧反向索引，建立新的
      this.sessionToChat.delete(binding.sessionId)
      binding.sessionId = input.sessionId
      this.sessionToChat.set(input.sessionId, input.chatId)
    }

    this.saveBindings()
    return { ...binding }
  }

  /** 移除绑定（从设置页调用） */
  removeBinding(chatId: string): boolean {
    const binding = this.chatBindings.get(chatId)
    if (!binding) return false

    this.sessionToChat.delete(binding.sessionId)
    this.chatBindings.delete(chatId)
    this.updateStatus({ activeBindings: this.chatBindings.size })
    this.saveBindings()
    return true
  }

  setSessionNotifyMode(sessionId: string, mode: FeishuNotifyMode): void {
    this.sessionNotifyModes.set(sessionId, mode)
  }

  // ===== 连接测试 =====

  async testConnection(appId: string, appSecret: string): Promise<FeishuTestResult> {
    try {
      const lark = await import('@larksuiteoapi/node-sdk')
      const client = new lark.Client({
        appId,
        appSecret,
        appType: lark.AppType.SelfBuild,
      })

      // 通过获取 tenant_access_token 来验证凭证
      const resp = await client.auth.tenantAccessToken.internal({
        data: {
          app_id: appId,
          app_secret: appSecret,
        },
      })

      if (resp.code === 0) {
        return {
          success: true,
          message: '连接成功',
          botName: `App ${appId.slice(0, 8)}...`,
        }
      }

      return {
        success: false,
        message: `飞书 API 错误: ${resp.msg ?? '未知错误'} (code: ${resp.code})`,
      }
    } catch (error) {
      return {
        success: false,
        message: `连接失败: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  // ===== 飞书图片处理 =====

  /**
   * 从飞书下载图片
   *
   * 使用 im.messageResource.get API 获取消息中的图片资源。
   */
  private async downloadFeishuImage(messageId: string, imageKey: string): Promise<Buffer> {
    if (!this.client) throw new Error('飞书 Client 未初始化')

    const resp = await this.client.im.messageResource.get({
      path: { message_id: messageId, file_key: imageKey },
      params: { type: 'image' },
    })

    // Lark SDK 返回 { writeFile, getReadableStream, headers } 对象
    const stream = resp.getReadableStream()
    const chunks: Buffer[] = []
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
  }

  /**
   * 下载飞书消息中的文件资源
   */
  private async downloadFeishuFile(messageId: string, fileKey: string): Promise<Buffer> {
    if (!this.client) throw new Error('飞书 Client 未初始化')

    const resp = await this.client.im.messageResource.get({
      path: { message_id: messageId, file_key: fileKey },
      params: { type: 'file' },
    })

    const stream = resp.getReadableStream()
    const chunks: Buffer[] = []
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
  }

  /**
   * 读取飞书云文档（新版 docx）的纯文本内容
   *
   * 使用 docx.document.raw_content API，需要应用开启 docx:document 读取权限。
   * 返回 null 表示读取失败（无权限 / 文档不存在）。
   */
  private async fetchFeishuDocxContent(documentId: string): Promise<string | null> {
    if (!this.client) throw new Error('飞书 Client 未初始化')

    try {
      const resp = await this.client.docx.document.rawContent({
        path: { document_id: documentId },
      })
      const content = resp.data?.content?.trim()
      return content && content.length > 0 ? content : null
    } catch (error) {
      console.error(`[飞书 Bridge] 读取云文档 ${documentId} 内容失败:`, error)
      return null
    }
  }

  /**
   * 文本内容含 brief 关键词 → 提取全文并按来源文件名分存为 briefs/{文件名}.md
   *
   * 每份 brief 独立一个 md（如「第二批达人 Brief 合集.pdf」→ briefs/vonbon 忘本甄果 · 第二批达人 Brief 合集.md），
   * 互不覆盖；单达人 brief 文件名即达人名，供审稿时按 briefs/{达人名}.md 直接命中。
   * 返回是否已入库。
   */
  private async saveBriefTextIfNeeded(
    workspaceSlug: string,
    fileName: string,
    text: string,
  ): Promise<boolean> {
    // 仅识别文件名含 brief 关键词的文档
    if (!/\bbrief\b|brief|briefs/i.test(fileName)) return false
    const trimmed = text.trim()
    if (!trimmed) return false

    try {
      const briefsDir = join(getWorkspaceFilesDir(workspaceSlug), 'briefs')
      mkdirSync(briefsDir, { recursive: true })
      const base = fileName.replace(/\.[^.]+$/, '').replace(/[/\\:*?"<>|]/g, '_').trim() || 'brief'
      const briefPath = join(briefsDir, `${base}.md`)
      writeFileSync(briefPath, trimmed, 'utf-8')
      console.log(`[飞书 Bridge] brief 已自动入库: ${briefPath} (${trimmed.length} 字)`)
      return true
    } catch (error) {
      console.warn(`[飞书 Bridge] brief 入库失败 ${fileName}:`, error)
      return false
    }
  }

  /**
   * 识别飞书发来的 brief 文件（文件名含 brief / BRIEF 等），提取全文并持久化
   *
   * 综合 brief（一份含所有达人）存为 workspace-files/briefs/brief.md，
   * 供后续任何会话审核稿件时按达人段匹配。返回是否已入库。
   */
  private async saveFeishuBriefIfNeeded(
    workspaceSlug: string,
    fileName: string,
    filePath: string,
  ): Promise<boolean> {
    // 仅识别文件名含 brief 关键词的文档
    if (!/\bbrief\b|brief|briefs/i.test(fileName)) return false
    if (!isSupportedDocumentExtension(extname(fileName))) return false

    try {
      const docText = await extractTextFromFile(filePath)
      return await this.saveBriefTextIfNeeded(workspaceSlug, fileName, docText)
    } catch (error) {
      console.warn(`[飞书 Bridge] brief 入库失败 ${fileName}:`, error)
      return false
    }
  }

  // ===== 稿件入库（版本递增下沉到 bridge） =====

  /** draft-review-state.jsonl 路径（工作区 workspace-files 根下） */
  private getDraftReviewStatePath(workspaceSlug: string): string {
    return join(getWorkspaceFilesDir(workspaceSlug), 'draft-review-state.jsonl')
  }

  /** 读取全部 draft-review-state 记录（损坏行跳过） */
  private readDraftReviewState(workspaceSlug: string): DraftReviewStateRecord[] {
    const statePath = this.getDraftReviewStatePath(workspaceSlug)
    if (!existsSync(statePath)) return []
    try {
      const records: DraftReviewStateRecord[] = []
      for (const line of readFileSync(statePath, 'utf-8').split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          records.push(JSON.parse(trimmed) as DraftReviewStateRecord)
        } catch {
          // 损坏行跳过，不影响版本累计
        }
      }
      return records
    } catch (error) {
      console.warn('[飞书 Bridge] 读取 draft-review-state 失败:', error)
      return []
    }
  }

  /** 追加一条 draft-review-state 记录 */
  private appendDraftReviewState(workspaceSlug: string, record: DraftReviewStateRecord): void {
    try {
      const statePath = this.getDraftReviewStatePath(workspaceSlug)
      mkdirSync(dirname(statePath), { recursive: true })
      appendFileSync(statePath, JSON.stringify(record) + '\n', 'utf-8')
    } catch (error) {
      console.warn('[飞书 Bridge] 追加 draft-review-state 失败:', error)
    }
  }

  /**
   * 稿件全文存档（版本递增由 bridge 确定性完成，不再依赖 Agent 计算）
   *
   * 版本号按 (群, 达人) 在 draft-review-state.jsonl 中的最大版本 +1 递增；
   * 全文写入 workspace-files/draft-archives/{达人名}/{达人名}_v{N}.md，
   * 并在 jsonl 追加一条基础记录（审核字段待 Agent 审核后回填）。
   * 入库前先与最新一版全文对比：内容一致 → 视为同版重发，不递增版本、不重复存档。
   * 返回 { version, archivePath }；失败返回 null。
   */
  private archiveDraftReview(
    workspaceSlug: string,
    groupId: string,
    influencer: string,
    content: string,
  ): { version: number; archivePath: string } | null {
    try {
      const records = this.readDraftReviewState(workspaceSlug)
      const sameInfluencer = records.filter((r) => r.groupId === groupId && r.influencer === influencer)
      const latest = sameInfluencer.reduce<DraftReviewStateRecord | null>(
        (max, r) => (max === null || r.version > max.version ? r : max),
        null,
      )

      const trimmed = content.trim()

      // 内容对比：与最新一版全文一致 → 同版重发（如云文档链接重复粘贴/催审），不递增版本
      if (latest?.archivePath && existsSync(latest.archivePath)) {
        try {
          const stored = readFileSync(latest.archivePath, 'utf-8')
            .replace(/^# 稿件 v\d+[^\n]*\n\n/, '')
            .trim()
          if (stored === trimmed) {
            console.log(`[飞书 Bridge] 稿件内容与第 ${latest.version} 版一致，视为同版重发，不新增版本`)
            return { version: latest.version, archivePath: latest.archivePath }
          }
        } catch {
          // 读档失败不影响正常递增流程
        }
      }

      const version = (latest?.version ?? 0) + 1

      const archiveDir = join(getWorkspaceFilesDir(workspaceSlug), 'draft-archives', influencer)
      mkdirSync(archiveDir, { recursive: true })
      const archivePath = join(archiveDir, `${influencer}_v${version}.md`)
      writeFileSync(archivePath, `# 稿件 v${version} · ${influencer}\n\n${trimmed}\n`, 'utf-8')

      this.appendDraftReviewState(workspaceSlug, {
        groupId,
        influencer,
        version,
        archivePath,
        ts: Date.now(),
      })
      console.log(`[飞书 Bridge] 稿件已存档 ${archivePath} (第 ${version} 版, ${content.length} 字)`)
      return { version, archivePath }
    } catch (error) {
      console.warn('[飞书 Bridge] 稿件存档失败:', error)
      return null
    }
  }

  /** 消息文本是否含稿件触发词（判定为待审核稿件） */
  private isDraftTriggerText(text: string): boolean {
    return /初稿|改稿|终稿|成片|发布预览|请查收|辛苦审核|审稿|稿件|审核一下|请审核|预览/i.test(text)
  }

  /** 提取达人名：优先【XX】，兜底用文档/文件名（去扩展名） */
  private extractInfluencerName(userText: string, fallbackName: string): string {
    let name = ''
    const bracketMatch = userText.match(/【[^】]+】/)
    if (bracketMatch) {
      name = bracketMatch[0].replace(/[【】]/g, '').trim()
    }
    if (!name) {
      name = fallbackName.replace(/\.(docx|doc|pdf|txt|md)$/i, '').trim() || '未命名'
    }
    return name.replace(/[/\\:*?"<>|]/g, '_').slice(0, 30) || '未命名'
  }

  /**
   * 识别飞书发来的稿件（云文档 docx / 文件）并按版本号入库
   *
   * 依据消息文本中的稿件触发词（初稿/改稿/终稿/稿件等）判定这是待审核稿件；
   * 达人名从消息文本提取（【XX】优先，兜底用文档/文件名）。
   * 流程（全部由 bridge 确定性完成，Agent 不再计算版本号）：
   * 1. 版本号按 (群, 达人) 在 draft-review-state.jsonl 中递增
   * 2. 全文存档 draft-archives/{达人名}/{达人名}_v{N}.md + jsonl 记录
   * 3. 稿件仓库 draft-review/{达人名}_v{N}.md（历史保留，Agent 读最新版省 token）
   * 返回存入库的版本号；非稿件文档返回 null。
   */
  private saveDraftReview(
    workspaceSlug: string,
    groupId: string,
    userText: string,
    docName: string,
    docContent: string,
    force = false,
  ): Promise<number | null> {
    if (!force && !this.isDraftTriggerText(userText)) return Promise.resolve(null)
    const safeName = this.extractInfluencerName(userText, docName)

    try {
      const archived = this.archiveDraftReview(workspaceSlug, groupId, safeName, docContent)
      const version = archived?.version ?? 1

      const draftDir = join(getWorkspaceFilesDir(workspaceSlug), 'draft-review')
      mkdirSync(draftDir, { recursive: true })
      const draftPath = join(draftDir, `${safeName}_v${version}.md`)
      writeFileSync(draftPath, docContent, 'utf-8')
      console.log(`[飞书 Bridge] 稿件已入库 ${draftPath} (第 ${version} 版, ${docContent.length} 字)`)
      return Promise.resolve(version)
    } catch (error) {
      console.warn(`[飞书 Bridge] 稿件入库失败:`, error)
      return Promise.resolve(null)
    }
  }

  /**
   * 读取指定达人的最新归档全文（draft-archives/{达人名}/{达人名}_v{N}.md，N 最大）
   *
   * 用于 CSV"稿件文字部分"兜底：bridge 未能读到稿件正文（如云文档 API 读取降级）时，
   * 从 Agent 兜底落盘的归档补全文字内容。返回 { influencer, content }；无效达人名/无归档返回 null。
   */
  private readLatestDraftArchive(workspaceSlug: string, influencer: string): { influencer: string; content: string } | null {
    if (!influencer || influencer === '未命名') return null
    const dir = join(getWorkspaceFilesDir(workspaceSlug), 'draft-archives', influencer)
    const latest = this.latestMdInDir(dir)
    if (!latest) return null
    try {
      const content = readFileSync(join(dir, latest), 'utf-8')
      return { influencer, content }
    } catch {
      return null
    }
  }

  /**
   * 扫描 draft-archives/ 下全部达人目录，取最近修改的归档（mtime 最新），返回 { influencer, content }
   *
   * 用于达人名/正文兜底：bridge 提取不到达人名（'未命名'）时，以 Agent 落盘归档的目录名作为达人名。
   */
  private findLatestDraftArchive(workspaceSlug: string): { influencer: string; content: string } | null {
    const root = join(getWorkspaceFilesDir(workspaceSlug), 'draft-archives')
    if (!existsSync(root)) return null
    let entries: string[]
    try {
      entries = readdirSync(root)
    } catch {
      return null
    }
    let best: { influencer: string; content: string; mtime: number } | null = null
    for (const entry of entries) {
      const dir = join(root, entry)
      if (!existsSync(dir)) continue
      let files: string[]
      try {
        files = readdirSync(dir).filter((f) => f.endsWith('.md'))
      } catch {
        continue
      }
      for (const f of files) {
        const p = join(dir, f)
        let mtime = 0
        try {
          mtime = statSync(p).mtimeMs
        } catch {
          continue
        }
        if (!best || mtime > best.mtime) {
          try {
            best = { influencer: entry, content: readFileSync(p, 'utf-8'), mtime }
          } catch {
            continue
          }
        }
      }
    }
    return best
  }

  /** 返回目录内版本号最大的 md 文件名（如 {达人名}_v{N}.md 取 N 最大者），无则 null */
  private latestMdInDir(dir: string): string | null {
    if (!existsSync(dir)) return null
    let files: string[]
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.md'))
    } catch {
      return null
    }
    if (files.length === 0) return null
    const versionOf = (f: string) => {
      const m = f.match(/_v(\d+)\.md$/)
      return m ? Number(m[1]) : 0
    }
    files.sort((a, b) => versionOf(b) - versionOf(a))
    return files[0] ?? null
  }

  /** 从归档全文提取图片信息（优先"图片：N 张…"行，兜底 markdown 图片引用计数） */
  private extractImageInfoFromArchive(content: string): string {
    if (!content) return ''
    const m = content.match(/(?:图片|图)[:：]\s*([^\n]+)/)
    if (m?.[1]?.trim()) return m[1].trim()
    const count = (content.match(/!\[[^\]]*\]\([^)]+\)/g) || []).length
    if (count > 0) return `图片 ${count} 张`
    return ''
  }

  /**
   * 稿件审核反馈 CSV 落盘：session 完成时把（@谁/达人名称/稿件文字/稿件图片/bot 回复）追加到工作区 CSV
   *
   * - 文件路径：{工作区根}/draft-review-feedback.csv（绝对路径，与 bridge 其余落盘基准一致）
   * - 表头：@谁,达人名称,稿件文字部分,稿件图片部分,bot回复审核内容（首次创建时写入，含 UTF-8 BOM 保证 Excel 中文不乱码）
   * - @谁 列：审核模板开头"@姓名"（bot 实际 @ 的接收人）；历史格式（含红/黄/绿卡列）自动迁移为 5 列
   * - 稿件文字部分兜底：bridge 未读到正文（云文档 API 降级，仅有链接文本）时从 draft-archives 最新归档补全
   */
  private recordDraftFeedbackCsv(sessionId: string, reply: string): void {
    const pending = this.pendingDraftFeedback.get(sessionId)
    this.pendingDraftFeedback.delete(sessionId)
    if (!pending || !reply.trim()) return

    const chatId = this.sessionToChat.get(sessionId)
    const binding = chatId ? this.chatBindings.get(chatId) : undefined
    const ws = binding?.workspaceId ? getAgentWorkspace(binding.workspaceId) : undefined
    if (!ws) return

    // 达人归属：优先用消息提取的达人名（pending.influencer）；缺失（'未命名'）时以 bot 回复模板中的"达人：X"为准
    // （三态模板固定输出该行，是本次审核意见的事实归属），二者皆无才保留 '未命名'
    let influencer = pending.influencer
    if (!influencer || influencer === '未命名') {
      influencer = this.extractInfluencerFromReply(reply) || '未命名'
    }
    let textPart = pending.textPart
    let imagePart = pending.imagePart
    const isPlaceholderText = !textPart || textPart.length < 30 || /https?:\/\//.test(textPart)

    // 稿件信息兜底：正文/图片缺失时，优先按本次审核归属的达人名精确读取对应归档（draft-archives/{达人名}/），
    // 杜绝按全局 mtime 扫描把其他达人的归档（正文/达人名）错填到本行（同一工作区多达人时归属错乱）
    let archived = influencer !== '未命名' && (isPlaceholderText || !imagePart)
      ? this.readLatestDraftArchive(ws.slug, influencer)
      : null
    // 达人名完全无法归属（罕见）时，最后才退化为全局最新归档
    if (!archived && (influencer === '未命名' || isPlaceholderText)) {
      archived = this.findLatestDraftArchive(ws.slug)
    }
    if (archived?.content) {
      if (influencer === '未命名') influencer = archived.influencer
      if (isPlaceholderText) textPart = archived.content
      if (!imagePart) imagePart = this.extractImageInfoFromArchive(archived.content)
    }

    const csvPath = join(getWorkspaceFilesDir(ws.slug), 'draft-review-feedback.csv')
    const escapeCsvField = (value: string): string => {
      const s = value ?? ''
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    // @谁 放第 1 列：回复中 @ 的接收人（审核模板开头 @姓名）
    const mentioned = this.extractMentionedName(reply)
    const line = `${escapeCsvField(mentioned)},${escapeCsvField(influencer)},${escapeCsvField(textPart)},${escapeCsvField(imagePart)},${escapeCsvField(reply)}\n`
    const headerLine = '\uFEFF@谁,达人名称,稿件文字部分,稿件图片部分,bot回复审核内容'
    try {
      if (!existsSync(csvPath)) {
        // 首次写入加 UTF-8 BOM（Excel 打开中文不乱码）+ 表头行
        appendFileSync(csvPath, `${headerLine}\n${line}`, 'utf-8')
        console.log(`[飞书 Bridge] 已追加稿件审核反馈 CSV: ${csvPath}`)
      } else {
        // 旧格式迁移：历史文件可能是「红/黄/绿卡,@谁,…」6 列或「红/黄/绿卡,达人名称,…」5 列（无 @谁），
        // 统一重写为目标 5 列 [@谁,达人,正文,图片,回复]（去掉红/黄/绿卡列、@谁 缺失时从回复提取），
        // 避免新行与旧表头错列（引号内换行/逗号不能被 \n 盲拆，需 RFC4180 解析）
        const existing = readFileSync(csvPath, 'utf-8')
        const records = this.splitCsvRecords(existing)
        const oldHeader = records[0] ?? []
        if ((oldHeader[0] ?? '').includes('@谁')) {
          appendFileSync(csvPath, line, 'utf-8')
        } else {
          const hasMention = oldHeader.includes('@谁')
          const dataRows = records.slice(1).map((fields) => {
            if (hasMention) {
              // 红/黄/绿卡,@谁,达人,正文,图片,回复 → 去掉卡列
              return [fields[1] ?? '', ...fields.slice(2, 6)]
            }
            // 红/黄/绿卡,达人,正文,图片,回复 → 从该行回复字段提取 @谁
            const replyField = fields[4] ?? ''
            return [this.extractMentionedName(replyField), ...fields.slice(1, 5)]
          })
          writeFileSync(csvPath, `${headerLine}\n${dataRows.map((f) => f.map(escapeCsvField).join(',')).join('\n')}\n${line}`, 'utf-8')
        }
        console.log(`[飞书 Bridge] 已追加稿件审核反馈 CSV: ${csvPath}`)
      }
      // 无论首次创建还是追加，都重新生成清洗版 viz CSV（含当前工作区全部记录）
      regenerateDraftReviewVizCsv(getWorkspaceFilesDir(ws.slug))
    } catch (error) {
      console.warn(`[飞书 Bridge] 追加稿件审核反馈 CSV 失败:`, error)
    }
  }

  /**
   * 从 bot 审核回复模板中提取"达人：X"作为本次审核的达人归属
   *
   * 三态模板（红卡/黄卡/绿卡/审核失败）固定输出"达人：X"行，是本行审核意见的事实归属；
   * 消息侧达人名提取失败（'未命名'）时以此为准，确保达人/正文/审核意见三者一致。
   */
  private extractInfluencerFromReply(reply: string): string {
    if (!reply) return ''
    const m = reply.match(/达人[：:]\s*([^\n，,。]+)/)
    return m?.[1]?.trim() ?? ''
  }

  /**
   * 从 bot 审核回复中提取 @ 的接收人（审核模板开头"@姓名"即本次审核的目标接收人）
   *
   * 回复列头部可能混入用户原话（如"新稿件是 X 的初稿…"），只从「📋 稿件审核」模板段起提取，
   * 确保 @谁 取的是 bot 实际 @ 的成员而非用户消息里的 @。
   */
  private extractMentionedName(reply: string): string {
    if (!reply) return ''
    const idx = reply.indexOf('📋 稿件审核')
    const segment = idx >= 0 ? reply.slice(idx) : reply
    const m = segment.match(/@([^\s@，,。\n]+)/)
    return m?.[1]?.trim() ?? ''
  }

  /**
   * 按 RFC4180 将 CSV 全文拆成逻辑记录（支持引号内逗号/换行/双引号转义）
   *
   * 用于旧格式 CSV（无 @谁 列）迁移时正确解析被引号包裹的多行字段，避免按 \n 盲拆破坏正文。
   */
  private splitCsvRecords(text: string): string[][] {
    const records: string[][] = []
    let field = ''
    let record: string[] = []
    let inQuotes = false
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"'
            i++
          } else {
            inQuotes = false
          }
        } else {
          field += ch
        }
      } else if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        record.push(field)
        field = ''
      } else if (ch === '\n') {
        record.push(field)
        field = ''
        if (record.some((f) => f !== '')) records.push(record)
        record = []
      } else {
        field += ch
      }
    }
    if (field !== '' || record.length > 0) {
      record.push(field)
      if (record.some((f) => f !== '')) records.push(record)
    }
    return records
  }

  /**
   * 群聊中所有文件/云文档消息（无论是否 @Bot）自动入库到会话区文件
   *
   * 落盘位置：
   * - 该群已有绑定会话 → session 工作目录（与 @Bot 消息的附件保存一致）
   * - 未绑定会话 → 默认工作区 workspace-files/feishu-inbox/{chatId}/ 归档，供后续会话访问
   *
   * 仅入库不触发 Agent，避免无关文件消耗 Token。
   */
  private async archiveGroupFile(
    chatId: string,
    messageId: string,
    messageType: string,
    content: string,
  ): Promise<void> {
    try {
      // 选择目标工作区：绑定会话 > Bot 默认 > 应用设置 > 第一个工作区
      const binding = this.chatBindings.get(chatId)
      let workspaceId = binding?.workspaceId ?? this.botConfig.defaultWorkspaceId ?? getSettings().agentWorkspaceId
      if (!workspaceId) {
        const byTime = listAgentWorkspacesByUpdatedAt()
        const def = byTime.find((w) => w.slug === 'default')
        workspaceId = def?.id ?? byTime[0]?.id
      }
      if (!workspaceId) return
      const workspace = getAgentWorkspace(workspaceId)
      if (!workspace) return

      if (messageType === 'file') {
        const parsed = JSON.parse(content) as { file_key?: string; file_name?: string }
        if (!parsed.file_key) return
        const fileData = await this.downloadFeishuFile(messageId, parsed.file_key)
        const fileName = parsed.file_name || `feishu-${parsed.file_key}`
        let savedPath: string
        if (binding) {
          savedPath = saveFileToSessionShared(workspace.slug, binding.sessionId, fileName, fileData)
        } else {
          const inboxDir = join(getWorkspaceFilesDir(workspace.slug), 'feishu-inbox', chatId)
          mkdirSync(inboxDir, { recursive: true })
          savedPath = join(inboxDir, fileName.replace(/[/\\:*?"<>|]/g, '_'))
          writeFileSync(savedPath, fileData)
        }
        console.log(`[飞书 Bridge] 群文件已自动入库: ${savedPath} (${fileData.length} bytes)`)
        // 未 @Bot 的文件也要落盘到 workspace：
        // ① 文件名含 brief → briefs/brief.md（跨会话 brief 匹配）
        // ② 文件名含稿件特征 → 提取全文入 draft-review 稿件仓库（按达人名+版本）
        await this.saveFeishuBriefIfNeeded(workspace.slug, fileName, savedPath)
        if (isSupportedDocumentExtension(extname(fileName)) && /初稿|改稿|终稿|成片|预览|稿件/i.test(fileName)) {
          try {
            const docText = await extractTextFromFile(savedPath)
            const influencer = this.extractInfluencerName(fileName, fileName)
            await this.saveDraftReview(workspace.slug, chatId, fileName, influencer || fileName, docText, true)
          } catch (error) {
            console.warn(`[飞书 Bridge] 稿件文件入库失败 ${fileName}:`, error)
          }
        }
      } else if (messageType === 'docx') {
        // 云文档：读取正文保存为 Markdown
        const parsed = JSON.parse(content) as { document_id?: string; doc_name?: string }
        if (!parsed.document_id) return
        const docContent = await this.fetchFeishuDocxContent(parsed.document_id)
        if (!docContent) return
        const fileName = `${(parsed.doc_name || '飞书云文档').replace(/[/\\:*?"<>|]/g, '_')}.md`
        let savedPath: string
        if (binding) {
          savedPath = saveFileToSessionShared(
            workspace.slug, binding.sessionId, fileName, Buffer.from(docContent, 'utf-8'),
          )
        } else {
          const inboxDir = join(getWorkspaceFilesDir(workspace.slug), 'feishu-inbox', chatId)
          mkdirSync(inboxDir, { recursive: true })
          savedPath = join(inboxDir, fileName)
          writeFileSync(savedPath, docContent, 'utf-8')
        }
        console.log(`[飞书 Bridge] 群云文档已自动入库: ${savedPath} (${docContent.length} 字)`)
        // 未 @Bot 的云文档也要落盘到 workspace：
        // ① 文件名含 brief → briefs/brief.md
        // ② 主动分享云文档即视为稿件候选 → 无条件入 draft-review 稿件仓库
        await this.saveBriefTextIfNeeded(workspace.slug, fileName, docContent)
        const influencer = this.extractInfluencerName(fileName, fileName)
        await this.saveDraftReview(workspace.slug, chatId, fileName, influencer || fileName, docContent, true)
      }
    } catch (error) {
      console.warn('[飞书 Bridge] 群文件自动入库失败:', error)
    }
  }

  // ===== 飞书消息处理 =====

  private async handleFeishuMessage(data: Record<string, unknown>): Promise<void> {
    if (!this.client) return

    // 事件级去重（飞书网关超时重投时 event_id 相同）
    const eventId = data.event_id as string | undefined
    if (eventId && this.recentEventIds.has(eventId)) {
      console.log('[飞书 Bridge] 跳过重复事件 (event_id):', eventId)
      return
    }
    if (eventId) {
      this.addToDedup(this.recentEventIds, eventId)
    }

    // 解析消息
    const message = (data as { message?: Record<string, unknown> }).message
    if (!message) return

    const sender = (data as { sender?: Record<string, unknown> }).sender

    // 过滤非用户消息（Bot 自己发的消息 sender_type 不是 "user"）
    const senderType = (sender?.sender_type as string) ?? ''
    if (senderType !== 'user') {
      return
    }

    // 消息级去重（同一条消息被不同 event 包裹时 message_id 相同）
    const messageId = message.message_id as string
    if (messageId && this.recentMessageIds.has(messageId)) {
      console.log('[飞书 Bridge] 跳过重复消息 (message_id):', messageId)
      return
    }
    if (messageId) {
      this.addToDedup(this.recentMessageIds, messageId)
    }

    const chatId = message.chat_id as string
    const messageType = message.message_type as string
    const chatType = message.chat_type as string
    const userId = (sender?.sender_id as Record<string, unknown>)?.open_id as string ?? 'unknown'
    const mentions = message.mentions as FeishuMention[] | undefined

    // chatId 级处理锁：同一聊天同时只处理一条消息，防止 bot 回复被重入处理
    if (this.processingChats.has(chatId)) {
      console.log('[飞书 Bridge] 跳过重入消息 (chatId lock):', chatId)
      return
    }

    // 群聊消息：非 @Bot 的文件/云文档消息仍然自动入库，但不触发 Agent
    if (chatType === 'group') {
      const mentioned = await this.isBotMentioned(mentions)
      if (!mentioned) {
        // 群内所有文件（云文档/pdf/docx 等）无论是否 @Bot 都入库到会话区文件
        if (messageType === 'file' || messageType === 'docx') {
          await this.archiveGroupFile(chatId, messageId, messageType, message.content as string)
        } else if (messageType === 'text') {
          // 文本消息含云文档链接：转成 docx 类型走 archiveGroupFile 确定性入库（读取失败静默降级）
          try {
            const parsed = JSON.parse(message.content as string) as { text?: string }
            const linkText = parsed.text ?? ''
            const docLinkId = extractDocxDocumentId(linkText)
            if (docLinkId) {
              await this.archiveGroupFile(chatId, messageId, 'docx', JSON.stringify({ document_id: docLinkId, doc_name: '飞书云文档' }))
            }
          } catch {
            // 解析失败忽略，不影响后续流程
          }
        }
        return
      }
    }

    // 记录群聊最近用户消息 ID（用于 thread reply）
    if (chatType === 'group' && messageId) {
      this.lastUserMessageId.set(chatId, messageId)
    }

    // 记录最近交互的 chatId 作为默认通知目标
    this.defaultNotifyChatId = chatId

    // 仅处理文本、图片、富文本、文件和云文档消息
    const supportedTypes = new Set(['text', 'image', 'post', 'file', 'docx'])
    if (!supportedTypes.has(messageType)) {
      console.log(`[飞书 Bridge] 不支持的消息类型: ${messageType}`)
      await this.sendTextMessage(chatId, '目前仅支持文本、图片、文件和云文档消息。')
      return
    }

    // 解析消息内容
    let text = ''
    const imageAttachments: FeishuImageAttachment[] = []
    const fileAttachments: FeishuFileAttachment[] = []
    // 稿件云文档（docx）暂存：供 handleUserMessage 按版本号入库
    let docxDraft: { name: string; content: string } | undefined

    if (messageType === 'text') {
      const content = JSON.parse(message.content as string) as { text?: string }
      text = content.text?.trim() ?? ''
      // 去除 @Bot 的占位符（如 @_user_1）
      text = text.replace(/@_user_\d+/g, '').trim()
    } else if (messageType === 'post') {
      // 富文本消息：提取文本和图片
      const content = JSON.parse(message.content as string) as {
        title?: string
        content?: Array<Array<{ tag: string; text?: string; image_key?: string }>>
      }
      const textParts: string[] = []
      if (content.title) textParts.push(content.title)
      for (const line of content.content ?? []) {
        for (const node of line) {
          if (node.tag === 'text' && node.text) {
            textParts.push(node.text)
          } else if (node.tag === 'img' && node.image_key) {
            try {
              const imageData = await this.downloadFeishuImage(messageId, node.image_key)
              const mediaType = inferImageMediaTypeShared(imageData)
              imageAttachments.push({ imageKey: node.image_key, data: imageData, mediaType })
            } catch (error) {
              console.error('[飞书 Bridge] 下载富文本图片失败:', error)
            }
          }
        }
      }
      text = textParts.join(' ').replace(/@_user_\d+/g, '').trim()
    } else if (messageType === 'image') {
      const content = JSON.parse(message.content as string) as { image_key?: string }
      if (content.image_key) {
        try {
          const imageData = await this.downloadFeishuImage(messageId, content.image_key)
          const mediaType = inferImageMediaTypeShared(imageData)
          if (imageData.length > 10 * 1024 * 1024) {
            console.warn(`[飞书 Bridge] 图片较大: ${(imageData.length / 1024 / 1024).toFixed(1)}MB`)
          }
          imageAttachments.push({ imageKey: content.image_key, data: imageData, mediaType })
        } catch (error) {
          console.error('[飞书 Bridge] 下载图片失败:', error)
          await this.sendCardMessage(chatId, buildErrorCard('图片下载失败，请重试。'))
          return
        }
      }
    } else if (messageType === 'file') {
      const content = JSON.parse(message.content as string) as { file_key?: string; file_name?: string }
      if (content.file_key) {
        try {
          const fileData = await this.downloadFeishuFile(messageId, content.file_key)
          const fileName = content.file_name || `feishu-${content.file_key}`
          if (fileData.length > 50 * 1024 * 1024) {
            await this.sendTextMessage(chatId, '文件过大（超过 50MB），暂不支持处理。')
            return
          }
          fileAttachments.push({ fileKey: content.file_key, fileName, data: fileData })
        } catch (error) {
          console.error('[飞书 Bridge] 下载文件失败:', error)
          await this.sendCardMessage(chatId, buildErrorCard('文件下载失败，请重试。'))
          return
        }
      }
    } else if (messageType === 'docx') {
      // 云文档消息：尝试读取文档内容并作为文本注入，让 Agent 能读到文档正文
      try {
        const content = JSON.parse(message.content as string) as {
          document_id?: string
          doc_name?: string
          url?: string
        }
        const documentId = content.document_id
        const docName = content.doc_name || '飞书云文档'
        if (documentId) {
          const docContent = await this.fetchFeishuDocxContent(documentId)
          if (docContent) {
            text = `${text ? text + '\n' : ''}（群成员分享了云文档「${docName}」，以下是文档内容）\n\n${docContent}`
            // 暂存稿件云文档信息，用于 handleUserMessage 中按版本号入库
            docxDraft = { name: docName, content: docContent }
            console.log(`[飞书 Bridge] 已读取云文档「${docName}」内容 (${docContent.length} 字)`)
          } else {
            await this.sendTextMessage(chatId, `已收到云文档「${docName}」，但无法读取文档内容（可能无读取权限）。`)
            return
          }
        }
      } catch (error) {
        console.error('[飞书 Bridge] 解析云文档消息失败:', error)
        await this.sendTextMessage(chatId, '云文档解析失败，请重试。')
        return
      }
    }

    // 群内分享云文档通常以纯文本链接（feishu.cn/docx/{id}）形式到达，而非 docx 消息类型：
    // 尝试从文本中提取 document_id 并读取内容，成功则注入 docxDraft 走确定性落盘；
    // 读取失败（无读取权限/文档不可访问）时降级——保留链接文本，由 Agent 通过 CDP 浏览器读取。
    if (!docxDraft && text) {
      const docLinkId = extractDocxDocumentId(text)
      if (docLinkId) {
        const docContent = await this.fetchFeishuDocxContent(docLinkId)
        if (docContent) {
          text = `${text}\n\n（群成员分享了云文档「飞书云文档」，以下是文档内容）\n\n${docContent}`
          docxDraft = { name: '飞书云文档', content: docContent }
          console.log(`[飞书 Bridge] 已识别文本中的云文档链接并读取内容 (${docContent.length} 字)`)
        } else {
          console.warn(`[飞书 Bridge] 云文档链接 ${docLinkId} 读取失败，降级由 Agent 通过 CDP 浏览器读取`)
        }
      }
    }

    const hasAttachments = imageAttachments.length > 0 || fileAttachments.length > 0
    if (!text && !hasAttachments) return

    // 纯附件消息（无文本）：暂存，等待后续文本一起触发 Agent
    if (!text && hasAttachments) {
      if (imageAttachments.length > 0) {
        const existing = this.pendingImages.get(chatId) ?? []
        existing.push(...imageAttachments)
        this.pendingImages.set(chatId, existing)
      }
      if (fileAttachments.length > 0) {
        const existing = this.pendingFiles.get(chatId) ?? []
        existing.push(...fileAttachments)
        this.pendingFiles.set(chatId, existing)
      }
      const parts: string[] = []
      const imgCount = this.pendingImages.get(chatId)?.length ?? 0
      const fileCount = this.pendingFiles.get(chatId)?.length ?? 0
      if (imgCount > 0) parts.push(`${imgCount} 张图片`)
      if (fileCount > 0) parts.push(`${fileCount} 个文件`)
      await this.sendTextMessage(chatId, `📎 已收到${parts.join('和')}，请继续发送文字消息来触发处理。`)
      return
    }

    // 文本消息到达时，合并暂存的图片和文件
    if (text && this.pendingImages.has(chatId)) {
      const pending = this.pendingImages.get(chatId)!
      imageAttachments.unshift(...pending)
      this.pendingImages.delete(chatId)
    }
    if (text && this.pendingFiles.has(chatId)) {
      const pending = this.pendingFiles.get(chatId)!
      fileAttachments.unshift(...pending)
      this.pendingFiles.delete(chatId)
    }

    // 获取群聊上下文
    let groupName: string | undefined
    let senderName: string | undefined
    if (chatType === 'group') {
      const [groupInfo, userName] = await Promise.all([
        this.getGroupInfo(chatId),
        this.getUserName(userId),
      ])
      groupName = groupInfo?.name
      senderName = userName
    }

    // 构建消息上下文
    const msgCtx: FeishuMessageContext = {
      chatId,
      senderOpenId: userId,
      senderName,
      messageId,
      chatType: chatType as 'p2p' | 'group',
      groupName,
    }

    // 加锁：防止同一聊天的消息并发处理（飞书 SDK 回调不 await，多条消息可能同时执行）
    if (this.processingChats.has(chatId)) return
    this.processingChats.add(chatId)
    try {
      // 命令路由
      if (text.startsWith('/')) {
        await this.handleCommand(msgCtx, text)
        return
      }

      // 群角色名单指令（需 @Bot 触发）：名单：Account-徐旭雯、执行-青子
      // 由 bridge 确定性解析存档，不经过 Agent，按群（chatId）隔离
      if (chatType === 'group' && /^(名单|更新名单|设置名单)\s*[:：]/.test(text)) {
        await this.handleRoleListCommand(msgCtx, text)
        return
      }

      // 群审核口径指令（需 @Bot 触发）：口径：字数 200 字左右即可...
      // 由 bridge 确定性存档并按群注入，审核时优先于 brief 旧措辞
      if (chatType === 'group' && /^(口径|审核口径)\s*[:：]/.test(text)) {
        await this.handleAuditStandardCommand(msgCtx, text)
        return
      }

      // 普通消息（文本/图片/文件）→ 转发到会话
      await this.handleUserMessage(msgCtx, text, imageAttachments, fileAttachments, docxDraft)
    } finally {
      this.processingChats.delete(chatId)
    }
  }

  // ===== 群角色名单（用户手动维护，按群隔离） =====

  /**
   * 处理群角色名单指令：名单：Account-徐旭雯、执行-青子
   *
   * 按群（chatId）持久化到 {configDir}/feishu-group-roles/{chatId}.json，
   * 作为 Agent 红卡 @执行 / 黄卡·绿卡·审核失败 @Account 判定的最高优先依据。
   * 名字需与群成员通讯录姓名精确匹配，匹配不到的名字 @ 会降级为文字点名，回执中单独提示。
   */
  private async handleRoleListCommand(msgCtx: FeishuMessageContext, text: string): Promise<void> {
    const { chatId } = msgCtx
    const payload = text.replace(/^(名单|更新名单|设置名单)\s*[:：]\s*/, '').trim()
    if (!payload) {
      await this.sendTextMessage(
        chatId,
        '名单格式：名单：Account-姓名1、执行-姓名2（Account- 我方关键人 → 黄卡/绿卡/审核失败 @；执行- 第三方执行方 → 红卡 @）',
      )
      return
    }

    const accountNames: string[] = []
    const executorNames: string[] = []
    const invalidEntries: string[] = []

    // 1. 按显式分隔符（顿号/逗号/分号/换行）拆分条目；名字内允许空格（如英文全名 Dennis Zhang）
    // 2. 每个条目再按前缀标记（Account-/执行-）前瞻切分，兼容"用空格分隔多条"的写法
    const rawEntries = payload
      .split(/[、,，;；\n]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    for (const raw of rawEntries) {
      const segments = raw
        .split(/(?=account\s*[:：-]|执行\s*[:：-])/i)
        .map((s) => s.trim())
        .filter(Boolean)
      for (const segment of segments) {
        const accountMatch = segment.match(/^account\s*[:：-]\s*(.+)$/i)
        const executorMatch = segment.match(/^执行\s*[:：-]\s*(.+)$/)
        if (accountMatch?.[1]) {
          const name = accountMatch[1].trim()
          if (name) accountNames.push(name)
        } else if (executorMatch?.[1]) {
          const name = executorMatch[1].trim()
          if (name) executorNames.push(name)
        } else {
          invalidEntries.push(segment)
        }
      }
    }

    const list: GroupRoleList = {
      accountNames: Array.from(new Set(accountNames)),
      executorNames: Array.from(new Set(executorNames)),
      updatedAt: Date.now(),
    }
    if (list.accountNames.length === 0 && list.executorNames.length === 0) {
      await this.sendTextMessage(chatId, '未识别到有效名单，格式：名单：Account-姓名1、执行-姓名2')
      return
    }

    await this.saveGroupRoleList(chatId, list)

    // 校验名单名字能否匹配到群成员（@ 转换依赖 name↔openId 精确匹配）
    const unmatched = this.findUnmatchedNames(chatId, [...list.accountNames, ...list.executorNames])

    const replyParts: string[] = ['✅ 已录入本群名单：']
    if (list.accountNames.length > 0) {
      replyParts.push(`Account 成员 ${list.accountNames.length} 人（${list.accountNames.join('、')}）`)
    }
    if (list.executorNames.length > 0) {
      replyParts.push(`执行成员 ${list.executorNames.length} 人（${list.executorNames.join('、')}）`)
    }
    if (invalidEntries.length > 0) {
      replyParts.push(`未识别条目：${invalidEntries.join('、')}`)
    }
    if (unmatched.length > 0) {
      // 附上本群成员姓名，方便用户对照真实名字（@ 转换与群成员 name 精确匹配）
      const groupInfo = this.groupInfoCache.get(chatId)
      const memberNames = (groupInfo?.members ?? [])
        .filter((m) => m.openId !== this.botOpenId)
        .map((m) => m.name)
      const memberSample =
        memberNames.length === 0
          ? '（空，可能未拉取到群成员，请检查机器人是否有群成员读取权限）'
          : memberNames.length > 10
            ? `${memberNames.slice(0, 10).join('、')} 等 ${memberNames.length} 人`
            : memberNames.join('、')
      console.warn(
        `[飞书 Bridge] 群角色名单未匹配（${chatId}）：${unmatched.join('、')}；群成员=[${memberNames.join(', ')}]`,
      )
      replyParts.push(`⚠️ 以下名字未匹配到群成员，@ 将降级为文字点名：${unmatched.join('、')}。本群成员名单：${memberSample}`)
    }
    await this.sendTextMessage(chatId, replyParts.join('；'))
  }

  /** 获取名单文件路径：{configDir}/feishu-group-roles/{chatId}.json */
  private getGroupRoleListPath(chatId: string): string {
    return join(getConfigDir(), 'feishu-group-roles', `${chatId}.json`)
  }

  /** 读取某群角色名单（带缓存，首次读盘） */
  private getGroupRoleList(chatId: string): GroupRoleList | null {
    const cached = this.groupRoleCache.get(chatId)
    if (cached) return cached

    try {
      const path = this.getGroupRoleListPath(chatId)
      if (!existsSync(path)) return null
      const raw = JSON.parse(readFileSync(path, 'utf-8')) as GroupRoleList
      this.groupRoleCache.set(chatId, raw)
      return raw
    } catch (error) {
      console.warn(`[飞书 Bridge] 读取群角色名单失败（${chatId}）:`, error)
      return null
    }
  }

  /** 持久化群角色名单并更新缓存 */
  private async saveGroupRoleList(chatId: string, list: GroupRoleList): Promise<void> {
    try {
      const dir = join(getConfigDir(), 'feishu-group-roles')
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      writeFileSync(this.getGroupRoleListPath(chatId), JSON.stringify(list, null, 2), 'utf-8')
      this.groupRoleCache.set(chatId, list)
      console.log(`[飞书 Bridge] 群角色名单已保存（${chatId}）: Account ${list.accountNames.length} 人，执行 ${list.executorNames.length} 人`)
    } catch (error) {
      console.error(`[飞书 Bridge] 保存群角色名单失败（${chatId}）:`, error)
      await this.sendTextMessage(chatId, '名单保存失败，请稍后重试。')
    }
  }

  /** 找出名单中未匹配到群成员通讯录姓名的名字（@ 会降级为文字点名） */
  private findUnmatchedNames(chatId: string, names: string[]): string[] {
    const groupInfo = this.groupInfoCache.get(chatId)
    const memberNames = new Set((groupInfo?.members ?? []).map((m) => m.name))
    return names.filter((n) => !memberNames.has(n))
  }

  // ===== 群审核口径（用户可维护，按群隔离） =====

  /**
   * 处理群审核口径指令：口径：字数 200 字左右即可...
   *
   * 按群（chatId）持久化到 {configDir}/feishu-audit-standards/{chatId}.json，
   * 稿件审核消息转发时由 bridge 确定性注入 `[本群审核口径: ...]`，
   * 作为审核判定最高优先依据（优先于 brief 旧措辞），不依赖 Agent 记忆 SKILL 规则。
   */
  private async handleAuditStandardCommand(msgCtx: FeishuMessageContext, text: string): Promise<void> {
    const { chatId } = msgCtx
    const content = text.replace(/^(口径|审核口径)\s*[:：]\s*/, '').trim()
    if (!content) {
      await this.sendTextMessage(
        chatId,
        '未识别到口径内容，格式：口径：字数 200 字左右即可，关键词埋点正文语义体现即达标…',
      )
      return
    }
    const standard: GroupAuditStandard = { content, updatedAt: Date.now() }
    await this.saveAuditStandard(chatId, standard)
    const preview = content.length > 60 ? `${content.slice(0, 60)}…` : content
    await this.sendTextMessage(
      chatId,
      `✅ 已更新本群审核口径（${content.length} 字）：${preview}。审核时以此为准，优先于 brief 旧措辞。`,
    )
  }

  /** 获取口径文件路径：{configDir}/feishu-audit-standards/{chatId}.json */
  private getAuditStandardPath(chatId: string): string {
    return join(getConfigDir(), 'feishu-audit-standards', `${chatId}.json`)
  }

  /** 读取某群审核口径（带缓存，首次读盘；未维护时返回默认口径） */
  private getAuditStandard(chatId: string): GroupAuditStandard {
    const cached = this.auditStandardCache.get(chatId)
    if (cached) return cached

    try {
      const path = this.getAuditStandardPath(chatId)
      if (existsSync(path)) {
        const raw = JSON.parse(readFileSync(path, 'utf-8')) as GroupAuditStandard
        this.auditStandardCache.set(chatId, raw)
        return raw
      }
    } catch (error) {
      console.warn(`[飞书 Bridge] 读取群审核口径失败（${chatId}）:`, error)
    }
    return { content: FeishuBridge.DEFAULT_AUDIT_STANDARD, updatedAt: 0 }
  }

  /** 持久化群审核口径并更新缓存 */
  private async saveAuditStandard(chatId: string, standard: GroupAuditStandard): Promise<void> {
    try {
      const dir = join(getConfigDir(), 'feishu-audit-standards')
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      writeFileSync(this.getAuditStandardPath(chatId), JSON.stringify(standard, null, 2), 'utf-8')
      this.auditStandardCache.set(chatId, standard)
      console.log(`[飞书 Bridge] 群审核口径已保存（${chatId}）: ${standard.content.slice(0, 60)}...`)
    } catch (error) {
      console.error(`[飞书 Bridge] 保存群审核口径失败（${chatId}）:`, error)
      await this.sendTextMessage(chatId, '审核口径保存失败，请稍后重试。')
    }
  }

  /** 稿件审核特征检测：命中审核关键词或携带附件（文件/云文档/图片） */
  private isDraftReviewMessage(text: string, hasAttachment: boolean): boolean {
    if (hasAttachment) return true
    return /初稿|改稿|终稿|成稿|成片|审稿|稿件|审一下|审核|预览|请查收|辛苦审核|发布预览|发布/.test(text)
  }

  /** 读取已落盘的单达人 brief（briefs/{达人名}.md），不存在返回 null */
  private readInfluencerBrief(workspaceId: string, influencer: string): string | null {
    try {
      const workspace = getAgentWorkspace(workspaceId)
      if (!workspace) return null
      const briefPath = join(getWorkspaceFilesDir(workspace.slug), 'briefs', `${influencer}.md`)
      if (!existsSync(briefPath)) return null
      return readFileSync(briefPath, 'utf-8')
    } catch (error) {
      console.warn(`[飞书 Bridge] 读取达人 brief 失败（${influencer}）:`, error)
      return null
    }
  }

  private async handleCommand(msgCtx: FeishuMessageContext, text: string): Promise<void> {
    const { chatId } = msgCtx
    const [command, ...args] = text.split(/\s+/)
    const arg = args.join(' ').trim()

    switch (command?.toLowerCase()) {
      case '/help':
        await this.sendCardMessage(chatId, buildHelpCard())
        break

      case '/new':
        await this.createNewSession(msgCtx, 'agent', arg || undefined)
        break

      case '/chat':
        await this.updateBindingMode(msgCtx, 'chat')
        break

      case '/agent':
        await this.updateBindingMode(msgCtx, 'agent')
        break

      case '/list':
        await this.handleListCommand(msgCtx)
        break

      case '/stop':
        await this.handleStopCommand(msgCtx)
        break

      case '/switch': {
        if (!arg) {
          await this.sendMessage(chatId, '用法: /switch <序号>（先用 /list 查看）')
          return
        }
        await this.handleSwitchCommand(msgCtx, arg)
        break
      }

      case '/workspace': {
        await this.handleWorkspaceCommand(msgCtx, arg || undefined)
        break
      }

      case '/now':
        await this.handleNowCommand(msgCtx)
        break

      default:
        await this.sendMessage(chatId, `未知命令: ${command}。输入 /help 查看帮助。`)
    }
  }

  // ===== 会话管理 =====

  private async createNewSession(
    msgCtx: FeishuMessageContext,
    mode: 'agent' | 'chat',
    title?: string,
    overrideWorkspaceId?: string,
  ): Promise<void> {
    const { chatId } = msgCtx
    const appSettings = getSettings()

    // 选择工作区：显式指定 > Bot 默认 > 应用设置 > 第一个工作区
    let workspaceId = overrideWorkspaceId ?? this.botConfig.defaultWorkspaceId ?? appSettings.agentWorkspaceId
    if (!workspaceId) {
      const byTime = listAgentWorkspacesByUpdatedAt()
      const def = byTime.find((w) => w.slug === 'default')
      workspaceId = def?.id ?? byTime[0]?.id
    }

    if (!workspaceId) {
      await this.sendMessage(chatId, '请先在 MAPro 设置中创建工作区。')
      return
    }

    // 渠道/模型：Bot 配置 > 应用设置
    const channelId = this.botConfig.defaultChannelId ?? appSettings.agentChannelId
    if (!channelId) {
      await this.sendMessage(chatId, '请先在 MAPro Agent 设置中选择渠道。')
      return
    }

    // 创建会话（使用默认标题，首次对话完成后会自动生成标题）
    const session = await createAgentSession(
      title,
      channelId,
      workspaceId,
    )

    // 绑定
    const binding: FeishuChatBinding = {
      chatId,
      botId: this.botConfig.id,
      userId: msgCtx.senderOpenId,
      sessionId: session.id,
      workspaceId,
      channelId,
      modelId: appSettings.agentModelId ?? undefined,
      mode,
      chatType: msgCtx.chatType,
      groupName: msgCtx.groupName,
      createdAt: Date.now(),
    }
    this.chatBindings.set(chatId, binding)
    this.sessionToChat.set(session.id, chatId)
    this.updateStatus({ activeBindings: this.chatBindings.size })
    this.saveBindings()

    // 通知渲染进程刷新会话列表（复用 TITLE_UPDATED 通道触发列表刷新）
    const windows = BrowserWindow.getAllWindows()
    if (windows.length > 0 && !windows[0]!.isDestroyed()) {
      windows[0]!.webContents.send(AGENT_IPC_CHANNELS.TITLE_UPDATED, {
        sessionId: session.id,
        title: session.title,
      })
    }

    const modeLabel = mode === 'agent' ? 'Agent' : 'Chat'
    await this.sendMessage(chatId, `✅ 已创建 ${modeLabel} 会话 (${session.id.slice(0, 8)})`)
  }

  private async updateBindingMode(msgCtx: FeishuMessageContext, mode: 'agent' | 'chat'): Promise<void> {
    const { chatId } = msgCtx
    const binding = this.chatBindings.get(chatId)
    if (binding) {
      binding.mode = mode
      const modeLabel = mode === 'agent' ? 'Agent' : 'Chat'
      await this.sendMessage(chatId, `已切换到 ${modeLabel} 模式`)
    } else {
      const modeLabel = mode === 'agent' ? 'Agent' : 'Chat'
      await this.sendMessage(chatId, `当前没有会话。直接发送消息将自动创建 ${modeLabel} 会话，或使用 /new 创建。`)
    }
  }

  private async handleListCommand(msgCtx: FeishuMessageContext): Promise<void> {
    const { chatId } = msgCtx
    const sessions = listAgentSessions()
    const workspaces = listAgentWorkspacesByUpdatedAt()
    const binding = this.chatBindings.get(chatId)
    const currentWorkspaceId = binding?.workspaceId

    // 每个工作区最多展示最近 5 个会话
    const MAX_SESSIONS_PER_WS = 5

    // 为所有会话建立全局序号映射（序号 = 全局排序位置，从 1 开始）
    const sessionIndexMap = new Map<string, number>()
    sessions.forEach((s, i) => sessionIndexMap.set(s.id, i + 1))

    // 按工作区分组
    const wsItems: WorkspaceListItem[] = workspaces.map((ws) => {
      const wsSessions = sessions
        .filter((s) => s.workspaceId === ws.id)
        .slice(0, MAX_SESSIONS_PER_WS)
        .map((s) => ({
          id: s.id,
          title: s.title,
          active: binding?.sessionId === s.id,
          index: sessionIndexMap.get(s.id) ?? 0,
        }))

      return { id: ws.id, name: ws.name, sessions: wsSessions }
    })

    // 未归属工作区的会话
    const orphanSessions = sessions
      .filter((s) => !s.workspaceId || !workspaces.some((w) => w.id === s.workspaceId))
      .slice(0, MAX_SESSIONS_PER_WS)
      .map((s) => ({
        id: s.id,
        title: s.title,
        active: binding?.sessionId === s.id,
        index: sessionIndexMap.get(s.id) ?? 0,
      }))

    if (orphanSessions.length > 0) {
      wsItems.push({ id: '', name: '未分配工作区', sessions: orphanSessions })
    }

    await this.sendCardMessage(chatId, buildSessionListCard(wsItems, currentWorkspaceId))
  }

  private async handleStopCommand(msgCtx: FeishuMessageContext): Promise<void> {
    const { chatId } = msgCtx
    const binding = this.chatBindings.get(chatId)
    if (!binding) {
      await this.sendMessage(chatId, '当前没有绑定的会话。')
      return
    }

    stopAgent(binding.sessionId)
    await this.sendMessage(chatId, '✅ 已停止 Agent')
  }

  private async handleSwitchCommand(msgCtx: FeishuMessageContext, arg: string): Promise<void> {
    const { chatId } = msgCtx
    const sessions = listAgentSessions()

    // 支持序号（如 /switch 1）和 ID 前缀两种方式
    const index = Number(arg)
    const match = Number.isInteger(index) && index >= 1 && index <= sessions.length
      ? sessions[index - 1]
      : sessions.find((s) => s.id.startsWith(arg))

    if (!match) {
      await this.sendMessage(chatId, `未找到会话。使用 /list 查看可用会话。`)
      return
    }

    // 清理旧绑定的反向索引
    const oldBinding = this.chatBindings.get(chatId)
    if (oldBinding) {
      this.sessionToChat.delete(oldBinding.sessionId)
    }

    const appSettings = getSettings()
    const binding: FeishuChatBinding = {
      chatId,
      botId: this.botConfig.id,
      userId: msgCtx.senderOpenId,
      sessionId: match.id,
      workspaceId: match.workspaceId ?? this.botConfig.defaultWorkspaceId ?? appSettings.agentWorkspaceId ?? '',
      channelId: match.channelId ?? appSettings.agentChannelId ?? '',
      modelId: appSettings.agentModelId ?? undefined,
      mode: 'agent',
      chatType: msgCtx.chatType,
      groupName: msgCtx.groupName,
      createdAt: Date.now(),
    }
    this.chatBindings.set(chatId, binding)
    this.sessionToChat.set(match.id, chatId)
    this.updateStatus({ activeBindings: this.chatBindings.size })
    this.saveBindings()

    await this.sendMessage(chatId, `✅ 已切换到会话: ${match.title} (${match.id.slice(0, 8)})`)
  }

  private async handleWorkspaceCommand(msgCtx: FeishuMessageContext, arg?: string): Promise<void> {
    const { chatId } = msgCtx
    const workspaces = listAgentWorkspacesByUpdatedAt()
    const binding = this.chatBindings.get(chatId)
    const currentWorkspaceId = binding?.workspaceId

    // 无参数 → 列出所有工作区供选择
    if (!arg) {
      const items = workspaces.map((w, i) => ({
        index: i + 1,
        name: w.name,
        isCurrent: w.id === currentWorkspaceId,
      }))
      await this.sendCardMessage(chatId, buildWorkspaceListCard(items))
      return
    }

    // 支持序号（如 /workspace 1）和名称两种方式
    const index = Number(arg)
    const match = Number.isInteger(index) && index >= 1 && index <= workspaces.length
      ? workspaces[index - 1]
      : workspaces.find(
          (w) => w.name.toLowerCase() === arg.toLowerCase() || w.slug === arg.toLowerCase(),
        )

    if (!match) {
      const available = workspaces.map((w, i) => `${i + 1}. ${w.name}`).join(', ')
      await this.sendMessage(chatId, `未找到工作区 "${arg}"。可用: ${available}`)
      return
    }

    // 清理旧绑定（切换工作区后需要用户选择或新建会话）
    if (binding) {
      this.sessionToChat.delete(binding.sessionId)
      this.chatBindings.delete(chatId)
      this.updateStatus({ activeBindings: this.chatBindings.size })
      this.saveBindings()
    }

    // 更新 Bot 配置的默认工作区（下次自动创建会话时使用）
    const { saveFeishuBotConfig } = await import('./feishu-config')
    saveFeishuBotConfig({
      id: this.botConfig.id,
      name: this.botConfig.name,
      enabled: this.botConfig.enabled,
      appId: this.botConfig.appId,
      appSecret: '', // 空字符串表示不修改
      defaultWorkspaceId: match.id,
      defaultChannelId: this.botConfig.defaultChannelId,
      defaultModelId: this.botConfig.defaultModelId,
    })
    // 同步更新内存中的 botConfig，避免后续读到旧快照
    this.botConfig = { ...this.botConfig, defaultWorkspaceId: match.id }

    // 列出该工作区下最近 10 条会话（序号为全局排序位置）
    const sessions = listAgentSessions()
    const recentSessions = sessions
      .filter((s) => s.workspaceId === match.id)
      .slice(0, 10)
      .map((s) => ({
        id: s.id,
        title: s.title,
        index: sessions.indexOf(s) + 1,
      }))

    await this.sendCardMessage(chatId, buildWorkspaceSwitchedCard(match.name, recentSessions))
  }

  private async handleNowCommand(msgCtx: FeishuMessageContext): Promise<void> {
    const { chatId } = msgCtx
    const binding = this.chatBindings.get(chatId)

    const lines: string[] = []

    // 会话信息
    if (binding) {
      const session = getAgentSessionMeta(binding.sessionId)
      lines.push(`**会话**: ${session?.title ?? '未知'} (\`${binding.sessionId.slice(0, 8)}\`)`)
      lines.push(`**模式**: ${binding.mode === 'agent' ? 'Agent' : 'Chat'}`)
    } else {
      lines.push('**会话**: 未绑定（发送消息将自动创建）')
    }

    // 工作区信息
    const workspaceId = binding?.workspaceId
    const workspace = workspaceId ? getAgentWorkspace(workspaceId) : undefined
    if (workspace) {
      lines.push(`**工作区**: ${workspace.name} (\`${workspace.slug}\`)`)

      // MCP Servers
      const capabilities = getWorkspaceCapabilities(workspace.slug)
      if (capabilities.mcpServers.length > 0) {
        lines.push('')
        lines.push('**MCP Servers**:')
        for (const mcp of capabilities.mcpServers) {
          const status = mcp.enabled !== false ? '✅' : '⏸️'
          lines.push(`  ${status} ${mcp.name}`)
        }
      } else {
        lines.push('**MCP Servers**: 无')
      }

      // Skills
      if (capabilities.skills.length > 0) {
        lines.push('')
        lines.push('**Skills**:')
        for (const skill of capabilities.skills) {
          const status = skill.enabled !== false ? '✅' : '⏸️'
          lines.push(`  ${status} ${skill.name}`)
        }
      } else {
        lines.push('**Skills**: 无')
      }

      // 工作区文件列表
      const { getAgentWorkspacePath: getWsPath } = await import('./config-paths')
      const wsPath = getWsPath(workspace.slug)
      try {
        const entries = readdirSync(wsPath, { withFileTypes: true })
        const fileList = entries
          .filter((e) => !e.name.startsWith('.') && e.name !== 'mcp.json' && e.name !== 'config.json' && e.name !== 'skills' && e.name !== 'skills-inactive')
          .map((e) => e.isDirectory() ? `📁 ${e.name}/` : `📄 ${e.name}`)
        if (fileList.length > 0) {
          lines.push('')
          lines.push('**工作区文件**:')
          for (const f of fileList.slice(0, 20)) {
            lines.push(`  ${f}`)
          }
          if (fileList.length > 20) {
            lines.push(`  ... 还有 ${fileList.length - 20} 项`)
          }
        }
      } catch {
        // 目录不存在或无法读取，忽略
      }
    } else {
      lines.push('**工作区**: 未设置')
    }

    const card: Record<string, unknown> = {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: '当前状态' },
        template: 'blue',
      },
      elements: [
        { tag: 'markdown', content: lines.join('\n') },
      ],
    }
    await this.sendCardMessage(chatId, card)
  }

  // ===== 用户消息处理 =====

  private async handleUserMessage(
    msgCtx: FeishuMessageContext,
    text: string,
    imageAttachments: FeishuImageAttachment[] = [],
    fileAttachments: FeishuFileAttachment[] = [],
    docxDraft?: { name: string; content: string },
  ): Promise<void> {
    const { chatId } = msgCtx
    let binding = this.chatBindings.get(chatId)

    // 自动创建会话
    if (!binding) {
      await this.createNewSession(msgCtx, 'agent')
      binding = this.chatBindings.get(chatId)
      if (!binding) return
    }

    // 并发保护：如果该会话的 Agent 仍在运行，直接拒绝，不要触碰 buffer
    if (isAgentSessionActive(binding.sessionId)) {
      try {
        const prefix = this.resolveContextPrefix(chatId)
        await this.sendCardMessage(chatId, buildErrorCard(`${prefix}上一条消息仍在处理中，请稍候再试`))
      } catch (error) {
        console.error(`[飞书 Bridge] 发送忙碌错误卡片失败:`, error)
      }
      return
    }

    // 保存飞书图片和文件到 session 工作目录，构建文件引用
    // 文档类文件（PDF/word/txt 等）额外提取正文文本注入，让 Agent 无需额外工具即可读取文件内容
    const attachedRefs: string[] = []
    const workspace = binding.workspaceId ? getAgentWorkspace(binding.workspaceId) : undefined
    // 稿件文件抽取文本缓存（首个文档文件，用于审核反馈 CSV"稿件文字部分"）
    let fileExtractedText = ''
    if (workspace) {
      for (const img of imageAttachments) {
        const savedPath = saveImageToSessionShared(
          workspace.slug, binding.sessionId, `feishu-${img.imageKey}`, img.mediaType, img.data,
        )
        attachedRefs.push(`- feishu-${img.imageKey}.${inferExtension(img.mediaType)}: ${savedPath}`)
      }
      for (const file of fileAttachments) {
        const savedPath = saveFileToSessionShared(
          workspace.slug, binding.sessionId, file.fileName, file.data,
        )
        attachedRefs.push(`- ${file.fileName}: ${savedPath}`)
        // 文档类文件：提取文本注入，避免 Agent 只拿到路径却读不到内容
        if (isSupportedDocumentExtension(extname(file.fileName))) {
          try {
            const docText = await extractTextFromFile(savedPath)
            if (docText && docText.trim().length > 0) {
              if (!fileExtractedText) fileExtractedText = docText
              attachedRefs.push(`【抽取自 ${file.fileName}】\n${docText.slice(0, 12000)}`)
            }
          } catch (docErr) {
            console.warn(`[飞书 Bridge] 提取文档 ${file.fileName} 文本失败:`, docErr)
          }
        }
        // 稿件文件（docx/doc/pdf/txt/md）：消息含稿件触发词时，版本递增 + 全文存档由 bridge 确定性完成
        if (workspace && this.isDraftTriggerText(text) && isSupportedDocumentExtension(extname(file.fileName))) {
          try {
            const docText = await extractTextFromFile(savedPath)
            if (docText && docText.trim().length > 0) {
              await this.saveDraftReview(workspace.slug, chatId, text, file.fileName, docText)
            }
          } catch (docErr) {
            console.warn(`[飞书 Bridge] 稿件文件 ${file.fileName} 入库失败:`, docErr)
          }
        }
        // brief 文档：自动入库到 workspace-files/briefs/brief.md，供后续审稿跨会话匹配
        if (workspace) {
          await this.saveFeishuBriefIfNeeded(workspace.slug, file.fileName, savedPath)
        }
      }
    }
    // 稿件云文档（docx）：版本递增 + 全文存档由 bridge 确定性完成，历史版本全部保留，后续改版 agent 从库里读最新版，省 token
    // 用户主动分享云文档到群即视为稿件候选，无条件入库（不再依赖消息文本含触发词）；
    // 云文档 brief（文件名含 brief）自动入库 briefs/brief.md
    if (workspace && docxDraft) {
      await this.saveDraftReview(workspace.slug, chatId, text, docxDraft.name, docxDraft.content, true)
      await this.saveBriefTextIfNeeded(workspace.slug, docxDraft.name, docxDraft.content)
    }
    const fileReferences = attachedRefs.length > 0
      ? `<attached_files>\n${attachedRefs.join('\n')}\n</attached_files>\n\n`
      : ''

    // 初始化缓冲
    this.sessionBuffers.set(binding.sessionId, {
      text: '',
      toolSummaries: new Map(),
      startedAt: Date.now(),
      hasPendingAskUser: false,
    })

    // 发送思考中指示
    const prefix = this.resolveContextPrefix(chatId)
    await this.sendMessage(chatId, `${prefix}⏳ Agent 处理中...`)

    if (binding.mode === 'agent') {
      // 构建消息：附件引用 + 文本
      const hasAnyAttachment = imageAttachments.length > 0 || fileAttachments.length > 0
      const userText = text || (hasAnyAttachment ? '请查看上面附加的文件。' : '')
      let agentMessage = fileReferences + userText

      // 群聊时注入发送者、群组上下文以及聊天历史到消息
      if (msgCtx.chatType === 'group') {
        const contextParts: string[] = []
        if (msgCtx.groupName) {
          contextParts.push(`[群聊: ${msgCtx.groupName}]`)
        }
        if (msgCtx.senderName) {
          contextParts.push(`[发送者: ${msgCtx.senderName}]`)
        }

        // 注入群成员列表（方便 Agent @某人）
        const groupInfo = this.groupInfoCache.get(chatId)
        if (groupInfo?.members && groupInfo.members.length > 0) {
          const membersExceptBot = groupInfo.members
            .filter((m) => m.openId !== this.botOpenId)
          const memberList = membersExceptBot
            .map((m) => `${m.name}(${m.openId})`)
            .join(', ')
          contextParts.push(`[群成员: ${memberList}]`)
          contextParts.push('[提示: 如需 @某人，请直接使用 @姓名 格式，如 @Alice，系统会自动转换为飞书 @mention]')
        }

        // 注入本群角色名单（用户手动维护，红卡 @执行 / 黄卡·绿卡·审核失败 @Account 判定的最高优先依据）
        // 红卡 @ 的是「本次稿件提交人」= 消息发送者（[发送者] 字段）本人——执行方可能有多人，
        // 必须 @ 发对应稿件的那个执行方，不得 @ 名单中全部执行成员或任意挑一个
        const roleList = this.getGroupRoleList(chatId)
        if (roleList && (roleList.accountNames.length > 0 || roleList.executorNames.length > 0)) {
          const roleParts: string[] = []
          if (roleList.accountNames.length > 0) {
            roleParts.push(`Account 成员：${roleList.accountNames.join('、')}`)
          }
          if (roleList.executorNames.length > 0) {
            roleParts.push(`执行成员：${roleList.executorNames.join('、')}`)
          }
          contextParts.push(`[本群角色名单: ${roleParts.join('；')}]（审核时红卡 @本次稿件提交人（[发送者] 即发稿件的执行方）本人、黄卡/绿卡/审核失败 @Account 成员，按此名单 @真实姓名；执行方多人时必须 @提交人本人，禁止 @名单中全部执行成员）`)
        }

        // 注入本群审核口径 + 已落盘单达人 brief（仅稿件审核特征消息；由系统确定性注入，
        // 不依赖 Agent 从 SKILL 记忆或主动读文件，审核判定最高优先依据）
        if (this.isDraftReviewMessage(userText, hasAnyAttachment || !!docxDraft)) {
          // 注入工作区根绝对路径：Agent 兜底落盘（SKILL Step 2.5 版本存档 / Step 3 brief 命中落盘）必须以该路径为唯一根基准，
          // 与 bridge 确定性落盘目录一致（Agent 的 <working_directory> 是会话目录，SKILL 相对路径 workspace-files/ 会解析到会话目录、导致工作区看不到）
          if (workspace) {
            contextParts.push(
              `[工作区根路径: ${getWorkspaceFilesDir(workspace.slug)}]（本群所有落盘以该绝对路径为唯一根基准：draft-archives/、draft-review-state.jsonl、briefs/；禁止使用相对路径 workspace-files/ 落到会话目录）`,
            )
          }
          const standard = this.getAuditStandard(chatId)
          contextParts.push(`[本群审核口径: ${standard.content}]（审核判定时本口径优先于 brief 旧措辞）`)
          // 审核硬约束（与 ma-draft-review SKILL Step 6/格式细节一致，系统确定性注入避免 Agent 自由发挥）：
          // 硬伤→红卡 @执行-返工；争议→黄卡 @Account-拍板；无硬伤→绿卡 @Account-放行；审核失败→@Account；不输出分数；
          // 判定依据不写入回复（仅黄卡/绿卡"可优化"区块内允许写）；产品名词序/同义变体不得判红卡、不得列入红卡"必须修改"清单（归入黄/绿卡"可优化"）；黄卡/绿卡末尾"可优化（结合 brief 方向，非硬性）"区块必须对照 brief 方向逐一产出建议（每条含优化方向+判定依据，仅确实无方向性差距才"- 无建议"）
          contextParts.push(
            '[审核硬约束: 硬伤→红卡 @本次稿件提交人（[发送者] 即发稿件的执行方）本人给逐条返工意见（执行方多人时必须 @提交人本人，禁止 @名单中全部执行成员）；无硬伤但有争议→黄卡 @Account成员 拍板；无硬伤无争议→绿卡 @Account成员 确认放行；审核失败（稿件无法自动审核）→@Account成员 转人工；不输出分数；产品名词序/同义变体不得判红卡、不得列入红卡"必须修改"清单（归入黄/绿卡"可优化"）；判定依据不写入回复（仅黄卡/绿卡"可优化"区块内允许写判定依据）；黄卡/绿卡末尾必须输出"可优化（结合 brief 方向，非硬性）"区块并对照 brief 方向逐一产出建议——每条建议对照 brief 方向与稿件内容差距产出，含优化方向+判定依据，仅确实无方向性差距才输出"- 无建议"；必须按 ma-draft-review 三态模板格式输出]',
          )

          const docName = docxDraft?.name ?? fileAttachments[0]?.fileName ?? ''
          const influencer = this.extractInfluencerName(userText, docName)
          if (influencer) {
            const brief = this.readInfluencerBrief(binding.workspaceId, influencer)
            if (brief) {
              const briefPreview = brief.length > 3000 ? `${brief.slice(0, 3000)}…（brief 过长已截断）` : brief
              contextParts.push(
                `[本群 brief（${influencer}）: ${briefPreview}]（审核时按此 brief 内容方向对照稿件，正文主体未承载 brief 核心逻辑即红卡）`,
              )
            }
          }
        }

        // 获取群聊历史消息作为上下文
        const chatHistory = await this.fetchChatHistory(chatId)
        const historyContext = this.formatChatHistoryContext(chatHistory)

        const parts: string[] = []
        if (contextParts.length > 0) parts.push(contextParts.join(' '))
        if (historyContext) parts.push(historyContext)

        // 群聊场景输出格式硬约束：避免 Agent 把过程性说明、工具描述、思考过程性文字一股脑贴到群里
        // 强制只输出最终结论，供运营/第三方可读的回复
        parts.push(
          '[群聊输出格式要求]\n' +
          '1. 直接给出最终结论和执行结果，不要写过程性说明（如"我先去..."、"接下来我会..."、"让我看看..."、"好的收到"之类的启动语。\n' +
          '2. 工具调用、读取文件、调用skill的动作本身属于内部步骤，不要写入最终回答。\n' +
          '3. 引用数据或结论时，只说结果，不说分析过程或调用了什么工具。\n' +
          '4. 如果需要向用户提出澄清，请把所有问题合并为一条，放在回复最前面。\n' +
          '5. 禁止把原始 JSON、错误堆栈、后端错误体直接贴出，已有的友好中文提示直接用简短一句话说明原因和建议即可。\n' +
          '6. 保持回复面向运营与第三方阅读，语气专业、简洁，避免冗长段落不超过 5 段，必要时使用要点列表。\n' +
          '7. 禁止输出任何工作过程描述（如"让我查看""我正在读取""文件已定位""稿件已提取""正在处理""已确认""现在查找"等），即使这些是真实执行过的动作。所有中间步骤都只在内部完成，群内只输出最终结论；例如稿件审核任务只输出审核意见结果，不输出查找、比对、确认的过程。',
        )

        if (fileReferences) parts.push(fileReferences.trimEnd())
        parts.push(userText)
        agentMessage = parts.join('\n')
      }

      // Agent 模式 — fire-and-forget，不阻塞事件回调
      // 群聊时注入动态 MCP 工具（允许 Agent 主动拉取更多群聊历史）
      let customMcpServers: Record<string, Record<string, unknown>> | undefined
      if (msgCtx.chatType === 'group') {
        const mcpServer = await this.createFeishuChatMcpServer(chatId)
        if (mcpServer) {
          customMcpServers = { feishu_chat: mcpServer as unknown as Record<string, unknown> }
        }
      }

      // 使用最新的渠道和模型设置（Bot 配置 > 应用设置 > 绑定默认值）
      const latestSettings = getSettings()
      const channelId = this.botConfig.defaultChannelId || latestSettings.agentChannelId || binding.channelId
      const modelId = this.botConfig.defaultModelId || latestSettings.agentModelId || binding.modelId

      // 稿件审核消息：注入 mentionedSkills 让编排层提示 Agent 主动调用 ma-draft-review Skill，
      // 使完整 SKILL 正文（含 Step 2.5 落盘要求）进入 Agent 上下文——与 bridge 确定性落盘构成双保险
      const isDraftMsg = this.isDraftReviewMessage(userText, hasAnyAttachment || !!docxDraft)

      // 稿件审核反馈 CSV：收集稿件信息（达人名/稿件文字/稿件图片），session 完成时与 bot 回复一并写入工作区 CSV
      if (isDraftMsg && workspace) {
        const docName = docxDraft?.name ?? fileAttachments[0]?.fileName ?? ''
        const influencer = this.extractInfluencerName(userText, docName)
        // 注意：空字符串/降级（docxDraft 为 null、文件文本为空）时用 || 逐级兜底到消息文本，禁止用 ??（只跳过 null/undefined）
        const textPart = docxDraft?.content || fileExtractedText || userText
        const imagePart = imageAttachments.length > 0
          ? imageAttachments.map((img) => `feishu-${img.imageKey}.${inferExtension(img.mediaType)}`).join('; ')
          : ''
        this.pendingDraftFeedback.set(binding.sessionId, { influencer, textPart, imagePart })
      }

      const input: AgentSendInput = {
        sessionId: binding.sessionId,
        userMessage: agentMessage,
        channelId,
        modelId,
        workspaceId: binding.workspaceId,
        permissionModeOverride: 'bypassPermissions',
        isHeadless: true,
        ...(customMcpServers && { customMcpServers }),
        ...(isDraftMsg ? { mentionedSkills: ['ma-draft-review'] } : {}),
      }

      runAgentHeadless(input, {
        onError: (error) => {
          const errPrefix = this.resolveContextPrefix(chatId)
          this.sendCardMessage(chatId, buildErrorCard(`${errPrefix}${error}`)).catch(console.error)
          this.sessionBuffers.delete(binding!.sessionId)
        },
        onComplete: () => {
          // complete 事件由 EventBus listener 处理
        },
        onTitleUpdated: (_title) => {
          // 标题更新可选通知
        },
      }).catch((error) => {
        console.error('[飞书 Bridge] Agent 运行异常:', error)
      })
    } else {
      // Chat 模式 — TODO: Phase 4 实现
      await this.sendMessage(chatId, 'Chat 模式暂未实现，请使用 /agent 切换到 Agent 模式。')
      this.sessionBuffers.delete(binding.sessionId)
    }
  }

  // ===== EventBus 事件处理 =====

  private handleAgentPayload(sessionId: string, payload: AgentStreamPayload): void {
    // 对于飞书发起的会话，缓冲由 handleUserMessage 初始化
    // 对于桌面发起的会话，complete 事件时检查是否需要通知
    const buffer = this.sessionBuffers.get(sessionId)

    if (buffer && payload.kind === 'sdk_message') {
      const msg = payload.message
      // 从 assistant 消息中提取文本
      if (msg.type === 'assistant') {
        const aMsg = msg as { message?: { content?: Array<{ type: string; text?: string }> } }
        for (const block of aMsg.message?.content ?? []) {
          if (block.type === 'text' && block.text) {
            buffer.text += block.text
          }
        }
        // 从 assistant 消息中累积工具使用摘要
        for (const block of aMsg.message?.content ?? []) {
          if (block.type === 'tool_use') {
            const tb = block as { name?: string }
            if (tb.name) {
              accumulateToolStart(buffer.toolSummaries, tb.name)
            }
          }
        }
      }
      // 从 user tool_result 中检测错误
      if (msg.type === 'user') {
        const uMsg = msg as { message?: { content?: Array<{ type: string; tool_use_id?: string; is_error?: boolean }> } }
        for (const block of uMsg.message?.content ?? []) {
          if (block.type === 'tool_result' && block.is_error) {
            // 标记工具有错误（简化处理：无法确定具体工具名）
          }
        }
      }
      // result 消息 → 会话完成
      if (msg.type === 'result') {
        if (buffer) {
          this.handleFeishuSessionComplete(sessionId)
        } else {
          this.handleDesktopSessionComplete(sessionId)
        }
        return
      }
    }

    // MAPro 内部事件处理：错误等
    if (payload.kind === 'sdk_message' && payload.message.type === 'assistant') {
      const aMsg = payload.message as { error?: { message: string } }
      if (aMsg.error) {
        const chatId = this.sessionToChat.get(sessionId)
        if (chatId) {
          const prefix = this.resolveContextPrefix(chatId)
          this.sendCardMessage(chatId, buildErrorCard(`${prefix}${aMsg.error.message}`)).catch(console.error)
        }
        this.sessionBuffers.delete(sessionId)
        this.pendingDraftFeedback.delete(sessionId)
      }
    }

    // 第 3 层加固：捕获 AskUser 请求事件
    if (payload.kind === 'mapro_event' && payload.event.type === 'ask_user_request') {
      const askUserBuffer = this.sessionBuffers.get(sessionId)
      if (askUserBuffer) {
        const request = payload.event.request
        // 标记存在未应答的 AskUser
        askUserBuffer.hasPendingAskUser = true
        // 提取问题摘要（取第一个问题的 header + question 前 50 字）
        if (request.questions && request.questions.length > 0) {
          const firstQ = request.questions[0]
          if (firstQ) {
            const summary = firstQ.header ? `${firstQ.header}：${firstQ.question}` : firstQ.question
            askUserBuffer.lastAskUserSummary = summary.slice(0, 50)
          }
        }
        console.log(`[飞书 Bridge] AskUser 请求 [${sessionId}]:`, askUserBuffer.lastAskUserSummary)
      }
    }

    // AskUser 已解决时清除标记
    if (payload.kind === 'mapro_event' && payload.event.type === 'ask_user_resolved') {
      const resolvedBuffer = this.sessionBuffers.get(sessionId)
      if (resolvedBuffer) {
        resolvedBuffer.hasPendingAskUser = false
      }
    }
  }

  /**
   * 清洗 Agent 原始输出文本，去除过程性说明、工具解释、thinking 标签、追问段落等
   * 确保最终发到飞书群的回复简洁专业，面向运营/第三方阅读
   */
  private sanitizeRemoteBotReply(text: string, buffer: SessionBuffer): string {
    if (!text) return ''

    let result = text

    // 1. 去除 thinking 标签内容（包含 XML 声明）
    const thinkingTagRegex = /(?:<\?xml[^>]*>)?<thinking>[\s\S]*?<\/thinking>/gi
    result = result.replace(thinkingTagRegex, '')

    // 2. 去除 thinking 分隔符块 (--- Thinking --- / === Thinking ===)
    result = result.replace(/[-=]{3,}\s*Thinking\s*[-=]{3,}[\s\S]*?(?:[-=]{3,}|$)/gi, '')

    // 3. 按行处理：过滤纯过程性单行
    const lines = result.split('\n')
    const filteredLines = lines.filter((line) => {
      const trimmed = line.trim()
      // 以常见启动语开头的短行
      if (/^(?:好的|收到|明白|了解|没问题|OK|好的啊|好的呀|让我想想|让我看看|让我查一下|我来帮你).{0,30}$/i.test(trimmed)) {
        return false
      }
      // JSON 错误残留块检测
      if (/^\s*\{.*"error"/i.test(trimmed)) {
        return false
      }
      // 过程性叙述行（让我查看/文件已定位/正在处理等）
      if (this.isProcessualText(trimmed)) {
        return false
      }
      return true
    })
    result = filteredLines.join('\n')

    // 4. 按段落处理：过滤过程性段落和追问段落
    const paragraphs = result.split(/\n\n+/)
    const filteredParagraphs = paragraphs.filter((para) => {
      const trimmed = para.trim()
      if (!trimmed) return true // 保留空段落用于分隔

      // 过滤包含追问关键词的段落（AskUser 未应答时 agent 留下的追问）
      if (buffer.hasPendingAskUser) {
        const hasQuestionPattern =
          /(?:请问|请告诉我|我需要确认|请选择|请你提供|你能否告诉我|需要你回答|我需要你选择)/i.test(trimmed)
        const hasShortQuestion = /^.{0,80}[\u4e00-\u9fa5]{0,20}[?？]$/im.test(trimmed)
        if (hasQuestionPattern || (hasShortQuestion && trimmed.length < 150)) {
          return false
        }
      }
      // 过程性叙述段落（"让我查看""已确认关键信息""正在处理"等），仅保留结论性段落
      if (this.isProcessualText(trimmed)) {
        return false
      }
      return true
    })
    result = filteredParagraphs.join('\n\n')

    // 5. 如果 AskUser 未应答，追加简短提示
    if (buffer.hasPendingAskUser && buffer.lastAskUserSummary) {
      result += `\n\n⚠️ 本次任务需要确认：${buffer.lastAskUserSummary}。请直接回复确认，我会继续处理。`
    }

    // 6. 合并多余空行
    result = result.replace(/\n{3,}/g, '\n\n')

    // 7. 去除首尾空白
    result = result.trim()

    // 8. 如果清洗后为空，给默认回复
    if (!result) {
      result = '任务已完成。'
    }

    return result
  }

  /**
   * 判断文本是否为过程性叙述（思考/动作描述/状态汇报），而非最终结论
   *
   * 用于群聊输出清洗：Agent 在群里的回复应只包含最终结论（如审核意见），
   * "让我查看…""文件已定位…""正在处理…""已确认关键信息…" 这类过程描述一律过滤。
   * 行级与段落级过滤共用此判断。
   */
  private isProcessualText(text: string): boolean {
    const trimmed = text.trim()
    if (!trimmed) return false

    // 1. 明确的结论标记（带冒号或"如下"等列举形式）强制保留
    if (/(?:审核意见|审核结果|审核结论|修改意见|修改建议|总体评价|最终结论|评审结果|意见如下|建议如下|结论)[:：]|(?:意见|建议|结论)如下/i.test(trimmed)) {
      return false
    }

    // 2. 第一人称/时序过程动词开头（"让我/我来/我现在/我已/正在/现在/接下来/首先/下一步"）
    if (/^(?:让我|我来|我现在|我已在|我已|我正在|我准备|我将|我完成|我已经|现在|正在|接下来|首先|下一步|是的[，,、]?正在|好的[，,、]?正在)/i.test(trimmed)) {
      return true
    }

    // 3. 状态汇报/动作描述（"文件已定位""稿件已提取""正在处理""现在查找"等）
    if (/(?:已定位|已提取|已确认|已同步|已找到|已读取|已下载|已保存|已入库|已收到|已成功|正在处理|正在确认|正在查找|正在核对|正在分析|正在读取|现在查找|现在提取|现在确认|现在完成|快速核对|快速确认|核对一下|确认一下|检查一下|查看一下|定位到|提取到|找到文件|读取到|同步到)/i.test(trimmed)) {
      return true
    }

    // 4. 以"让我"开头的完整叙述句
    if (/^让我.{0,120}$/i.test(trimmed)) {
      return true
    }

    // 5. 文件操作异常/失败汇报
    if (/(?:无法直接提取|提取异常|读取失败|下载失败|解析失败|找不到|未找到|无法读取|暂时无法|没有权限|权限不足|需要权限)/i.test(trimmed)) {
      return true
    }

    // 6. 过程性清单项（上传文件/保存位置等）
    if (/^(?:上传文件|文件路径|保存位置|存放位置|落盘位置|同步到)[:：]/i.test(trimmed)) {
      return true
    }

    return false
  }

  /** 飞书发起的会话完成：发送完整回复到飞书 */
  private handleFeishuSessionComplete(sessionId: string): void {
    const buffer = this.sessionBuffers.get(sessionId)
    if (!buffer) return

    // 第 2 层加固：清洗 Agent 原始输出，去除过程性说明和追问段落
    const cleanedText = this.sanitizeRemoteBotReply(buffer.text, buffer)

    const duration = (Date.now() - buffer.startedAt) / 1000
    const toolSummaries = Array.from(buffer.toolSummaries.values())
    const result: FormattedAgentResult = {
      text: cleanedText,
      toolSummaries,
      duration,
    }

    const chatId = this.sessionToChat.get(sessionId)
    if (chatId) {
      this.sendAgentReply(chatId, result).catch(console.error)
    }

    // 稿件审核反馈 CSV：Agent 完成时把稿件信息 + bot 回复追加到工作区 CSV（绝对路径）
    this.recordDraftFeedbackCsv(sessionId, cleanedText)

    this.sessionBuffers.delete(sessionId)
  }

  /**
   * 桌面发起的会话完成：根据通知模式和在场状态决定是否发飞书通知
   *
   * - off → 不发
   * - always → 发
   * - auto → 用户不在场时才发
   */
  private handleDesktopSessionComplete(sessionId: string): void {
    if (!this.client || !this.defaultNotifyChatId) return

    const mode = this.sessionNotifyModes.get(sessionId) ?? 'auto'

    if (mode === 'off') return
    if (mode === 'auto' && presenceService.isUserPresent(sessionId)) return

    // 需要发通知 → 发送简短通知卡片
    this.sendDesktopNotification(sessionId).catch(console.error)
  }

  /** 向飞书发送桌面会话完成通知，并通知渲染进程 */
  private async sendDesktopNotification(sessionId: string): Promise<void> {
    if (!this.defaultNotifyChatId) return

    // 获取会话标题
    const sessions = await listAgentSessions()
    const session = sessions.find((s) => s.id === sessionId)
    const title = session?.title ?? '未命名会话'
    const preview = '任务已完成，请在 MAPro 中查看详情。'

    // 发送通知卡片到飞书
    const card = buildNotificationCard(title, preview, [], 0)
    await this.sendCard(this.defaultNotifyChatId, card)

    // 通知渲染进程（用于 Sonner toast + 桌面通知）
    const payload: FeishuNotificationSentPayload = {
      sessionId,
      sessionTitle: title,
      preview,
    }
    const windows = BrowserWindow.getAllWindows()
    if (windows.length > 0 && !windows[0]!.isDestroyed()) {
      windows[0]!.webContents.send(FEISHU_IPC_CHANNELS.NOTIFICATION_SENT, payload)
    }
  }

  private async sendAgentReply(chatId: string, result: FormattedAgentResult): Promise<void> {
    const subtitle = this.resolveContextSubtitle(chatId)

    if (!result.text.trim()) {
      await this.sendMessage(chatId, `${subtitle ? `${subtitle} | ` : ''}✅ Agent 已完成（无文本输出）`)
      return
    }

    // 群聊时，将 @Name 转换为飞书 <at> 标签
    const binding = this.chatBindings.get(chatId)
    const processedResult: FormattedAgentResult = {
      ...result,
      text: binding?.chatType === 'group'
        ? this.convertMentionsToAtTags(result.text, chatId)
        : result.text,
    }

    const chunks = splitLongContent(processedResult.text)

    if (chunks.length === 1) {
      // 单条卡片
      await this.sendCardMessage(chatId, buildAgentReplyCard(processedResult, subtitle))
    } else {
      // 多条消息
      for (let i = 0; i < chunks.length; i++) {
        const chunkResult: FormattedAgentResult = {
          text: chunks[i]!,
          toolSummaries: i === chunks.length - 1 ? processedResult.toolSummaries : [],
          duration: i === chunks.length - 1 ? processedResult.duration : 0,
        }
        await this.sendCardMessage(chatId, buildAgentReplyCard(chunkResult, subtitle))
      }
    }
  }

  /**
   * 将 Agent 文本中的 @Name 转换为飞书卡片 markdown 的 <at id=open_id>Name</at> 格式
   *
   * 匹配规则：@Name 中的 Name 必须与群成员缓存中的某个成员名称完全匹配。
   */
  private convertMentionsToAtTags(text: string, chatId: string): string {
    const groupInfo = this.groupInfoCache.get(chatId)
    if (!groupInfo?.members || groupInfo.members.length === 0) return text

    // 构建 name → openId 映射（排除 Bot 自身）
    const nameToId = new Map<string, string>()
    for (const m of groupInfo.members) {
      if (m.openId !== this.botOpenId) {
        nameToId.set(m.name, m.openId)
      }
    }
    if (nameToId.size === 0) return text

    // 按名称长度降序排列，避免短名称先匹配导致长名称被截断
    const names = Array.from(nameToId.keys()).sort((a, b) => b.length - a.length)
    // 构建正则：匹配 @Name（Name 为群成员名称）
    const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const pattern = new RegExp(`@(${escaped.join('|')})(?![\\w])`, 'g')

    return text.replace(pattern, (_, name: string) => {
      const openId = nameToId.get(name)
      return openId ? `<at id=${openId}>${name}</at>` : `@${name}`
    })
  }

  // ===== 飞书 API =====

  /** 向去重集合添加 ID，保持集合大小不超过上限 */
  private addToDedup(set: Set<string>, id: string): void {
    set.add(id)
    if (set.size > FeishuBridge.DEDUP_MAX) {
      const first = set.values().next().value as string
      set.delete(first)
    }
  }

  // ===== 群聊辅助方法 =====

  /**
   * 从 mention.id 中提取 open_id
   *
   * 飞书事件中 mention.id 可能是字符串（如 "all"）或对象 { open_id, union_id, user_id }。
   */
  private extractMentionOpenId(mention: FeishuMention): string | null {
    const { id } = mention
    if (typeof id === 'string') return id
    if (typeof id === 'object' && id !== null) return id.open_id ?? null
    return null
  }

  /**
   * 检测消息的 mentions 列表中是否包含 @Bot
   *
   * 优先用 botOpenId 精确匹配；未获取时尝试重新获取。
   * 飞书群聊 @所有人 时 mention.id 为 "all"，直接排除。
   */
  private async isBotMentioned(mentions: FeishuMention[] | undefined): Promise<boolean> {
    if (!mentions || mentions.length === 0) return false

    // 提取所有 mention 的 open_id，排除 @所有人
    const mentionIds = mentions
      .map((m) => ({ name: m.name, openId: this.extractMentionOpenId(m) }))
      .filter((m) => m.openId && m.openId !== 'all')
    if (mentionIds.length === 0) return false

    // 如果 botOpenId 未获取，尝试重新获取
    if (!this.botOpenId && this.client) {
      try {
        const botInfoResp = await this.client.request<{
          bot?: { open_id?: string }
          data?: { bot?: { open_id?: string } }
        }>({
          method: 'GET',
          url: 'https://open.feishu.cn/open-apis/bot/v3/info/',
        })
        this.botOpenId = botInfoResp?.bot?.open_id ?? botInfoResp?.data?.bot?.open_id ?? null
        if (this.botOpenId) {
          console.log(`[飞书 Bridge] 延迟获取 Bot open_id 成功: ${this.botOpenId}`)
        }
      } catch (error) {
        console.warn('[飞书 Bridge] 延迟获取 Bot info 失败:', error)
      }
    }

    if (this.botOpenId) {
      const matched = mentionIds.some((m) => m.openId === this.botOpenId)
      if (!matched) {
        console.log(`[飞书 Bridge] @Bot 未匹配 — botOpenId=${this.botOpenId}, mentions=[${mentionIds.map((m) => `${m.name}(${m.openId})`).join(', ')}]`)
      }
      return matched
    }

    // botOpenId 仍未获取：拒绝，避免 @其他人误触发
    console.warn(`[飞书 Bridge] botOpenId 未获取，无法精确匹配，跳过消息（mentions: ${mentionIds.map((m) => `${m.name}(${m.openId})`).join(', ')}）`)
    return false
  }

  /**
   * 获取群聊信息（带缓存，TTL 1 小时）
   */
  private async getGroupInfo(chatId: string): Promise<FeishuGroupInfo | null> {
    const cached = this.groupInfoCache.get(chatId)
    if (cached && Date.now() - cached.cachedAt < FeishuBridge.GROUP_CACHE_TTL) {
      // 缓存命中：仍调度一次群昵称抓取（带冷却），便于验证与失败重试
      this.scheduleNicknameRefresh(chatId)
      return cached
    }

    if (!this.client) return null

    try {
      const [chatResp, members] = await Promise.all([
        this.client.im.chat.get({ path: { chat_id: chatId } }),
        this.fetchGroupMembers(chatId),
      ])
      const name = chatResp?.data?.name ?? '未知群组'
      const description = chatResp?.data?.description

      const info: FeishuGroupInfo = { chatId, name, description, members, cachedAt: Date.now() }
      this.groupInfoCache.set(chatId, info)

      // 同时填充 userNameCache
      for (const m of members) {
        this.userNameCache.set(m.openId, m.name)
      }

      // 异步补充群昵称（CDP 抓取飞书网页版，群昵称优先覆盖通讯录姓名，失败静默回退）
      this.scheduleNicknameRefresh(chatId)

      return info
    } catch (error) {
      console.warn('[飞书 Bridge] 获取群聊信息失败:', error)
      return null
    }
  }

  /**
   * 调度群昵称抓取：带 in-flight 守卫与 1 分钟冷却，成功/失败都记录尝试时间。
   */
  private scheduleNicknameRefresh(chatId: string): void {
    if (this.nicknameFetchesInFlight.has(chatId)) return
    const last = this.lastNicknameFetchAt.get(chatId)
    if (last !== undefined && Date.now() - last < FeishuBridge.NICKNAME_FETCH_COOLDOWN_MS) return
    this.lastNicknameFetchAt.set(chatId, Date.now())
    this.refreshGroupNicknames(chatId).catch((error) => {
      console.warn('[飞书 Bridge] 群昵称抓取异常:', error)
    })
  }

  /**
   * 拉取群成员列表（最多 200 人，不含机器人）
   */
  private async fetchGroupMembers(chatId: string): Promise<FeishuGroupMember[]> {
    if (!this.client) return []

    try {
      const resp = await this.client.im.chatMembers.get({
        path: { chat_id: chatId },
        params: { member_id_type: 'open_id', page_size: 100 },
      })
      const items = resp?.data?.items ?? []
      return items
        .filter((item) => item.member_id && item.name)
        .map((item) => ({ openId: item.member_id!, name: item.name! }))
    } catch (error) {
      console.warn('[飞书 Bridge] 获取群成员列表失败:', error)
      return []
    }
  }

  /**
   * 通过 CDP 连接已登录飞书网页版的 Chrome，抓取群成员群昵称并覆盖缓存
   *
   * OpenAPI 只能拿到通讯录姓名（不带 Account-/执行- 前缀），前缀识别依赖群昵称，
   * 因此这里以 CDP 抓取结果优先覆盖 groupInfoCache 与 userNameCache。
   * 未配置 CDP 端口或抓取失败时静默回退到 API 通讯录姓名。
   */
  private async refreshGroupNicknames(chatId: string): Promise<void> {
    if (this.nicknameFetchesInFlight.has(chatId)) return
    const info = this.groupInfoCache.get(chatId)
    if (!info || !info.members || info.members.length === 0) return
    const apiMembers = info.members

    // CDP 端口复用「网页爬取」工具设置
    const credentials = getToolCredentials('web-scraper')
    const port =
      typeof credentials.chromeRemoteDebuggingPort === 'string'
        ? credentials.chromeRemoteDebuggingPort.trim()
        : ''
    if (!port) return

    this.nicknameFetchesInFlight.add(chatId)
    try {
      const result = await executeGroupNicknameFetchTask(
        {
          chatId,
          groupName: info.name,
          apiMembers: apiMembers.map((m) => ({ openId: m.openId, name: m.name })),
        },
        { chromeRemoteDebuggingPort: port, timeoutMs: 90_000 },
      )

      if (result.success && result.members.length > 0) {
        const nicknameMap = new Map(result.members.map((m) => [m.openId, m.name]))
        const mergedMembers = apiMembers.map((m) =>
          nicknameMap.has(m.openId) ? { ...m, name: nicknameMap.get(m.openId)! } : m,
        )
        this.groupInfoCache.set(chatId, {
          ...info,
          members: mergedMembers,
          cachedAt: Date.now(),
        })
        for (const m of mergedMembers) {
          this.userNameCache.set(m.openId, m.name)
        }
        console.log(`[飞书 Bridge] 群昵称抓取完成（${chatId}）：覆盖 ${result.members.length} 人（${result.summary}）`)
      } else if (result.error) {
        console.warn(`[飞书 Bridge] 群昵称抓取失败（${chatId}）：${result.error}`)
      }
    } catch (error) {
      console.warn('[飞书 Bridge] 群昵称抓取异常:', error)
    } finally {
      this.nicknameFetchesInFlight.delete(chatId)
    }
  }

  /**
   * 获取用户显示名称（带缓存）
   *
   * 失败时回退返回 open_id 前 8 位。
   */
  private async getUserName(openId: string): Promise<string> {
    const cached = this.userNameCache.get(openId)
    if (cached) return cached

    if (!this.client) return openId.slice(0, 8)

    try {
      const resp = await this.client.contact.user.get({
        path: { user_id: openId },
        params: { user_id_type: 'open_id' },
      })
      const name = resp?.data?.user?.name
      if (name) {
        this.userNameCache.set(openId, name)
        return name
      }
    } catch (error) {
      console.warn('[飞书 Bridge] 获取用户信息失败:', error)
    }

    return openId.slice(0, 8)
  }

  // ===== 群聊消息历史 =====

  /** 默认拉取的群聊历史消息数量 */
  private static readonly DEFAULT_HISTORY_COUNT = 20

  /**
   * 获取聊天历史消息
   *
   * 调用 `im/v1/messages` 接口，按时间倒序拉取指定数量的消息。
   * 需要 `im:message.group_msg` 权限。
   */
  private async fetchChatHistory(
    chatId: string,
    options?: {
      pageSize?: number
      beforeTimestamp?: number
    },
  ): Promise<FeishuChatMessage[]> {
    if (!this.client) return []

    try {
      const pageSize = Math.min(options?.pageSize ?? FeishuBridge.DEFAULT_HISTORY_COUNT, 50)
      const endTime = options?.beforeTimestamp
        ? Math.floor(options.beforeTimestamp / 1000).toString()
        : undefined

      const resp = await this.client.im.message.list({
        params: {
          container_id_type: 'chat',
          container_id: chatId,
          sort_type: 'ByCreateTimeDesc',
          page_size: pageSize,
          ...(endTime && { end_time: endTime }),
        },
      })

      if (resp.code !== 0) {
        console.warn('[飞书 Bridge] 获取聊天历史失败:', resp.msg)
        return []
      }

      const items = resp.data?.items ?? []
      const messages: FeishuChatMessage[] = []

      for (const item of items) {
        // 跳过已删除的消息
        if (item.deleted) continue

        const senderId = item.sender?.id ?? 'unknown'
        const senderType = (item.sender?.sender_type ?? 'unknown') as FeishuChatMessage['senderType']
        const msgType = item.msg_type ?? 'unknown'
        const createTime = Number(item.create_time ?? 0)

        // 解析消息内容
        const content = this.parseChatMessageContent(msgType, item.body?.content)

        messages.push({
          messageId: item.message_id ?? '',
          senderId,
          senderType,
          msgType,
          content,
          createTime,
        })
      }

      // 按时间正序返回（API 返回的是倒序）
      messages.reverse()

      // 异步解析发送者名称（不阻塞返回）
      await this.resolveMessageSenderNames(messages)

      return messages
    } catch (error) {
      console.warn('[飞书 Bridge] 获取聊天历史异常:', error)
      return []
    }
  }

  /**
   * 解析消息内容为可读文本
   */
  private parseChatMessageContent(msgType: string, rawContent?: string): string {
    if (!rawContent) return '[空消息]'

    try {
      switch (msgType) {
        case 'text': {
          const parsed = JSON.parse(rawContent) as { text?: string }
          return parsed.text ?? ''
        }
        case 'post': {
          // 富文本消息，提取纯文本
          const parsed = JSON.parse(rawContent) as {
            title?: string
            content?: Array<Array<{ tag: string; text?: string }>>
          }
          const parts: string[] = []
          if (parsed.title) parts.push(parsed.title)
          for (const line of parsed.content ?? []) {
            const lineText = line
              .filter((el) => el.tag === 'text' && el.text)
              .map((el) => el.text)
              .join('')
            if (lineText) parts.push(lineText)
          }
          return parts.join('\n') || '[富文本消息]'
        }
        case 'interactive':
          return '[交互卡片]'
        case 'image':
          return '[图片]'
        case 'file':
          return '[文件]'
        case 'audio':
          return '[语音]'
        case 'media':
          return '[视频]'
        case 'sticker':
          return '[表情]'
        case 'share_chat':
          return '[群名片]'
        case 'share_user':
          return '[个人名片]'
        default:
          return `[${msgType}]`
      }
    } catch {
      return `[${msgType}]`
    }
  }

  /**
   * 批量解析消息发送者名称
   */
  private async resolveMessageSenderNames(messages: FeishuChatMessage[]): Promise<void> {
    const uniqueUserIds = new Set<string>()
    for (const msg of messages) {
      if (msg.senderType === 'user' && !this.userNameCache.has(msg.senderId)) {
        uniqueUserIds.add(msg.senderId)
      }
    }

    // 并发获取用户名称（最多 10 个并发）
    const userIds = Array.from(uniqueUserIds).slice(0, 10)
    await Promise.allSettled(userIds.map((id) => this.getUserName(id)))

    // 回填名称
    for (const msg of messages) {
      if (msg.senderType === 'user') {
        msg.senderName = this.userNameCache.get(msg.senderId)
      } else if (msg.senderType === 'app') {
        msg.senderName = 'Bot'
      }
    }
  }

  /**
   * 将消息历史格式化为 Agent 可读的上下文文本
   */
  private formatChatHistoryContext(messages: FeishuChatMessage[]): string {
    if (messages.length === 0) return ''

    const lines = messages.map((msg) => {
      const time = new Date(msg.createTime).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
      })
      const sender = msg.senderName ?? msg.senderId.slice(0, 8)
      const role = msg.senderType === 'app' ? 'Bot' : sender
      return `[${time}] ${role}: ${msg.content}`
    })

    return [
      '--- 群聊历史消息（最近） ---',
      ...lines,
      '--- 历史消息结束 ---',
    ].join('\n')
  }

  /**
   * 创建飞书群聊 MCP 服务器（动态工具，仅在群聊 Agent 会话中注入）
   *
   * 提供 `fetch_group_chat_history` 工具，让 Agent 可以主动拉取更多群聊历史。
   */
  private async createFeishuChatMcpServer(
    chatId: string,
  ): Promise<Record<string, unknown> | null> {
    try {
      const sdk = await loadClaudeAgentSdk()
      const { z } = await import('zod')

      const server = sdk.createSdkMcpServer({
        name: 'feishu_chat',
        version: '1.0.0',
        tools: [
          sdk.tool(
            'fetch_group_chat_history',
            '获取飞书群聊的历史消息。当你需要了解更多群聊上下文来完成任务时使用此工具。' +
            '返回指定数量的历史消息，包含发送者、时间和内容。',
            {
              limit: z.number().min(1).max(50).optional()
                .describe('要获取的消息数量（默认 20，最多 50）'),
              before_timestamp: z.number().optional()
                .describe('获取此时间戳（毫秒）之前的消息，用于向前翻页'),
            },
            async (args) => {
              const messages = await this.fetchChatHistory(chatId, {
                pageSize: args.limit,
                beforeTimestamp: args.before_timestamp,
              })

              if (messages.length === 0) {
                return {
                  content: [{ type: 'text' as const, text: '没有更多历史消息。' }],
                }
              }

              const formatted = this.formatChatHistoryContext(messages)
              const oldestTimestamp = messages[0]?.createTime ?? 0

              return {
                content: [{
                  type: 'text' as const,
                  text: `${formatted}\n\n（如需更早的消息，使用 before_timestamp: ${oldestTimestamp}）`,
                }],
              }
            },
            { annotations: { readOnlyHint: true } },
          ),
        ],
      })

      console.log('[飞书 Bridge] 已创建群聊 MCP 工具')
      return server as unknown as Record<string, unknown>
    } catch (error) {
      console.warn('[飞书 Bridge] 创建群聊 MCP 工具失败:', error)
      return null
    }
  }

  /**
   * 解析消息上下文前缀：[工作区名称]->[会话名称]：
   *
   * 用于在每条回复的飞书消息开头标注来源，方便用户区分。
   */
  private resolveContextPrefix(chatId: string): string {
    const binding = this.chatBindings.get(chatId)
    if (!binding) return ''

    const workspace = binding.workspaceId ? getAgentWorkspace(binding.workspaceId) : undefined
    const session = getAgentSessionMeta(binding.sessionId)

    const wsName = workspace?.name ?? '默认工作区'
    const sessName = session?.title ?? binding.sessionId.slice(0, 8)

    return `[${wsName}]->[${sessName}]：`
  }

  /** 获取卡片 header subtitle 用的上下文描述 */
  private resolveContextSubtitle(chatId: string): string {
    const binding = this.chatBindings.get(chatId)
    if (!binding) return ''

    const workspace = binding.workspaceId ? getAgentWorkspace(binding.workspaceId) : undefined
    const session = getAgentSessionMeta(binding.sessionId)

    const wsName = workspace?.name ?? '默认工作区'
    const sessName = session?.title ?? binding.sessionId.slice(0, 8)

    return `${wsName} · ${sessName}`
  }

  private async sendTextMessage(chatId: string, text: string): Promise<void> {
    if (!this.client) return

    try {
      const resp = await this.client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text }),
        },
      })
      // 将 Bot 发出的消息 ID 加入去重集合，防止回环
      const sentId = (resp?.data as Record<string, unknown>)?.message_id as string | undefined
      if (sentId) this.addToDedup(this.recentMessageIds, sentId)
    } catch (error) {
      console.error('[飞书 Bridge] 发送文本消息失败:', error)
    }
  }

  private async sendCard(chatId: string, card: Record<string, unknown>): Promise<void> {
    if (!this.client) return

    try {
      const resp = await this.client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'interactive',
          content: JSON.stringify(card),
        },
      })
      // 将 Bot 发出的消息 ID 加入去重集合，防止回环
      const sentId = (resp?.data as Record<string, unknown>)?.message_id as string | undefined
      if (sentId) this.addToDedup(this.recentMessageIds, sentId)
    } catch (error) {
      console.error('[飞书 Bridge] 发送卡片消息失败:', error)
    }
  }

  // ===== 群聊 Thread Reply =====

  /** 回复指定消息（文本，群聊线程回复） */
  private async replyTextMessage(messageId: string, text: string): Promise<void> {
    if (!this.client) return

    try {
      const resp = await this.client.im.message.reply({
        path: { message_id: messageId },
        data: {
          content: JSON.stringify({ text }),
          msg_type: 'text',
        },
      })
      const sentId = (resp?.data as Record<string, unknown>)?.message_id as string | undefined
      if (sentId) this.addToDedup(this.recentMessageIds, sentId)
    } catch (error) {
      console.error('[飞书 Bridge] 回复文本消息失败:', error)
    }
  }

  /** 回复指定消息（卡片，群聊线程回复） */
  private async replyCard(messageId: string, card: Record<string, unknown>): Promise<void> {
    if (!this.client) return

    try {
      const resp = await this.client.im.message.reply({
        path: { message_id: messageId },
        data: {
          content: JSON.stringify(card),
          msg_type: 'interactive',
        },
      })
      const sentId = (resp?.data as Record<string, unknown>)?.message_id as string | undefined
      if (sentId) this.addToDedup(this.recentMessageIds, sentId)
    } catch (error) {
      console.error('[飞书 Bridge] 回复卡片消息失败:', error)
    }
  }

  /**
   * 发送文本消息到聊天（自动选择回复或新建）
   *
   * 群聊时使用 reply（线程回复），单聊时使用 create。
   */
  private async sendMessage(chatId: string, text: string): Promise<void> {
    const binding = this.chatBindings.get(chatId)
    const replyToId = binding?.chatType === 'group'
      ? this.lastUserMessageId.get(chatId)
      : undefined

    if (replyToId) {
      await this.replyTextMessage(replyToId, text)
    } else {
      await this.sendTextMessage(chatId, text)
    }
  }

  /**
   * 发送卡片消息到聊天（自动选择回复或新建）
   */
  private async sendCardMessage(chatId: string, card: Record<string, unknown>): Promise<void> {
    const binding = this.chatBindings.get(chatId)
    const replyToId = binding?.chatType === 'group'
      ? this.lastUserMessageId.get(chatId)
      : undefined

    if (replyToId) {
      await this.replyCard(replyToId, card)
    } else {
      await this.sendCard(chatId, card)
    }
  }

  // ===== 状态更新与广播 =====

  private updateStatus(partial: Partial<FeishuBridgeState>): void {
    this.status = { ...this.status, ...partial }

    // 广播到渲染进程（包含 botId 和 botName）
    const windows = BrowserWindow.getAllWindows()
    if (windows.length > 0 && !windows[0]!.isDestroyed()) {
      windows[0]!.webContents.send(FEISHU_IPC_CHANNELS.STATUS_CHANGED, {
        ...this.status,
        botId: this.botConfig.id,
        botName: this.botConfig.name,
      })
    }
  }
}

// ===== 导出类（由 FeishuBridgeManager 创建实例） =====

export { FeishuBridge }
