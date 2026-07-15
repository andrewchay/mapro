/**
 * 网页爬取工具（Chat 模式）
 *
 * 基于 BrowserAutomationService 提供浏览器自动化爬取能力。
 * 用户通过自然语言描述任务，AI 生成 Playwright 脚本并执行。
 */

import type { ToolCall, ToolResult, ToolDefinition } from '@ma-proma/core'
import type { ChatToolMeta } from '@ma-proma/shared'
import {
  executeScrapingTask,
  getDefaultUserDataDir,
  checkPythonAndPlaywright,
  resetPythonPlaywrightCheck,
} from '../browser-automation/browser-automation-service.ts'
import { getToolCredentials } from '../chat-tool-config'

// ===== 工具元数据 =====

export const WEB_SCRAPER_TOOL_META: ChatToolMeta = {
  id: 'web-scraper',
  name: '网页爬取',
  description: '使用浏览器自动化访问网页并提取结构化数据',
  params: [
    { name: 'url', type: 'string', description: '要访问的目标网页 URL', required: true },
    { name: 'task', type: 'string', description: '具体的爬取任务描述，例如"提取前 20 个商品的名称和价格"', required: true },
    { name: 'outputFormat', type: 'string', description: '输出格式：json、csv、markdown，默认 json', required: false },
  ],
  icon: 'Globe',
  category: 'builtin',
  executorType: 'builtin',
  systemPromptAppend: `
<web_scraper_instructions>
你拥有网页爬取能力（web_scraper）。

**何时调用：**
- 用户需要从某个网页提取数据时
- 用户要求"抓取"、"爬取"、"获取"某个网站信息时
- 需要获取 KOL 主页、商品列表、搜索结果等结构化数据时

**参数使用：**
- url：目标网页的完整 URL
- task：清晰具体的任务描述，包括要提取的字段、数量限制、筛选条件
- outputFormat：可选，默认 json

**登录态说明：**
- 如果目标页面需要登录，请在设置中配置浏览器 Profile 或 Cookie。
- 首次登录可以关闭 headless 模式，在弹出的浏览器窗口中手动扫码/短信登录，系统会自动保存登录态供后续任务复用。

**调用后处理：**
- 向用户总结抓取到的数据
- 告诉用户结果文件保存在哪个工作区目录
- 如果任务失败，根据截图和错误信息分析原因
</web_scraper_instructions>`,
}

// ===== 工具定义（传给 Provider） =====

export const WEB_SCRAPER_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'web_scraper',
    description: 'Use browser automation to visit a webpage and extract structured data. Use this when the user asks to scrape, crawl, or extract information from a specific URL.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Target webpage URL' },
        task: { type: 'string', description: 'Specific scraping task description, e.g. "Extract the titles and prices of the first 20 products"' },
        outputFormat: { type: 'string', enum: ['json', 'csv', 'markdown'], description: 'Output format, default is json' },
      },
      required: ['url', 'task'],
    },
  },
]

// ===== 可用性检查 =====

/**
 * 检查网页爬取工具是否可用
 *
 * 检查本地是否已安装 python3 和 playwright Python 包。
 */
export function isWebScraperAvailable(): boolean {
  return checkPythonAndPlaywright().available
}

/**
 * 获取网页爬取工具的可用性状态和提示信息
 */
export function getWebScraperAvailability(): { available: boolean; message: string } {
  return checkPythonAndPlaywright()
}

/**
 * 刷新网页爬取工具的可用性检查结果
 */
export function refreshWebScraperAvailability(): void {
  resetPythonPlaywrightCheck()
}

// ===== 工具执行 =====

/** 网页爬取工具名称集合 */
const WEB_SCRAPER_TOOL_NAMES = new Set(['web_scraper'])

/**
 * 判断是否为网页爬取工具调用
 */
export function isWebScraperToolCall(toolName: string): boolean {
  return WEB_SCRAPER_TOOL_NAMES.has(toolName)
}

/**
 * 执行网页爬取工具
 */
export async function executeWebScraperTool(toolCall: ToolCall): Promise<ToolResult> {
  const args = toolCall.arguments
  const url = typeof args.url === 'string' ? args.url : ''
  const task = typeof args.task === 'string' ? args.task : ''
  const outputFormat =
    args.outputFormat === 'json' || args.outputFormat === 'csv' || args.outputFormat === 'markdown'
      ? args.outputFormat
      : 'json'

  if (!url || !task) {
    return {
      toolCallId: toolCall.id,
      content: '缺少必要参数：url 和 task 必填',
      isError: true,
    }
  }

  // 读取用户配置的凭据
  const credentials = getToolCredentials('web-scraper')
  const userDataDir =
    typeof credentials.userDataDir === 'string' && credentials.userDataDir.trim()
      ? credentials.userDataDir.trim()
      : getDefaultUserDataDir(url)
  const headless = credentials.headless !== 'false'

  try {
    const result = await executeScrapingTask(
      { url, task, outputFormat },
      {
        userDataDir,
        cookies: typeof credentials.cookies === 'string' ? credentials.cookies : undefined,
        headless,
        proxy: typeof credentials.proxy === 'string' ? credentials.proxy : undefined,
        userAgent: typeof credentials.userAgent === 'string' ? credentials.userAgent : undefined,
        timeoutMs:
          typeof credentials.timeoutMs === 'string' || typeof credentials.timeoutMs === 'number'
            ? Number(credentials.timeoutMs) || 60_000
            : 60_000,
      },
    )

    if (result.success) {
      return {
        toolCallId: toolCall.id,
        content: result.summary,
      }
    }

    return {
      toolCallId: toolCall.id,
      content: `爬取任务未成功：${result.error ?? '未知错误'}\n\n任务目录：${result.taskDir}\n\n${result.summary}`,
      isError: true,
    }
  } catch (error) {
    return {
      toolCallId: toolCall.id,
      content: `执行爬取工具时发生异常：${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    }
  }
}
