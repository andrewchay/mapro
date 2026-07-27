import { describe, expect, test } from 'bun:test'
import { GoogleAdapter } from './google-adapter'
import { OpenAIAdapter } from './openai-adapter'
import type { StreamRequestInput } from './types'

const input: StreamRequestInput = {
  providerType: 'openai',
  baseUrl: 'https://example.com/v1',
  apiKey: 'test-key',
  modelId: 'test-model',
  history: [],
  userMessage: '查看截图后继续',
  systemMessage: '测试',
  readImageAttachments: () => [],
  continuationMessages: [
    { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'ComputerUseScreenshot', arguments: {} }] },
    {
      role: 'tool',
      results: [{ toolCallId: 'call_1', content: '截图已附加。', imageData: [{ mediaType: 'image/png', data: 'AQID' }] }],
    },
  ],
}

describe('工具截图续接', () => {
  test('given an OpenAI-compatible provider when a tool returns a screenshot then the next request includes an image message', () => {
    const request = new OpenAIAdapter().buildStreamRequest(input)
    const body = JSON.parse(request.body) as { messages: Array<{ role: string; content: unknown }> }

    expect(body.messages.at(-1)).toEqual({
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } },
        { type: 'text', text: '工具截图：' },
      ],
    })
  })

  test('given a Google provider when a tool returns a screenshot then the next request includes inline image data', () => {
    const request = new GoogleAdapter().buildStreamRequest({ ...input, providerType: 'google' })
    const body = JSON.parse(request.body) as { contents: Array<{ role: string; parts: unknown[] }> }

    expect(body.contents.at(-1)).toEqual({
      role: 'user',
      parts: [
        { text: '工具截图：' },
        { inline_data: { mime_type: 'image/png', data: 'AQID' } },
      ],
    })
  })
})
