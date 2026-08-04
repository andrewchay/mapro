/**
 * Agent AskUserQuestion 交互式问答服务
 *
 * 核心职责：
 * - 拦截 AskUserQuestion 工具调用
 * - 解析问题列表，发送到渲染进程展示交互 UI
 * - 等待用户回答，通过 updatedInput 注入 answers 字段
 * - 管理 pending 请求生命周期
 *
 * 复用权限系统的 Promise + Map 异步等待模式。
 */

import { randomUUID } from 'node:crypto'
import type {
  AskUserRequest,
  AskUserQuestion,
  AskUserQuestionOption,
} from '@ma-proma/shared'

/** canUseTool 返回的权限结果 */
type PermissionResult = {
  behavior: 'allow'
  updatedInput: Record<string, unknown>
} | {
  behavior: 'deny'
  message: string
}

/** 待处理的 AskUser 请求 */
interface PendingAskUser {
  resolve: (result: PermissionResult) => void
  request: AskUserRequest
  timeoutId?: ReturnType<typeof setTimeout>
}

/**
 * Agent AskUserQuestion 交互式问答服务
 *
 * 单例模式，管理所有会话的 AskUser 请求。
 */
export class AgentAskUserService {
  /** 待处理的 AskUser 请求 Map（requestId → PendingAskUser） */
  private pendingRequests = new Map<string, PendingAskUser>()

  /** Headless 场景下 AskUser 超时时间（60s） */
  readonly HEADLESS_ASK_USER_TIMEOUT_MS = 60_000

  /**
   * 处理 AskUserQuestion 工具调用
   *
   * 解析问题列表，发送到渲染进程，阻塞等待用户回答，
   * 回答后通过 updatedInput 注入 answers 字段。
   *
   * @param isHeadless 是否为 headless 场景（飞书 bot 远程触发）。headless 下不发送渲染进程，60s 超时自动 deny。
   */
  handleAskUserQuestion(
    sessionId: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
    sendToRenderer: (request: AskUserRequest) => void,
    isHeadless = false,
  ): Promise<PermissionResult> {
    const questions = this.parseQuestions(input)

    const request: AskUserRequest = {
      requestId: randomUUID(),
      sessionId,
      kind: input.interactionType === 'computer_use_takeover' ? 'computer_use_takeover' : 'question',
      questions,
      toolInput: input,
    }

    // Headless 场景：不发送到渲染进程（无人能回答）
    if (!isHeadless) {
      sendToRenderer(request)
    }

    return new Promise<PermissionResult>((resolve) => {
      // Headless 场景：添加超时保护
      let timeoutId: ReturnType<typeof setTimeout> | undefined
      if (isHeadless) {
        timeoutId = setTimeout(() => {
          if (this.pendingRequests.has(request.requestId)) {
            console.log(`[AskUser] Headless 超时自动 deny [${sessionId}] (${this.HEADLESS_ASK_USER_TIMEOUT_MS / 1000}s)`)
            this.pendingRequests.delete(request.requestId)
            resolve({ behavior: 'deny', message: '无人应答，按默认策略继续' })
          }
        }, this.HEADLESS_ASK_USER_TIMEOUT_MS)
      }

      const pending: PendingAskUser = { resolve, request, timeoutId }
      this.pendingRequests.set(request.requestId, pending)

      signal.addEventListener('abort', () => {
        if (this.pendingRequests.has(request.requestId)) {
          if (timeoutId) clearTimeout(timeoutId)
          this.pendingRequests.delete(request.requestId)
          resolve({ behavior: 'deny', message: '操作已中止' })
        }
      }, { once: true })
    })
  }

  /**
   * 响应 AskUser 请求（由 IPC handler 调用）
   *
   * @returns 对应的 sessionId，用于向渲染进程发送 resolved 事件；未找到返回 null
   */
  respondToAskUser(requestId: string, answers: Record<string, string>): string | null {
    const pending = this.pendingRequests.get(requestId)
    if (!pending) return null

    if (pending.timeoutId) clearTimeout(pending.timeoutId)

    const sessionId = pending.request.sessionId

    // 构建 updatedInput：保留原始输入 + 注入 answers
    const updatedInput: Record<string, unknown> = {
      ...pending.request.toolInput,
      answers,
    }

    pending.resolve({
      behavior: 'allow' as const,
      updatedInput,
    })
    this.pendingRequests.delete(requestId)
    return sessionId
  }

  /**
   * 获取当前所有待处理的 AskUser 请求（用于渲染进程重载后恢复状态）
   */
  getPendingRequests(): AskUserRequest[] {
    return [...this.pendingRequests.values()].map((p) => p.request)
  }

  /**
   * 清除指定会话的所有待处理 AskUser 请求
   */
  clearSessionPending(sessionId: string): void {
    for (const [requestId, pending] of this.pendingRequests) {
      if (pending.request.sessionId === sessionId) {
        if (pending.timeoutId) clearTimeout(pending.timeoutId)
        pending.resolve({ behavior: 'deny', message: '会话已结束' })
        this.pendingRequests.delete(requestId)
      }
    }
  }

  /**
   * 从工具输入中解析问题列表
   *
   * SDK AskUserQuestion 工具输入格式：
   * { questions: [{ question, header, options: [{ label, description, preview }], multiSelect }] }
   */
  private parseQuestions(input: Record<string, unknown>): AskUserQuestion[] {
    const rawQuestions = input.questions
    if (!Array.isArray(rawQuestions)) return []

    return rawQuestions.map((q: unknown): AskUserQuestion => {
      const raw = q as Record<string, unknown>
      const options = Array.isArray(raw.options)
        ? (raw.options as Array<Record<string, unknown>>).map((o): AskUserQuestionOption => ({
            label: typeof o.label === 'string' ? o.label : '',
            description: typeof o.description === 'string' ? o.description : undefined,
            preview: typeof o.preview === 'string' ? o.preview.slice(0, 10_000) : undefined,
          }))
        : []

      return {
        question: typeof raw.question === 'string' ? raw.question : '',
        header: typeof raw.header === 'string' ? raw.header : undefined,
        options,
        multiSelect: raw.multiSelect === true,
      }
    })
  }
}

/** 全局 AskUser 服务实例 */
export const askUserService = new AgentAskUserService()
