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
  /** 重连参数：指数退避，最多 5 次 */
  const MAX_RETRIES = 5
  let ws: WebSocket | null = null
  let disposed = false // 调用方主动停止
  let settled = false // 已收到 complete/error（流正常结束）
  let retries = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  // 首次连接发送 agent:send 启动运行；断线重连只 agent:attach 接收进行中事件
  let attachOnly = false

  function connect(): void {
    ws = new WebSocket(buildWebSocketUrl(WS_BASE))
    agentSockets.set(sessionId, ws)

    ws.onopen = () => {
      retries = 0
      ws!.send(JSON.stringify(
        attachOnly
          ? { type: 'agent:attach', payload: { sessionId } }
          : { type: 'agent:send', payload: { sessionId, userMessage } },
      ))
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
          settled = true
          onEvent({ type: 'complete' })
          ws?.close()
        } else if (message.channel === 'agent:stream:error') {
          settled = true
          onEvent({ type: 'error', error: message.data.error || '未知错误' })
          ws?.close()
        }
      } catch (error) {
        console.error('[webAPI] Agent WebSocket 消息解析失败:', error)
      }
    }

    ws.onerror = (error) => {
      // 错误后会紧跟 onclose，统一在 onclose 里处理重连
      console.error('[webAPI] Agent WebSocket 错误:', error)
    }

    ws.onclose = () => {
      if (agentSockets.get(sessionId) === ws) {
        agentSockets.delete(sessionId)
      }
      if (disposed || settled) return

      // 意外断开：指数退避重连，重连后仅 attach 接收进行中的流式进度
      if (retries >= MAX_RETRIES) {
        console.error(`[webAPI] Agent WebSocket 重连 ${MAX_RETRIES} 次失败，放弃`)
        onEvent({ type: 'error', error: '连接已断开，重连失败' })
        return
      }
      attachOnly = true
      const delay = Math.min(1000 * 2 ** retries, 15_000)
      retries += 1
      console.log(`[webAPI] Agent WebSocket 意外断开，${delay}ms 后重连（第 ${retries}/${MAX_RETRIES} 次）`)
      reconnectTimer = setTimeout(() => {
        if (!disposed && !settled) connect()
      }, delay)
    }
  }

  connect()

  return () => {
    disposed = true
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    try {
      ws?.send(JSON.stringify({ type: 'agent:stop', payload: { sessionId } }))
    } catch {
      // ws 可能已关闭
    }
    agentSockets.delete(sessionId)
    ws?.close()
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
