/**
 * WebSocket 事件通道
 *
 * 阶段 A 仅支持 Chat 流式消息：
 * - 客户端发送 { type: 'chat', payload: { conversationId, messages, userMessage, systemMessage, thinkingEnabled } }
 * - 服务端通过 { type: 'chat-stream-event', event } 推送流式事件
 */

import type { WebSocket } from 'ws'
import type { ChatSendInput, ChatStreamEvent, EventSink } from '@ma-proma/server'
import { ChatService } from '@ma-proma/server'
import type { ChatProviderConfig } from '@ma-proma/server'

export interface WebSocketMessage {
  type: string
  payload: unknown
}

export function createChatEventSink(ws: WebSocket): EventSink {
  return {
    send: (channel: string, data: unknown) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: channel, data }))
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
      const eventSink = createChatEventSink(ws)
      chatService.sendMessage(input, eventSink).catch((error) => {
        console.error('[WebSocket] Chat 处理失败:', error)
        eventSink.send('chat-stream-event', { type: 'error', error: '处理失败' } satisfies ChatStreamEvent)
      })
      return
    }

    ws.send(JSON.stringify({ type: 'error', data: `未知消息类型: ${message.type}` }))
  }
}
