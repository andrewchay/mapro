/**
 * OpenAI 兼容供应商适配器
 *
 * 实现 OpenAI Chat Completions API 的消息转换、请求构建和 SSE 解析。
 * 同时适用于 OpenAI 和自定义 OpenAI 兼容 API。
 * 特点：
 * - 角色：system / user / assistant / tool
 * - 图片格式：{ type: 'image_url', image_url: { url: 'data:mime;base64,...' } }
 * - SSE 解析：choices[0].delta.content + reasoning_content + tool_calls
 * - 认证：Authorization: Bearer
 */

import type {
  ProviderAdapter,
  ProviderRequest,
  StreamRequestInput,
  StreamEvent,
  TitleRequestInput,
  ImageAttachmentData,
  ToolDefinition,
  ContinuationMessage,
} from './types.ts'
import { normalizeBaseUrl } from './url-utils.ts'
import { AGENT_PROVIDER_RUNTIME_CAPABILITIES } from '@ma-proma/shared'

/** 已知支持 stream_options.include_usage 的供应商 */
const STREAM_USAGE_SUPPORTED_PROVIDERS = new Set(['openai', 'deepseek'])

/** 判断供应商是否支持流式 usage 统计 */
function supportsStreamUsage(providerType?: string): boolean {
  return !!providerType && STREAM_USAGE_SUPPORTED_PROVIDERS.has(providerType)
}

/**
 * 判断供应商是否支持图片输入
 *
 * 复用能力矩阵（DeepSeek / Kimi-Coding 等 OpenAI 兼容端点不支持图片，
 * 发送 image_url 内容块会被 400 拒绝：unknown variant `image_url`）；
 * 未知供应商默认允许，保持原行为。
 */
function supportsImageInput(providerType?: string): boolean {
  if (!providerType) return true
  const caps =
    AGENT_PROVIDER_RUNTIME_CAPABILITIES[providerType as keyof typeof AGENT_PROVIDER_RUNTIME_CAPABILITIES]
  return caps?.supportsImages ?? true
}

// ===== OpenAI 特有类型 =====

/** OpenAI 内容块 */
interface OpenAIContentBlock {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string }
}

/** OpenAI tool_call 格式 */
interface OpenAIToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/** OpenAI 消息格式（扩展支持 tool role） */
interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | OpenAIContentBlock[] | null
  reasoning_content?: string
  tool_calls?: OpenAIToolCall[]
  tool_call_id?: string
}

/** OpenAI SSE 用量详情 */
interface OpenAIChunkUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
  /** DeepSeek 等扩展字段 */
  prompt_cache_hit_tokens?: number
  prompt_cache_miss_tokens?: number
}

