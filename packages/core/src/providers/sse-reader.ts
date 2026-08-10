/**
 * 共享 SSE 流式读取器
 *
 * 封装所有供应商通用的 SSE 解析逻辑：
 * - fetch 调用 + 错误检查
 * - ReadableStream reader + TextDecoder 管理
 * - 逐行 buffer 分割 + data: 前缀检测 + [DONE] 哨兵处理
 * - 通过 adapter.parseSSELine() 委托供应商特定解析
 * - 通过回调分发事件
 * - 累积工具调用信息（tool use 支持）
 */

import type { ProviderAdapter, ProviderRequest, StreamEventCallback, StreamUsageEvent, ThinkingBlock, ToolCall } from './types.ts'

// ===== 流式请求 =====

/** streamSSE 的输入选项 */
export interface StreamSSEOptions {
  /** 构建好的 HTTP 请求配置 */
  request: ProviderRequest
  /** 供应商适配器（用于解析 SSE 行） */
  adapter: ProviderAdapter
  /** 事件回调 */
  onEvent: StreamEventCallback
  /** AbortSignal 用于取消请求 */
  signal?: AbortSignal
  /** 自定义 fetch 函数（代理等场景下由调用方注入） */
  fetchFn?: typeof globalThis.fetch
  /**
   * 连接阶段超时（毫秒），默认 30000
   *
   * fetch 发出后到拿到响应头的最长等待。部分上游会长时间不返回响应头，
   * 无此超时轮次会永久挂起。
   */
  connectTimeoutMs?: number
  /**
   * 流读空闲超时（毫秒），默认 90000；<= 0 表示禁用
   *
   * 两次收到数据 chunk 之间的最长间隔。上游 socket 保持打开但不再发数据的
   * "静默挂起"场景下，超时主动断开并抛出含 ETIMEDOUT 的错误（可被
   * error-patterns.ts 的 TRANSIENT_NETWORK_PATTERN 识别为瞬时错误，触发 withRetry 重试），
   * 避免轮次永久卡死、并发守卫失效导致后续消息"收到不执行"。
   */
  stallTimeoutMs?: number
}

/** 默认连接超时：30 秒 */
const DEFAULT_CONNECT_TIMEOUT_MS = 30_000
/** 默认流读空闲超时：90 秒（容忍 reasoning 模型的长思考间隔） */
const DEFAULT_STALL_TIMEOUT_MS = 90_000

/** 合并多个 AbortSignal（优先原生 AbortSignal.any，缺失时手动转发） */
function combineAbortSignals(signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const active = signals.filter((s): s is AbortSignal => !!s)
  if (active.length === 0) return undefined
  if (active.length === 1) return active[0]
  const anyFn = (AbortSignal as { any?: (list: AbortSignal[]) => AbortSignal }).any
  if (typeof anyFn === 'function') return anyFn(active)
  const controller = new AbortController()
  for (const s of active) {
    if (s.aborted) {
      controller.abort(s.reason)
      break
    }
    s.addEventListener('abort', () => controller.abort(s.reason), { once: true })
  }
  return controller.signal
}

/** streamSSE 的返回结果 */
export interface StreamSSEResult {
  /** 累积的完整文本内容 */
  content: string
  /** 累积的推理内容（扁平文本，所有思考块拼接） */
  reasoning: string
  /**
   * 结构化的思考块（每块含 thinking 文本和可选 signature）
   *
   * 思考+工具模式下必须原样（含签名）回传给 Anthropic 协议家族服务端：
   * 签名缺失时会被 DeepSeek v4 等服务端以 "content[].thinking must be passed back" 拒绝。
   */
  thinkingBlocks: ThinkingBlock[]
  /** 本轮返回的工具调用列表 */
  toolCalls: ToolCall[]
  /** 停止原因（'tool_use' 表示需要执行工具后继续） */
  stopReason?: string
  /** 本轮流式请求的用量统计（取决于供应商协议，可能缺失） */
  usage?: StreamUsageEvent['usage']
}

/**
 * 执行流式 SSE 请求
 *
 * 通用流程：
 * 1. 发起 fetch POST 请求
 * 2. 检查响应状态
 * 3. 获取 ReadableStream reader，逐 chunk 读取
 * 4. 按换行分行，过滤 "data: " 前缀和 "[DONE]" 哨兵
 * 5. 调用 adapter.parseSSELine() 解析供应商特定 JSON
 * 6. 累积 content/reasoning/toolCalls，通过 onEvent 回调分发
 * 7. 返回完整内容
 */
