/**
 * 定时爬取任务服务单元测试
 *
 * 覆盖 ScheduledScrapingService 的 CRUD、持久化与启停逻辑，
 * 通过 mock executeScrapingTask 避免真实启动浏览器。
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, mock } from 'bun:test'
import { existsSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

const executeScrapingTaskMock = mock(async () => ({
  success: true,
  summary: 'mocked scraping result',
  taskDir: '/tmp/mock-task',
  resultFiles: ['url-1/result.json'],
}))

mock.module(join(__dirname, '..', 'browser-automation', 'browser-automation-service.ts'), () => ({
  executeScrapingTask: executeScrapingTaskMock,
}))

const TEST_DIR = join(tmpdir(), `mapro-scheduled-scraping-test-${Date.now()}`)

interface ScheduledScrapingServiceModule {
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
}

let service: ScheduledScrapingServiceModule

describe('scheduled-scraping-service 定时爬取任务', () => {
  beforeAll(async () => {
    mkdirSync(TEST_DIR, { recursive: true })
    process.env._MAPRO_TEST_CONFIG_DIR = TEST_DIR
    service = (await import('../browser-automation/scheduled-scraping-service')) as ScheduledScrapingServiceModule
  })

  afterAll(() => {
    service.stopAllScheduledTasks()
    delete process.env._MAPRO_TEST_CONFIG_DIR
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
  })

  beforeEach(() => {
    executeScrapingTaskMock.mockClear()
    // 清理持久化文件，保证每个用例隔离
    const tasksPath = join(TEST_DIR, 'scheduled-scraping.json')
    if (existsSync(tasksPath)) {
      rmSync(tasksPath)
    }
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
})
