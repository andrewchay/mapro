/**
 * Browser Automation Service
 *
 * 提供基于 Playwright 的浏览器自动化能力：
 * 1. 根据任务描述生成 Python + Playwright 脚本
 * 2. 在隔离目录中执行脚本
 * 3. 收集结果文件与截图
 *
 * 当前为模式 A（脚本自动化）的实现基础。
 */

import { join } from 'node:path'
import { mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { getConfigDir } from '../config-paths.ts'

export interface ScrapingTaskInput {
  /** 任务自然语言描述 */
  task: string
  /** 起始 URL */
  url: string
  /** 输出格式 */
  outputFormat?: 'json' | 'csv' | 'markdown'
}

export interface ScrapingTaskResult {
  /** 是否成功 */
  success: boolean
  /** 结果摘要 */
  summary: string
  /** 任务目录路径 */
  taskDir: string
  /** 结果文件相对路径 */
  resultFile?: string
  /** 截图文件相对路径 */
  screenshotFile?: string
  /** 原始脚本文件相对路径 */
  scriptFile?: string
  /** 错误信息 */
  error?: string
}

const SCRAPED_DIR_NAME = 'scraped'
const DEFAULT_OUTPUT_FORMAT: NonNullable<ScrapingTaskInput['outputFormat']> = 'json'
const SCRIPT_TIMEOUT_MS = 60_000

/**
 * 获取爬取任务根目录
 */
function getScrapedRootDir(): string {
  const dir = join(getConfigDir(), SCRAPED_DIR_NAME)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * 创建任务目录
 */
function createTaskDir(): string {
  const taskId = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const dir = join(getScrapedRootDir(), taskId)
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 生成 Playwright Python 脚本
 */
async function generateScrapingScript(
  input: ScrapingTaskInput,
  taskDir: string,
  outputFormat: NonNullable<ScrapingTaskInput['outputFormat']>,
): Promise<{ scriptPath: string; success: boolean; error?: string }> {
  const resultFileName = `result.${outputFormat === 'markdown' ? 'md' : outputFormat}`
  const screenshotFileName = 'screenshot.png'
  const scriptFileName = 'script.py'

  const resultFilePath = join(taskDir, resultFileName)
  const screenshotFilePath = join(taskDir, screenshotFileName)
  const scriptPath = join(taskDir, scriptFileName)

  const systemPrompt = `你是一名专业的 Web 爬虫工程师。请根据用户任务生成一个完整的、可独立运行的 Python + Playwright 脚本。

要求：
1. 使用 Playwright 同步 API（from playwright.sync_api import sync_playwright）
2. 使用 headless 模式启动 Chromium
3. 只访问用户指定的 URL 及其同域名页面
4. 等待关键元素加载完成后再提取数据
5. 处理滚动加载、分页等常见情况，但限制总条目数不超过 50 条
6. 将结果保存到 RESULT_FILE 指定的路径
7. 同时保存一张最终页面截图到 SCREENSHOT_FILE 指定的路径
8. 添加 try/finally 确保浏览器关闭
9. 遇到反爬或验证码时，保存当前截图并优雅退出，不要无限重试
10. 脚本中通过环境变量读取 RESULT_FILE 和 SCREENSHOT_FILE
11. 只输出可执行的 Python 代码，不要输出任何解释文字或 markdown 代码块标记`

  const prompt = `任务：${input.task}
目标 URL：${input.url}
输出格式：${outputFormat}
结果保存路径（通过环境变量 RESULT_FILE 读取）：${resultFilePath}
截图保存路径（通过环境变量 SCREENSHOT_FILE 读取）：${screenshotFilePath}

请生成 Python 脚本。脚本需要：
- 导入 os 模块读取 RESULT_FILE 和 SCREENSHOT_FILE
- 使用 json/csv/markdown 库按格式保存数据
- 输出简洁的爬取结果摘要到 stdout`

  const { completePrompt } = await import('../ma-tools/llm-service.ts')
  const llmResult = await completePrompt(prompt, systemPrompt, { jsonMode: false })
  if (!llmResult.success || !llmResult.text) {
    return { scriptPath, success: false, error: llmResult.error ?? '脚本生成失败' }
  }

  // 清理可能的 markdown 代码块标记
  let scriptCode = llmResult.text.trim()
  if (scriptCode.startsWith('```python')) {
    scriptCode = scriptCode.replace(/^```python\n?/, '').replace(/\n?```$/, '')
  } else if (scriptCode.startsWith('```')) {
    scriptCode = scriptCode.replace(/^```\n?/, '').replace(/\n?```$/, '')
  }

  const { writeFileSync } = await import('node:fs')
  writeFileSync(scriptPath, scriptCode, 'utf-8')

  return { scriptPath, success: true }
}

/**
 * 执行 Python 脚本
 */
function runPythonScript(scriptPath: string, taskDir: string): Promise<{
  success: boolean
  stdout: string
  stderr: string
  error?: string
}> {
  return new Promise((resolve) => {
    const outputFormat = 'json' // 脚本内部自行决定，这里仅提供默认值
    const resultFilePath = join(taskDir, `result.${outputFormat}`)
    const screenshotFilePath = join(taskDir, 'screenshot.png')

    const child = spawn('python3', [scriptPath], {
      cwd: taskDir,
      env: {
        ...process.env,
        RESULT_FILE: resultFilePath,
        SCREENSHOT_FILE: screenshotFilePath,
      },
      stdio: 'pipe',
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString('utf-8')
    })

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString('utf-8')
    })

    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
    }, SCRIPT_TIMEOUT_MS)

    child.on('close', (code) => {
      clearTimeout(timeout)
      if (code === 0) {
        resolve({ success: true, stdout, stderr })
      } else {
        resolve({
          success: false,
          stdout,
          stderr,
          error: `脚本退出码 ${code ?? 'unknown'}`,
        })
      }
    })

    child.on('error', (err: Error) => {
      clearTimeout(timeout)
      resolve({ success: false, stdout, stderr, error: err.message })
    })
  })
}

