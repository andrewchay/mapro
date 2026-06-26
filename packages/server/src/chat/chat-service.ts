/**
 * 阶段 A 最小 Chat 服务
 *
 * 仅支持单一 Provider 的文本流式对话，不处理：
 * - 附件 / 图片
 * - 工具调用
 * - 标题生成
 * - 消息持久化
 *
 * 事件通过 EventSink 推送到客户端。
 */

import { getAdapter, streamSSE } from '@ma-proma/core'
import type { StreamEvent } from '@ma-proma/core'
import type { ChatMessage, ProviderType } from '@ma-proma/shared'
import type { RendererTransport } from '../transport/types.ts'
import type { ChatProviderConfig, ChatSendInput, ChatStreamEvent } from './types.ts'

export class ChatService {
  private config: ChatProviderConfig

  constructor(config: ChatProviderConfig) {
    this.config = config
  }

  async sendMessage(input: ChatSendInput, transport: RendererTransport, signal?: AbortSignal): Promise<void> {
    const adapter = getAdapter(this.config.provider as ProviderType)

    const request = adapter.buildStreamRequest({
      baseUrl: this.config.baseUrl,
      apiKey: this.config.apiKey,
      modelId: this.config.modelId,
      history: input.messages,
      userMessage: input.userMessage,
      systemMessage: input.systemMessage,
      attachments: [],
      readImageAttachments: () => [],
      thinkingEnabled: input.thinkingEnabled,
    })

    const sendEvent = (event: ChatStreamEvent) => {
      transport.send('chat-stream-event', event)
    }

    try {
      const result = await streamSSE({
        request,
        adapter,
        signal,
        onEvent: (event: StreamEvent) => {
          if (event.type === 'chunk') {
            sendEvent({ type: 'chunk', delta: event.delta })
          } else if (event.type === 'reasoning') {
            sendEvent({ type: 'reasoning', delta: event.delta })
          }
        },
      })

      sendEvent({ type: 'done', content: result.content, reasoning: result.reasoning })
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '流式请求失败'
      console.error('[ChatService] 流式请求失败:', error)
      sendEvent({ type: 'error', error: errorMsg })
    }
  }
}

/**
 * 简单的内存消息历史管理（阶段 A 临时用）
 */
export class InMemoryChatHistory {
  private messages: ChatMessage[] = []

  add(role: ChatMessage['role'], content: string): void {
    this.messages.push({ role, content, id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, createdAt: Date.now() })
  }

  getMessages(): ChatMessage[] {
    return this.messages
  }

  clear(): void {
    this.messages = []
  }
}
