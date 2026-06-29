/**
 * Web Agent 编排器
 *
 * 组合 @ma-proma/server 的 Agent 服务，为 WebSocket / HTTP 提供统一入口。
 * 支持权限审批、AskUserQuestion、ExitPlanMode 等交互式流程。
 */

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import type {
  AgentStreamPayload,
  SDKMessage,
  MAProPermissionMode,
  PermissionResponse,
  AskUserResponse,
  ExitPlanModeResponse,
  ExitPlanModeRequest,
  PermissionRequest,
  AskUserRequest,
} from '@ma-proma/shared'
import type { AgentResourceLimits } from '@ma-proma/server'
import {
  MAPRO_PERMISSION_MODE_CONFIG,
  MAPRO_DEFAULT_PERMISSION_MODE,
  isMAProPermissionMode,
  SAFE_TOOLS,
} from '@ma-proma/shared'
import type {
  AppContext,
  AgentSessionManager,
  AgentWorkspaceManager,
  ChatToolConfigService,
  RendererTransport,
  CanUseToolOptions,
  PermissionResult,
  ExitPlanPermissionResult,
} from '@ma-proma/server'
import {
  ClaudeAgentAdapter,
  AgentEventBus,
  buildAgentEnvironment,
  getAgentWorkspacePath,
  AgentPermissionService,
  AgentAskUserService,
  AgentExitPlanService,
  validateToolInput,
  estimateTokenCount,
  WRITE_CONTENT_TOKEN_THRESHOLD,
  AgentAuditLogger,
  agentToolBlocklist,
} from '@ma-proma/server'

export interface AgentOrchestratorConfig {
  provider: string
  apiKey: string
  model: string
  channelId: string
  baseUrl?: string
  proxyUrl?: string
  /** 默认权限模式，默认 auto */
  permissionMode?: MAProPermissionMode
  /** 可选 SDK CLI 路径，测试用 */
  sdkCliPath?: string
  /** Agent 资源限制（默认从环境变量读取） */
  resourceLimits?: AgentResourceLimits
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
  private activeSessions = new Set<string>()

  private permissionService = new AgentPermissionService()
  private askUserService = new AgentAskUserService()
  private exitPlanService = new AgentExitPlanService()
  private sessionPermissionModes = new Map<string, MAProPermissionMode>()
  private auditLogger: AgentAuditLogger

