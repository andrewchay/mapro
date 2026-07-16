/**
 * 定时爬取任务服务
 *
 * 管理按周期执行的 web-scraper 批量任务。
 * 任务列表持久化到 ~/.mapro/scheduled-scraping.json，
 * 应用启动后自动启动所有启用任务，退出前统一停止。
 */

import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { getConfigDir } from '../config-paths.ts'
import type { ScheduledScrapingTask } from '@ma-proma/shared'
import {
  executeScrapingTask,
  getDefaultUserDataDir,
  resolveTimeoutMs,
  type ScrapingTaskResult,
} from './browser-automation-service'
import { getToolCredentials } from '../chat-tool-config'

const SCHEDULED_SCRAPING_FILE_NAME = 'scheduled-scraping.json'

/** 当前活跃的定时器 */
const activeTimers = new Map<string, ReturnType<typeof setInterval>>()
/** 正在执行的任务 ID，防止重叠运行 */
const runningTasks = new Set<string>()

function getConfigPath(): string {
  return join(getConfigDir(), SCHEDULED_SCRAPING_FILE_NAME)
}

/**
 * 读取定时爬取任务列表
 */
export function getScheduledScrapingTasks(): ScheduledScrapingTask[] {
  const path = getConfigPath()
  if (!existsSync(path)) return []
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as { tasks?: ScheduledScrapingTask[] }
    return Array.isArray(parsed.tasks) ? parsed.tasks : []
  } catch (error) {
    console.error('[Scheduled Scraping] 读取任务列表失败:', error)
    return []
  }
}

/**
 * 保存定时爬取任务列表
 */
export function saveScheduledScrapingTasks(tasks: ScheduledScrapingTask[]): void {
  const path = getConfigPath()
  try {
    writeFileSync(path, JSON.stringify({ tasks }, null, 2), 'utf-8')
  } catch (error) {
    console.error('[Scheduled Scraping] 保存任务列表失败:', error)
    throw new Error('保存定时爬取任务失败')
  }
}

/**
 * 添加任务
 */
export function addScheduledScrapingTask(
  task: Omit<ScheduledScrapingTask, 'id'>,
): ScheduledScrapingTask {
  const tasks = getScheduledScrapingTasks()
  const newTask: ScheduledScrapingTask = { ...task, id: randomUUID() }
  tasks.push(newTask)
  saveScheduledScrapingTasks(tasks)
  if (newTask.enabled) {
    startScheduledTask(newTask.id)
  }
  return newTask
}

/**
 * 更新任务
 */
export function updateScheduledScrapingTask(
  id: string,
  updates: Partial<Omit<ScheduledScrapingTask, 'id'>>,
): ScheduledScrapingTask | null {
  const tasks = getScheduledScrapingTasks()
  const index = tasks.findIndex((t) => t.id === id)
  if (index === -1) return null

  const existing = tasks[index]!
  const updated: ScheduledScrapingTask = { ...existing, ...updates }
  tasks[index] = updated
  saveScheduledScrapingTasks(tasks)

  // 重启任务以应用新的间隔或启用状态
  stopScheduledTask(id)
  if (updated.enabled) {
    startScheduledTask(id)
  }
  return updated
}

/**
 * 删除任务
 */
export function deleteScheduledScrapingTask(id: string): boolean {
  const tasks = getScheduledScrapingTasks()
  const index = tasks.findIndex((t) => t.id === id)
  if (index === -1) return false

  stopScheduledTask(id)
  tasks.splice(index, 1)
  saveScheduledScrapingTasks(tasks)
  return true
}

/**
 * 执行单个定时任务
 */
async function runScheduledTask(id: string): Promise<ScrapingTaskResult | undefined> {
  if (runningTasks.has(id)) {
    console.warn(`[Scheduled Scraping] 任务 ${id} 仍在运行，跳过本次调度`)
    return
  }

  const tasks = getScheduledScrapingTasks()
  const task = tasks.find((t) => t.id === id)
  if (!task || !task.enabled) return

  runningTasks.add(id)
  console.log(`[Scheduled Scraping] 开始执行任务: ${task.name}`)

  try {
    const credentials = getToolCredentials('web-scraper')
    const targetUrl = task.urls?.[0] ?? ''
    const userDataDir =
      credentials.userDataDir?.trim() || (targetUrl ? getDefaultUserDataDir(targetUrl) : undefined)

    const result: ScrapingTaskResult = await executeScrapingTask(
      {
        task: task.task,
        urls: task.urls,
        outputFormat: task.outputFormat ?? 'json',
        importToKolDatabase: task.importToKolDatabase ?? false,
      },
      {
        userDataDir,
        cookies: typeof credentials.cookies === 'string' ? credentials.cookies : undefined,
        headless: credentials.headless !== 'false',
        proxy: typeof credentials.proxy === 'string' ? credentials.proxy : undefined,
        userAgent: typeof credentials.userAgent === 'string' ? credentials.userAgent : undefined,
        timeoutMs: resolveTimeoutMs(credentials.timeoutMs) || 120_000,
        maxRetries: task.maxRetries ?? 1,
        scriptTemplate: typeof credentials.scriptTemplate === 'string' ? credentials.scriptTemplate : undefined,
      },
    )

    if (result.success) {
      console.log(`[Scheduled Scraping] 任务 ${task.name} 成功:`, result.summary.slice(0, 200))
    } else {
      console.error(`[Scheduled Scraping] 任务 ${task.name} 失败:`, result.error)
    }
    return result
  } catch (error) {
    console.error(`[Scheduled Scraping] 任务 ${task.name} 执行异常:`, error)
    return undefined
  } finally {
    runningTasks.delete(id)
  }
}

/**
 * 启动单个定时任务
 */
export function startScheduledTask(id: string): void {
  stopScheduledTask(id)

  const tasks = getScheduledScrapingTasks()
  const task = tasks.find((t) => t.id === id)
  if (!task || !task.enabled) return

  const intervalMs = Math.max(task.intervalMinutes, 1) * 60 * 1000
  const timer = setInterval(() => {
    runScheduledTask(id).catch((err) => {
      console.error(`[Scheduled Scraping] 任务 ${id} 调度异常:`, err)
    })
  }, intervalMs)

  activeTimers.set(id, timer)
  console.log(`[Scheduled Scraping] 已启动任务: ${task.name}，间隔 ${task.intervalMinutes} 分钟`)
}

/**
 * 停止单个定时任务
 */
export function stopScheduledTask(id: string): void {
  const timer = activeTimers.get(id)
  if (timer) {
    clearInterval(timer)
    activeTimers.delete(id)
  }
}

/**
 * 启动定时爬取服务
 *
 * 应用启动时调用，加载并启动所有启用任务。
 */
export function startScheduledScrapingService(): void {
  const tasks = getScheduledScrapingTasks()
  for (const task of tasks) {
    if (task.enabled) {
      startScheduledTask(task.id)
    }
  }
}

/**
 * 测试专用：直接触发单个任务执行
 */
export function runScheduledTaskForTests(id: string): Promise<ScrapingTaskResult | undefined> {
  return runScheduledTask(id)
}

/**
 * 停止所有定时任务
 */
export function stopAllScheduledTasks(): void {
  for (const [id, timer] of activeTimers) {
    clearInterval(timer)
    console.log(`[Scheduled Scraping] 已停止任务: ${id}`)
  }
  activeTimers.clear()
}
