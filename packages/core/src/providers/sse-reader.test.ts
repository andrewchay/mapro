/**
 * streamSSE 超时机制测试
 *
 * 覆盖两个新增防护：
 * 1. 连接超时：fetch 长时间不返回响应头时主动断开
 * 2. 流读空闲超时：上游 socket 保持打开但不再发数据（静默挂起）时主动断开
 *
 * 两类错误消息均含 ETIMEDOUT，可被 error-patterns.ts 的
 * TRANSIENT_NETWORK_PATTERN 识别为瞬时错误，触发 withRetry 重试。
 */

import { test, expect } from 'bun:test'
import { streamSSE, type StreamSSEOptions } from './sse-reader.ts'
import type { ProviderAdapter, ProviderRequest, StreamEvent } from './types.ts'

// ===== 测试辅助 =====

const TEST_REQUEST: ProviderRequest = {
  url: 'https://example.test/v1/chat/completions',
  headers: { 'Content-Type': 'application/json' },
  body: '{}',
}

/** 最小 ProviderAdapter mock：把 data 行当 chunk 事件透传 */
const mockAdapter = {
  providerType: 'openai',
  buildStreamRequest: () => TEST_REQUEST,
  parseSSELine: (jsonLine: string): StreamEvent[] => {
    try {
      const parsed = JSON.parse(jsonLine) as { delta?: string }
      return parsed.delta ? [{ type: 'chunk', delta: parsed.delta }] : []
    } catch {
      return []
    }
  },
  buildTitleRequest: () => TEST_REQUEST,
  parseTitleResponse: () => null,
} as unknown as ProviderAdapter

const noopOnEvent: StreamSSEOptions['onEvent'] = () => {}

/** 构造一个由外部控制的 ReadableStream */
function controllableStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
  })
  return { stream, controller }
}

function sseResponse(lines: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line))
      }
      controller.close()
    },
  })
  return new Response(stream, { status: 200 })
}

// ===== 正常流程回归 =====

test('正常流式响应完整返回内容', async () => {
  const fetchFn = (() =>
    Promise.resolve(sseResponse(['data: {"delta":"你好"}\n\n', 'data: {"delta":"世界"}\n\n', 'data: [DONE]\n\n']))) as unknown as typeof fetch

  const result = await streamSSE({
    request: TEST_REQUEST,
    adapter: mockAdapter,
    onEvent: noopOnEvent,
    fetchFn,
  })

  expect(result.content).toBe('你好世界')
})

// ===== 流读空闲超时 =====

test('流静默挂起时在 stallTimeoutMs 后抛出 ETIMEDOUT 错误', async () => {
  // 流先吐一个 chunk 后永久沉默（模拟 DeepSeek 静默挂起）
  const { stream, controller } = controllableStream()
  controller.enqueue(new TextEncoder().encode('data: {"delta":"前半段"}\n\n'))
  const fetchFn = (() => Promise.resolve(new Response(stream, { status: 200 }))) as unknown as typeof fetch

  const start = Date.now()
  const error = await streamSSE({
    request: TEST_REQUEST,
    adapter: mockAdapter,
    onEvent: noopOnEvent,
    fetchFn,
    stallTimeoutMs: 100,
  }).catch((e: unknown) => e)

  const elapsed = Date.now() - start
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).message).toContain('ETIMEDOUT')
  expect((error as Error).message).toContain('空闲超时')
  // 应在超时阈值附近返回（留足调度余量），而不是永久挂起
  expect(elapsed).toBeGreaterThanOrEqual(90)
  expect(elapsed).toBeLessThan(5_000)
})

test('stallTimeoutMs <= 0 时禁用空闲超时', async () => {
  // 流立即结束，即使禁用超时也能正常返回（验证禁用分支不破坏正常流程）
  const fetchFn = (() =>
    Promise.resolve(sseResponse(['data: {"delta":"ok"}\n\n', 'data: [DONE]\n\n']))) as unknown as typeof fetch

  const result = await streamSSE({
    request: TEST_REQUEST,
    adapter: mockAdapter,
    onEvent: noopOnEvent,
    fetchFn,
    stallTimeoutMs: 0,
  })

  expect(result.content).toBe('ok')
})

