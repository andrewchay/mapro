/**
 * Agent WebSocket 客户端
 *
 * 将 Agent WebSocket 相关逻辑从 web-api.ts 中抽离，避免 React 组件测试通过
 * mock.module 全局替换 web-api.ts 后，影响此处真实 WebSocket 行为的单元测试。
 */

import type { AgentStreamPayload } from '@ma-proma/shared'
import type { AgentStreamEvent } from './platform-api.ts'
import { resolveWebSocketBase } from '../lib/websocket-url.ts'
import { getAccessToken } from '../store/token-store.ts'
import { getApiToken } from './api-token.ts'

const WS_BASE = resolveWebSocketBase()

function getAuthToken(): string | null {
  return getAccessToken() ?? getApiToken() ?? null
}

function buildWebSocketUrl(base: string): string {
  const token = getAuthToken()
  if (!token) return base
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}token=${encodeURIComponent(token)}`
}

/** 按 sessionId 保存当前 Agent WebSocket，避免切换会话后响应丢失 */
const agentSockets = new Map<string, WebSocket>()

function getAgentWebSocket(sessionId: string): WebSocket {
  const ws = agentSockets.get(sessionId)
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error('Agent 连接已断开，请重新发送消息后再试')
  }
  return ws
}

function sendAgentWebSocketMessage(
  sessionId: string,
  message: { type: string; payload: Record<string, unknown> },
): void {
  const ws = getAgentWebSocket(sessionId)
  ws.send(JSON.stringify(message))
}

export function sendAgentMessage(
  sessionId: string,
  userMessage: string,
  onEvent: (event: AgentStreamEvent) => void,
): () => void {
  const ws = new WebSocket(buildWebSocketUrl(WS_BASE))
  agentSockets.set(sessionId, ws)

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'agent:send', payload: { sessionId, userMessage } }))
  }

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data)
      if (message.channel === 'agent:stream:event') {
        const payload = message.data.payload as AgentStreamPayload
        if (payload.kind === 'mapro_event') {
          onEvent({ type: 'mapro_event', event: payload.event })
        } else {
          onEvent({ type: 'payload', payload })
        }
      } else if (message.channel === 'agent:stream:complete') {
        onEvent({ type: 'complete' })
        ws.close()
      } else if (message.channel === 'agent:stream:error') {
        onEvent({ type: 'error', error: message.data.error || '未知错误' })
        ws.close()
      }
    } catch (error) {
      console.error('[webAPI] Agent WebSocket 消息解析失败:', error)
    }
  }

  ws.onerror = (error) => {
    console.error('[webAPI] Agent WebSocket 错误:', error)
    onEvent({ type: 'error', error: 'WebSocket 连接失败' })
  }

  ws.onclose = () => {
    if (agentSockets.get(sessionId) === ws) {
      agentSockets.delete(sessionId)
    }
  }

  return () => {
    try {
      ws.send(JSON.stringify({ type: 'agent:stop', payload: { sessionId } }))
    } catch {
      // ws 可能已关闭
    }
    agentSockets.delete(sessionId)
    ws.close()
  }
}

export function respondAgentPermission(
  sessionId: string,
  requestId: string,
  behavior: 'allow' | 'deny',
  alwaysAllow: boolean,
): void {
  sendAgentWebSocketMessage(sessionId, {
    type: 'agent:permission:respond',
    payload: { requestId, behavior, alwaysAllow },
  })
}

export function respondAgentAskUser(
  sessionId: string,
  requestId: string,
  answers: Record<string, string>,
): void {
  sendAgentWebSocketMessage(sessionId, {
    type: 'agent:ask-user:respond',
    payload: { requestId, answers },
  })
}

export function respondAgentExitPlanMode(
  sessionId: string,
  requestId: string,
  action: string,
  feedback?: string,
): void {
  sendAgentWebSocketMessage(sessionId, {
    type: 'agent:exit-plan-mode:respond',
    payload: { requestId, action, ...(feedback ? { feedback } : {}) },
  })
}

/** 测试专用：清空所有缓存的 Agent WebSocket 连接 */
export function __resetAgentSockets(): void {
  agentSockets.clear()
}