  constructor(deps: AgentOrchestratorDeps) {
    this.context = deps.context
    this.sessionManager = deps.sessionManager
    this.workspaceManager = deps.workspaceManager
    this.chatToolConfigService = deps.chatToolConfigService
    this.config = deps.config
    this.adapter = new ClaudeAgentAdapter()
    this.eventBus = new AgentEventBus()
    this.auditLogger = new AgentAuditLogger(deps.context)
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
    if (this.activeSessions.has(sessionId)) {
      this.emitError(sessionId, '会话正在处理中，请等待当前请求完成后再发送新消息')
      return
    }
    this.activeSessions.add(sessionId)

    try {
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

    const history = await this.sessionManager.getAgentSessionMessages(sessionId)
    const prompt = this.buildPrompt(history, userMessage)

    // 追加用户消息到持久化存储（放在 prompt 构建之后，避免同一条消息在 prompt 里重复）
    await this.sessionManager.appendAgentMessage(sessionId, {
      id: cryptoRandomId(),
      role: 'user',
      content: userMessage,
      createdAt: Date.now(),
    })

    const sdkCliPath = this.config.sdkCliPath ?? resolveSDKCliPath()
    if (!existsSync(sdkCliPath)) {
      this.emitError(sessionId, `SDK binary 不存在: ${sdkCliPath}`)
      return
    }

    const controller = new AbortController()
    this.abortControllers.set(sessionId, controller)

    // 确定初始权限模式
    const envMode = process.env.MAPRO_AGENT_PERMISSION_MODE
    const initialPermissionMode: MAProPermissionMode =
      this.config.permissionMode ??
      (typeof envMode === 'string' && isMAProPermissionMode(envMode) ? envMode : undefined) ??
      MAPRO_DEFAULT_PERMISSION_MODE

    this.sessionPermissionModes.set(sessionId, initialPermissionMode)
    console.log(`[Agent 编排] 权限模式: ${initialPermissionMode}`)

    if (initialPermissionMode === 'plan') {
      this.eventBus.emit(sessionId, { kind: 'mapro_event', event: { type: 'enter_plan_mode', sessionId } })
    }

    const getPermissionMode = (): MAProPermissionMode =>
      this.sessionPermissionModes.get(sessionId) ?? initialPermissionMode

    const handleExitPlanMode = (toolInput: Record<string, unknown>, signal: AbortSignal): Promise<ExitPlanPermissionResult> => {
      return this.exitPlanService.handleExitPlanMode(
        sessionId,
        toolInput,
        signal,
        (request: ExitPlanModeRequest) => {
          this.eventBus.emit(sessionId, { kind: 'mapro_event', event: { type: 'exit_plan_mode_request', request } })
        },
      )
    }

    const autoCanUseTool = this.permissionService.createCanUseTool(
      sessionId,
      (request: PermissionRequest) => {
        this.eventBus.emit(sessionId, { kind: 'mapro_event', event: { type: 'permission_request', request } })
      },
      (sid, input, signal, sendAskUser) =>
        this.askUserService.handleAskUserQuestion(sid, input, signal, sendAskUser),
      (request: AskUserRequest) => {
        this.eventBus.emit(sessionId, { kind: 'mapro_event', event: { type: 'ask_user_request', request } })
      },
    )

    const PLAN_MODE_ALLOWED_TOOLS = new Set([
      'Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch',
      'Agent', 'TodoRead', 'TodoWrite', 'TaskOutput',
      'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet',
      'ListMcpResourcesTool', 'ReadMcpResourceTool',
    ])

    let planModeEntered = initialPermissionMode === 'plan'

    const resolvePermission = async (toolName: string, input: Record<string, unknown>, options: CanUseToolOptions): Promise<PermissionResult> => {
      const currentMode = getPermissionMode()

      // 参数校验守卫
      const validationFailure = validateToolInput(toolName, input)
      if (validationFailure) {
        console.warn(`[Agent 工具验证] 参数缺失: tool=${toolName}, mode=${currentMode}`)
        return validationFailure
      }

      // Write 大文件 token 截断防护
      if (toolName === 'Write' && typeof input.content === 'string') {
        const estimatedTokens = estimateTokenCount(input.content)
        if (estimatedTokens > WRITE_CONTENT_TOKEN_THRESHOLD) {
          console.warn(
            `[Agent 工具验证] Write 内容过大: tokens≈${estimatedTokens}, chars=${input.content.length}, file=${String(input.file_path)}`,
          )
          return {
            behavior: 'deny' as const,
            message:
              `The content for Write tool (~${estimatedTokens} estimated tokens, ${input.content.length} chars) is too large and may be truncated. ` +
              `Please split the write into smaller sequential steps: write the first portion of the file now, then use Edit tool to append remaining sections incrementally.`,
          }
        }
      }

      // EnterPlanMode / ExitPlanMode 处理
      if (currentMode === 'bypassPermissions' && (toolName === 'EnterPlanMode' || toolName === 'ExitPlanMode')) {
        return { behavior: 'allow' as const, updatedInput: input }
      }

      if (toolName === 'ExitPlanMode') {
        console.log(`[canUseTool] ExitPlanMode: signal.aborted=${options.signal.aborted}, planModeEntered=${planModeEntered}, mode=${currentMode}`)
        if (!planModeEntered) {
          return { behavior: 'allow' as const, updatedInput: input }
        }
        const result = await handleExitPlanMode(input, options.signal)
        if (result.behavior === 'allow' && 'targetMode' in result && result.targetMode) {
          this.sessionPermissionModes.set(sessionId, result.targetMode)
          planModeEntered = false
          if (this.adapter.setPermissionMode) {
            this.adapter.setPermissionMode(sessionId, result.targetMode).catch((err: unknown) => {
              console.warn(`[Agent 编排] SDK 权限模式切换失败:`, err)
            })
          }
        }
        return result
      }

      if (toolName === 'EnterPlanMode') {
        planModeEntered = true
        this.eventBus.emit(sessionId, { kind: 'mapro_event', event: { type: 'enter_plan_mode', sessionId } })
        return { behavior: 'allow' as const, updatedInput: input }
      }

      // AskUserQuestion：始终走交互式问答流程
      if (toolName === 'AskUserQuestion') {
        return this.askUserService.handleAskUserQuestion(
          sessionId, input, options.signal,
          (request: AskUserRequest) => {
            this.eventBus.emit(sessionId, { kind: 'mapro_event', event: { type: 'ask_user_request', request } })
          },
        )
      }

      // 普通工具的权限分派
      switch (currentMode) {
        case 'bypassPermissions':
          return { behavior: 'allow' as const, updatedInput: input }

        case 'plan': {
          if (PLAN_MODE_ALLOWED_TOOLS.has(toolName)) {
            return { behavior: 'allow' as const, updatedInput: input }
          }
          if (toolName === 'Write' || toolName === 'Edit') {
            const filePath = typeof input.file_path === 'string' ? input.file_path : ''
            if (filePath.toLowerCase().endsWith('.md')) {
              return { behavior: 'allow' as const, updatedInput: input }
            }
          }
          // Bash 工具：计划模式下默认拒绝，避免维护 Shell 正则带来的安全风险
          if (toolName === 'Bash') {
            return { behavior: 'deny' as const, message: '计划模式下不允许执行 Bash 命令，请在计划审批通过后再执行' }
          }
          if (toolName.startsWith('mcp__')) {
            return { behavior: 'allow' as const, updatedInput: input }
          }
          return { behavior: 'deny' as const, message: '计划模式下不允许执行写操作，请在计划审批通过后再执行' }
        }

        case 'auto':
          return autoCanUseTool(toolName, input, options)

        default:
          return { behavior: 'allow' as const, updatedInput: input }
      }
    }

    const canUseTool = async (toolName: string, input: Record<string, unknown>, options: CanUseToolOptions): Promise<PermissionResult> => {
      const currentMode = getPermissionMode()
      this.auditLogger.log({
        sessionId,
        eventType: 'tool_request',
        toolName,
        input,
        permissionMode: currentMode,
      })

      // 黑名单拦截：任何权限模式下都生效
      const blocklistResult = agentToolBlocklist.check(toolName, input)
      if (blocklistResult.blocked) {
        console.warn(`[Agent 黑名单] 拦截: sessionId=${sessionId}, tool=${toolName}, rule=${blocklistResult.matchedRule}`)
        this.auditLogger.log({
          sessionId,
          eventType: 'permission_decision',
          toolName,
          decision: 'deny',
          decisionReason: blocklistResult.reason,
          permissionMode: currentMode,
        })
        return { behavior: 'deny' as const, message: blocklistResult.reason! }
      }

      const result = await resolvePermission(toolName, input, options)
      this.auditLogger.log({
        sessionId,
        eventType: 'permission_decision',
        toolName,
        decision: result.behavior,
        decisionReason: 'message' in result ? result.message : undefined,
        permissionMode: getPermissionMode(),
      })
      return result
    }

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
        sdkPermissionMode: initialPermissionMode === 'bypassPermissions'
          ? 'auto'
          : MAPRO_PERMISSION_MODE_CONFIG[initialPermissionMode].sdkMode,
        allowDangerouslySkipPermissions: false,
        canUseTool,
        ...(initialPermissionMode === 'auto' && { allowedTools: [...SAFE_TOOLS] }),
        resourceLimits: this.config.resourceLimits,
        systemPrompt: '你是 MAPro Agent，一个专业的广告营销 AI 助手。',
      } as import('@ma-proma/server').ClaudeAgentQueryOptions)

