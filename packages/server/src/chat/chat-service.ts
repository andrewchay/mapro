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
import type { StreamEvent, ImageAttachmentData } from '@ma-proma/core'
import type { ChatMessage, ProviderType, FileAttachment } from '@ma-proma/shared'
import type { RendererTransport } from '../transport/types.ts'
import type { ChatProviderConfig, ChatSendInput, ChatStreamEvent } from './types.ts'
import { AttachmentService } from '../files/attachment-service.ts'
import type { FileProvider } from '../files/types.ts'
import type { AppContext } from '../context/types.ts'

/** 支持的图片 MIME 类型 */
const IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
])

function isImageAttachment(mediaType: string): boolean {
  return IMAGE_MIME_TYPES.has(mediaType)
}

export interface ChatServiceDeps {
  context: AppContext
  fileProvider: FileProvider
}

export class ChatService {
  private config: ChatProviderConfig
  private attachmentService: AttachmentService

  constructor(config: ChatProviderConfig, deps: ChatServiceDeps) {
    this.config = config
    this.attachmentService = new AttachmentService(deps.context, deps.fileProvider)
  }

  async sendMessage(input: ChatSendInput, transport: RendererTransport, signal?: AbortSignal): Promise<void> {
    const adapter = getAdapter(this.config.provider as ProviderType)

    const readImageAttachments = (attachments?: FileAttachment[]): ImageAttachmentData[] => {
      if (!attachments || attachments.length === 0) return []
      const imageAttachments = attachments.filter((a) => isImageAttachment(a.mediaType))
      return imageAttachments.map((a) => {
        const parts = a.localPath.split('/')
        const fileId = parts[parts.length - 1]
        const id = parts[parts.length - 2]
        const scope = parts[parts.length - 3]
        if (!scope || !id || !fileId) {
          console.warn(`[ChatService] 附件路径格式异常，跳过读取: ${a.localPath}`)
          return { mediaType: a.mediaType, data: '' }
        }
        try {
          const data = this.attachmentService.readAsBase64Sync(scope, id, fileId)
          return { mediaType: a.mediaType, data }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          console.warn(`[ChatService] 读取图片附件失败: ${a.localPath}`, message)
          return { mediaType: a.mediaType, data: '' }
        }
      })
    }

    const request = adapter.buildStreamRequest({
      baseUrl: this.config.baseUrl,
      apiKey: this.config.apiKey,
      modelId: this.config.modelId,
      history: input.messages,
      userMessage: input.userMessage,
      systemMessage: input.systemMessage,
      attachments: input.attachments,
      readImageAttachments,
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
