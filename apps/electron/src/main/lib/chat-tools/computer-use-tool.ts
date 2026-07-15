/**
 * Computer Use 视觉浏览器自动化工具（Chat 模式）
 *
 * 让 AI 通过截图-决策-执行循环操作浏览器，适合复杂动态页面和需要视觉判断的任务。
 */

import type { ToolCall, ToolResult, ToolDefinition } from '@ma-proma/core'
import type { ChatToolMeta } from '@ma-proma/shared'
import { executeComputerUseTask } from '../browser-automation/computer-use-service.ts'
import { PlaywrightBrowserDriver } from '../browser-automation/playwright-browser-driver.ts'
import { createComputerUseLLMCaller } from '../browser-automation/computer-use-llm.ts'
import {
  getDefaultUserDataDir,
  checkPythonAndPlaywright,
  resetPythonPlaywrightCheck,
  resolveTimeoutMs,
} from '../browser-automation/browser-automation-service.ts'
import { getToolCredentials } from '../chat-tool-config'

export const COMPUTER_USE_TOOL_META: ChatToolMeta = {
  id: 'computer-use',
  name: '视觉浏览器自动化',
  description: '通过截图和视觉推理自动操作浏览器完成复杂任务',
  params: [
    { name: 'url', type: 'string', description: '要访问的目标网页 URL', required: true },
    { name: 'task', type: 'string', description: '具体任务描述，例如"登录小红书后台并进入达人合作页面"', required: true },
    { name: 'maxSteps', type: 'number', description: '最大操作步数，默认 30', required: false },
  ],
  icon: 'Monitor',
  category: 'builtin',
  executorType: 'builtin',
  systemPromptAppend: `
<computer_use_instructions>
你拥有视觉浏览器自动化能力（computer_use）。

**何时调用：**
- 页面结构复杂、动态加载、需要多步交互时
- 用户要求"打开某页面并做某事"，且该任务需要视觉判断（如点击按钮位置、识别验证码、判断加载状态）
- 脚本爬取（web_scraper）失败或无法处理时

**参数使用：**
- url：目标网页的完整 URL
- task：清晰具体的任务描述，包括最终目标和关键判断标准
- maxSteps：可选，默认 30 步。复杂任务可适当增大，但注意 token 消耗

**与 web_scraper 的区别：**
- web_scraper：AI 生成固定 Python 脚本，速度快，适合结构化页面
- computer_use：AI 每步看截图再决策，能处理动态/未知 UI，但成本高

**调用后处理：**
- 向用户总结操作过程和最终结果
- 告诉用户结果文件和截图保存路径
- 如果任务未完成或需要人工介入（如扫码、验证码），明确说明
</computer_use_instructions>`,
}

export const COMPUTER_USE_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'computer_use',
    description: 'Use visual browser automation to complete complex tasks. The AI sees screenshots and decides actions (click, type, scroll, etc.) step by step. Use this when the page is dynamic, requires visual judgment, or when web_scraper fails.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Target webpage URL' },
        task: { type: 'string', description: 'Specific task description, e.g. "Log in to Xiaohongshu creator platform and navigate to the KOL cooperation page"' },
        maxSteps: { type: 'number', description: 'Maximum number of steps (default 30)' },
      },
      required: ['url', 'task'],
    },
  },
]

export function isComputerUseAvailable(): boolean {
  return checkPythonAndPlaywright().available
}

export function getComputerUseAvailability(): { available: boolean; message: string } {
  return checkPythonAndPlaywright()
}

export function refreshComputerUseAvailability(): void {
  resetPythonPlaywrightCheck()
}

const COMPUTER_USE_TOOL_NAMES = new Set(['computer_use'])

export function isComputerUseToolCall(toolName: string): boolean {
  return COMPUTER_USE_TOOL_NAMES.has(toolName)
}

export async function executeComputerUseTool(toolCall: ToolCall): Promise<ToolResult> {
  const args = toolCall.arguments
  const url = typeof args.url === 'string' ? args.url : ''
  const task = typeof args.task === 'string' ? args.task : ''
  const maxSteps = typeof args.maxSteps === 'number' ? args.maxSteps : 30

  if (!url || !task) {
    return {
      toolCallId: toolCall.id,
      content: '缺少必要参数：url 和 task 必填',
      isError: true,
    }
  }

  const credentials = getToolCredentials('computer-use')
  const userDataDir =
    typeof credentials.userDataDir === 'string' && credentials.userDataDir.trim()
      ? credentials.userDataDir.trim()
      : getDefaultUserDataDir(url)
  const headless = credentials.headless !== 'false'

  const driver = new PlaywrightBrowserDriver()
  const callLLM = createComputerUseLLMCaller()

  try {
    const result = await executeComputerUseTask(
      { url, task, maxSteps },
      {
        userDataDir,
        cookies: typeof credentials.cookies === 'string' ? credentials.cookies : undefined,
        headless,
        proxy: typeof credentials.proxy === 'string' ? credentials.proxy : undefined,
        userAgent: typeof credentials.userAgent === 'string' ? credentials.userAgent : undefined,
        timeoutMs: resolveTimeoutMs(credentials.timeoutMs),
      },
      driver,
      callLLM,
    )

    if (result.success) {
      return {
        toolCallId: toolCall.id,
        content: result.summary,
      }
    }

    return {
      toolCallId: toolCall.id,
      content: `视觉自动化任务未成功：${result.error ?? '未知错误'}\n\n任务目录：${result.taskDir}\n\n${result.summary}`,
      isError: true,
    }
  } catch (error) {
    return {
      toolCallId: toolCall.id,
      content: `执行视觉自动化工具时发生异常：${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    }
  }
}