/** OpenAI SSE 数据块 */
interface OpenAIChunkData {
  choices?: Array<{
    delta?: {
      content?: string
      reasoning_content?: string
      tool_calls?: Array<{
        index?: number
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
  usage?: OpenAIChunkUsage
}

/** OpenAI 标题响应 */
interface OpenAITitleResponse {
  choices?: Array<{ message?: { content?: string } }>
}

// ===== 消息转换 =====

/**
 * 将图片附件转换为 OpenAI 格式的内容块
 */
function buildImageBlocks(imageData: ImageAttachmentData[]): OpenAIContentBlock[] {
  return imageData.map((img) => ({
    type: 'image_url' as const,
    image_url: { url: `data:${img.mediaType};base64,${img.data}` },
  }))
}

/**
 * 构建包含图片和文本的消息内容
 *
 * 供应商不支持图片输入时，把图片降级为文本占位（图片不进请求体），
 * 避免 OpenAI 兼容端点 400：unknown variant `image_url`, expected `text`。
 */
function buildMessageContent(
  text: string,
  imageData: ImageAttachmentData[],
  providerType?: string,
): string | OpenAIContentBlock[] {
  if (imageData.length === 0) return text

  if (!supportsImageInput(providerType)) {
    const placeholder = `[附 ${imageData.length} 张图片（当前模型不支持图片输入，未读取）]`
    return text ? `${text} ${placeholder}` : placeholder
  }

  const content: OpenAIContentBlock[] = buildImageBlocks(imageData)
  if (text) {
    content.push({ type: 'text', text })
  }
  return content
}

/**
 * 将统一消息历史转换为 OpenAI 格式
 *
 * OpenAI 是唯一支持 system 角色消息的 provider。
 * 包含历史消息附件的处理。
 */
function toOpenAIMessages(input: StreamRequestInput): OpenAIMessage[] {
  const { history, userMessage, systemMessage, attachments, readImageAttachments } = input
  const messages: OpenAIMessage[] = []

  // System 消息作为独立 role
  if (systemMessage) {
    messages.push({ role: 'system', content: systemMessage })
  }

  // 历史消息
  for (const msg of history) {
    if (msg.role === 'system') continue

    const role = msg.role === 'assistant' ? 'assistant' as const : 'user' as const

    // 历史用户消息的附件也需要转换为多模态内容
    if (msg.role === 'user' && msg.attachments && msg.attachments.length > 0) {
      const historyImages = readImageAttachments(msg.attachments)
      messages.push({ role, content: buildMessageContent(msg.content, historyImages, input.providerType) })
    } else if (msg.role === 'assistant' && msg.reasoning) {
      messages.push({ role, content: msg.content, reasoning_content: msg.reasoning })
    } else {
      messages.push({ role, content: msg.content })
    }
  }

  // 当前用户消息
  const currentImages = readImageAttachments(attachments)
  messages.push({
    role: 'user',
    content: buildMessageContent(userMessage, currentImages, input.providerType),
  })

  return messages
}

/**
 * 将工具定义转换为 OpenAI 格式
 */
function toOpenAITools(tools: ToolDefinition[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
}

/**
 * 归一化续接消息，保证每个 assistant tool_calls 都有对应的 tool 结果
 *
 * 会话中断（/stop、abort）、错误重试等场景下，可能残留"悬空"的 tool_calls
 * （模型已发出调用但结果未写入历史）。OpenAI 校验要求每个 tool_call_id 都
 * 必须有返回值，否则 400 拒绝（"every tool_call_id must have a corresponding
 * tool message"）。这里在请求前做兜底：剔除孤立的 tool_calls；消息因此
 * 只剩 tool_calls 而无文本内容时整条移除，确保最后一条不是待响应的 tool_calls。
 */
function normalizeContinuationMessages(continuationMessages: ContinuationMessage[]): ContinuationMessage[] {
  const callIds = new Set<string>()
  const resultIds = new Set<string>()
  for (const contMsg of continuationMessages) {
    if (contMsg.role === 'assistant') {
      for (const tc of contMsg.toolCalls) callIds.add(tc.id)
    } else if (contMsg.role === 'tool') {
      for (const result of contMsg.results) resultIds.add(result.toolCallId)
    }
  }

  const orphanCallIds = new Set([...callIds].filter((id) => !resultIds.has(id)))
  if (orphanCallIds.size === 0) return continuationMessages

  const normalized: ContinuationMessage[] = []
  for (const contMsg of continuationMessages) {
    if (contMsg.role !== 'assistant') {
      normalized.push(contMsg)
      continue
    }
    const keptCalls = contMsg.toolCalls.filter((tc) => !orphanCallIds.has(tc.id))
    if (keptCalls.length === contMsg.toolCalls.length) {
      normalized.push(contMsg)
      continue
    }
    // 剔除孤立 tool_calls 后，消息若无文本内容则整条移除（避免发送空 assistant 消息）
    if (!contMsg.content && !contMsg.reasoning && !contMsg.thinkingBlocks?.length && keptCalls.length === 0) {
      continue
    }
    normalized.push({ ...contMsg, toolCalls: keptCalls })
  }
  return normalized
}

/**
 * 将续接消息追加到 OpenAI 消息列表
 */
function appendContinuationMessages(
  messages: OpenAIMessage[],
  continuationMessages: ContinuationMessage[],
  providerType?: string,
): void {
  for (const contMsg of normalizeContinuationMessages(continuationMessages)) {
    if (contMsg.role === 'assistant') {
      const toolCalls = contMsg.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      }))
      messages.push({
        role: 'assistant',
        content: contMsg.content || null,
        // 孤立 tool_calls 剔除后可能为空，空数组会让部分端点报 schema 错误，需省略字段
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      })
    } else if (contMsg.role === 'tool') {
      for (const result of contMsg.results) {
        messages.push({
          role: 'tool',
          content: result.content,
          tool_call_id: result.toolCallId,
        })
        // Chat Completions 的 tool 消息不支持图片内容块；紧随 tool_result 追加一条
        // user 图像消息，确保模型能在下一轮看到 Computer Use/Web Bridge 截图。
        if (result.imageData?.length) {
          messages.push({
            role: 'user',
            content: buildMessageContent('工具截图：', result.imageData, providerType),
          })
        }
      }
    }
  }
}

// ===== 适配器实现 =====

export class OpenAIAdapter implements ProviderAdapter {
  readonly providerType = 'openai' as const