      for await (const sdkMessage of stream) {
        if (controller.signal.aborted) break
        await this.handleSDKMessage(sessionId, sdkMessage)
      }

      this.send(sessionId, 'agent:stream:complete', { sessionId })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.auditLogger.log({ sessionId, eventType: 'error', output: message })
      this.emitError(sessionId, message)
    } finally {
      this.abortControllers.delete(sessionId)
      this.sessionPermissionModes.delete(sessionId)
      this.auditLogger.flush()
    }
    } finally {
      this.activeSessions.delete(sessionId)
    }
  }

  handleStop(sessionId: string): void {
    const controller = this.abortControllers.get(sessionId)
    if (controller) {
      controller.abort()
      this.abortControllers.delete(sessionId)
    }
    this.sessionPermissionModes.delete(sessionId)
    this.activeSessions.delete(sessionId)
    this.permissionService.clearSessionPending(sessionId)
    this.askUserService.clearSessionPending(sessionId)
    this.exitPlanService.clearSessionPending(sessionId)
    this.adapter.abort(sessionId)
    // 确保该会话的审计日志及时落盘
    this.auditLogger.flush()
  }

  /** 释放编排器资源 */
  dispose(): void {
    this.auditLogger.dispose()
    this.adapter.dispose()
  }

  /** 响应权限请求 */
  respondPermission(_sessionId: string, response: PermissionResponse): void {
    const resolvedSessionId = this.permissionService.respondToPermission(
      response.requestId,
      response.behavior,
      response.alwaysAllow,
    )
    if (resolvedSessionId) {
      this.eventBus.emit(resolvedSessionId, {
        kind: 'mapro_event',
        event: { type: 'permission_resolved', requestId: response.requestId, behavior: response.behavior },
      })
    }
  }

  /** 响应 AskUser 请求 */
  respondAskUser(_sessionId: string, response: AskUserResponse): void {
    const resolvedSessionId = this.askUserService.respondToAskUser(response.requestId, response.answers)
    if (resolvedSessionId) {
      this.eventBus.emit(resolvedSessionId, {
        kind: 'mapro_event',
        event: { type: 'ask_user_resolved', requestId: response.requestId },
      })
    }
  }

  /** 响应 ExitPlanMode 请求 */
  respondExitPlanMode(_sessionId: string, response: ExitPlanModeResponse): void {
    const result = this.exitPlanService.respondToExitPlanMode(response)
    if (result) {
      this.eventBus.emit(result.sessionId, {
        kind: 'mapro_event',
        event: { type: 'exit_plan_mode_resolved', requestId: response.requestId },
      })
    }
  }

  private async handleSDKMessage(sessionId: string, sdkMessage: SDKMessage): Promise<void> {
    // 持久化 SDK 消息
    await this.sessionManager.appendSDKMessages(sessionId, [sdkMessage])

    // 记录工具执行结果
    this.recordToolResultFromSDKMessage(sessionId, sdkMessage)

    // 透传 SDK 消息给前端
    this.eventBus.emit(sessionId, { kind: 'sdk_message', message: sdkMessage })
  }

  private recordToolResultFromSDKMessage(sessionId: string, sdkMessage: SDKMessage): void {
    if (sdkMessage.type !== 'user') return
    const contentBlocks = (sdkMessage as unknown as Record<string, unknown>).message as
      | Array<{ type: string; tool_use_id?: unknown; content?: unknown; is_error?: unknown }>
      | undefined
    if (!Array.isArray(contentBlocks)) return

    for (const block of contentBlocks) {
      if (block.type === 'tool_result') {
        const toolUseId = block.tool_use_id ? String(block.tool_use_id) : undefined
        const isError = block.is_error ? Boolean(block.is_error) : false
        this.auditLogger.log({
          sessionId,
          eventType: 'tool_result',
          toolUseId,
          output: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
          isError,
        })
      }
    }
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
