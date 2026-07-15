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

import { join, dirname } from 'node:path'
import {
  mkdirSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
  cpSync,
} from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { getConfigDir } from '../config-paths.ts'
import { completePrompt } from '../ma-tools/llm-service.ts'

export interface ScrapingTaskInput {
  /** 任务自然语言描述 */
  task: string
  /** 起始 URL */
  url: string
  /** 输出格式 */
  outputFormat?: 'json' | 'csv' | 'markdown'
}

export interface ScrapingTaskOptions {
  /** 持久浏览器 Profile 目录 */
  userDataDir?: string
  /** Cookie 文本（JSON 数组格式，兼容 Playwright add_cookies） */
  cookies?: string
  /** 是否使用 headless 模式，默认 true */
  headless?: boolean
  /** 代理服务器，例如 http://user:pass@host:port */
  proxy?: string
  /** 自定义 User-Agent */
  userAgent?: string
  /** 任务超时（毫秒），默认 60000 */
  timeoutMs?: number
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
const PROFILES_DIR_NAME = 'browser-profiles'
const DEFAULT_OUTPUT_FORMAT: NonNullable<ScrapingTaskInput['outputFormat']> = 'json'
const DEFAULT_SCRIPT_TIMEOUT_MS = 60_000

/** 环境检查结果缓存 */
let pythonPlaywrightCheckCache: { available: boolean; message: string } | null = null

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
 * 获取默认浏览器 Profile 根目录
 */
export function getBrowserProfilesRootDir(): string {
  const dir = join(getConfigDir(), PROFILES_DIR_NAME)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * 根据 URL 获取默认 Profile 目录
 */
export function getDefaultUserDataDir(url: string): string {
  try {
    const hostname = new URL(url).hostname
    return join(getBrowserProfilesRootDir(), hostname)
  } catch {
    return join(getBrowserProfilesRootDir(), 'default')
  }
}

/**
 * 检查 python3 和 playwright 是否可用
 */
export function checkPythonAndPlaywright(): { available: boolean; message: string } {
  if (pythonPlaywrightCheckCache) {
    return pythonPlaywrightCheckCache
  }

  const pythonCheck = spawnSync('python3', ['--version'], {
    encoding: 'utf-8',
    timeout: 5000,
  })
  if (pythonCheck.error || pythonCheck.status !== 0) {
    const result = {
      available: false,
      message: '未检测到 python3，请先安装 Python 3.10+',
    }
    pythonPlaywrightCheckCache = result
    return result
  }

  const pythonVersion = pythonCheck.stdout.trim() || pythonCheck.stderr.trim()
  const playwrightCheck = spawnSync(
    'python3',
    ['-c', 'from playwright.sync_api import sync_playwright; print("playwright ok")'],
    {
      encoding: 'utf-8',
      timeout: 5000,
    },
  )
  if (playwrightCheck.error || playwrightCheck.status !== 0) {
    const stderr = playwrightCheck.stderr?.trim() || ''
    const result = {
      available: false,
      message: `${pythonVersion} 已安装，但未检测到 playwright Python 包或 Chromium 未安装。请运行：\npip install playwright\npython3 -m playwright install chromium\n\n原始错误：${stderr.slice(0, 200)}`,
    }
    pythonPlaywrightCheckCache = result
    return result
  }

  const result = {
    available: true,
    message: `${pythonVersion}，playwright 已安装（${playwrightCheck.stdout.trim()}）`,
  }
  pythonPlaywrightCheckCache = result
  return result
}

/**
 * 清除环境检查缓存（用于安装依赖后刷新）
 */
export function resetPythonPlaywrightCheck(): void {
  pythonPlaywrightCheckCache = null
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

/** Playwright add_cookies 兼容的 Cookie 结构 */
export interface ScraperCookie {
  name: string
  value: string
  domain: string
  path: string
  expires?: number
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
}

/**
 * 解析 Cookie 文本为 Playwright Cookie 数组（纯函数，便于测试）
 *
 * 支持两种输入：
 * 1. JSON 数组（Playwright cookie 格式）-> 原样返回
 * 2. Netscape cookies.txt 格式 -> 转换为 JSON 数组
 *
 * 解析失败或无有效条目时返回空数组。
 */
export function parseCookiesText(cookiesText: string): ScraperCookie[] {
  const raw = cookiesText.trim()
  if (!raw) return []

  // 尝试解析为 JSON
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed as ScraperCookie[]
    }
  } catch {
    // 不是 JSON，尝试 Netscape 格式
  }

  // Netscape 格式转换
  const lines = raw.split('\n')
  const cookies: ScraperCookie[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const parts = trimmed.split('\t')
    if (parts.length < 7) continue
    const rawDomain = parts[0]!
    const rawPath = parts[2]!
    const rawSecure = parts[3]!
    const rawExpires = parts[4]!
    const rawName = parts[5]!
    const rawValue = parts[6]!
    cookies.push({
      domain: rawDomain.startsWith('.') ? rawDomain : `.${rawDomain}`,
      name: rawName,
      value: rawValue,
      path: rawPath,
      secure: rawSecure === 'TRUE',
      expires: Number(rawExpires) > 0 ? Number(rawExpires) : undefined,
      httpOnly: false,
      sameSite: 'Lax',
    })
  }

  return cookies
}

/**
 * 准备 Cookie 文件
 *
 * 支持两种输入：
 * 1. JSON 数组（Playwright cookie 格式）-> 直接保存为 cookies.json
 * 2. Netscape 格式 -> 转换为 JSON 数组后保存
 */
function prepareCookiesFile(cookiesText: string, taskDir: string): string | undefined {
  const cookies = parseCookiesText(cookiesText)
  if (cookies.length === 0) return undefined

  const cookiesPath = join(taskDir, 'cookies.json')
  writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2), 'utf-8')
  return cookiesPath
}

