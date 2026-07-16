/**
 * 网页爬取工具执行入口测试（端到端凭据透传）
 *
 * 不 mock browser-automation-service / chat-tool-config，
 * 通过真实调用 executeWebScraperTool + 自定义 Python 脚本模板，
 * 验证设置页保存的凭据被完整透传到 Playwright 脚本执行环境。
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ToolCall, ToolResult } from '@ma-proma/core'

const TEST_DIR = join(tmpdir(), `mapro-web-scraper-tool-test-${Date.now()}`)
process.env._MAPRO_TEST_CONFIG_DIR = TEST_DIR

// Mock llm-service 与 kol-data-service，切断其到 electron / safeStorage 的依赖链。
// 注意：这里不 mock chat-tool-config，避免 chat-tool-config 的 mock 泄漏影响其它测试。
mock.module('../ma-tools/llm-service.ts', () => ({
  completePrompt: async () => ({ success: false, text: '', error: 'mocked-llm' }),
  complete: async () => ({ success: false, text: '', error: 'mocked-llm' }),
  extractJSON: (text: string) => JSON.parse(text),
}))
import { createKolDataServiceMock } from './mocks/kol-data-service-mock'

mock.module('../ma-tools/kol-data-service.ts', () =>
  createKolDataServiceMock({ upsertKOL: mock((kol: unknown) => kol) }),
)

afterAll(() => {
  delete process.env._MAPRO_TEST_CONFIG_DIR
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true })
  }
  mock.restore()
})

let executeWebScraperTool: (toolCall: ToolCall) => Promise<ToolResult>
let updateToolCredentials: (toolId: string, credentials: Record<string, string>) => void
let getToolCredentials: (toolId: string) => Record<string, string>

function baseToolCall(overrides?: Partial<ToolCall['arguments']>): ToolCall {
  return {
    id: 'call-1',
    name: 'web_scraper',
    arguments: {
      url: 'https://example.com',
      task: '抓取示例',
      ...overrides,
    },
  }
}

/** 生成一个把环境变量写入 sideFile 的 Python 脚本模板 */
function envRecorderTemplate(sideFile: string): string {
  return `import os, json
result_file = os.environ['RESULT_FILE']
side_file = ${JSON.stringify(sideFile)}
with open(result_file, 'w') as f: json.dump({}, f)
with open(side_file, 'w') as f: json.dump(dict(os.environ), f)`
}

/** 生成一个把 KOL 数据写入 result.json 的 Python 脚本模板 */
function kolResultTemplate(): string {
  return `import os, json
result_file = os.environ['RESULT_FILE']
with open(result_file, 'w') as f:
    json.dump([{'name': '测试KOL', 'platform': 'xiaohongshu', 'followers': 10000}], f, ensure_ascii=False)`
}

/** 生成一个需要重试一次才能成功的 Python 脚本模板 */
function retryOnceTemplate(): string {
  return `import os, json, sys
result_file = os.environ['RESULT_FILE']
counter_file = os.path.join(os.path.dirname(result_file), 'counter.txt')
count = 0
if os.path.exists(counter_file):
    with open(counter_file) as f: count = int(f.read() or 0)
count += 1
with open(counter_file, 'w') as f: f.write(str(count))
if count < 2:
    sys.exit(1)
with open(result_file, 'w') as f: json.dump({}, f)`
}