/**
 * 读取结果文件内容摘要
 */
function readResultSummary(taskDir: string, outputFormat: string): string {
  const resultFileName = `result.${outputFormat === 'markdown' ? 'md' : outputFormat}`
  const resultPath = join(taskDir, resultFileName)
  if (!existsSync(resultPath)) {
    return ''
  }

  try {
    const content = readFileSync(resultPath, 'utf-8')
    return content.slice(0, 2000)
  } catch {
    return ''
  }
}

/**
 * 执行爬取任务
 */
export async function executeScrapingTask(input: ScrapingTaskInput): Promise<ScrapingTaskResult> {
  const taskDir = createTaskDir()
  const outputFormat: NonNullable<ScrapingTaskInput['outputFormat']> = input.outputFormat ?? DEFAULT_OUTPUT_FORMAT

  try {
    // 1. 生成脚本
    const scriptResult = await generateScrapingScript(input, taskDir, outputFormat)
    if (!scriptResult.success) {
      return {
        success: false,
        summary: '',
        taskDir,
        error: scriptResult.error,
      }
    }

    // 2. 执行脚本
    const runResult = await runPythonScript(scriptResult.scriptPath, taskDir)

    // 3. 检查结果文件
    const resultFileName = `result.${outputFormat === 'markdown' ? 'md' : outputFormat}`
    const resultPath = join(taskDir, resultFileName)
    const screenshotPath = join(taskDir, 'screenshot.png')

    const resultExists = existsSync(resultPath)
    const screenshotExists = existsSync(screenshotPath)

    const resultSummary = readResultSummary(taskDir, outputFormat)
    const summaryLines: string[] = []

    if (runResult.success && resultExists) {
      summaryLines.push(`✅ 爬取任务完成`)
      summaryLines.push(`结果文件：${resultFileName}`)
      if (screenshotExists) {
        summaryLines.push(`页面截图：screenshot.png`)
      }
      if (resultSummary) {
        summaryLines.push(`数据预览：\n${resultSummary}`)
      }
    } else {
      summaryLines.push(`⚠️ 爬取任务未完全成功`)
      if (runResult.error) {
        summaryLines.push(`错误：${runResult.error}`)
      }
      if (runResult.stderr) {
        summaryLines.push(`stderr：${runResult.stderr.slice(0, 500)}`)
      }
      if (screenshotExists) {
        summaryLines.push(`已保存页面截图：screenshot.png`)
      }
    }

    return {
      success: runResult.success && resultExists,
      summary: summaryLines.join('\n'),
      taskDir,
      resultFile: resultExists ? resultFileName : undefined,
      screenshotFile: screenshotExists ? 'screenshot.png' : undefined,
      scriptFile: 'script.py',
    }
  } catch (error) {
    return {
      success: false,
      summary: '',
      taskDir,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * 清理指定任务目录
 */
export function cleanupScrapingTask(taskDir: string): void {
  if (existsSync(taskDir)) {
    rmSync(taskDir, { recursive: true, force: true })
  }
}