/**
 * 准备用户数据目录
 *
 * 为了避免多任务并发修改同一个 Profile，先将源 Profile 复制到任务目录，
 * 任务结束后再写回源目录（如果任务成功）。
 */
function prepareUserDataDir(sourceDir: string | undefined, taskDir: string): string | undefined {
  if (!sourceDir) return undefined

  if (!existsSync(sourceDir)) {
    mkdirSync(sourceDir, { recursive: true })
  }

  const taskProfileDir = join(taskDir, 'profile')
  if (existsSync(sourceDir)) {
    try {
      cpSync(sourceDir, taskProfileDir, { recursive: true })
    } catch (error) {
      console.warn('[Browser Automation] 复制 Profile 失败，将直接使用源目录:', error)
      return sourceDir
    }
  } else {
    mkdirSync(taskProfileDir, { recursive: true })
  }

  return taskProfileDir
}

/**
 * 将任务目录中的 Profile 写回源目录
 */
function writeBackUserDataDir(
  sourceDir: string | undefined,
  taskProfileDir: string | undefined,
): void {
  if (!sourceDir || !taskProfileDir) return
  if (!existsSync(taskProfileDir)) return
  try {
    // 源目录可能在此过程中被其他任务修改，简单覆盖。
    // 如需严格并发控制，后续可加文件锁。
    cpSync(taskProfileDir, sourceDir, { recursive: true, force: true })
  } catch (error) {
    console.warn('[Browser Automation] 写回 Profile 失败:', error)
  }
}

/**
 * 生成 Playwright Python 脚本
 */
async function generateScrapingScript(
  input: ScrapingTaskInput,
  taskDir: string,
  outputFormat: NonNullable<ScrapingTaskInput['outputFormat']>,
  options: Required<Pick<ScrapingTaskOptions, 'headless'>> &
    Pick<ScrapingTaskOptions, 'userDataDir' | 'proxy' | 'userAgent'>,
  cookiesPath?: string,
): Promise<{ scriptPath: string; success: boolean; error?: string }> {
  const resultFileName = `result.${outputFormat === 'markdown' ? 'md' : outputFormat}`
  const screenshotFileName = 'screenshot.png'
  const scriptFileName = 'script.py'

  const resultFilePath = join(taskDir, resultFileName)
  const screenshotFilePath = join(taskDir, screenshotFileName)
  const scriptPath = join(taskDir, scriptFileName)

  const hasUserDataDir = !!options.userDataDir
  const hasCookies = !!cookiesPath
  const hasProxy = !!options.proxy
  const hasUserAgent = !!options.userAgent

  const systemPrompt = `你是一名专业的 Web 爬虫工程师。请根据用户任务生成一个完整的、可独立运行的 Python + Playwright 脚本。

反爬与风控要求：
1. 每次页面操作（点击、输入、滚动、跳转）后必须添加随机时间间隔
2. 随机等待时间范围：0.5 秒到 3 秒（使用 random.uniform(0.5, 3.0) 或 random.randint(500, 3000)）
3. 不要在脚本中使用固定 sleep 时间
4. 滚动加载时，每滚动一屏后随机等待 1-3 秒再继续
5. 翻页/加载更多时，每页之间随机等待 2-4 秒
6. 遇到反爬或验证码时，保存当前截图并优雅退出，不要无限重试

技术要求：
1. 使用 Playwright 同步 API（from playwright.sync_api import sync_playwright）
2. 通过环境变量 HEADLESS 控制是否 headless（HEADLESS == 'true' 时用 headless，否则用有界面窗口）
3. ${hasUserDataDir ? '通过环境变量 USER_DATA_DIR 读取持久 Profile 路径，使用 browser.launch_persistent_context(USER_DATA_DIR, ...)' : '使用 browser.new_context() 创建新上下文'}
4. ${hasCookies ? '通过环境变量 COOKIES_FILE 读取 cookies.json 路径，在创建 context 后调用 context.add_cookies(json.load(open(COOKIES_FILE))) 注入登录态' : '不需要注入 Cookie'}
5. ${hasProxy ? '通过环境变量 PROXY 设置代理，在 launch/context 中传入 proxy={"server": PROXY}' : '不需要代理'}
6. ${hasUserAgent ? '通过环境变量 USER_AGENT 自定义 User-Agent，在 context 创建时传入 user_agent=USER_AGENT' : '使用正常浏览器 User-Agent，不要暴露 Playwright/HeadlessChrome'}
7. 启动参数加入 ["--disable-blink-features=AutomationControlled"] 以降低被检测概率
8. 设置 viewport={"width": 1280, "height": 800}、locale='zh-CN'、timezone_id='Asia/Shanghai'
9. 只访问用户指定的 URL 及其同域名页面
10. 等待关键元素加载完成后再提取数据
11. 处理滚动加载、分页等常见情况，但限制总条目数不超过 50 条
12. 将结果保存到 RESULT_FILE 指定的路径
13. 同时保存一张最终页面截图到 SCREENSHOT_FILE 指定的路径
14. 添加 try/finally 确保浏览器关闭
15. 脚本中通过环境变量读取 RESULT_FILE 和 SCREENSHOT_FILE
16. 只输出可执行的 Python 代码，不要输出任何解释文字或 markdown 代码块标记`

  const prompt = `任务：${input.task}
目标 URL：${input.url}
输出格式：${outputFormat}
${hasUserDataDir ? `持久 Profile 路径（环境变量 USER_DATA_DIR）：${options.userDataDir}` : '不使用持久 Profile'}
${hasCookies ? `Cookie 文件路径（环境变量 COOKIES_FILE）：${cookiesPath}` : '不注入 Cookie'}
${hasProxy ? `代理（环境变量 PROXY）：${options.proxy}` : '不使用代理'}
${hasUserAgent ? `User-Agent（环境变量 USER_AGENT）：${options.userAgent}` : '使用默认 User-Agent'}
结果保存路径（环境变量 RESULT_FILE）：${resultFilePath}
截图保存路径（环境变量 SCREENSHOT_FILE）：${screenshotFilePath}

请生成 Python 脚本。脚本需要：
- 导入 os 模块读取 RESULT_FILE、SCREENSHOT_FILE、HEADLESS、USER_DATA_DIR、COOKIES_FILE、PROXY、USER_AGENT
- 使用 json/csv/markdown 库按格式保存数据
- 输出简洁的爬取结果摘要到 stdout`

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

  writeFileSync(scriptPath, scriptCode, 'utf-8')

  return { scriptPath, success: true }
}

