import { describe, expect, test } from 'bun:test'
import { OpenAIAdapter } from './openai-adapter'
import type { StreamRequestInput } from './types'

function buildInput(continuationMessages: StreamRequestInput['continuationMessages']): StreamRequestInput {
  return {
    providerType: 'openai',
    baseUrl: 'https://example.com/v1',
    apiKey: 'test-key',
    modelId: 'test-model',
    history: [],
    userMessage: '继续',
    systemMessage: '测试',
    readImageAttachments: () => [],
    continuationMessages,
  }
}

describe('OpenAI 续接消息归一化', () => {
  test('given 成对的 assistant tool_calls 与 tool 结果 when 构建请求 then 原样保留', () => {
    const input = buildInput([
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_1', name: 'Read', arguments: { file_path: 'a.ts' } }],
      },
      { role: 'tool', results: [{ toolCallId: 'call_1', content: '文件内容' }] },
    ])
    const request = new OpenAIAdapter().buildStreamRequest(input)
    const body = JSON.parse(request.body) as {
      messages: Array<{ role: string; content: string | null; tool_calls?: unknown; tool_call_id?: string }>
    }

    expect(body.messages.at(-2)).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [
        { id: 'call_1', type: 'function', function: { name: 'Read', arguments: '{"file_path":"a.ts"}' } },
      ],
    })
    expect(body.messages.at(-1)).toEqual({ role: 'tool', content: '文件内容', tool_call_id: 'call_1' })
  })

  test('given 悬空的 assistant tool_calls（无对应 tool 结果）when 构建请求 then 剔除孤立调用', () => {
    const input = buildInput([
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'call_1', name: 'Read', arguments: { file_path: 'a.ts' } },
          { id: 'call_2', name: 'Grep', arguments: { pattern: 'foo' } },
        ],
      },
      { role: 'tool', results: [{ toolCallId: 'call_1', content: '文件内容' }] },
    ])
    const request = new OpenAIAdapter().buildStreamRequest(input)
    const body = JSON.parse(request.body) as {
      messages: Array<{ role: string; content: string | null; tool_calls?: unknown }>
    }

    const assistant = body.messages.find((m) => m.role === 'assistant')
    expect(assistant?.tool_calls).toEqual([
      { id: 'call_1', type: 'function', function: { name: 'Read', arguments: '{"file_path":"a.ts"}' } },
    ])
  })

  test('given assistant 只剩孤立 tool_calls 且无文本 when 构建请求 then 整条消息被移除', () => {
    const input = buildInput([
      { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'Read', arguments: {} }] },
    ])
    const request = new OpenAIAdapter().buildStreamRequest(input)
    const body = JSON.parse(request.body) as { messages: Array<{ role: string }> }

    // 只剩系统提示与用户消息，无悬空 assistant tool_calls
    expect(body.messages.some((m) => m.role === 'assistant')).toBe(false)
  })

  test('given 孤立 tool_calls 但消息带文本内容 when 构建请求 then 保留文本、剔除孤立调用', () => {
    const input = buildInput([
      {
        role: 'assistant',
        content: '我先看看文件内容。',
        toolCalls: [{ id: 'call_1', name: 'Read', arguments: {} }],
      },
    ])
    const request = new OpenAIAdapter().buildStreamRequest(input)
    const body = JSON.parse(request.body) as {
      messages: Array<{ role: string; content: string | null; tool_calls?: unknown }>
    }

    const assistant = body.messages.find((m) => m.role === 'assistant')
    expect(assistant?.content).toBe('我先看看文件内容。')
    expect(assistant?.tool_calls).toBeUndefined()
  })
})
