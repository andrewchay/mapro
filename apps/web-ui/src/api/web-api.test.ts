/**
 * agent-websocket-client.ts 单元测试
 *
 * 验证 Agent WebSocket 按 sessionId 隔离：
 * - sendAgentMessage 将连接按 sessionId 存储
 * - respondAgentPermission / respondAgentAskUser / respondAgentExitPlanMode 发送到对应连接
 * - 连接断开后响应给出警告（不抛错）
 *
 * 注意：这些函数已从 web-api.ts 抽离到本文件，避免 React 组件测试通过 mock.module
 * 全局替换 web-api.ts 后影响此处的真实 WebSocket 行为测试。
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import {
  sendAgentMessage,
  respondAgentPermission,
  respondAgentAskUser,
  respondAgentExitPlanMode,
  __resetAgentSockets,
} from './agent-websocket-client.ts'
import { setApiToken, clearApiToken } from './api-token.ts'

class MockWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  url: string
  readyState = MockWebSocket.CONNECTING
  sentMessages: string[] = []
  onopen: (() => unknown) | null = null
  onmessage: ((data: string) => unknown) | null = null
  onclose: (() => unknown) | null = null
  onerror: (() => unknown) | null = null

  constructor(url: string | URL) {
    this.url = String(url)
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN
      this.onopen?.()
    })
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    this.sentMessages.push(String(data))
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  }
}

const originalWebSocket = globalThis.WebSocket

describe('Agent WebSocket Client', () => {
  let createdSockets: MockWebSocket[] = []

  beforeEach(() => {
    createdSockets = []
    __resetAgentSockets()
    globalThis.WebSocket = class extends MockWebSocket {
      constructor(url: string | URL) {
        super(url)
        createdSockets.push(this)
      }
    } as unknown as typeof WebSocket
  })

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket
    __resetAgentSockets()
    clearApiToken()
  })

  test('sendAgentMessage 按 sessionId 存储独立 WebSocket', async () => {
    const stopA = sendAgentMessage('session-a', 'hello', () => {})
    const stopB = sendAgentMessage('session-b', 'world', () => {})

    // 等待两个 socket 都 open
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(createdSockets.length).toBe(2)
    expect(createdSockets[0]!.url).toContain('ws://')
    expect(createdSockets[1]!.url).toContain('ws://')

    // 各自发送了 agent:send
    expect(createdSockets[0]!.sentMessages.length).toBe(1)
    expect(createdSockets[1]!.sentMessages.length).toBe(1)

    const msgA = JSON.parse(createdSockets[0]!.sentMessages[0]!)
    expect(msgA.type).toBe('agent:send')
    expect(msgA.payload.sessionId).toBe('session-a')

    const msgB = JSON.parse(createdSockets[1]!.sentMessages[0]!)
    expect(msgB.payload.sessionId).toBe('session-b')

    stopA()
    stopB()
  })

  test('respondAgentPermission 发送到对应 session 的 WebSocket', async () => {
    sendAgentMessage('session-perm', 'hello', () => {})
    await new Promise((resolve) => setTimeout(resolve, 10))

    respondAgentPermission('session-perm', 'req-1', 'allow', false)

    const socket = createdSockets[0]!
    expect(socket.sentMessages.length).toBe(2)

    const response = JSON.parse(socket.sentMessages[1]!)
    expect(response.type).toBe('agent:permission:respond')
    expect(response.payload).toEqual({ requestId: 'req-1', behavior: 'allow', alwaysAllow: false })
  })

  test('respondAgentAskUser 发送到对应 session 的 WebSocket', async () => {
    sendAgentMessage('session-ask', 'hello', () => {})
    await new Promise((resolve) => setTimeout(resolve, 10))

    respondAgentAskUser('session-ask', 'req-2', { 'q1': 'a1' })

    const response = JSON.parse(createdSockets[0]!.sentMessages[1]!)
    expect(response.type).toBe('agent:ask-user:respond')
    expect(response.payload).toEqual({ requestId: 'req-2', answers: { 'q1': 'a1' } })
  })

  test('respondAgentExitPlanMode 发送到对应 session 的 WebSocket', async () => {
    sendAgentMessage('session-plan', 'hello', () => {})
    await new Promise((resolve) => setTimeout(resolve, 10))

    respondAgentExitPlanMode('session-plan', 'req-3', 'approve_auto')

    const response = JSON.parse(createdSockets[0]!.sentMessages[1]!)
    expect(response.type).toBe('agent:exit-plan-mode:respond')
    expect(response.payload).toEqual({ requestId: 'req-3', action: 'approve_auto' })
  })

  test('连接断开后响应抛出明确错误，避免静默失败', async () => {
    sendAgentMessage('session-closed', 'hello', () => {})
    await new Promise((resolve) => setTimeout(resolve, 10))

    createdSockets[0]!.close()
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(() => respondAgentPermission('session-closed', 'req-4', 'deny', false)).toThrow(
      'Agent 连接已断开，请重新发送消息后再试',
    )
  })

  test('配置 API Token 后 WebSocket URL 携带 token query', async () => {
    setApiToken('ws-ui-token')
    sendAgentMessage('session-token', 'hello', () => {})
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(createdSockets[0]!.url).toContain('token=ws-ui-token')
  })
})