/**
 * 执行 Python 脚本
 */
function runPythonScript(
  scriptPath: string,
  taskDir: string,
  env: Record<string, string>,
  timeoutMs: number,
): Promise<{
  success: boolean
  stdout: string
  stderr: string
  error?: string
}> {
  return new Promise((resolve) => {
    const child = spawn('python3', [scriptPath], {
      cwd: taskDir,
      env: {
        ...process.env,
        ...env,
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
    }, timeoutMs)

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
export async function executeScrapingTask(
  input: ScrapingTaskInput,
  options: ScrapingTaskOptions = {},
): Promise<ScrapingTaskResult> {
  const taskDir = createTaskDir()
  const outputFormat: NonNullable<ScrapingTaskInput['outputFormat']> =
    input.outputFormat ?? DEFAULT_OUTPUT_FORMAT
  const timeoutMs = options.timeoutMs ?? DEFAULT_SCRIPT_TIMEOUT_MS
  const headless = options.headless ?? true

  // 准备 Profile 和 Cookie
  const userDataDir = options.userDataDir
    ? prepareUserDataDir(options.userDataDir, taskDir)
    : undefined
  const cookiesPath = options.cookies ? prepareCookiesFile(options.cookies, taskDir) : undefined

  try {
    // 1. 生成脚本
    const scriptResult = await generateScrapingScript(
      input,
      taskDir,
      outputFormat,
      {
        headless,
        userDataDir,
        proxy: options.proxy,
        userAgent: options.userAgent,
      },
      cookiesPath,
    )
    if (!scriptResult.success) {
      return {
        success: false,
        summary: '',
        taskDir,
        error: scriptResult.error,
      }
    }

    // 2. 执行脚本
    const env: Record<string, string> = {
      RESULT_FILE: join(taskDir, `result.${outputFormat === 'markdown' ? 'md' : outputFormat}`),
      SCREENSHOT_FILE: join(taskDir, 'screenshot.png'),
      HEADLESS: headless ? 'true' : 'false',
    }
    if (userDataDir) env.USER_DATA_DIR = userDataDir
    if (cookiesPath) env.COOKIES_FILE = cookiesPath
    if (options.proxy) env.PROXY = options.proxy
    if (options.userAgent) env.USER_AGENT = options.userAgent

    const runResult = await runPythonScript(scriptResult.scriptPath, taskDir, env, timeoutMs)

    // 3. 写回 Profile（保留登录态）
    if (runResult.success && options.userDataDir && userDataDir) {
      writeBackUserDataDir(options.userDataDir, userDataDir)
    }

    // 4. 检查结果文件
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
