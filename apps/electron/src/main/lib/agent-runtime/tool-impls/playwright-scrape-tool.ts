/** MAPro Runtime 的受控 Playwright/CDP 爬取工具。 */

import type { ToolResult } from '@ma-proma/core'
import {
  executeScrapingTask,
  getDefaultUserDataDir,
  resolveTimeoutMs,
} from '../../browser-automation/browser-automation-service'
import { getToolCredentials, getToolState } from '../../chat-tool-config'
import type { ToolContext } from '../types'

export const PLAYWRIGHT_SCRAPE_TOOL_NAME = 'PlaywrightScrape'

export function createPlaywrightScrapeToolDefinition() {
  return {
    name: PLAYWRIGHT_SCRAPE_TOOL_NAME,
    description: '通过受控 Playwright 执行网页登录态下的筛选、抓取和结构化数据提取。复用“网页爬取”设置中的 Profile、Cookie、系统 Chrome 或 Chrome CDP 配置。适合需要稳定定位元素、调用页面接口或批量筛选的任务；每次执行都需要用户批准。',
    parameters: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: '目标网页完整 URL' },
        task: { type: 'string', description: '明确的浏览器自动化任务，包含筛选条件、要提取的字段和数量限制' },
        output_format: { type: 'string', enum: ['json', 'csv', 'markdown'], description: '结果格式，默认 json' },
      },
      required: ['url', 'task'],
    },
  }
}

export async function executePlaywrightScrapeTool(input: unknown, _ctx: ToolContext): Promise<ToolResult> {
  const url = readString(input, 'url')
  const task = readString(input, 'task')
  if (!url || !task) return error('url 和 task 必须是非空字符串')

  if (!getToolState('web-scraper').enabled) {
    return error('网页爬取工具当前已禁用，请先在设置中启用后再执行 Playwright 自动化。')
  }

  const credentials = getToolCredentials('web-scraper')
  const result = await executeScrapingTask(
    { url, task, outputFormat: readOutputFormat(input) },
    {
      userDataDir: readConfiguredString(credentials.userDataDir) ?? getDefaultUserDataDir(url),
      cookies: readConfiguredString(credentials.cookies),
      headless: credentials.headless !== 'false',
      proxy: readConfiguredString(credentials.proxy),
      userAgent: readConfiguredString(credentials.userAgent),
      timeoutMs: resolveTimeoutMs(credentials.timeoutMs),
      maxRetries: readConfiguredNumber(credentials.maxRetries),
      scriptTemplate: readConfiguredString(credentials.scriptTemplate),
      useSystemChrome: credentials.useSystemChrome === 'true',
      chromeExecutablePath: readConfiguredString(credentials.chromeExecutablePath),
      chromeRemoteDebuggingPort: readConfiguredString(credentials.chromeRemoteDebuggingPort),
      minActionDelayMs: readConfiguredNumber(credentials.minActionDelayMs),
      maxActionDelayMs: readConfiguredNumber(credentials.maxActionDelayMs),
    },
  )

  if (result.success) return { toolCallId: '', content: `${result.summary}\n\n任务目录：${result.taskDir}` }
  return error(`Playwright 自动化未成功：${result.error ?? '未知错误'}\n\n任务目录：${result.taskDir}\n\n${result.summary}`)
}

function readOutputFormat(input: unknown): 'json' | 'csv' | 'markdown' | undefined {
  const value = readString(input, 'output_format')
  return value === 'json' || value === 'csv' || value === 'markdown' ? value : undefined
}

function readConfiguredString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readConfiguredNumber(value: unknown): number | undefined {
  if (value === undefined || value === '') return undefined
  const numberValue = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numberValue) ? numberValue : undefined
}

function error(content: string): ToolResult { return { toolCallId: '', content, isError: true } }
function readString(value: unknown, key: string): string | undefined {
  return typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>)[key] === 'string'
    ? (value as Record<string, string>)[key]
    : undefined
}
