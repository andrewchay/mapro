/**
 * PlaywrightBrowserDriver 单元测试
 *
 * 主要回归验证：Python 驱动服务脚本必须使用单线程 HTTPServer，
 * 避免 Playwright sync API 在多线程环境下出现 greenlet 线程切换异常。
 */

import { describe, it, expect, beforeAll, mock } from 'bun:test'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TEST_DIR = join(tmpdir(), `mapro-driver-test-${Date.now()}`)

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

let PYTHON_SERVER_SCRIPT: string

beforeAll(async () => {
  process.env._MAPRO_TEST_CONFIG_DIR = TEST_DIR
  const module = await import('../browser-automation/playwright-browser-driver')
  PYTHON_SERVER_SCRIPT = module.PYTHON_SERVER_SCRIPT
})

describe('PlaywrightBrowserDriver Python 服务脚本', () => {
  it('使用单线程 HTTPServer，不包含 ThreadingHTTPServer', () => {
    expect(PYTHON_SERVER_SCRIPT).toContain('from http.server import BaseHTTPRequestHandler, HTTPServer')
    expect(PYTHON_SERVER_SCRIPT).not.toContain('ThreadingHTTPServer')
    expect(PYTHON_SERVER_SCRIPT).toContain('server = HTTPServer')
  })

  it('/close 端点在请求处理线程内关闭浏览器，再另起线程停止 HTTP 服务', () => {
    expect(PYTHON_SERVER_SCRIPT).toContain("elif path == '/close':")
    expect(PYTHON_SERVER_SCRIPT).toContain('close_browser()')
    expect(PYTHON_SERVER_SCRIPT).toContain('threading.Thread(target=self.server_instance.shutdown).start()')
  })

  it('CDP 模式不关闭外部 Chrome 上下文和浏览器', () => {
    expect(PYTHON_SERVER_SCRIPT).toContain('IS_CDP = bool(CHROME_REMOTE_DEBUGGING_PORT)')
    expect(PYTHON_SERVER_SCRIPT).toContain('connect_over_cdp')
    expect(PYTHON_SERVER_SCRIPT).toContain('CDP_CONTEXT_IS_EXTERNAL = True')
    // close_browser 在 CDP 模式下只关闭 page，不能关闭 context/browser
    expect(PYTHON_SERVER_SCRIPT).toContain('# CDP 复用外部 Chrome：不要关闭用户浏览器，仅断开引用')
  })
})
