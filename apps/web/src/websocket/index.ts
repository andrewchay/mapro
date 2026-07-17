/**
 * WebSocket 事件通道
 *
 * 阶段 A 支持 Chat 流式消息。
 * 阶段 B 扩展为通用 RendererTransport，用于 Agent 事件、权限请求等。
 * 阶段 C1：Agent Orchestrator 按连接用户隔离，避免会话/工作区数据串户。
 */

import type { WebSocket } from 'ws'
import type { ChatSendInput, ChatStreamEvent, RendererTransport } from '@ma-proma/server'
import { ChatService } from '@ma-proma/server'
import type { ChatProviderConfig } from '@ma-proma/server'
import type { AppContext, FileProvider, UserContext } from '@ma-proma/server'
import type { PermissionResponse, AskUserResponse, ExitPlanModeResponse } from '@ma-proma/shared'
import type { AgentOrchestrator } from '../agent/agent-orchestrator.ts'
import { createUserAppContext } from '../context.ts'

export interface WebSocketMessage {
  type: string
  payload: unknown
}

export function createWebSocketTransport(ws: WebSocket): RendererTransport {
  return {
    send: (channel: string, data: unknown) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ channel, data }))
      }
    },
  }
}

export interface WebSocketHandlerDeps {
  context: AppContext
  fileProvider: FileProvider
}

export type AgentOrchestratorFactory = (userContext: UserContext) => Promise<AgentOrchestrator | undefined> | AgentOrchestrator | undefined

export function createWebSocketHandler(
  chatConfig: ChatProviderConfig | null,
  getAgentOrchestrator: AgentOrchestratorFactory | undefined,
  deps: WebSocketHandlerDeps,
) {
  /** 按 WebSocket 追踪活跃的 transport detach 回调，连接关闭时统一清理 */
  const activeDetaches = new Map<WebSocket, Set<() => void>>()

  function resolveChatContext(userContext?: UserContext): AppContext {
    if (!userContext || userContext.isSystemAccount) return deps.context
    return createUserAppContext(deps.context, userContext.userId)
  }

  function trackDetach(ws: WebSocket, detach: () => void): void {
    let set = activeDetaches.get(ws)
    if (!set) {
      set = new Set()
      activeDetaches.set(ws, set)
    }
    set.add(detach)
  }

  function untrackDetach(ws: WebSocket, detach: () => void): void {
    const set = activeDetaches.get(ws)
    if (set) {
      set.delete(detach)
      if (set.size === 0) activeDetaches.delete(ws)
    }
  }

  function handleMessage(ws: WebSocket, raw: string, agentOrchestrator: AgentOrchestrator | undefined, userContext?: UserContext) {
    let message: WebSocketMessage
    try {
      message = JSON.parse(raw)
    } catch {
      ws.send(JSON.stringify({ type: 'error', data: '消息格式错误' }))
      return
    }

    if (message.type === 'chat') {
      if (!chatConfig) {
        const transport = createWebSocketTransport(ws)
        transport.send('chat-stream-event', { type: 'error', error: 'Chat 未配置：请设置 MAPRO_CHAT_PROVIDER 和 MAPRO_CHAT_API_KEY' } satisfies ChatStreamEvent)
        return
      }

      const input = message.payload as ChatSendInput
      const transport = createWebSocketTransport(ws)
      const chatContext = resolveChatContext(userContext)
      const chatService = new ChatService(chatConfig, { context: chatContext, fileProvider: deps.fileProvider })
      chatService.sendMessage(input, transport).catch((error) => {
        console.error('[WebSocket] Chat 处理失败:', error)
        transport.send('chat-stream-event', { type: 'error', error: '处理失败' } satisfies ChatStreamEvent)
      })
      return
    }

    if (message.type === 'agent:attach') {
      if (!agentOrchestrator) {
        ws.send(JSON.stringify({
          type: 'error',
          data: 'Agent 未配置：请设置 MAPRO_AGENT_API_KEY',
        }))
        return
      }

      // 断线重连后仅挂接传输层接收进行中会话的事件，不触发新的 Agent 运行
      const payload = message.payload as { sessionId: string }
      const transport = createWebSocketTransport(ws)
      const detach = agentOrchestrator.attachTransport(payload.sessionId, transport)
      trackDetach(ws, detach)
      return
    }

    if (message.type === 'agent:send') {
      if (!agentOrchestrator) {
        ws.send(JSON.stringify({
          type: 'error',
          data: 'Agent 未配置：请设置 MAPRO_AGENT_API_KEY',
        }))
        return
      }

      const payload = message.payload as { sessionId: string; userMessage: string }
      const transport = createWebSocketTransport(ws)
      const detach = agentOrchestrator.attachTransport(payload.sessionId, transport)
      trackDetach(ws, detach)

      agentOrchestrator.handleSend(payload.sessionId, payload.userMessage).catch((error) => {
        console.error('[WebSocket] Agent 处理失败:', error)
        transport.send('agent:stream:error', { sessionId: payload.sessionId, error: '处理失败' })
      }).finally(() => {
        detach()
        untrackDetach(ws, detach)
      })
      return
    }

    if (message.type === 'agent:stop') {
      if (!agentOrchestrator) {
        ws.send(JSON.stringify({ type: 'error', data: 'Agent 未配置' }))
        return
      }
      const payload = message.payload as { sessionId: string }
      agentOrchestrator.handleStop(payload.sessionId)
      return
    }

    if (message.type === 'agent:permission:respond') {
      if (!agentOrchestrator) {
        ws.send(JSON.stringify({ type: 'error', data: 'Agent 未配置' }))
        return
      }
      const payload = message.payload as PermissionResponse & { sessionId: string }
      agentOrchestrator.respondPermission(payload.sessionId, payload)
      return
    }

    if (message.type === 'agent:ask-user:respond') {
      if (!agentOrchestrator) {
        ws.send(JSON.stringify({ type: 'error', data: 'Agent 未配置' }))
        return
      }
      const payload = message.payload as AskUserResponse & { sessionId: string }
      agentOrchestrator.respondAskUser(payload.sessionId, payload)
      return
    }

    if (message.type === 'agent:exit-plan-mode:respond') {
      if (!agentOrchestrator) {
        ws.send(JSON.stringify({ type: 'error', data: 'Agent 未配置' }))
        return
      }
      const payload = message.payload as ExitPlanModeResponse & { sessionId: string }
      agentOrchestrator.respondExitPlanMode(payload.sessionId, payload)
      return
    }

    ws.send(JSON.stringify({ type: 'error', data: `未知消息类型: ${message.type}` }))
  }

  function handleClose(ws: WebSocket): void {
    const detaches = activeDetaches.get(ws)
    if (detaches) {
      for (const detach of detaches) {
        detach()
      }
      activeDetaches.delete(ws)
    }
  }

  return { handleMessage, handleClose }
}

