/**
 * WebSocket handler 单元测试
 *
 * 验证消息路由、Chat/Agent 未配置降级、以及 Agent 响应方法转发。
 */

import { describe, test, expect, mock } from 'bun:test'
import type { WebSocket } from 'ws'
import { ChatService } from '@ma-proma/server'
import { createWebSocketHandler, createWebSocketTransport } from './index.ts'
import type { AgentOrchestrator } from '../agent/agent-orchestrator.ts'

const mockDeps = {
  context: { getConfigDir: () => '', getResourcesPath: () => '', isPackaged: () => false },
  fileProvider: { readFileAsBase64: () => Promise.resolve('') },
} as never

class MockWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  CONNECTING = MockWebSocket.CONNECTING
  OPEN = MockWebSocket.OPEN
  CLOSING = MockWebSocket.CLOSING
  CLOSED = MockWebSocket.CLOSED

  readyState = MockWebSocket.OPEN
  sentMessages: string[] = []

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    this.sentMessages.push(String(data))
  }
}

function createMockOrchestrator(): AgentOrchestrator {
  return {
    attachTransport: mock(() => () => {}),
    handleSend: mock(() => Promise.resolve()),
    handleStop: mock(() => {}),
    respondPermission: mock(() => {}),
    respondAskUser: mock(() => {}),
    respondExitPlanMode: mock(() => {}),
  } as unknown as AgentOrchestrator
}

describe('createWebSocketTransport', () => {
  test('OPEN 状态下发送 JSON 消息', () => {
    const ws = new MockWebSocket()
    const transport = createWebSocketTransport(ws as unknown as WebSocket)
    transport.send('test:channel', { foo: 'bar' })

    expect(ws.sentMessages.length).toBe(1)
    expect(JSON.parse(ws.sentMessages[0]!)).toEqual({
      channel: 'test:channel',
      data: { foo: 'bar' },
    })
  })

  test('非 OPEN 状态跳过发送', () => {
    const ws = new MockWebSocket()
    ws.readyState = MockWebSocket.CLOSED
    const transport = createWebSocketTransport(ws as unknown as WebSocket)
    transport.send('test:channel', { foo: 'bar' })

    expect(ws.sentMessages.length).toBe(0)
  })
})

