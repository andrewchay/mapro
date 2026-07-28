/**
 * Agent Runtime Prompt 构建器单元测试
 */

import { describe, test, expect } from 'bun:test'
import { buildAgentSystemPrompt, sdkMessagesToChatMessages } from './prompt-builder'
import type { SDKMessage } from '@ma-proma/shared'

describe('Prompt 构建器', () => {
  test('buildAgentSystemPrompt 包含 cwd', () => {
    const prompt = buildAgentSystemPrompt(undefined, '/tmp/workspace')
    expect(prompt).toContain('/tmp/workspace')
    expect(prompt).toContain('你可以使用工具')
    expect(prompt).toContain('PlaywrightScrape')
    expect(prompt).toContain('Computer Use')
  })

  test('given custom instructions when building an agent prompt then built-in browser rules remain visible', () => {
    const prompt = buildAgentSystemPrompt('输出必须使用 JSON。', '/tmp/workspace')

    expect(prompt).toContain('你是一个高效的编程助手')
    expect(prompt).toContain('PlaywrightScrape')
    expect(prompt).toContain('用户自定义系统指令：\n输出必须使用 JSON。')
  })

  test('sdkMessagesToChatMessages 转换文本对话', () => {
    const messages: SDKMessage[] = [
      {
        type: 'user',
        message: { content: [{ type: 'text', text: '你好' }] },
        parent_tool_use_id: null,
      } as SDKMessage,
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: '有什么可以帮你？' }] },
        parent_tool_use_id: null,
      } as SDKMessage,
    ]

    const history = sdkMessagesToChatMessages(messages)

    expect(history).toHaveLength(2)
    expect(history[0]?.role).toBe('user')
    expect(history[0]?.content).toBe('你好')
    expect(history[1]?.role).toBe('assistant')
    expect(history[1]?.content).toBe('有什么可以帮你？')
  })

  test('sdkMessagesToChatMessages 序列化 tool_use/tool_result', () => {
    const messages: SDKMessage[] = [
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: '我来读取' },
            { type: 'tool_use', id: 'tc_1', name: 'Read', input: { file_path: 'note.txt' } },
          ],
        },
        parent_tool_use_id: null,
      } as SDKMessage,
      {
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tc_1', content: 'old content' }],
        },
        parent_tool_use_id: null,
      } as SDKMessage,
    ]

    const history = sdkMessagesToChatMessages(messages)

    expect(history).toHaveLength(2)
    expect(history[0]?.content).toContain('<tool_use id="tc_1" name="Read">')
    expect(history[0]?.content).toContain('file_path')
    expect(history[1]?.content).toContain('<tool_result tool_use_id="tc_1">')
    expect(history[1]?.content).toContain('old content')
  })

  test('sdkMessagesToChatMessages 只保留最近 20 条', () => {
    const messages: SDKMessage[] = Array.from({ length: 25 }, (_, i) => ({
      type: i % 2 === 0 ? 'user' : 'assistant',
      message: { content: [{ type: 'text', text: `msg ${i}` }] },
      parent_tool_use_id: null,
    } as SDKMessage))

    const history = sdkMessagesToChatMessages(messages)

    expect(history).toHaveLength(20)
    expect(history[0]?.content).toBe('msg 5')
    expect(history[19]?.content).toBe('msg 24')
  })
})
