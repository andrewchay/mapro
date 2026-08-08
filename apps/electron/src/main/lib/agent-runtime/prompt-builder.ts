/**
 * Agent Runtime Prompt 构建器
 *
 * 构建优化缓存的 prompt：
 * 1. system prompt（稳定前缀）
 * 2. 当前工作目录等环境信息（稳定前缀）
 * 3. 历史对话（动态追加）
 * 4. 当前用户消息（最新）
 *
 * 这种布局有利于 OpenAI/DeepSeek/GLM/Kimi 的自动前缀缓存命中。
 * 工具定义通过 StreamRequestInput.tools 单独传递给 ProviderAdapter，不在 system prompt 中重复。
 */

import type { ChatMessage, SDKMessage, SDKAssistantMessage, SDKUserMessage, FileAttachment } from '@ma-proma/shared'
import type { RuntimeMessage } from './types.ts'

/** 最大回填历史消息条数 */
const MAX_HISTORY_MESSAGES = 20

/** 默认 Agent 系统提示词 */
const DEFAULT_AGENT_SYSTEM_PROMPT = `你是一个高效的编程助手，擅长通过工具调用完成代码编辑、文件操作和命令执行任务。

请遵循以下原则：
- 分析用户需求，选择合适的工具逐步完成
- 读取文件后再修改，不要凭空编辑
- 编辑文件时确保 old_string 精确唯一
- 执行 bash 命令时注意工作目录
- 完成后向用户说明修改内容`

const BROWSER_AUTOMATION_GUIDANCE = `

浏览器自动化选择：
- 对登录态页面、达人筛选、稳定元素定位、批量提取或需要页面接口的流程，优先使用 PlaywrightScrape。它会复用用户配置的 Chrome/CDP/Profile，不要自行用 Bash 拼接未受管的浏览器脚本。
- WebBridge 适合简单网页导航、读取和 CSS selector 操作；先读取快照再交互。
- 只有 WebBridge 无法取得结构化页面元素时，才使用 Computer Use；先截图，再按截图坐标及 coordinate_scale 操作。
- PlaywrightScrape、WebBridge 写操作和 Computer Use 都需要用户逐次确认；不得绕过登录、验证码、支付、发布或其他敏感确认。`

/**
 * 构建 Agent system prompt
 *
 * 将用户传入的基础提示词与环境信息合并，保持结构稳定以提升缓存命中率。
 */
export function buildAgentSystemPrompt(
  baseSystemPrompt: string | undefined,
  cwd: string,
): string {
  const customInstructions = baseSystemPrompt?.trim()
  return `${DEFAULT_AGENT_SYSTEM_PROMPT}${BROWSER_AUTOMATION_GUIDANCE}${customInstructions ? `\n\n用户自定义系统指令：\n${customInstructions}` : ''}\n\n当前工作目录：${cwd}\n你可以使用工具来完成任务。需要调用工具时，请使用函数调用格式。`
}

/**
 * 将 RuntimeMessage 转换为 ChatMessage 格式
 *
 * 阶段 1 简化处理：
 * - user / assistant 直接转换
 * - tool 结果转换为 user 角色的文本消息，包含工具返回内容
 */
export function runtimeMessagesToChatMessages(messages: RuntimeMessage[]): ChatMessage[] {
  const result: ChatMessage[] = []

  for (const msg of messages) {
    if (msg.role === 'tool') {
      // tool 结果包装为 user 消息，让模型看到工具返回
      result.push({
        id: `${msg.createdAt}-tool`,
        role: 'user',
        content: `<tool_result tool_call_id="${msg.toolCallId}">${msg.isError ? '[错误] ' : ''}${msg.content}</tool_result>`,
        createdAt: msg.createdAt,
      })
      continue
    }

    result.push({
      id: `${msg.createdAt}-${msg.role}`,
      role: msg.role,
      content: msg.content,
      createdAt: msg.createdAt,
    })
  }

  return result
}

/**
 * 将持久化的 SDKMessage 转换为 ChatMessage 历史记录
 *
 * 阶段 2 简化处理：
 * - user / assistant 消息提取文本内容
 * - tool_use / tool_result 块序列化为 XML 标签文本
 * - 仅保留最近 MAX_HISTORY_MESSAGES 条
 */
interface TextLikeBlock {
  type: 'text'
  text: string
}

interface ToolUseLikeBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

interface ToolResultLikeBlock {
  type: 'tool_result'
  tool_use_id: string
  content?: unknown
  is_error?: boolean
}

function isTextBlock(block: unknown): block is TextLikeBlock {
  return typeof block === 'object' && block !== null && (block as { type: string }).type === 'text' && 'text' in block
}

function isToolUseBlock(block: unknown): block is ToolUseLikeBlock {
  return typeof block === 'object' && block !== null && (block as { type: string }).type === 'tool_use' && 'id' in block && 'name' in block
}

function isToolResultBlock(block: unknown): block is ToolResultLikeBlock {
  return typeof block === 'object' && block !== null && (block as { type: string }).type === 'tool_result' && 'tool_use_id' in block
}

export function sdkMessagesToChatMessages(messages: SDKMessage[]): ChatMessage[] {
  // 成对裁剪：切点若落在 tool_use/tool_result 对中间（切点前是 assistant、切点是其
  // tool_result 的 user 消息），前移切点把 assistant 一并包含，避免拆散工具调用对，
  // 保证每轮 tool 结果与其调用始终成对出现在历史中。
  let start = Math.max(0, messages.length - MAX_HISTORY_MESSAGES)
  if (start > 0 && messages[start]?.type === 'user' && messages[start - 1]?.type === 'assistant') {
    start -= 1
  }
  const recent = messages.slice(start)
  const result: ChatMessage[] = []

  for (const msg of recent) {
    if (msg.type === 'assistant') {
      const assistantMsg = msg as SDKAssistantMessage
      const content = assistantMsg.message?.content
      if (!Array.isArray(content)) continue

      const parts: string[] = []
      for (const block of content) {
        if (isTextBlock(block)) {
          parts.push(block.text)
        } else if (isToolUseBlock(block)) {
          parts.push(`<tool_use id="${block.id}" name="${block.name}">${JSON.stringify(block.input)}</tool_use>`)
        }
      }

      if (parts.length > 0) {
        result.push({
          id: assistantMsg.uuid || `${assistantMsg.session_id || ''}-assistant-${Date.now()}`,
          role: 'assistant',
          content: parts.join('\n'),
          createdAt: Date.now(),
        })
      }
      continue
    }

    if (msg.type === 'user') {
      const userMsg = msg as SDKUserMessage
      const content = userMsg.message?.content
      if (!Array.isArray(content)) continue

      const parts: string[] = []
      for (const block of content) {
        if (isTextBlock(block)) {
          parts.push(block.text)
        } else if (isToolResultBlock(block)) {
          const errorPrefix = block.is_error ? '[错误] ' : ''
          const text = typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
          parts.push(`<tool_result tool_use_id="${block.tool_use_id}">${errorPrefix}${text}</tool_result>`)
        }
      }

      if (parts.length > 0) {
        const attachments = (userMsg as unknown as { _attachments?: FileAttachment[] })._attachments
        result.push({
          id: userMsg.uuid || `${userMsg.session_id || ''}-user-${Date.now()}`,
          role: 'user',
          content: parts.join('\n'),
          createdAt: Date.now(),
          attachments,
        })
      }
    }
  }

  return result
}