describe('createWebSocketHandler', () => {
  test('JSON 解析失败返回消息格式错误', () => {
    const { handleMessage } = createWebSocketHandler(null, undefined, mockDeps)
    const ws = new MockWebSocket()
    handleMessage(ws as unknown as WebSocket, 'not-json', undefined)

    expect(ws.sentMessages.length).toBe(1)
    const msg = JSON.parse(ws.sentMessages[0]!)
    expect(msg.type).toBe('error')
    expect(msg.data).toContain('消息格式错误')
  })

  test('chat 未配置返回错误', () => {
    const { handleMessage } = createWebSocketHandler(null, undefined, mockDeps)
    const ws = new MockWebSocket()
    handleMessage(ws as unknown as WebSocket, JSON.stringify({ type: 'chat', payload: { message: 'hi' } }), undefined)

    const msg = JSON.parse(ws.sentMessages[0]!)
    expect(msg.channel).toBe('chat-stream-event')
    expect(msg.data.type).toBe('error')
    expect(msg.data.error).toContain('Chat 未配置')
  })

  test('chat 已配置调用 ChatService.sendMessage', () => {
    const sendMessageMock = mock(() => Promise.resolve())
    const originalSendMessage = ChatService.prototype.sendMessage
    ChatService.prototype.sendMessage = sendMessageMock

    try {
      const { handleMessage } = createWebSocketHandler({ provider: 'anthropic', apiKey: 'test', model: 'test' } as never, undefined, mockDeps)
      const ws = new MockWebSocket()
      handleMessage(ws as unknown as WebSocket, JSON.stringify({ type: 'chat', payload: { message: 'hi', conversationId: 'c-1' } }), undefined)

      expect(sendMessageMock).toHaveBeenCalled()
    } finally {
      ChatService.prototype.sendMessage = originalSendMessage
    }
  })

  test('agent:send 未配置返回错误', () => {
    const { handleMessage } = createWebSocketHandler(null, undefined, mockDeps)
    const ws = new MockWebSocket()
    handleMessage(ws as unknown as WebSocket, JSON.stringify({ type: 'agent:send', payload: { sessionId: 's-1', userMessage: 'hi' } }), undefined)

    const msg = JSON.parse(ws.sentMessages[0]!)
    expect(msg.type).toBe('error')
    expect(msg.data).toContain('Agent 未配置')
  })

  test('agent:send 调用 attachTransport、handleSend 并在完成时 detach', async () => {
    const orchestrator = createMockOrchestrator()
    const detachMock = mock(() => {})
    orchestrator.attachTransport = mock(() => detachMock)

    const { handleMessage } = createWebSocketHandler(null, () => orchestrator, mockDeps)
    const ws = new MockWebSocket()
    handleMessage(ws as unknown as WebSocket, JSON.stringify({ type: 'agent:send', payload: { sessionId: 's-1', userMessage: 'hi' } }), orchestrator)

    // 等待 handleSend Promise 完成
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(orchestrator.attachTransport).toHaveBeenCalled()
    expect(orchestrator.handleSend).toHaveBeenCalledWith('s-1', 'hi')
    expect(detachMock).toHaveBeenCalled()
  })

  test('agent:stop 调用 orchestrator.handleStop', () => {
    const orchestrator = createMockOrchestrator()
    const { handleMessage } = createWebSocketHandler(null, () => orchestrator, mockDeps)
    const ws = new MockWebSocket()
    handleMessage(ws as unknown as WebSocket, JSON.stringify({ type: 'agent:stop', payload: { sessionId: 's-1' } }), orchestrator)

    expect(orchestrator.handleStop).toHaveBeenCalledWith('s-1')
  })

  test('agent:permission:respond 调用 orchestrator.respondPermission', () => {
    const orchestrator = createMockOrchestrator()
    const { handleMessage } = createWebSocketHandler(null, () => orchestrator, mockDeps)
    const ws = new MockWebSocket()
    handleMessage(ws as unknown as WebSocket, JSON.stringify({
      type: 'agent:permission:respond',
      payload: { sessionId: 's-1', requestId: 'r-1', behavior: 'allow', alwaysAllow: false },
    }), orchestrator)

    expect(orchestrator.respondPermission).toHaveBeenCalledWith('s-1', {
      sessionId: 's-1',
      requestId: 'r-1',
      behavior: 'allow',
      alwaysAllow: false,
    })
  })

  test('agent:ask-user:respond 调用 orchestrator.respondAskUser', () => {
    const orchestrator = createMockOrchestrator()
    const { handleMessage } = createWebSocketHandler(null, () => orchestrator, mockDeps)
    const ws = new MockWebSocket()
    handleMessage(ws as unknown as WebSocket, JSON.stringify({
      type: 'agent:ask-user:respond',
      payload: { sessionId: 's-1', requestId: 'r-2', answers: { q1: 'a1' } },
    }), orchestrator)

    expect(orchestrator.respondAskUser).toHaveBeenCalledWith('s-1', {
      sessionId: 's-1',
      requestId: 'r-2',
      answers: { q1: 'a1' },
    })
  })

  test('agent:exit-plan-mode:respond 调用 orchestrator.respondExitPlanMode', () => {
    const orchestrator = createMockOrchestrator()
    const { handleMessage } = createWebSocketHandler(null, () => orchestrator, mockDeps)
    const ws = new MockWebSocket()
    handleMessage(ws as unknown as WebSocket, JSON.stringify({
      type: 'agent:exit-plan-mode:respond',
      payload: { sessionId: 's-1', requestId: 'r-3', action: 'approve_auto' },
    }), orchestrator)

    expect(orchestrator.respondExitPlanMode).toHaveBeenCalledWith('s-1', {
      sessionId: 's-1',
      requestId: 'r-3',
      action: 'approve_auto',
    })
  })

  test('未知消息类型返回错误', () => {
    const { handleMessage } = createWebSocketHandler(null, undefined, mockDeps)
    const ws = new MockWebSocket()
    handleMessage(ws as unknown as WebSocket, JSON.stringify({ type: 'unknown', payload: {} }), undefined)

    const msg = JSON.parse(ws.sentMessages[0]!)
    expect(msg.type).toBe('error')
    expect(msg.data).toContain('未知消息类型')
  })

  test('ws 关闭时调用未完成 agent:send 的 detach 清理 transport', async () => {
    const orchestrator = createMockOrchestrator()
    const detachMock = mock(() => {})
    // 模拟 handleSend 长时间不结束，detach 不会通过 finally 调用
    orchestrator.attachTransport = mock(() => detachMock)
    orchestrator.handleSend = mock(() => new Promise<void>(() => {}))

    const { handleMessage, handleClose } = createWebSocketHandler(null, () => orchestrator, mockDeps)
    const ws = new MockWebSocket()
    handleMessage(ws as unknown as WebSocket, JSON.stringify({ type: 'agent:send', payload: { sessionId: 's-1', userMessage: 'hi' } }), orchestrator)

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(detachMock).not.toHaveBeenCalled()

    handleClose(ws as unknown as WebSocket)
    expect(detachMock).toHaveBeenCalled()
  })
})
