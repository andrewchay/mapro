/**
 * Web Agent 编排器
 *
 * 组合 @ma-proma/server 的 Agent 服务，为 WebSocket / HTTP 提供统一入口。
 * 当前阶段：最小可用闭环，固定 allow-all 权限模式，不做权限/AskUser UI。
 */

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import type {
  AgentSendInput,
  AgentStreamPayload,
  SDKMessage,
} from '@ma-proma/shared'
import type {
  AppContext,
  AgentSessionManager,
  AgentWorkspaceManager,
  ChatToolConfigService,
  RendererTransport,
} from '@ma-proma/server'
import {
  ClaudeAgentAdapter,
  AgentEventBus,
  buildAgentEnvironment,
  getAgentWorkspacePath,
} from '@ma-proma/server'

export interface AgentOrchestratorConfig {
  provider: string
  apiKey: string
  model: string
  channelId: string
  baseUrl?: string
  proxyUrl?: string
}

export interface AgentOrchestratorDeps {
  context: AppContext
  sessionManager: AgentSessionManager
  workspaceManager: AgentWorkspaceManager
  chatToolConfigService: ChatToolConfigService
  config: AgentOrchestratorConfig
}

export class AgentOrchestrator {
  private context: AppContext
  private sessionManager: AgentSessionManager
  private workspaceManager: AgentWorkspaceManager
  private chatToolConfigService: ChatToolConfigService
  private config: AgentOrchestratorConfig
  private adapter: ClaudeAgentAdapter
  private eventBus: AgentEventBus
  private abortControllers = new Map<string, AbortController>()
  private transports = new Map<string, RendererTransport>()

  constructor(deps: AgentOrchestratorDeps) {
    this.context = deps.context
    this.sessionManager = deps.sessionManager
    this.workspaceManager = deps.workspaceManager
    this.chatToolConfigService = deps.chatToolConfigService
    this.config = deps.config
    this.adapter = new ClaudeAgentAdapter()
    this.eventBus = new AgentEventBus()
  }

  /** 注册当前 WebSocket 连接的传输层 */
  attachTransport(sessionId: string, transport: RendererTransport): () => void {
    this.transports.set(sessionId, transport)

    const handler = (eventSessionId: string, payload: AgentStreamPayload) => {
      if (eventSessionId !== sessionId) return
      transport.send('agent:stream:event', { sessionId, payload })
    }
    const unsubscribe = this.eventBus.on(handler)

    return () => {
      unsubscribe()
      this.transports.delete(sessionId)
    }
  }

  async handleSend(sessionId: string, userMessage: string): Promise<void> {
    const meta = await this.sessionManager.getAgentSessionMeta(sessionId)
    if (!meta) {
      throw new Error(`会话不存在: ${sessionId}`)
    }

    const workspace = meta.workspaceId
      ? this.workspaceManager.getAgentWorkspace(meta.workspaceId)
      : undefined

    const cwd = workspace
      ? getAgentWorkspacePath(this.context, workspace.slug)
      : this.context.getConfigDir()

    // 追加用户消息到持久化存储
    await this.sessionManager.appendAgentMessage(sessionId, {
      id: cryptoRandomId(),
      role: 'user',
      content: userMessage,
      createdAt: Date.now(),
    })

    const sdkCliPath = resolveSDKCliPath()
    if (!existsSync(sdkCliPath)) {
      this.emitError(sessionId, `SDK binary 不存在: ${sdkCliPath}`)
      return
    }

    const controller = new AbortController()
    this.abortControllers.set(sessionId, controller)

    const history = await this.sessionManager.getAgentSessionMessages(sessionId)
    const prompt = this.buildPrompt(history, userMessage)

    try {
      const stream = this.adapter.query({
        sessionId,
        prompt,
        model: this.config.model,
        cwd,
        abortSignal: controller.signal,
        sdkCliPath,
        env: buildAgentEnvironment({
          apiKey: this.config.apiKey,
          baseUrl: this.config.baseUrl,
          proxyUrl: this.config.proxyUrl,
        }),
        sdkPermissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        systemPrompt: '你是 MAPro Agent，一个专业的广告营销 AI 助手。',
      } as import('@ma-proma/server').ClaudeAgentQueryOptions)

      for await (const sdkMessage of stream) {
        if (controller.signal.aborted) break
        await this.handleSDKMessage(sessionId, sdkMessage)
      }

      this.send(sessionId, 'agent:stream:complete', { sessionId })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.emitError(sessionId, message)
    } finally {
      this.abortControllers.delete(sessionId)
    }
  }

  handleStop(sessionId: string): void {
    const controller = this.abortControllers.get(sessionId)
    if (controller) {
      controller.abort()
      this.abortControllers.delete(sessionId)
    }
    this.adapter.abort(sessionId)
  }

  private async handleSDKMessage(sessionId: string, sdkMessage: SDKMessage): Promise<void> {
    // 持久化 SDK 消息
    await this.sessionManager.appendSDKMessages(sessionId, [sdkMessage])

    // 透传 SDK 消息给前端
    this.eventBus.emit(sessionId, { kind: 'sdk_message', message: sdkMessage })
  }



  private buildPrompt(history: Array<{ role: string; content: string }>, userMessage: string): string {
    // 简单上下文：取最近 10 条消息
    const recent = history.slice(-10)
    const context = recent
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n')
    return context ? `${context}\n\nUser: ${userMessage}` : userMessage
  }

  private emitError(sessionId: string, error: string): void {
    console.error(`[Agent Orchestrator] 会话 ${sessionId} 错误:`, error)
    this.send(sessionId, 'agent:stream:error', { sessionId, error })
  }

  private send(sessionId: string, channel: string, data: unknown): void {
    const transport = this.transports.get(sessionId)
    if (transport) {
      transport.send(channel, data)
    }
  }
}

function resolveSDKCliPath(): string {
  const subpkg = `claude-agent-sdk-${process.platform}-${process.arch}`
  const binaryName = process.platform === 'win32' ? 'claude.exe' : 'claude'

  try {
    const modulePath = typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url)
    const cjsRequire = createRequire(modulePath)
    const sdkEntryPath = cjsRequire.resolve('@anthropic-ai/claude-agent-sdk')
    const anthropicDir = dirname(dirname(sdkEntryPath))
    return join(anthropicDir, subpkg, binaryName)
  } catch (error) {
    console.warn('[Agent Orchestrator] 解析 SDK 路径失败:', error)
  }

  // 兜底：尝试相对 node_modules
  return join(process.cwd(), 'node_modules', '@anthropic-ai', subpkg, binaryName)
}

function cryptoRandomId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}
