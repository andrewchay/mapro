/**
 * Browser Automation Service
 *
 * 提供基于 Playwright 的浏览器自动化能力：
 * 1. 根据任务描述生成 Python + Playwright 脚本
 * 2. 在隔离目录中执行脚本
 * 3. 收集结果文件与截图
 * 4. 支持批量 URL、失败重试、自定义脚本模板、KOL 数据库导入
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
import { buildScriptEnv } from './script-env.ts'
import { upsertKOL, type KOLRecord } from '../ma-tools/kol-data-service.ts'

export interface ScrapingTaskInput {
  /** 任务自然语言描述 */
  task: string
  /** 起始 URL（与 urls 二选一） */
  url?: string
  /** 批量 URL 列表（与 url 二选一） */
  urls?: string[]
  /** 输出格式 */
  outputFormat?: 'json' | 'csv' | 'markdown'
  /** 成功后是否将 JSON 结果导入 KOL 数据库 */
  importToKolDatabase?: boolean
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
  /** 失败重试次数，默认 0 */
  maxRetries?: number
  /** 自定义脚本模板（支持 {{task}} {{url}} 等占位符） */
  scriptTemplate?: string
  /** 是否使用系统 Chrome 而非 Playwright 内置 Chromium */
  useSystemChrome?: boolean
  /** Chrome 可执行文件路径（可选） */
  chromeExecutablePath?: string
  /** Chrome CDP 远程调试端口（可选） */
  chromeRemoteDebuggingPort?: string
  /** 最小操作间隔（毫秒），默认 0 */
  minActionDelayMs?: number
  /** 最大操作间隔（毫秒），默认 0 */
  maxActionDelayMs?: number
}

export interface ScrapingTaskResult {
  /** 是否成功 */
  success: boolean
  /** 结果摘要 */
  summary: string
  /** 任务目录路径 */
  taskDir: string
  /** 单 URL 结果文件相对路径 */
  resultFile?: string
  /** 批量结果文件相对路径列表 */
  resultFiles?: string[]
  /** 单 URL 截图文件相对路径 */
  screenshotFile?: string
  /** 批量截图文件相对路径列表 */
  screenshotFiles?: string[]
  /** 原始脚本文件相对路径 */
  scriptFile?: string
  /** 错误信息 */
  error?: string
  /** KOL 数据库导入结果 */
  kolImport?: { inserted: number; errors: string[] }
}

const SCRAPED_DIR_NAME = 'scraped'
const PROFILES_DIR_NAME = 'browser-profiles'
const DEFAULT_OUTPUT_FORMAT: NonNullable<ScrapingTaskInput['outputFormat']> = 'json'

/**
 * 结果文件名统一规则：markdown 输出实际落盘为 result.md。
 * 生成、校验、读取必须使用同一映射，避免重试逻辑误判产物缺失。
 */
function getResultFileName(outputFormat: string): string {
  return `result.${outputFormat === 'markdown' ? 'md' : outputFormat}`
}
const DEFAULT_SCRIPT_TIMEOUT_MS = 60_000
const DEFAULT_MAX_RETRIES = 0

/**
 * 解析用户配置的 timeoutMs
 *
 * 兼容旧版本按秒保存的凭据：
 * - 数值 >= 1000 视为毫秒
 * - 数值 < 1000 视为秒，转换为毫秒
 */
export function resolveTimeoutMs(timeoutMs: string | number | undefined): number {
  if (timeoutMs === undefined || timeoutMs === '') return DEFAULT_SCRIPT_TIMEOUT_MS
  const numeric = typeof timeoutMs === 'number' ? timeoutMs : Number(timeoutMs)
  if (Number.isNaN(numeric) || numeric <= 0) return DEFAULT_SCRIPT_TIMEOUT_MS
  return numeric < 1000 ? numeric * 1000 : numeric
}

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
  if (sourceDir === taskProfileDir) return
  try {
    // 源目录可能在此过程中被其他任务修改，简单覆盖。
    // 如需严格并发控制，后续可加文件锁。
    cpSync(taskProfileDir, sourceDir, { recursive: true, force: true })
  } catch (error) {
    console.warn('[Browser Automation] 写回 Profile 失败:', error)
  }
}

/**
 * 替换脚本模板中的占位符
 */
function renderScriptTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? `{{${key}}}`)
}

/**
 * 生成默认的系统提示词
 */
function buildDefaultSystemPrompt(options: {
  hasUserDataDir: boolean
  hasCookies: boolean
  hasProxy: boolean
  hasUserAgent: boolean
  useSystemChrome: boolean
  hasChromeExecutablePath: boolean
  hasChromeRemoteDebuggingPort: boolean
  minActionDelayMs: number
  maxActionDelayMs: number
}): string {
  const delayHint =
    options.minActionDelayMs > 0 && options.maxActionDelayMs >= options.minActionDelayMs
      ? `每次操作后调用 random_wait()，等待 ${options.minActionDelayMs}-${options.maxActionDelayMs} 毫秒`
      : '每次操作后调用 random_wait()，默认等待 500-3000 毫秒'

  return `你是一名专业的 Web 爬虫工程师。请根据用户任务生成一个完整的、可独立运行的 Python + Playwright 脚本。

反爬与风控要求：
1. 每次页面操作（点击、输入、滚动、跳转、翻页）后必须调用 random_wait() 添加随机时间间隔
2. ${delayHint}
3. 不要在脚本中使用固定 sleep 时间
4. 滚动加载时，每滚动一屏后随机等待再继续
5. 翻页/加载更多时，每页之间随机等待
6. 遇到反爬或验证码时，保存当前截图并优雅退出，不要无限重试

浏览器启动要求（必须按以下顺序选择）：
1. 如果环境变量 CHROME_REMOTE_DEBUGGING_PORT 有值，使用 connect_over_cdp(f'http://127.0.0.1:{CHROME_REMOTE_DEBUGGING_PORT}') 连接已启动的 Chrome
2. 否则如果 USE_SYSTEM_CHROME == 'true'，使用 chromium.launch_persistent_context(..., channel='chrome'${options.hasChromeExecutablePath ? ', executable_path=os.environ["CHROME_EXECUTABLE_PATH"]' : ''}) 或 chromium.launch(..., channel='chrome')
3. 否则使用默认 Chromium
4. 启动参数加入 ["--disable-blink-features=AutomationControlled"] 以降低被检测概率
5. 设置 viewport={"width": 1280, "height": 800}、locale='zh-CN'、timezone_id='Asia/Shanghai'
6. 如果通过 CDP 连接外部 Chrome，只能关闭自己打开的 page，禁止调用 context.close() 或 browser.close()，避免关闭用户已有的浏览器上下文

技术要求：
1. 使用 Playwright 同步 API（from playwright.sync_api import sync_playwright）
2. 通过环境变量 HEADLESS 控制是否 headless（HEADLESS == 'true' 时用 headless，否则用有界面窗口）
3. ${options.hasUserDataDir ? '通过环境变量 USER_DATA_DIR 读取持久 Profile 路径' : '使用 browser.new_context() 创建新上下文'}
4. ${options.hasCookies ? '通过环境变量 COOKIES_FILE 读取 cookies.json 路径，在创建 context 后调用 context.add_cookies(json.load(open(COOKIES_FILE))) 注入登录态' : '不需要注入 Cookie'}
5. ${options.hasProxy ? '通过环境变量 PROXY 设置代理，在 launch/context 中传入 proxy={"server": PROXY}' : '不需要代理'}
6. ${options.hasUserAgent ? '通过环境变量 USER_AGENT 自定义 User-Agent，在 context 创建时传入 user_agent=USER_AGENT' : '使用正常浏览器 User-Agent，不要暴露 Playwright/HeadlessChrome'}
7. 必须提供 random_wait() 实现：读取 MIN_ACTION_DELAY_MS 和 MAX_ACTION_DELAY_MS 环境变量，使用 time.sleep(random.uniform(...))
8. 只访问用户指定的 URL 及其同域名页面
9. 等待关键元素加载完成后再提取数据
10. 处理滚动加载、分页等常见情况，但限制总条目数不超过 50 条
11. 将结果保存到 RESULT_FILE 指定的路径
12. 同时保存一张最终页面截图到 SCREENSHOT_FILE 指定的路径
13. 添加 try/finally 确保浏览器关闭
14. 脚本中通过环境变量读取 RESULT_FILE 和 SCREENSHOT_FILE
15. 只输出可执行的 Python 代码，不要输出任何解释文字或 markdown 代码块标记`
}