  buildStreamRequest(input: StreamRequestInput): ProviderRequest {
    const url = normalizeBaseUrl(input.baseUrl)
    const messages = toOpenAIMessages(input)

    const bodyObj: Record<string, unknown> = {
      model: input.modelId,
      messages,
      stream: true,
    }

    // 仅在确认支持的供应商上请求流式 usage，避免其他 OpenAI 兼容端点报未知参数错误
    if (supportsStreamUsage(input.providerType)) {
      bodyObj.stream_options = { include_usage: true }
    }

    // 工具定义
    if (input.tools && input.tools.length > 0) {
      bodyObj.tools = toOpenAITools(input.tools)
    }

    // 工具续接消息
    if (input.continuationMessages && input.continuationMessages.length > 0) {
      appendContinuationMessages(messages, input.continuationMessages, input.providerType)
    }

    return {
      url: `${url}/chat/completions`,
      headers: {
        'Authorization': `Bearer ${input.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(bodyObj),
    }
  }

  parseSSELine(jsonLine: string): StreamEvent[] {
    try {
      const chunk = JSON.parse(jsonLine) as OpenAIChunkData
      const delta = chunk.choices?.[0]?.delta
      const events: StreamEvent[] = []

      if (delta?.content) {
        events.push({ type: 'chunk', delta: delta.content })
      }

      // DeepSeek 等供应商的推理内容
      if (delta?.reasoning_content) {
        events.push({ type: 'reasoning', delta: delta.reasoning_content })
      }

      // 工具调用
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.function?.name) {
            events.push({
              type: 'tool_call_start',
              toolCallId: tc.id || `tc_${tc.index ?? 0}`,
              toolName: tc.function.name,
            })
          }
          if (tc.function?.arguments) {
            // tc.id 仅在首个 chunk 中存在，后续 delta 不携带 id
            // 使用空字符串让 SSE reader 通过 currentToolCallId 关联
            events.push({
              type: 'tool_call_delta',
              toolCallId: tc.id || '',
              argumentsDelta: tc.function.arguments,
            })
          }
        }
      }

      // 检查 finish_reason
      const finishReason = chunk.choices?.[0]?.finish_reason
      if (finishReason === 'tool_calls') {
        events.push({ type: 'done', stopReason: 'tool_use' })
      }

      // 用量统计（stream_options.include_usage 在最后一条 chunk 返回）
      if (chunk.usage) {
        events.push({
          type: 'usage',
          usage: {
            input_tokens: chunk.usage.prompt_tokens,
            output_tokens: chunk.usage.completion_tokens,
            total_tokens: chunk.usage.total_tokens,
            cache_read_input_tokens: chunk.usage.prompt_tokens_details?.cached_tokens,
            prompt_cache_hit_tokens: chunk.usage.prompt_cache_hit_tokens,
            prompt_cache_miss_tokens: chunk.usage.prompt_cache_miss_tokens,
          },
        })
      }

      return events
    } catch {
      return []
    }
  }

  buildTitleRequest(input: TitleRequestInput): ProviderRequest {
    const url = normalizeBaseUrl(input.baseUrl)

    return {
      url: `${url}/chat/completions`,
      headers: {
        'Authorization': `Bearer ${input.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: input.modelId,
        messages: [{ role: 'user', content: input.prompt }],
        max_tokens: 50,
      }),
    }
  }

  parseTitleResponse(responseBody: unknown): string | null {
    const data = responseBody as OpenAITitleResponse
    return data.choices?.[0]?.message?.content ?? null
  }
}
