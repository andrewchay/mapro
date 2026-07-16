/**
 * Browser Fetch 单元测试
 *
 * 验证为 Agent 提供的 browser_fetch 能力：
 * 1. 生成的 Python 脚本支持持久 Profile、Cookie 注入和多种输出格式
 * 2. executeBrowserFetchTask 输入校验正确
 */

import { describe, it, expect, beforeAll, mock } from 'bun:test'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TEST_DIR = join(tmpdir(), `mapro-browser-fetch-test-${Date.now()}`)

// 切断 electron 依赖链，避免 Bun 测试环境无法加载 safeStorage/app。
mock.module('electron', () => ({
  app: {
    getPath: () => TEST_DIR,
    isPackaged: false,
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}))

// browser-automation-service 静态依赖 ma-tools/llm-service 与 kol-data-service，
// 它们会经由 channel-manager 引入 electron safeStorage。
mock.module(join(__dirname, '..', 'ma-tools', 'llm-service.ts'), () => ({
  completePrompt: async () => ({ success: false, text: '', error: 'mocked-llm' }),
  complete: async () => ({ success: false, text: '', error: 'mocked-llm' }),
  extractJSON: (text: string) => JSON.parse(text),
}))

mock.module(join(__dirname, '..', 'ma-tools', 'kol-data-service.ts'), () => ({
  upsertKOL: () => {},
}))

let BROWSER_FETCH_SCRIPT: string
let executeBrowserFetchTask: (input: { url: string }) => Promise<{ success: boolean; error?: string }>

beforeAll(async () => {
  process.env._MAPRO_TEST_CONFIG_DIR = TEST_DIR
  const module = await import('../browser-automation/browser-automation-service')
  BROWSER_FETCH_SCRIPT = module.BROWSER_FETCH_SCRIPT
  executeBrowserFetchTask = module.executeBrowserFetchTask
})

describe('browser_fetch 脚本内容', () => {
  it('使用 Playwright 同步 API 并支持持久 Profile 与 Cookie 注入', () => {
    expect(BROWSER_FETCH_SCRIPT).toContain('from playwright.sync_api import sync_playwright')
    expect(BROWSER_FETCH_SCRIPT).toContain('launch_persistent_context')
    expect(BROWSER_FETCH_SCRIPT).toContain('USER_DATA_DIR')
    expect(BROWSER_FETCH_SCRIPT).toContain('COOKIES_FILE')
    expect(BROWSER_FETCH_SCRIPT).toContain('context.add_cookies')
  })

  it('支持 html / text / markdown 三种输出格式', () => {
    expect(BROWSER_FETCH_SCRIPT).toContain("FORMAT == 'text'")
    expect(BROWSER_FETCH_SCRIPT).toContain("FORMAT == 'markdown'")
    expect(BROWSER_FETCH_SCRIPT).toContain('page.content()')
    expect(BROWSER_FETCH_SCRIPT).toContain('page.inner_text')
  })

  it('截图并保存结果文件', () => {
    expect(BROWSER_FETCH_SCRIPT).toContain('RESULT_FILE')
    expect(BROWSER_FETCH_SCRIPT).toContain('SCREENSHOT_FILE')
    expect(BROWSER_FETCH_SCRIPT).toContain('page.screenshot')
  })

  it('CDP 模式连接已有 Chrome 且不会关闭外部上下文', () => {
    expect(BROWSER_FETCH_SCRIPT).toContain('connect_over_cdp')
    expect(BROWSER_FETCH_SCRIPT).toContain('IS_CDP = bool(CHROME_REMOTE_DEBUGGING_PORT)')
    expect(BROWSER_FETCH_SCRIPT).toContain('CDP_CONTEXT_IS_EXTERNAL = True')
    // 关闭外部 Chrome 上下文/浏览器是危险操作，脚本必须避免
    expect(BROWSER_FETCH_SCRIPT).not.toContain("if IS_CDP:\n    context.close()")
    expect(BROWSER_FETCH_SCRIPT).not.toContain("if IS_CDP:\n    browser.close()")
  })
})

describe('executeBrowserFetchTask', () => {
  it('URL 为空时返回明确失败', async () => {
    const result = await executeBrowserFetchTask({ url: '' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('缺少 URL')
  })
})