/**
 * 生成 Playwright Python 脚本
 */
async function generateScrapingScript(
  input: ScrapingTaskInput,
  taskDir: string,
  outputFormat: NonNullable<ScrapingTaskInput['outputFormat']>,
  options: Required<Pick<ScrapingTaskOptions, 'headless'>> &
    Pick<
      ScrapingTaskOptions,
      | 'userDataDir'
      | 'proxy'
      | 'userAgent'
      | 'scriptTemplate'
      | 'useSystemChrome'
      | 'chromeExecutablePath'
      | 'chromeRemoteDebuggingPort'
      | 'minActionDelayMs'
      | 'maxActionDelayMs'
    >,
  cookiesPath?: string,
): Promise<{ scriptPath: string; success: boolean; error?: string }> {
  const resultFileName = getResultFileName(outputFormat)
  const screenshotFileName = 'screenshot.png'
  const scriptFileName = 'script.py'

  const resultFilePath = join(taskDir, resultFileName)
  const screenshotFilePath = join(taskDir, screenshotFileName)
  const scriptPath = join(taskDir, scriptFileName)

  const hasUserDataDir = !!options.userDataDir
  const hasCookies = !!cookiesPath
  const hasProxy = !!options.proxy
  const hasUserAgent = !!options.userAgent
  const useSystemChrome = options.useSystemChrome ?? false
  const chromeRemoteDebuggingPort = options.chromeRemoteDebuggingPort
  const minActionDelayMs = options.minActionDelayMs ?? 0
  const maxActionDelayMs = options.maxActionDelayMs ?? 0

  const variables: Record<string, string> = {
    task: input.task,
    url: input.url ?? '',
    urls: input.urls ? JSON.stringify(input.urls) : '[]',
    outputFormat,
    resultFile: resultFilePath,
    screenshotFile: screenshotFilePath,
    userDataDir: options.userDataDir ?? '',
    cookiesFile: cookiesPath ?? '',
    proxy: options.proxy ?? '',
    userAgent: options.userAgent ?? '',
    headless: options.headless ? 'true' : 'false',
    useSystemChrome: useSystemChrome ? 'true' : 'false',
    chromeExecutablePath: options.chromeExecutablePath ?? '',
    chromeRemoteDebuggingPort: chromeRemoteDebuggingPort ?? '',
    minActionDelayMs: String(minActionDelayMs),
    maxActionDelayMs: String(maxActionDelayMs),
  }

  let scriptCode: string

  if (options.scriptTemplate) {
    // 使用自定义脚本模板，直接渲染变量后作为最终脚本，跳过 LLM
    scriptCode = renderScriptTemplate(options.scriptTemplate, variables)
  } else {
    const systemPrompt = buildDefaultSystemPrompt({
      hasUserDataDir,
      hasCookies,
      hasProxy,
      hasUserAgent,
      useSystemChrome,
      hasChromeExecutablePath: !!options.chromeExecutablePath,
      hasChromeRemoteDebuggingPort: !!chromeRemoteDebuggingPort,
      minActionDelayMs,
      maxActionDelayMs,
    })
    const prompt = `任务：${input.task}
目标 URL：${input.url ?? input.urls?.join(', ') ?? ''}
输出格式：${outputFormat}
${hasUserDataDir ? `持久 Profile 路径（环境变量 USER_DATA_DIR）：${options.userDataDir}` : '不使用持久 Profile'}
${hasCookies ? `Cookie 文件路径（环境变量 COOKIES_FILE）：${cookiesPath}` : '不注入 Cookie'}
${hasProxy ? `代理（环境变量 PROXY）：${options.proxy}` : '不使用代理'}
${hasUserAgent ? `User-Agent（环境变量 USER_AGENT）：${options.userAgent}` : '使用默认 User-Agent'}
${useSystemChrome ? '使用系统 Chrome（环境变量 USE_SYSTEM_CHROME=true）' : '使用 Playwright 内置 Chromium'}
${options.chromeExecutablePath ? `Chrome 路径（环境变量 CHROME_EXECUTABLE_PATH）：${options.chromeExecutablePath}` : ''}
${chromeRemoteDebuggingPort ? `CDP 端口（环境变量 CHROME_REMOTE_DEBUGGING_PORT）：${chromeRemoteDebuggingPort}` : ''}
操作间隔：${minActionDelayMs}-${maxActionDelayMs} 毫秒
结果保存路径（环境变量 RESULT_FILE）：${resultFilePath}
截图保存路径（环境变量 SCREENSHOT_FILE）：${screenshotFilePath}

请生成 Python 脚本。脚本需要：
- 导入 os、time、random
- 读取 RESULT_FILE、SCREENSHOT_FILE、HEADLESS、USER_DATA_DIR、COOKIES_FILE、PROXY、USER_AGENT、USE_SYSTEM_CHROME、CHROME_EXECUTABLE_PATH、CHROME_REMOTE_DEBUGGING_PORT、MIN_ACTION_DELAY_MS、MAX_ACTION_DELAY_MS
- 使用系统 Chrome（USE_SYSTEM_CHROME=true 时 channel='chrome'，并可指定 executable_path）或 CDP（CHROME_REMOTE_DEBUGGING_PORT 时 connect_over_cdp）
- 定义 random_wait() 函数，在每次点击、输入、滚动、跳转后调用
- 使用 json/csv/markdown 库按格式保存数据
- 输出简洁的爬取结果摘要到 stdout`

    const llmResult = await completePrompt(prompt, systemPrompt, { jsonMode: false })
    if (!llmResult.success || !llmResult.text) {
      return { scriptPath, success: false, error: llmResult.error ?? '脚本生成失败' }
    }

    // 清理可能的 markdown 代码块标记
    scriptCode = llmResult.text.trim()
    if (scriptCode.startsWith('```python')) {
      scriptCode = scriptCode.replace(/^```python\n?/, '').replace(/\n?```$/, '')
    } else if (scriptCode.startsWith('```')) {
      scriptCode = scriptCode.replace(/^```\n?/, '').replace(/\n?```$/, '')
    }
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
      // 最小环境白名单：不向 LLM 生成的脚本暴露 API Key 等敏感环境变量
      env: buildScriptEnv(env),
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
 * 执行 Python 脚本（带重试）
 */
async function runPythonScriptWithRetries(
  scriptPath: string,
  taskDir: string,
  env: Record<string, string>,
  timeoutMs: number,
  maxRetries: number,
): Promise<ReturnType<typeof runPythonScript> extends Promise<infer T> ? T : never> {
  let lastResult = await runPythonScript(scriptPath, taskDir, env, timeoutMs)

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const resultFileName = getResultFileName(env.OUTPUT_FORMAT ?? 'json')
    const resultPath = join(taskDir, resultFileName)
    const screenshotPath = join(taskDir, 'screenshot.png')
    const resultExists = existsSync(resultPath)
    const screenshotExists = existsSync(screenshotPath)

    if (lastResult.success && resultExists) {
      return lastResult
    }

    console.warn(`[Browser Automation] 第 ${attempt} 次重试...`)
    lastResult = await runPythonScript(scriptPath, taskDir, env, timeoutMs)
  }

  return lastResult
}

/**
 * 读取结果文件内容摘要
 */
function readResultSummary(taskDir: string, outputFormat: string): string {
  const resultFileName = getResultFileName(outputFormat)
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
 * 将爬取结果导入 KOL 数据库
 *
 * 期望 result.json 为对象数组，每个对象至少包含 name、platform、followers 等字段。
 * 缺少的字段会填充默认值。
 */
export function importScrapedResultToKolDatabase(
  resultPath: string,
): { inserted: number; errors: string[] } {
  const result: { inserted: number; errors: string[] } = { inserted: 0, errors: [] }

  if (!existsSync(resultPath)) {
    result.errors.push('结果文件不存在')
    return result
  }

  let items: unknown[]
  try {
    const content = readFileSync(resultPath, 'utf-8')
    const parsed = JSON.parse(content)
    items = Array.isArray(parsed) ? parsed : [parsed]
  } catch (error) {
    result.errors.push(`解析结果文件失败: ${error instanceof Error ? error.message : String(error)}`)
    return result
  }

  for (const raw of items) {
    if (typeof raw !== 'object' || raw === null) {
      result.errors.push('跳过非对象条目')
      continue
    }

    const item = raw as Record<string, unknown>
    const name = String(item.name ?? item.nickname ?? item.username ?? '')
    if (!name) {
      result.errors.push('跳过缺少 name 的条目')
      continue
    }

    const platform = String(item.platform ?? 'unknown')
    const id = String(item.id ?? `${platform}-${name}`)
    const followers = String(item.followers ?? item.fanCount ?? item.fans ?? 0)
    const engagement = String(item.engagement ?? item.engagementRate ?? item.interaction ?? 0)
    const category = String(item.category ?? item.tag ?? '')
    const price = String(item.price ?? item.quote ?? 0)
    const city = String(item.city ?? '')
    const avatar = String(item.avatar ?? item.avatarUrl ?? item.profileImage ?? '')
    const source = String(item.source ?? 'web-scraper')

    try {
      upsertKOL({
        id,
        name,
        platform,
        followers,
        engagement,
        category,
        price,
        city,
        avatar,
        source,
        rawData: JSON.stringify(item),
        extendedData: item.extendedData as KOLRecord['extendedData'],
        valueTags: Array.isArray(item.valueTags) ? item.valueTags.map(String) : undefined,
        riskFlags: Array.isArray(item.riskFlags) ? item.riskFlags.map(String) : undefined,
      } as Parameters<typeof upsertKOL>[0])
      result.inserted++
    } catch (error) {
      result.errors.push(`导入 ${name} 失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return result
}

interface SingleScrapingRunOptions {
  headless: boolean
  userDataDir?: string
  proxy?: string
  userAgent?: string
  timeoutMs: number
  maxRetries: number
  scriptTemplate?: string
  useSystemChrome?: boolean
  chromeExecutablePath?: string
  chromeRemoteDebuggingPort?: string
  minActionDelayMs?: number
  maxActionDelayMs?: number
}

/**
 * 执行单 URL 爬取（内部辅助）
 */
async function executeSingleScrapingTask(
  input: Omit<ScrapingTaskInput, 'urls'> & { url: string },
  options: SingleScrapingRunOptions,
  taskDir: string,
  subDir: string,
  sharedCookiesPath?: string,
  sharedUserDataDir?: string,
): Promise<{
  success: boolean
  summary: string
  resultFile?: string
  screenshotFile?: string
  scriptFile?: string
  error?: string
}> {
  const baseDir = subDir ? join(taskDir, subDir) : taskDir
  if (subDir) {
    mkdirSync(baseDir, { recursive: true })
  }

  const outputFormat: 'json' | 'csv' | 'markdown' = input.outputFormat ?? DEFAULT_OUTPUT_FORMAT
  const headless = options.headless

  // 准备 Profile 和 Cookie（单任务复用共享的；如无共享则按原逻辑准备）
  const userDataDir = sharedUserDataDir ?? prepareUserDataDir(options.userDataDir, baseDir)
  const cookiesPath = sharedCookiesPath

  try {
    const scriptResult = await generateScrapingScript(
      input,
      baseDir,
      outputFormat,
      {
        headless,
        userDataDir,
        proxy: options.proxy,
        userAgent: options.userAgent,
        scriptTemplate: options.scriptTemplate,
        useSystemChrome: options.useSystemChrome,
        chromeExecutablePath: options.chromeExecutablePath,
        chromeRemoteDebuggingPort: options.chromeRemoteDebuggingPort,
        minActionDelayMs: options.minActionDelayMs,
        maxActionDelayMs: options.maxActionDelayMs,
      },
      cookiesPath,
    )
    if (!scriptResult.success) {
      return {
        success: false,
        summary: '',
        error: scriptResult.error,
      }
    }

    const env: Record<string, string> = {
      RESULT_FILE: join(baseDir, getResultFileName(outputFormat)),
      SCREENSHOT_FILE: join(baseDir, 'screenshot.png'),
      OUTPUT_FORMAT: outputFormat,
      HEADLESS: headless ? 'true' : 'false',
    }
    if (userDataDir) env.USER_DATA_DIR = userDataDir
    if (cookiesPath) env.COOKIES_FILE = cookiesPath
    if (options.proxy) env.PROXY = options.proxy
    if (options.userAgent) env.USER_AGENT = options.userAgent
    env.USE_SYSTEM_CHROME = options.useSystemChrome ? 'true' : 'false'
    if (options.chromeExecutablePath) env.CHROME_EXECUTABLE_PATH = options.chromeExecutablePath
    if (options.chromeRemoteDebuggingPort) env.CHROME_REMOTE_DEBUGGING_PORT = options.chromeRemoteDebuggingPort
    env.MIN_ACTION_DELAY_MS = String(options.minActionDelayMs ?? 0)
    env.MAX_ACTION_DELAY_MS = String(options.maxActionDelayMs ?? 0)

    const runResult = await runPythonScriptWithRetries(
      scriptResult.scriptPath,
      baseDir,
      env,
      options.timeoutMs,
      options.maxRetries,
    )

    // 写回 Profile（保留登录态）
    if (runResult.success && options.userDataDir && userDataDir) {
      writeBackUserDataDir(options.userDataDir, userDataDir)
    }

    const resultFileName = getResultFileName(outputFormat)
    const resultPath = join(baseDir, resultFileName)
    const screenshotPath = join(baseDir, 'screenshot.png')

    const resultExists = existsSync(resultPath)
    const screenshotExists = existsSync(screenshotPath)

    const resultSummary = readResultSummary(baseDir, outputFormat)
    const summaryLines: string[] = []

    if (runResult.success && resultExists) {
      summaryLines.push(`✅ 爬取任务完成`)
      summaryLines.push(`结果文件：${subDir ? `${subDir}/${resultFileName}` : resultFileName}`)
      if (screenshotExists) {
        summaryLines.push(`页面截图：${subDir ? `${subDir}/screenshot.png` : 'screenshot.png'}`)
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
        summaryLines.push(`已保存页面截图：${subDir ? `${subDir}/screenshot.png` : 'screenshot.png'}`)
      }
    }

    return {
      success: runResult.success && resultExists,
      summary: summaryLines.join('\n'),
      resultFile: resultExists ? (subDir ? `${subDir}/${resultFileName}` : resultFileName) : undefined,
      screenshotFile: screenshotExists ? (subDir ? `${subDir}/screenshot.png` : 'screenshot.png') : undefined,
      scriptFile: subDir ? `${subDir}/script.py` : 'script.py',
    }
  } catch (error) {
    return {
      success: false,
      summary: '',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * 执行爬取任务
 *
 * 支持单 URL 与批量 URL，批量时会为每个 URL 创建子目录并聚合结果。
 */
export async function executeScrapingTask(
  input: ScrapingTaskInput,
  options: ScrapingTaskOptions = {},
): Promise<ScrapingTaskResult> {
  const taskDir = createTaskDir()
  const outputFormat = input.outputFormat ?? DEFAULT_OUTPUT_FORMAT
  const timeoutMs = options.timeoutMs ?? DEFAULT_SCRIPT_TIMEOUT_MS
  const headless = options.headless ?? true
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES

  // 准备共享 Profile 和 Cookie
  const sharedUserDataDir = options.userDataDir
    ? prepareUserDataDir(options.userDataDir, taskDir)
    : undefined
  const sharedCookiesPath = options.cookies ? prepareCookiesFile(options.cookies, taskDir) : undefined

  const runOptions: SingleScrapingRunOptions = {
    headless,
    userDataDir: options.userDataDir,
    proxy: options.proxy,
    userAgent: options.userAgent,
    timeoutMs,
    maxRetries,
    scriptTemplate: options.scriptTemplate,
    useSystemChrome: options.useSystemChrome,
    chromeExecutablePath: options.chromeExecutablePath,
    chromeRemoteDebuggingPort: options.chromeRemoteDebuggingPort,
    minActionDelayMs: options.minActionDelayMs,
    maxActionDelayMs: options.maxActionDelayMs,
  }

  try {
    const urls: string[] =
      input.urls && input.urls.length > 0
        ? input.urls
        : input.url
          ? [input.url]
          : []

    if (urls.length === 0) {
      return {
        success: false,
        summary: '',
        taskDir,
        error: '缺少 URL 参数',
      }
    }

    const perUrlResults: Awaited<ReturnType<typeof executeSingleScrapingTask>>[] = []

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i]!
      const subDir: string = urls.length > 1 ? `url-${i + 1}` : ''
      const result = await executeSingleScrapingTask(
        { task: input.task, url, outputFormat },
        runOptions,
        taskDir,
        subDir,
        sharedCookiesPath,
        sharedUserDataDir,
      )
      perUrlResults.push(result)
    }

    // 批量任务结束后再写回一次 Profile（单任务已在内部写回）
    if (options.userDataDir && sharedUserDataDir) {
      writeBackUserDataDir(options.userDataDir, sharedUserDataDir)
    }

    const allSuccess = perUrlResults.every((r) => r.success)
    const resultFiles = perUrlResults.map((r) => r.resultFile).filter(Boolean) as string[]
    const screenshotFiles = perUrlResults.map((r) => r.screenshotFile).filter(Boolean) as string[]
    const combinedError = perUrlResults.map((r) => r.error).filter(Boolean).join('\n')

    const summaryLines: string[] = []
    if (urls.length > 1) {
      summaryLines.push(`批量爬取：共 ${urls.length} 个 URL，成功 ${perUrlResults.filter((r) => r.success).length} 个`)
    }
    perUrlResults.forEach((r, i) => {
      summaryLines.push(`\n--- URL ${i + 1}: ${urls[i]} ---`)
      summaryLines.push(r.summary)
      if (r.error) {
        summaryLines.push(`错误：${r.error}`)
      }
    })

    // KOL 数据库导入
    let kolImport: { inserted: number; errors: string[] } | undefined
    if (input.importToKolDatabase && resultFiles.length > 0) {
      kolImport = { inserted: 0, errors: [] }
      for (const relativePath of resultFiles) {
        const fullPath = join(taskDir, relativePath)
        const partial = importScrapedResultToKolDatabase(fullPath)
        kolImport.inserted += partial.inserted
        kolImport.errors.push(...partial.errors)
      }
      summaryLines.push(`\n[ KOL 数据库导入 ] 成功 ${kolImport.inserted} 条，失败 ${kolImport.errors.length} 条`)
    }

    return {
      success: allSuccess,
      summary: summaryLines.join('\n'),
      taskDir,
      resultFile: urls.length === 1 ? resultFiles[0] : undefined,
      resultFiles: urls.length > 1 ? resultFiles : undefined,
      screenshotFile: urls.length === 1 ? screenshotFiles[0] : undefined,
      screenshotFiles: urls.length > 1 ? screenshotFiles : undefined,
      scriptFile: urls.length === 1 ? perUrlResults[0]?.scriptFile : undefined,
      error: combinedError || undefined,
      kolImport,
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
 * Browser Fetch 任务输入
 *
 * 用于 Agent 模式下替代 SDK WebFetch 抓取登录态页面。
 */
export interface BrowserFetchTaskInput {
  /** 目标 URL */
  url: string
  /** 输出格式：html（默认）、text、markdown */
  format?: 'html' | 'text' | 'markdown'
  /** 页面加载后额外等待毫秒数 */
  waitMs?: number
  /** CSS 选择器，命中后只提取该元素内容 */
  selector?: string
}

export interface BrowserFetchTaskOptions {
  /** 持久浏览器 Profile 目录 */
  userDataDir?: string
  /** Cookie 文本（JSON 数组或 Netscape 格式） */
  cookies?: string
  /** 是否 headless，默认 true */
  headless?: boolean
  /** 代理 */
  proxy?: string
  /** 自定义 User-Agent */
  userAgent?: string
  /** 超时（毫秒），默认 60000 */
  timeoutMs?: number
  /** 是否使用系统 Chrome */
  useSystemChrome?: boolean
  /** Chrome 可执行文件路径（可选） */
  chromeExecutablePath?: string
  /** Chrome CDP 远程调试端口（可选） */
  chromeRemoteDebuggingPort?: string
  /** 最小操作间隔（毫秒），默认 0 */
  minActionDelayMs?: number
  /** 最大操作间隔（毫秒），默认 0 */
  maxActionDelayMs?: number
}

export interface BrowserFetchTaskResult {
  success: boolean
  summary: string
  taskDir: string
  resultFile?: string
  screenshotFile?: string
  error?: string
}

const BROWSER_FETCH_DIR_NAME = 'browser-fetches'

function createBrowserFetchTaskDir(): string {
  const taskId = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const dir = join(getConfigDir(), BROWSER_FETCH_DIR_NAME, taskId)
  mkdirSync(dir, { recursive: true })
  return dir
}

export const BROWSER_FETCH_SCRIPT = `import base64
import json
import os
import random
import sys
import time

from playwright.sync_api import sync_playwright

URL = os.environ['URL']
FORMAT = os.environ.get('FORMAT', 'html')
WAIT_MS = int(os.environ.get('WAIT_MS', '0') or '0')
SELECTOR = os.environ.get('SELECTOR', '') or None
RESULT_FILE = os.environ['RESULT_FILE']
SCREENSHOT_FILE = os.environ['SCREENSHOT_FILE']
HEADLESS = os.environ.get('HEADLESS', 'true') == 'true'
USER_DATA_DIR = os.environ.get('USER_DATA_DIR', '') or None
COOKIES_FILE = os.environ.get('COOKIES_FILE', '') or None
PROXY = os.environ.get('PROXY', '') or None
USER_AGENT = os.environ.get('USER_AGENT', '') or None
USE_SYSTEM_CHROME = os.environ.get('USE_SYSTEM_CHROME', '') == 'true'
CHROME_EXECUTABLE_PATH = os.environ.get('CHROME_EXECUTABLE_PATH', '') or None
CHROME_REMOTE_DEBUGGING_PORT = os.environ.get('CHROME_REMOTE_DEBUGGING_PORT', '') or None
MIN_ACTION_DELAY_MS = int(os.environ.get('MIN_ACTION_DELAY_MS', '0') or '0')
MAX_ACTION_DELAY_MS = int(os.environ.get('MAX_ACTION_DELAY_MS', '0') or '0')
IS_CDP = bool(CHROME_REMOTE_DEBUGGING_PORT)

playwright = None
browser = None
context = None
page = None
CDP_CONTEXT_IS_EXTERNAL = False


def random_wait():
    if MIN_ACTION_DELAY_MS > 0 and MAX_ACTION_DELAY_MS >= MIN_ACTION_DELAY_MS:
        time.sleep(random.uniform(MIN_ACTION_DELAY_MS / 1000, MAX_ACTION_DELAY_MS / 1000))


try:
    playwright = sync_playwright().start()
    args = ['--disable-blink-features=AutomationControlled']
    viewport = {'width': 1280, 'height': 800}
    proxy = {'server': PROXY} if PROXY else None

    if IS_CDP:
        browser = playwright.chromium.connect_over_cdp(f'http://127.0.0.1:{CHROME_REMOTE_DEBUGGING_PORT}')
        if browser.contexts:
            context = browser.contexts[0]
            CDP_CONTEXT_IS_EXTERNAL = True
        else:
            context = browser.new_context(
                viewport=viewport,
                locale='zh-CN',
                timezone_id='Asia/Shanghai',
            )
            CDP_CONTEXT_IS_EXTERNAL = False
    elif USER_DATA_DIR:
        launch_kwargs = {
            'headless': HEADLESS,
            'args': args,
            'viewport': viewport,
            'locale': 'zh-CN',
            'timezone_id': 'Asia/Shanghai',
            'proxy': proxy,
        }
        if USE_SYSTEM_CHROME:
            launch_kwargs['channel'] = 'chrome'
        if CHROME_EXECUTABLE_PATH:
            launch_kwargs['executable_path'] = CHROME_EXECUTABLE_PATH
        context = playwright.chromium.launch_persistent_context(USER_DATA_DIR, **launch_kwargs)
    else:
        launch_kwargs = {
            'headless': HEADLESS,
            'args': args,
            'proxy': proxy,
        }
        if USE_SYSTEM_CHROME:
            launch_kwargs['channel'] = 'chrome'
        if CHROME_EXECUTABLE_PATH:
            launch_kwargs['executable_path'] = CHROME_EXECUTABLE_PATH
        browser = playwright.chromium.launch(**launch_kwargs)
        context = browser.new_context(
            viewport=viewport,
            locale='zh-CN',
            timezone_id='Asia/Shanghai',
        )

    if not IS_CDP:
        if COOKIES_FILE and os.path.exists(COOKIES_FILE):
            try:
                with open(COOKIES_FILE, 'r', encoding='utf-8') as f:
                    cookies = json.load(f)
                if cookies:
                    context.add_cookies(cookies)
            except Exception as e:
                print(f'[browser-fetch] 注入 Cookie 失败: {e}', file=sys.stderr)

        if USER_AGENT:
            context.set_extra_http_headers({'User-Agent': USER_AGENT})

    page = context.new_page()

    if IS_CDP and USER_AGENT:
        page.set_extra_http_headers({'User-Agent': USER_AGENT})

    page.goto(URL, wait_until='networkidle')
    random_wait()

    if WAIT_MS > 0:
        page.wait_for_timeout(WAIT_MS)

    if SELECTOR:
        element = page.query_selector(SELECTOR)
        if element is None:
            raise RuntimeError(f'选择器未命中: {SELECTOR}')
        content = element.inner_html()
    else:
        if FORMAT == 'text':
            title = page.title()
            body_text = page.inner_text('body')
            content = f'{title}\\n\\n{body_text}'
        elif FORMAT == 'markdown':
            html = page.content()
            try:
                from markdownify import markdownify as md
                content = md(html).strip()
            except Exception:
                content = html
        else:
            content = page.content()

    with open(RESULT_FILE, 'w', encoding='utf-8') as f:
        f.write(content)

    raw = page.screenshot(full_page=False, type='png')
    with open(SCREENSHOT_FILE, 'wb') as f:
        f.write(raw)

    print(f'[browser-fetch] 成功获取 {URL}，长度 {len(content)} 字符', flush=True)
except Exception as e:
    print(f'[browser-fetch] 失败: {e}', file=sys.stderr)
    sys.exit(1)
finally:
    try:
        if page:
            page.close()
    except Exception:
        pass
    page = None

    if not IS_CDP or not CDP_CONTEXT_IS_EXTERNAL:
        try:
            if context:
                context.close()
        except Exception:
            pass
        context = None

    if not IS_CDP:
        try:
            if browser:
                browser.close()
        except Exception:
            pass
        browser = None
    else:
        # CDP 复用外部 Chrome：不要关闭用户浏览器，仅断开引用
        context = None
        browser = None

    try:
        if playwright:
            playwright.stop()
    except Exception:
        pass
    playwright = None
`

/**
 * 使用真实浏览器抓取单个页面内容
 *
 * 与 SDK WebFetch 不同：支持持久 Profile 和 Cookie，可抓取登录态页面。
 */
export async function executeBrowserFetchTask(
  input: BrowserFetchTaskInput,
  options: BrowserFetchTaskOptions = {},
): Promise<BrowserFetchTaskResult> {
  const taskDir = createBrowserFetchTaskDir()
  const timeoutMs = options.timeoutMs ?? DEFAULT_SCRIPT_TIMEOUT_MS
  const headless = options.headless ?? true

  try {
    if (!input.url) {
      return { success: false, summary: '', taskDir, error: '缺少 URL 参数' }
    }

    const taskProfileDir = options.userDataDir
      ? prepareUserDataDir(options.userDataDir, taskDir)
      : undefined
    const cookiesPath = options.cookies
      ? prepareCookiesFile(options.cookies, taskDir)
      : undefined

    const scriptPath = join(taskDir, 'script.py')
    writeFileSync(scriptPath, BROWSER_FETCH_SCRIPT, 'utf-8')

    const resultFileName = `result.${input.format ?? 'html'}`
    const resultPath = join(taskDir, resultFileName)
    const screenshotPath = join(taskDir, 'screenshot.png')

    const env: Record<string, string> = {
      URL: input.url,
      FORMAT: input.format ?? 'html',
      WAIT_MS: String(input.waitMs ?? 0),
      SELECTOR: input.selector ?? '',
      RESULT_FILE: resultPath,
      SCREENSHOT_FILE: screenshotPath,
      HEADLESS: headless ? 'true' : 'false',
    }
    if (taskProfileDir) env.USER_DATA_DIR = taskProfileDir
    if (cookiesPath) env.COOKIES_FILE = cookiesPath
    if (options.proxy) env.PROXY = options.proxy
    if (options.userAgent) env.USER_AGENT = options.userAgent
    env.USE_SYSTEM_CHROME = options.useSystemChrome ? 'true' : 'false'
    if (options.chromeExecutablePath) env.CHROME_EXECUTABLE_PATH = options.chromeExecutablePath
    if (options.chromeRemoteDebuggingPort) env.CHROME_REMOTE_DEBUGGING_PORT = options.chromeRemoteDebuggingPort
    env.MIN_ACTION_DELAY_MS = String(options.minActionDelayMs ?? 0)
    env.MAX_ACTION_DELAY_MS = String(options.maxActionDelayMs ?? 0)

    const runResult = await runPythonScript(scriptPath, taskDir, env, timeoutMs)

    if (runResult.success && options.userDataDir && taskProfileDir) {
      writeBackUserDataDir(options.userDataDir, taskProfileDir)
    }

    const resultExists = existsSync(resultPath)
    const screenshotExists = existsSync(screenshotPath)

    let contentPreview = ''
    if (resultExists) {
      const content = readFileSync(resultPath, 'utf-8')
      contentPreview = content.slice(0, 1200)
    }

    if (runResult.success && resultExists) {
      return {
        success: true,
        summary: `✅ 页面抓取完成\nURL：${input.url}\n格式：${input.format ?? 'html'}\n结果文件：${resultFileName}\n页面截图：screenshot.png\n\n内容预览（前 1200 字符）：\n${contentPreview}`,
        taskDir,
        resultFile: resultFileName,
        screenshotFile: screenshotExists ? 'screenshot.png' : undefined,
      }
    }

    return {
      success: false,
      summary: '',
      taskDir,
      error: runResult.error ?? (runResult.stderr || '未生成结果文件'),
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

// ===== 飞书群昵称抓取（CDP 连接已登录飞书网页版的 Chrome） =====

/**
 * 群昵称抓取任务输入
 *
 * 通过 CDP 连接已登录飞书网页版的 Chrome，打开目标群聊并抓取成员群昵称，
 * 用于覆盖 OpenAPI 只能拿到的通讯录姓名（前缀识别依赖群昵称）。
 */
export interface GroupNicknameFetchTaskInput {
  /** 目标群 chatId */
  chatId: string
  /** 群名称（用于 messenger 搜索兜底打开群聊） */
  groupName?: string
  /** 飞书 Web 宿主，如 https://xxx.feishu.cn（可选，脚本会从已打开页面自动推断） */
  feishuWebUrl?: string
  /** OpenAPI 获取的群成员列表（openId + 通讯录姓名），用于与页面显示名匹配 */
  apiMembers: { openId: string; name: string }[]
}

export interface GroupNicknameFetchTaskResult {
  success: boolean
  summary: string
  taskDir: string
  /** 抓取到的群昵称（openId → 群昵称） */
  members: { openId: string; name: string }[]
  /** 网络捕获到的成员 API 响应条数（调试用） */
  capturedCount: number
  /** DOM 文本匹配到的成员数（调试用） */
  domMatchedCount: number
  error?: string
}

export const GROUP_NICKNAME_SCRIPT = `import json
import os
import re
import sys

from playwright.sync_api import sync_playwright

CHAT_ID = os.environ['CHAT_ID']
HOST = os.environ.get('FEISHU_WEB_URL', '').strip().rstrip('/')
GROUP_NAME = os.environ.get('GROUP_NAME', '') or ''
API_MEMBERS_FILE = os.environ['API_MEMBERS_FILE']
RESULT_FILE = os.environ['RESULT_FILE']
SCREENSHOT_FILE = os.environ['SCREENSHOT_FILE']
PORT = os.environ.get('CHROME_REMOTE_DEBUGGING_PORT', '').strip()
MAX_SCROLLS = int(os.environ.get('MAX_SCROLLS', '6') or '6')
SCROLL_DELAY_MS = int(os.environ.get('SCROLL_DELAY_MS', '1500') or '1500')

if not PORT:
    raise SystemExit('缺少 CHROME_REMOTE_DEBUGGING_PORT：本任务必须通过 CDP 连接已登录飞书网页版的 Chrome')

with open(API_MEMBERS_FILE, 'r', encoding='utf-8') as f:
    api_members = json.load(f)

# 通讯录姓名 → openId（用于与页面显示名做前缀匹配）
contact_to_id = {}
for m in api_members:
    name = (m.get('name') or '').strip()
    if name and name not in contact_to_id:
        contact_to_id[name] = m.get('openId', '')


def extract_members(data):
    """递归提取 JSON 中带 open_id + name 的成员对象（内部 API 响应结构启发式）"""
    found = []

    def walk(node):
        if isinstance(node, dict):
            oid = node.get('open_id') or node.get('member_id') or node.get('openId') or node.get('memberId') or node.get('id')
            name = node.get('name') or node.get('nickname') or node.get('display_name')
            if isinstance(oid, str) and oid.startswith('ou_') and isinstance(name, str) and name.strip():
                found.append({'open_id': oid, 'name': name.strip()})
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(data)
    return found


playwright = None
browser = None
context = None
page = None
captured_members = []
captured_urls = []


def on_response(response):
    url = response.url or ''
    if 'feishu.cn' not in url and 'larksuite.com' not in url:
        return
    if 'member' not in url.lower() and '/im/' not in url.lower():
        return
    try:
        data = json.loads(response.body())
    except Exception:
        return
    hits = extract_members(data)
    if hits:
        captured_urls.append(url)
        for h in hits:
            captured_members.append(h)


try:
    playwright = sync_playwright().start()
    browser = playwright.chromium.connect_over_cdp('http://127.0.0.1:' + PORT)
    if not browser.contexts:
        raise RuntimeError('CDP 浏览器没有可用上下文，请确认 Chrome 已启动且登录飞书网页版')
    context = browser.contexts[0]
    page = context.new_page()
    page.on('response', on_response)

    # 确定飞书 Web 宿主：优先显式传入，其次从已打开页面推断
    host = HOST
    if not host:
        for p in context.pages:
            match = re.match(r'(https://[a-z0-9.-]+\\.(?:feishu\\.cn|larksuite\\.com))', p.url or '')
            if match:
                host = match.group(1)
                break
    if not host:
        raise RuntimeError('无法确定飞书 Web 宿主：请传入 FEISHU_WEB_URL，或先在 Chrome 中打开飞书网页版')

    def page_has_chat():
        try:
            if not page:
                return False
            if CHAT_ID in page.url:
                return True
            body_text = page.inner_text('body')
            return any(cname and cname in body_text for cname in contact_to_id)
        except Exception:
            return False

    # 候选一：直接打开群聊 URL（多种路由格式）
    chat_opened = False
    for prefix in ('/messenger/card', '/message/chat', '/messenger/chat', '/space/im/chat'):
        url = host + prefix + '/' + CHAT_ID
        try:
            page.goto(url, wait_until='domcontentloaded', timeout=20000)
            page.wait_for_timeout(3000)
            if page_has_chat():
                chat_opened = True
                break
        except Exception as e:
            print('[group-nickname] 打开候选 URL 失败 ' + url + ': ' + str(e), file=sys.stderr)

    # 候选二：messenger 搜索群名兜底
    if not chat_opened and GROUP_NAME:
        try:
            page.goto(host + '/messenger/', wait_until='domcontentloaded', timeout=20000)
            page.wait_for_timeout(3000)
            try:
                search = page.locator(
                    'input[placeholder*="搜索"], input[placeholder*="Search"], [class*="search"] input'
                ).first
                search.wait_for(state='visible', timeout=8000)
                search.click()
                search.fill(GROUP_NAME)
            except Exception:
                page.keyboard.press('Meta+K')
                page.wait_for_timeout(1000)
                page.keyboard.type(GROUP_NAME)
            page.wait_for_timeout(2500)
            page.get_by_text(GROUP_NAME, exact=False).first.click(timeout=6000)
            page.wait_for_timeout(3000)
            chat_opened = page_has_chat()
        except Exception as e:
            print('[group-nickname] messenger 搜索兜底失败: ' + str(e), file=sys.stderr)

    if not chat_opened:
        raise RuntimeError('未能打开目标群聊：请确认网页版已登录且该群对当前账号可见')

    # 向上滚动消息区，加载更多历史消息
    try:
        page.mouse.move(640, 400)
        for _ in range(MAX_SCROLLS):
            page.mouse.wheel(0, -3000)
            page.wait_for_timeout(SCROLL_DELAY_MS)
    except Exception as e:
        print('[group-nickname] 滚动消息失败: ' + str(e), file=sys.stderr)

    # 收集页面上的短文本节点（消息发送者显示名候选）
    raw_texts = page.evaluate('''(() => {
        const set = new Set();
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
            const t = (walker.currentNode.textContent || '').trim();
            if (!t || t.length > 30) continue;
            const code = t.charCodeAt(0);
            if (code >= 48 && code <= 57) continue;
            set.add(t);
        }
        return Array.from(set);
    })()''')

    # 匹配：显示名等于通讯录姓名，或以其结尾（前缀-姓名 命名约定）
    matched = {}
    for cname, oid in contact_to_id.items():
        hits = [t for t in raw_texts if t == cname or t.endswith(cname)]
        if hits:
            exact = [t for t in hits if t == cname]
            matched[oid] = (exact or sorted(hits, key=len))[0]

    # 网络捕获优先于 DOM 匹配
    merged = {}
    for cm in captured_members:
        merged.setdefault(cm['open_id'], cm['name'])
    for oid, name in matched.items():
        merged.setdefault(oid, name)

    result = {
        'members': [{'openId': oid, 'name': name} for oid, name in merged.items()],
        'capturedUrls': captured_urls,
        'capturedCount': len(captured_members),
        'domMatchedCount': len(matched),
        'groupName': GROUP_NAME,
    }
    with open(RESULT_FILE, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    try:
        raw = page.screenshot(type='png')
        with open(SCREENSHOT_FILE, 'wb') as f:
            f.write(raw)
    except Exception:
        pass

    print('[group-nickname] 完成：网络捕获 ' + str(len(captured_members)) + ' 人，DOM 匹配 ' + str(len(matched)) + ' 人', flush=True)
except Exception as e:
    print('[group-nickname] 失败: ' + str(e), file=sys.stderr)
    sys.exit(1)
finally:
    try:
        if page:
            page.close()
    except Exception:
        pass
    page = None
    # CDP 复用外部 Chrome：不关闭用户浏览器
    context = None
    browser = None
    try:
        if playwright:
            playwright.stop()
    except Exception:
        pass
    playwright = None
`

/**
 * 执行群昵称抓取任务
 *
 * 通过 CDP 连接已登录飞书网页版的 Chrome，打开目标群聊抓取成员群昵称。
 * 必须配置 CDP 端口（网页爬取设置中的 chromeRemoteDebuggingPort）。
 */
export async function executeGroupNicknameFetchTask(
  input: GroupNicknameFetchTaskInput,
  options: { chromeRemoteDebuggingPort?: string; timeoutMs?: number } = {},
): Promise<GroupNicknameFetchTaskResult> {
  const taskDir = createBrowserFetchTaskDir()
  const timeoutMs = options.timeoutMs ?? 120_000
  const emptyResult = (error: string): GroupNicknameFetchTaskResult => ({
    success: false,
    summary: '',
    taskDir,
    members: [],
    capturedCount: 0,
    domMatchedCount: 0,
    error,
  })

  try {
    if (!options.chromeRemoteDebuggingPort) {
      return emptyResult('缺少 CDP 端口（网页爬取设置中的 chromeRemoteDebuggingPort）')
    }
    if (input.apiMembers.length === 0) {
      return emptyResult('缺少 API 群成员列表')
    }

    const apiMembersPath = join(taskDir, 'api-members.json')
    writeFileSync(apiMembersPath, JSON.stringify(input.apiMembers), 'utf-8')
    const scriptPath = join(taskDir, 'script.py')
    writeFileSync(scriptPath, GROUP_NICKNAME_SCRIPT, 'utf-8')

    const resultPath = join(taskDir, 'result.json')
    const screenshotPath = join(taskDir, 'screenshot.png')

    const env: Record<string, string> = {
      CHAT_ID: input.chatId,
      FEISHU_WEB_URL: input.feishuWebUrl ?? '',
      GROUP_NAME: input.groupName ?? '',
      API_MEMBERS_FILE: apiMembersPath,
      RESULT_FILE: resultPath,
      SCREENSHOT_FILE: screenshotPath,
      CHROME_REMOTE_DEBUGGING_PORT: options.chromeRemoteDebuggingPort,
    }

    const runResult = await runPythonScript(scriptPath, taskDir, env, timeoutMs)
    if (!runResult.success || !existsSync(resultPath)) {
      return emptyResult(runResult.error ?? (runResult.stderr || '未生成结果文件'))
    }

    const parsed = JSON.parse(readFileSync(resultPath, 'utf-8')) as {
      members?: { openId: string; name: string }[]
      capturedCount?: number
      domMatchedCount?: number
    }
    const members = Array.isArray(parsed.members) ? parsed.members : []
    const capturedCount = Number(parsed.capturedCount ?? 0)
    const domMatchedCount = Number(parsed.domMatchedCount ?? 0)
    const summary =
      members.length > 0
        ? `群昵称抓取完成：共 ${members.length} 人（网络捕获 ${capturedCount}，DOM 匹配 ${domMatchedCount}）`
        : `群昵称抓取未匹配到成员（网络捕获 ${capturedCount}，DOM 匹配 ${domMatchedCount}），保持 API 通讯录姓名`

    return { success: true, summary, taskDir, members, capturedCount, domMatchedCount }
  } catch (error) {
    return emptyResult(error instanceof Error ? error.message : String(error))
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