export async function streamSSE(options: StreamSSEOptions): Promise<StreamSSEResult> {
  const {
    request,
    adapter,
    onEvent,
    signal,
    fetchFn = fetch,
    connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
    stallTimeoutMs = DEFAULT_STALL_TIMEOUT_MS,
  } = options

  // 1. 发起请求（支持通过 fetchFn 注入代理）
  // 连接阶段加超时：超时后主动 abort 并抛出 ETIMEDOUT 错误（可被识别为瞬时错误触发重试）。
  // 注意不能把 AbortSignal.timeout 直接传给 fetch——它会在整个流生命周期内生效，
  // 会把正常的长时间流式响应也掐断；因此只在等待响应头的阶段 race，拿到响应后清除定时器。
  const connectController = new AbortController()
  const combinedSignal = combineAbortSignals([signal, connectController.signal])
  let connectTimer: ReturnType<typeof setTimeout> | undefined
  const fetchPromise = fetchFn(request.url, {
    method: 'POST',
    headers: request.headers,
    body: request.body,
    signal: combinedSignal,
  })
  const response = await (connectTimeoutMs > 0
    ? Promise.race([
        fetchPromise,
        new Promise<never>((_, reject) => {
          connectTimer = setTimeout(() => {
            connectController.abort()
            reject(new Error(`ETIMEDOUT: SSE 连接超时（${Math.round(connectTimeoutMs / 1000)} 秒未收到响应头）`))
          }, connectTimeoutMs)
        }),
      ]).finally(() => clearTimeout(connectTimer))
    : fetchPromise)

  // 2. 错误检查
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`${adapter.providerType} API 错误 (${response.status}): ${text.slice(0, 300)}`)
  }

  if (!response.body) {
    throw new Error('响应体为空')
  }

  // 3. 读取流
  let content = ''
  let reasoning = ''
  let stopReason: string | undefined
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  // 工具调用追踪
  const pendingToolCalls = new Map<string, { id: string; name: string; args: string; metadata?: Record<string, unknown> }>()
  let currentToolCallId: string | undefined

  // 思考块追踪（Anthropic 协议：每个 thinking 块由多个 thinking_delta + signature_delta 组成）
  const thinkingBlocks: ThinkingBlock[] = []
  let currentThinking: ThinkingBlock | null = null

  // 用量统计追踪
  let lastUsage: StreamUsageEvent['usage'] | undefined

  // 流读空闲超时：距上一次收到【有效 SSE data 行】超过阈值即判定上游静默挂起，抛瞬时错误供上层重试。
  // 注意不能以「原始 chunk」计时——DeepSeek 等上游可能持续发心跳/注释行（": ping"/空行）或极慢的思考增量，
  // 这些会不断重置「距上次 chunk」的计时器，导致轮次无限挂起（消息“收到不执行”）。
  // 因此只认真正的 data: 事件，心跳类内容不重置 deadline。
  type ReadResult = Awaited<ReturnType<typeof reader.read>>
  // 有效数据到达时间戳（毫秒）；初始为响应体就绪时刻
  let lastMeaningfulAt = Date.now()
  const readWithStallTimeout = (): Promise<ReadResult> => {
    if (stallTimeoutMs <= 0) return reader.read()
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const checkDeadline = (): void => {
        const elapsed = Date.now() - lastMeaningfulAt
        if (elapsed >= stallTimeoutMs) {
          reject(
            new Error(
              `ETIMEDOUT: SSE 流空闲超时（${Math.round(stallTimeoutMs / 1000)} 秒无有效数据），主动断开以便重试`,
            ),
          )
          return
        }
        timer = setTimeout(checkDeadline, Math.min(stallTimeoutMs - elapsed, 1000))
      }
      checkDeadline()
      reader.read().then(
        (result) => {
          if (timer) clearTimeout(timer)
          resolve(result)
        },
        (error) => {
          if (timer) clearTimeout(timer)
          reject(error)
        },
      )
    })
  }

  try {
    while (true) {
      const { done, value } = await readWithStallTimeout()
      if (done) break

      buffer += decoder.decode(value, { stream: true }).replace(/\uFFFD/g, '')
      const lines = buffer.split('\n')
      // 保留最后一个可能不完整的行
      buffer = lines.pop() || ''

      for (const line of lines) {
        // SSE 规范：冒号后的空格是可选的，兼容 "data: {...}" 和 "data:{...}" 两种格式
        let data: string
        if (line.startsWith('data: ')) {
          data = line.slice(6).trim()
        } else if (line.startsWith('data:')) {
          data = line.slice(5).trim()
        } else {
          continue
        }
        if (data === '[DONE]' || !data) continue

        // 有效 data 事件到达，更新空闲 deadline（心跳/注释行不会走到这里）
        lastMeaningfulAt = Date.now()

        // 4. 委托给 adapter 解析供应商特定 JSON
        const events = adapter.parseSSELine(data)

        for (const event of events) {
          if (event.type === 'chunk') {
            content += event.delta
          } else if (event.type === 'reasoning') {
            reasoning += event.delta
            // 同步追加到当前思考块
            if (currentThinking) {
              currentThinking.thinking += event.delta
            } else {
              // 容错：有些 Provider 不发 content_block_start，直接发 thinking_delta
              currentThinking = { thinking: event.delta }
              thinkingBlocks.push(currentThinking)
            }
          } else if (event.type === 'reasoning_signature') {
            if (currentThinking) {
              currentThinking.signature = (currentThinking.signature ?? '') + event.signature
            } else {
              // 容错：signature_delta 出现时没有活跃思考块，自建一个
              currentThinking = { thinking: '', signature: event.signature }
              thinkingBlocks.push(currentThinking)
            }
          } else if (event.type === 'reasoning_block_start') {
            currentThinking = { thinking: '' }
            thinkingBlocks.push(currentThinking)
          } else if (event.type === 'reasoning_block_stop') {
            currentThinking = null
          } else if (event.type === 'tool_call_start') {
            currentToolCallId = event.toolCallId
            pendingToolCalls.set(event.toolCallId, {
              id: event.toolCallId,
              name: event.toolName,
              args: '',
              metadata: event.metadata,
            })
          } else if (event.type === 'tool_call_delta') {
            const tcId = event.toolCallId || currentToolCallId
            if (tcId) {
              const pending = pendingToolCalls.get(tcId)
              if (pending) {
                pending.args += event.argumentsDelta
              }
            }
          } else if (event.type === 'done' && event.stopReason) {
            stopReason = event.stopReason
          } else if (event.type === 'usage') {
            lastUsage = event.usage
          }
          onEvent(event)
        }
      }
    }
  } finally {
    // 异常/提前退出时先取消底层流，释放 undici 连接（releaseLock 不会取消响应体）
    try {
      await reader.cancel()
    } catch {
      // 流可能已关闭，忽略
    }
    reader.releaseLock()
  }

  // 将 pending 工具调用解析为最终结果
  const toolCalls: ToolCall[] = []
  for (const [, pending] of pendingToolCalls) {
    try {
      toolCalls.push({
        id: pending.id,
        name: pending.name,
        arguments: pending.args ? JSON.parse(pending.args) : {},
        metadata: pending.metadata,
      })
    } catch {
      // JSON 解析失败仍保留工具调用（空参数）
      toolCalls.push({
        id: pending.id,
        name: pending.name,
        arguments: {},
        metadata: pending.metadata,
      })
    }
  }

  // 有工具调用但无显式 stopReason 时自动推断
  if (toolCalls.length > 0 && !stopReason) {
    stopReason = 'tool_use'
  }

  onEvent({ type: 'done', stopReason })
  return { content, reasoning, thinkingBlocks, toolCalls, stopReason, usage: lastUsage }
}

