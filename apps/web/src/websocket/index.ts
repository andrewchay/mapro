/**
 * WebSocket 事件通道
 *
 * 阶段 A 仅支持 Chat 流式消息。
 * 阶段 B 扩展为通用 RendererTransport，用于 Agent 事件、权限请求等。
 */

import type { WebSocket } from 'ws'
import type { ChatSendInput, ChatStreamEvent, RendererTransport } from '@ma-proma/server'
import { ChatService } from '@ma-proma/server'
import type { ChatProviderConfig } from '@ma-proma/server'

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

export function createWebSocketHandler(chatConfig: ChatProviderConfig | null) {
  const chatService = chatConfig ? new ChatService(chatConfig) : null

  return function handleMessage(ws: WebSocket, raw: string) {
    let message: WebSocketMessage
    try {
      message = JSON.parse(raw)
    } catch {
      ws.send(JSON.stringify({ type: 'error', data: '消息格式错误' }))
      return
    }

    if (message.type === 'chat') {
      if (!chatService) {
        ws.send(JSON.stringify({
          type: 'chat-stream-event',
          data: { type: 'error', error: 'Chat 未配置：请设置 MAPRO_CHAT_PROVIDER 和 MAPRO_CHAT_API_KEY' } satisfies ChatStreamEvent,
        }))
        return
      }

      const input = message.payload as ChatSendInput
      const transport = createWebSocketTransport(ws)
      chatService.sendMessage(input, transport).catch((error) => {
        console.error('[WebSocket] Chat 处理失败:', error)
        transport.send('chat-stream-event', { type: 'error', error: '处理失败' } satisfies ChatStreamEvent)
      })
      return
    }

    ws.send(JSON.stringify({ type: 'error', data: `未知消息类型: ${message.type}` }))
  }
}
