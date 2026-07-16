/**
 * 定时爬取任务服务单元测试
 *
 * 覆盖 ScheduledScrapingService 的 CRUD、持久化、启停逻辑，
 * 以及定时任务执行时是否正确复用 Web Scraper 凭据。
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, mock } from 'bun:test'
import { existsSync, rmSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const TEST_DIR = join(tmpdir(), `mapro-scheduled-scraping-test-${Date.now()}`)
process.env._MAPRO_TEST_CONFIG_DIR = TEST_DIR

// Mock llm-service 与 kol-data-service，切断其到 electron / safeStorage 的依赖链。
// 不 mock chat-tool-config，避免跨测试文件泄漏。
mock.module('../ma-tools/llm-service.ts', () => ({
  completePrompt: async () => ({ success: false, text: '', error: 'mocked-llm' }),
  complete: async () => ({ success: false, text: '', error: 'mocked-llm' }),
  extractJSON: (text: string) => JSON.parse(text),
}))
import { createKolDataServiceMock } from './mocks/kol-data-service-mock'

mock.module('../ma-tools/kol-data-service.ts', () =>
  createKolDataServiceMock({ upsertKOL: mock((kol: unknown) => kol) }),
)

let service: {
  getScheduledScrapingTasks: () => import('@ma-proma/shared').ScheduledScrapingTask[]
  addScheduledScrapingTask: (
    task: Omit<import('@ma-proma/shared').ScheduledScrapingTask, 'id'>,
  ) => import('@ma-proma/shared').ScheduledScrapingTask
  updateScheduledScrapingTask: (
    id: string,
    updates: Partial<Omit<import('@ma-proma/shared').ScheduledScrapingTask, 'id'>>,
  ) => import('@ma-proma/shared').ScheduledScrapingTask | null
  deleteScheduledScrapingTask: (id: string) => boolean
  startScheduledTask: (id: string) => void
  stopScheduledTask: (id: string) => void
  startScheduledScrapingService: () => void
  stopAllScheduledTasks: () => void
  runScheduledTaskForTests: (id: string) => Promise<import('../browser-automation/browser-automation-service').ScrapingTaskResult | undefined>
}
let updateToolCredentials: (toolId: string, credentials: Record<string, string>) => void

describe('scheduled-scraping-service 定时爬取任务', () => {
  beforeAll(async () => {
    mkdirSync(TEST_DIR, { recursive: true })
    const chatToolConfig = await import('../chat-tool-config.ts')
    updateToolCredentials = chatToolConfig.updateToolCredentials
    service = (await import('../browser-automation/scheduled-scraping-service.ts')) as typeof service
  })

  afterAll(() => {
    service?.stopAllScheduledTasks()
    delete process.env._MAPRO_TEST_CONFIG_DIR
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
    mock.restore()
  })

  beforeEach(() => {
    // 清理持久化文件与凭据，保证每个用例隔离
    updateToolCredentials('web-scraper', {})
    const tasksPath = join(TEST_DIR, 'scheduled-scraping.json')
    if (existsSync(tasksPath)) {
      rmSync(tasksPath)
    }
  })

  afterEach(() => {
    service.stopAllScheduledTasks()
  })

  it('添加任务后可以通过 getScheduledScrapingTasks 读取', () => {
    const added = service.addScheduledScrapingTask({
      name: '每日 KOL 抓取',
      urls: ['https://a.com'],
      task: '抓取 KOL 列表',
      intervalMinutes: 60,
      enabled: false,
    })

    expect(added.id).toBeTruthy()
    const tasks = service.getScheduledScrapingTasks()
    expect(tasks.length).toBe(1)
    expect(tasks[0]!.name).toBe('每日 KOL 抓取')
    expect(tasks[0]!.enabled).toBe(false)
  })

  it('更新任务会持久化并返回更新后的任务', () => {
    const added = service.addScheduledScrapingTask({
      name: '旧名称',
      urls: ['https://a.com'],
      task: '抓取',
      intervalMinutes: 30,
      enabled: false,
    })

    const updated = service.updateScheduledScrapingTask(added.id, { name: '新名称' })
    expect(updated).not.toBeNull()
    expect(updated!.name).toBe('新名称')

    const tasks = service.getScheduledScrapingTasks()
    expect(tasks[0]!.name).toBe('新名称')
  })

  it('删除任务后列表为空', () => {
    const added = service.addScheduledScrapingTask({
      name: '待删除',
      urls: ['https://a.com'],
      task: '抓取',
      intervalMinutes: 10,
      enabled: false,
    })

    expect(service.deleteScheduledScrapingTask(added.id)).toBe(true)
    expect(service.getScheduledScrapingTasks().length).toBe(0)
    expect(service.deleteScheduledScrapingTask(added.id)).toBe(false)
  })

  it('启动并停止单个任务不会泄漏定时器', () => {
    const added = service.addScheduledScrapingTask({
      name: '启停测试',
      urls: ['https://a.com'],
      task: '抓取',
      intervalMinutes: 1,
      enabled: false,
    })

    service.startScheduledTask(added.id)
    service.stopScheduledTask(added.id)
    // 没有抛出异常即视为成功；activeTimers 是私有状态，通过再次 stop 不报错间接验证
    expect(service.stopScheduledTask(added.id)).toBeUndefined()
  })

  it('startScheduledScrapingService 启动所有启用任务，stopAllScheduledTasks 全部清理', () => {
    service.addScheduledScrapingTask({
      name: '启用任务 A',
      urls: ['https://a.com'],
      task: '抓取 A',
      intervalMinutes: 1,
      enabled: true,
    })
    service.addScheduledScrapingTask({
      name: '禁用任务 B',
      urls: ['https://b.com'],
      task: '抓取 B',
      intervalMinutes: 1,
      enabled: false,
    })

    service.startScheduledScrapingService()
    service.stopAllScheduledTasks()
    // 清理后再次启动服务不应重复启动已停止任务导致泄漏；这里主要验证无异常
    expect(() => service.stopAllScheduledTasks()).not.toThrow()
  })

  it('执行定时任务时复用 Web Scraper 凭据', async () => {
    const profileDir = join(TEST_DIR, 'scheduled-profile')
    const cookiesJson = JSON.stringify([
      { name: 'session', value: 'abc', domain: '.scheduled.example.com', path: '/' },
    ])
    updateToolCredentials('web-scraper', {
      userDataDir: profileDir,
      cookies: cookiesJson,
      headless: 'false',
      proxy: 'http://proxy.example.com:8080',
      userAgent: 'ScheduledUA/1.0',
      timeoutMs: '90000',
      scriptTemplate: `import os, json
result_file = os.environ['RESULT_FILE']
with open(result_file, 'w') as f: json.dump(dict(os.environ), f)`,
    })

    const added = service.addScheduledScrapingTask({
      name: '凭据复用测试',
      urls: ['https://scheduled.example.com'],
      task: '定时抓取',
      intervalMinutes: 1,
      maxRetries: 1,
      importToKolDatabase: false,
      enabled: true,
    })

    const result = await service.runScheduledTaskForTests(added.id)

    expect(result).toBeDefined()
    expect(result!.success).toBe(true)
    const resultPath = join(result!.taskDir, 'result.json')
    const env = JSON.parse(readFileSync(resultPath, 'utf-8'))

    expect(env.HEADLESS).toBe('false')
    expect(env.PROXY).toBe('http://proxy.example.com:8080')
    expect(env.USER_AGENT).toBe('ScheduledUA/1.0')
    expect(env.COOKIES_FILE).toBeTruthy()
    expect(existsSync(env.COOKIES_FILE)).toBe(true)
    expect(JSON.parse(readFileSync(env.COOKIES_FILE, 'utf-8'))).toEqual(JSON.parse(cookiesJson))
    expect(env.USER_DATA_DIR).toBeTruthy()
  })

  it('执行定时任务时复用 Web Scraper timeoutMs 秒值', async () => {
    updateToolCredentials('web-scraper', {
      timeoutMs: '2',
      scriptTemplate: `import os, json, time
result_file = os.environ['RESULT_FILE']
time.sleep(1.5)
with open(result_file, 'w') as f: json.dump({}, f)`,
    })

    const added = service.addScheduledScrapingTask({
      name: '超时复用测试',
      urls: ['https://timeout.example.com'],
      task: '抓取',
      intervalMinutes: 1,
      enabled: true,
    })

    const result = await service.runScheduledTaskForTests(added.id)

    expect(result).toBeDefined()
    expect(result!.success).toBe(true)
  })

  it('执行定时任务时 importToKolDatabase 将 JSON 结果导入 KOL 数据库', async () => {
    updateToolCredentials('web-scraper', {
      importToKolDatabase: 'true',
      scriptTemplate: `import os, json
result_file = os.environ['RESULT_FILE']
with open(result_file, 'w') as f:
    json.dump([{'name': '定时KOL', 'platform': 'xiaohongshu', 'followers': 5000}], f, ensure_ascii=False)`,
    })

    const added = service.addScheduledScrapingTask({
      name: 'KOL 导入测试',
      urls: ['https://kol.example.com'],
      task: '抓取',
      intervalMinutes: 1,
      importToKolDatabase: true,
      enabled: true,
    })

    const result = await service.runScheduledTaskForTests(added.id)

    expect(result).toBeDefined()
    expect(result!.success).toBe(true)
    expect(result!.kolImport).toBeDefined()
    expect(result!.kolImport!.inserted).toBe(1)
  })
})
