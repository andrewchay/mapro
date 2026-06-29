/**
 * 阶段 A 最小 Chat 配置
 *
 * 通过环境变量或服务启动参数配置单一 Provider，
 * 不迁移完整的 channels.json / 渠道管理 UI。
 */

import type { ProviderType, ChatMessage, FileAttachment } from '@ma-proma/shared'

export interface ChatProviderConfig {
  provider: ProviderType
  baseUrl: string
  apiKey: string
  modelId: string
}

export interface ChatSendInput {
  conversationId: string
  messages: ChatMessage[]
  userMessage: string
  systemMessage?: string
  thinkingEnabled?: boolean
  /** 文件附件列表 */
  attachments?: FileAttachment[]
}

export interface ChatStreamEvent {
  type: 'chunk' | 'reasoning' | 'done' | 'error'
  delta?: string
  content?: string
  reasoning?: string
  error?: string
}