describe('executeWebScraperTool 凭据透传', () => {
  beforeAll(async () => {
    mkdirSync(TEST_DIR, { recursive: true })
    const chatToolConfig = await import('../chat-tool-config.ts')
    updateToolCredentials = chatToolConfig.updateToolCredentials
    getToolCredentials = chatToolConfig.getToolCredentials
    const webScraperTool = await import('../chat-tools/web-scraper-tool.ts')
    executeWebScraperTool = webScraperTool.executeWebScraperTool
  })

  beforeEach(() => {
    // 清理凭据，保证每个用例从干净状态开始
    updateToolCredentials('web-scraper', {})
    for (const file of ['env.json', 'env2.json']) {
      const p = join(TEST_DIR, file)
      if (existsSync(p)) rmSync(p)
    }
  })

  it('Given 凭据默认导入 KOL 为 true when 工具参数未指定 then 将 JSON 结果导入 KOL 数据库', async () => {
    updateToolCredentials('web-scraper', {
      importToKolDatabase: 'true',
      scriptTemplate: kolResultTemplate(),
    })

    const result = await executeWebScraperTool(baseToolCall())

    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('KOL 数据库导入')
    expect(result.content).toContain('成功 1 条')
  })

  it('Given 工具参数显式 false when 凭据为 true then 不导入 KOL 数据库', async () => {
    updateToolCredentials('web-scraper', {
      importToKolDatabase: 'true',
      scriptTemplate: envRecorderTemplate(join(TEST_DIR, 'env.json')),
    })

    const result = await executeWebScraperTool(baseToolCall({ importToKolDatabase: false }))

    expect(result.isError).toBeUndefined()
    expect(result.content).not.toContain('KOL 数据库导入')
  })

  it('Given 完整凭据 when 执行 then 全部透传给 Python 脚本环境', async () => {
    const sideFile = join(TEST_DIR, 'env.json')
    updateToolCredentials('web-scraper', {
      userDataDir: join(TEST_DIR, 'custom-profile'),
      cookies: JSON.stringify([{ name: 'session', value: 'abc', domain: '.example.com', path: '/' }]),
      headless: 'false',
      proxy: 'http://127.0.0.1:8080',
      userAgent: 'TestUA/1.0',
      timeoutMs: '90000',
      maxRetries: '2',
      scriptTemplate: envRecorderTemplate(sideFile),
    })

    const result = await executeWebScraperTool(baseToolCall({ maxRetries: 3 }))

    expect(result.isError).toBeUndefined()
    const env = JSON.parse(readFileSync(sideFile, 'utf-8'))

    expect(env.HEADLESS).toBe('false')
    expect(env.PROXY).toBe('http://127.0.0.1:8080')
    expect(env.USER_AGENT).toBe('TestUA/1.0')
    expect(env.COOKIES_FILE).toBeTruthy()
    expect(existsSync(env.COOKIES_FILE)).toBe(true)
    expect(env.USER_DATA_DIR).toBeTruthy()
  })

  it('Given 凭据 maxRetries=2 when 脚本首次失败 then 第二次重试成功', async () => {
    updateToolCredentials('web-scraper', {
      maxRetries: '2',
      scriptTemplate: retryOnceTemplate(),
    })

    const result = await executeWebScraperTool(baseToolCall())

    expect(result.isError).toBeUndefined()
  })

  it('Given 工具参数覆盖凭据 maxRetries when 脚本首次失败 then 按参数重试成功', async () => {
    updateToolCredentials('web-scraper', {
      maxRetries: '0',
      scriptTemplate: retryOnceTemplate(),
    })

    const result = await executeWebScraperTool(baseToolCall({ maxRetries: 2 }))

    expect(result.isError).toBeUndefined()
  })

  it('Given 凭据 timeoutMs 为秒 when 执行 then 不会按毫秒过早超时', async () => {
    // 脚本会睡 1.5 秒；如果 timeoutMs 被错误当成毫秒（60ms），任务会超时失败。
    updateToolCredentials('web-scraper', {
      timeoutMs: '2',
      scriptTemplate: `import os, json, time
result_file = os.environ['RESULT_FILE']
time.sleep(1.5)
with open(result_file, 'w') as f: json.dump({}, f)`,
    })

    const result = await executeWebScraperTool(baseToolCall())

    // 若秒值正确转换为 2000ms，则 1.5 秒脚本不会超时，任务成功。
    expect(result.isError).toBeUndefined()
  })

  it('读取凭据时使用设置页保存的毫秒值', () => {
    updateToolCredentials('web-scraper', { timeoutMs: '120000' })
    const credentials = getToolCredentials('web-scraper')
    expect(credentials.timeoutMs).toBe('120000')
  })
})
