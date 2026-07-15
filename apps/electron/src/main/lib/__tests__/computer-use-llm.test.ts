/**
 * Computer Use LLM Caller 单元测试
 *
 * 验证 caller 能正确构造多模态消息、调用 LLM 服务、解析 action。
 */

import { describe, it, expect, beforeEach, spyOn, mock } from 'bun:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Mock llm-service，避免拉入 electron safeStorage 导入链
mock.module(join(__dirname, '..', 'ma-tools', 'llm-service.ts'), () => ({
  complete: mock(async () => ({ success: false, text: '', error: 'mocked-llm' })),
  completePrompt: mock(async () => ({ success: false, text: '', error: 'mocked-llm' })),
}))

import type { LLMVisionCallParams } from '../browser-automation/computer-use-types'

interface ComputerUseLLMModule {
  createComputerUseLLMCaller: () => (params: LLMVisionCallParams) => Promise<{ thought: string; action: unknown }>
}

let moduleRef: ComputerUseLLMModule
let completeMock: ReturnType<typeof mock>

beforeEach(async () => {
  const llmModule = await import('../ma-tools/llm-service')
  completeMock = llmModule.complete as unknown as ReturnType<typeof mock>
  completeMock.mockClear()
  moduleRef = (await import('../browser-automation/computer-use-llm')) as ComputerUseLLMModule
})

describe('createComputerUseLLMCaller', () => {
  it('将截图构造为 data URL 并调用 complete', async () => {
    completeMock.mockResolvedValue({
      success: true,
      text: JSON.stringify({ thought: '点击按钮', action: { type: 'click', x: 100, y: 200 } }),
    })

    const caller = moduleRef.createComputerUseLLMCaller()
    const result = await caller({
      systemPrompt: 'system prompt',
      task: '测试任务',
      screenshotBase64: 'fake-base64',
      history: [],
    })

    expect(completeMock).toHaveBeenCalledTimes(1)
    const [messages, options] = completeMock.mock.calls[0] as [Array<{ role: string; content: unknown }>, { jsonMode?: boolean }]

    expect(messages.length).toBe(2)
    expect(messages[0]!.role).toBe('system')
    expect(messages[0]!.content).toBe('system prompt')
    expect(messages[1]!.role).toBe('user')

    const parts = messages[1]!.content as Array<{ type: string; text?: string; image_url?: { url: string } }>
    expect(Array.isArray(parts)).toBe(true)
    expect(parts[0]!.type).toBe('text')
    expect(parts[0]!.text).toContain('测试任务')
    expect(parts[1]!.type).toBe('image_url')
    expect(parts[1]!.image_url?.url).toBe('data:image/png;base64,fake-base64')

    expect(options.jsonMode).toBe(true)

    expect(result.thought).toBe('点击按钮')
    expect(result.action).toEqual({ type: 'click', x: 100, y: 200 })
  })

  it('历史动作会被写入 prompt', async () => {
    completeMock.mockResolvedValue({
      success: true,
      text: JSON.stringify({ thought: '完成', action: { type: 'finish', summary: 'ok' } }),
    })

    const caller = moduleRef.createComputerUseLLMCaller()
    await caller({
      systemPrompt: '',
      task: '历史测试',
      screenshotBase64: 'img',
      history: [{ thought: '之前', action: { type: 'goto', url: 'https://x.com' } }],
    })

    const [messages] = completeMock.mock.calls[0] as [Array<{ role: string; content: unknown }>, unknown]
    const parts = messages[1]!.content as Array<{ type: string; text?: string }>
    const textPart = parts.find((p) => p.type === 'text')
    expect(textPart?.text).toContain('https://x.com')
  })

  it('LLM 调用失败时抛出错误', async () => {
    completeMock.mockResolvedValue({ success: false, error: 'API 错误' })

    const caller = moduleRef.createComputerUseLLMCaller()
    await expect(
      caller({
        systemPrompt: '',
        task: '错误测试',
        screenshotBase64: 'img',
        history: [],
      }),
    ).rejects.toThrow('API 错误')
  })
})