test('心跳/注释行不重置空闲超时（防止 keepalive 无限挂起）', async () => {
  // 上游持续发 ": ping" 注释行（每 30ms），但从不发有效 data 事件；
  // 旧实现按“距上次 chunk”计时会被无限重置；新实现只认有效 data，应仍超时。
  const { stream, controller } = controllableStream()
  const encoder = new TextEncoder()
  const pingTimer = setInterval(() => {
    try {
      controller.enqueue(encoder.encode(': ping\n\n'))
    } catch {
      /* 流已关闭 */
    }
  }, 30)
  const fetchFn = (() => Promise.resolve(new Response(stream, { status: 200 }))) as unknown as typeof fetch

  const start = Date.now()
  const error = await streamSSE({
    request: TEST_REQUEST,
    adapter: mockAdapter,
    onEvent: noopOnEvent,
    fetchFn,
    stallTimeoutMs: 100,
  }).catch((e: unknown) => e)
  clearInterval(pingTimer)

  const elapsed = Date.now() - start
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).message).toContain('ETIMEDOUT')
  expect((error as Error).message).toContain('空闲超时')
  // 尽管 ping 每 30ms 到达，仍应在有效数据空闲 100ms 左右触发
  expect(elapsed).toBeGreaterThanOrEqual(90)
  expect(elapsed).toBeLessThan(5_000)
})

test('持续有效数据会重置空闲超时（不误报）', async () => {
  // 上游每 30ms 发一条真实 data，持续 250ms 后正常 [DONE] 收尾；
  // 空闲超时 100ms 不应触发（每次有效数据都重置 deadline）。
  const { stream, controller } = controllableStream()
  const encoder = new TextEncoder()
  let i = 0
  const dataTimer = setInterval(() => {
    i += 1
    try {
      controller.enqueue(encoder.encode(`data: {"delta":"${i}"}\n\n`))
      if (i >= 6) {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      }
    } catch {
      /* 流已关闭 */
    }
  }, 30)
  const fetchFn = (() => Promise.resolve(new Response(stream, { status: 200 }))) as unknown as typeof fetch

  const result = await streamSSE({
    request: TEST_REQUEST,
    adapter: mockAdapter,
    onEvent: noopOnEvent,
    fetchFn,
    stallTimeoutMs: 100,
  })
  clearInterval(dataTimer)

  expect(result.content).toBe('123456')
})

// ===== 连接超时 =====

test('连接阶段挂起时在 connectTimeoutMs 后抛出 ETIMEDOUT 错误', async () => {
  // fetch 永不 resolve（模拟上游不返回响应头）
  const fetchFn = (() => new Promise<Response>(() => {})) as unknown as typeof fetch

  const start = Date.now()
  const error = await streamSSE({
    request: TEST_REQUEST,
    adapter: mockAdapter,
    onEvent: noopOnEvent,
    fetchFn,
    connectTimeoutMs: 100,
  }).catch((e: unknown) => e)

  const elapsed = Date.now() - start
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).message).toContain('ETIMEDOUT')
  expect((error as Error).message).toContain('连接超时')
  expect(elapsed).toBeGreaterThanOrEqual(90)
  expect(elapsed).toBeLessThan(5_000)
})

test('连接超时后主动 abort 请求', async () => {
  let observedSignal: AbortSignal | null | undefined
  const fetchFn = ((_: unknown, init?: RequestInit) => {
    observedSignal = init?.signal
    return new Promise<Response>(() => {})
  }) as unknown as typeof fetch

  await streamSSE({
    request: TEST_REQUEST,
    adapter: mockAdapter,
    onEvent: noopOnEvent,
    fetchFn,
    connectTimeoutMs: 50,
  }).catch(() => {})

  expect(observedSignal?.aborted).toBe(true)
})

// ===== 外部取消 =====

test('外部 signal 取消时正常抛错', async () => {
  const { stream, controller } = controllableStream() // 永不产出的流
  const fetchFn = ((_: unknown, init?: RequestInit) => {
    // 模拟 undici 行为：fetch signal 触发后中止响应体流
    init?.signal?.addEventListener('abort', () => {
      try {
        controller.error(new DOMException('The operation was aborted.', 'AbortError'))
      } catch {
        // 流可能已关闭，忽略
      }
    })
    return Promise.resolve(new Response(stream, { status: 200 }))
  }) as unknown as typeof fetch
  const controller2 = new AbortController()
  setTimeout(() => controller2.abort(), 50)

  const error = await streamSSE({
    request: TEST_REQUEST,
    adapter: mockAdapter,
    onEvent: noopOnEvent,
    fetchFn,
    signal: controller2.signal,
    stallTimeoutMs: 10_000, // 外部取消应先于空闲超时生效
  }).catch((e: unknown) => e)

  expect(error).toBeDefined()
  // 取消错误不应被误报为 ETIMEDOUT
  expect(String((error as Error)?.message ?? error)).not.toContain('ETIMEDOUT')
})
