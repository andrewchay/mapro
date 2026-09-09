import { describe, expect, test, mock } from 'bun:test'
import type { Context, Model } from '@earendil-works/pi-ai'
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions'

// 被测模块经 attachment-enrichment 依赖 attachment-service/document-parser，
// 它们会加载 electron，因此在测试环境中先 mock electron。
mock.module('electron', () => ({
  BrowserWindow: class MockBrowserWindow {},
  dialog: {
    showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }),
    showSaveDialog: () => Promise.resolve({ canceled: true, filePath: '' }),
  },
  shell: { openExternal: () => {} },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (plain: string) => Buffer.from(plain),
    decryptString: (buf: Buffer) => buf.toString('utf-8'),
  },
}))

mock.module('../attachment-service', () => ({
  isImageAttachment: (mediaType: string) => mediaType.startsWith('image/'),
  readAttachmentAsBase64: () => 'AQID',
}))

mock.module('../document-parser', () => ({
  isDocumentAttachment: (mediaType: string) => mediaType === 'text/plain',
  extractTextFromAttachment: async () => '',
}))

interface CapturedPiPrompt {
  text: string
  options?: {
    expandPromptTemplates?: boolean
    images?: Array<{ type: 'image'; data: string; mimeType: string }>
  }
}

let capturedPrompts: CapturedPiPrompt[] = []
let capturedSettings: { images?: { blockImages?: boolean } } | undefined

function getCapturedSettings(): { images?: { blockImages?: boolean } } | undefined {
  return capturedSettings
}

mock.module('./pi-sdk-loader', () => ({
  loadPiCodingAgent: async () => ({
    DefaultResourceLoader: class {
      async reload(): Promise<void> {}
    },
    SessionManager: { inMemory: () => ({}) },
    SettingsManager: {
      inMemory: (settings: { images?: { blockImages?: boolean } }) => {
        capturedSettings = settings
        return {}
      },
    },
    createAgentSession: async () => ({
      session: {
        state: { messages: [] },
        subscribe: () => () => {},
        async prompt(text: string, options?: CapturedPiPrompt['options']) {
          capturedPrompts.push({ text, options })
        },
        async abort() {},
        dispose() {},
      },
    }),
  }),
}))

mock.module('./pi-model-registry', () => ({
  registerPiModelFromChannel: async () => ({
    agentDir: '/tmp/pi-agent',
    modelRuntime: {},
    model: {},
  }),
}))

// 被测模块需要在 mock 之后导入
const { PiAgentAdapter } = await import('./pi-agent-adapter')

describe('PiAgentAdapter', () => {
  test('given required channel fields are missing then query fails with a helpful error', async () => {
    const adapter = new PiAgentAdapter()

    await expect(async () => {
      for await (const _message of adapter.query({ sessionId: 's-pi', prompt: 'hello', agentRuntime: 'pi' })) {
        // 配置不完整，不应产出消息。
      }
    }).toThrow('Pi Runtime 需要 provider、apiKey、baseUrl、model、cwd')
  })

  test('abort and dispose are safe when no Pi session is active', () => {
    const adapter = new PiAgentAdapter()

    expect(() => adapter.abort('s-pi')).not.toThrow()
    expect(() => adapter.dispose()).not.toThrow()
  })

  test('given a user uploads a JPEG when Pi sends the turn then the model receives the real image block', async () => {
    capturedPrompts = []
    capturedSettings = undefined
    const adapter = new PiAgentAdapter()

    for await (const _message of adapter.query({
      sessionId: 's-pi-jpeg',
      prompt: '理解这幅图',
      agentRuntime: 'pi',
      provider: 'custom',
      apiKey: 'test-key',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash-vision-exp',
      cwd: '/tmp',
      attachments: [{
        id: 'jpeg-1',
        filename: 'photo.jpg',
        mediaType: 'image/jpeg',
        size: 3,
        localPath: '/tmp/photo.jpg',
      }],
    })) {
      // mock session 不返回消息。
    }

    expect(getCapturedSettings()?.images?.blockImages).toBe(false)
    expect(capturedPrompts).toEqual([{
      text: '理解这幅图',
      options: {
        expandPromptTemplates: false,
        images: [{ type: 'image', data: 'AQID', mimeType: 'image/jpeg' }],
      },
    }])

    const sentPrompt = capturedPrompts[0]
    if (!sentPrompt) throw new Error('Pi 未生成 prompt')
    let finalPayload: Record<string, unknown> | undefined
    const model: Model<'openai-completions'> = {
      id: 'deepseek-v4-flash-vision-exp',
      name: 'deepseek-v4-flash-vision-exp',
      api: 'openai-completions',
      provider: 'custom',
      baseUrl: 'https://api.deepseek.com/v1',
      reasoning: true,
      input: ['text', 'image'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1_000_000,
      maxTokens: 64_000,
    }
    const context: Context = {
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: sentPrompt.text },
          ...(sentPrompt.options?.images ?? []),
        ],
        timestamp: 1,
      }],
    }
    const serialized = streamSimple(model, context, {
      apiKey: 'test-key',
      onPayload: (payload) => {
        finalPayload = payload as Record<string, unknown>
        throw new Error('payload captured')
      },
    })
    await serialized.result()

    const apiMessages = finalPayload?.messages as Array<Record<string, unknown>> | undefined
    expect(apiMessages?.at(-1)?.content).toEqual([
      { type: 'text', text: '理解这幅图' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AQID' } },
    ])
  })
})