// ===== 非流式标题请求 =====

/**
 * 执行非流式标题生成请求
 *
 * @param request 构建好的 HTTP 请求配置
 * @param adapter 供应商适配器（用于解析响应）
 * @returns 提取的标题文本，失败返回 null
 */
export async function fetchTitle(
  request: ProviderRequest,
  adapter: ProviderAdapter,
  fetchFn: typeof globalThis.fetch = fetch,
): Promise<string | null> {
  try {
    console.log('[fetchTitle] 发送请求:', {
      url: request.url,
      provider: adapter.providerType,
      bodyPreview: request.body.slice(0, 200),
    })

    const response = await fetchFn(request.url, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
    })

    console.log('[fetchTitle] 收到响应:', {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown')
      console.warn('[fetchTitle] 请求失败:', {
        status: response.status,
        error: errorText.slice(0, 500),
      })
      return null
    }

    const data: unknown = await response.json()
    console.log('[fetchTitle] 解析响应体:', {
      provider: adapter.providerType,
      dataPreview: JSON.stringify(data).slice(0, 500),
    })

    const title = adapter.parseTitleResponse(data)
    console.log('[fetchTitle] 解析标题结果:', { title })
    return title
  } catch (error) {
    console.error('[fetchTitle] 异常:', error)
    return null
  }
}
