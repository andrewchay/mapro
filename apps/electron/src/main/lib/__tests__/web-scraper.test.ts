/**
 * 网页爬取工具（web-scraper）单元测试
 *
 * 覆盖 plan《web-scraper-login-anti-crawl-plan.md》测试计划第 1 项：
 * 1. isWebScraperAvailable() / checkPythonAndPlaywright() 在 python3/playwright 缺失时的行为与缓存
 * 2. getDefaultUserDataDir 按域名生成 Profile 路径
 * 3. parseCookiesText 对 JSON / Netscape 格式的解析
 * 4. executeScrapingTask 能正确准备 Profile、Cookie 文件并写入环境变量
 *    （通过 mock completePrompt 生成确定性脚本，验证环境变量注入）
 * 5. web-scraper-tool 的元数据与工具调用判断
 *
 * 通过 _MAPRO_TEST_CONFIG_DIR 环境变量注入独立临时目录，避免污染真实配置。
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, spyOn, mock } from 'bun:test'
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

// ===== Mock llm-service，避免其导入链拉入 electron（safeStorage）=====
//
// browser-automation-service 静态依赖 ma-tools/llm-service，后者经
// channel-manager → safeStorage 引入 electron，在 Bun 测试环境不可加载。
// 用 mock.module 在被测模块加载前替换 llm-service 导出。
const __dirname = dirname(fileURLToPath(import.meta.url))
mock.module(join(__dirname, '..', 'ma-tools', 'llm-service.ts'), () => ({
  completePrompt: async () => ({ success: false, text: '', error: 'mocked-llm' }),
  complete: async () => ({ success: false, text: '', error: 'mocked-llm' }),
  extractJSON: (text: string) => JSON.parse(text),
}))

// ===== Mock KOL 数据服务，避免测试写入真实 SQLite =====
const upsertKOLMock = mock((kol: unknown) => {})
import { createKolDataServiceMock } from './mocks/kol-data-service-mock'

mock.module(join(__dirname, '..', 'ma-tools', 'kol-data-service.ts'), () =>
  createKolDataServiceMock({ upsertKOL: upsertKOLMock }),
)

// ===== 测试环境 =====

const TEST_DIR = join(tmpdir(), `mapro-web-scraper-test-${Date.now()}`)

interface BrowserAutomationModule {
  getDefaultUserDataDir: (url: string) => string
  getBrowserProfilesRootDir: () => string
  parseCookiesText: (text: string) => import('../browser-automation/browser-automation-service').ScraperCookie[]
  checkPythonAndPlaywright: () => { available: boolean; message: string }
  resetPythonPlaywrightCheck: () => void
  executeScrapingTask: (
    input: import('../browser-automation/browser-automation-service').ScrapingTaskInput,
    options?: import('../browser-automation/browser-automation-service').ScrapingTaskOptions,
  ) => Promise<import('../browser-automation/browser-automation-service').ScrapingTaskResult>
  resolveTimeoutMs: (value: string | number | undefined) => number
  getScrapedRootDir?: () => string
}

interface WebScraperToolModule {
  WEB_SCRAPER_TOOL_META: import('@ma-proma/shared').ChatToolMeta
  WEB_SCRAPER_TOOL_DEFINITIONS: unknown[]
  isWebScraperAvailable: () => boolean
  isWebScraperToolCall: (name: string) => boolean
}

let browserAutomation: BrowserAutomationModule
let webScraperTool: WebScraperToolModule

describe('web-scraper 网页爬取工具', () => {
  beforeAll(async () => {
    mkdirSync(TEST_DIR, { recursive: true })
    process.env._MAPRO_TEST_CONFIG_DIR = TEST_DIR

    browserAutomation = (await import('../browser-automation/browser-automation-service')) as BrowserAutomationModule
    webScraperTool = (await import('../chat-tools/web-scraper-tool')) as WebScraperToolModule
  })

  afterAll(() => {
    delete process.env._MAPRO_TEST_CONFIG_DIR
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
  })

  beforeEach(() => {
    // 每个用例前清除环境检查缓存，避免用例间互相影响
    browserAutomation.resetPythonPlaywrightCheck()
  })

  // ===== 1. 默认 Profile 目录生成 =====

  describe('getDefaultUserDataDir', () => {
    it('按 URL 域名生成 Profile 目录', () => {
      const dir = browserAutomation.getDefaultUserDataDir('https://www.xiaohongshu.com/explore')
      expect(dir).toContain('browser-profiles')
      expect(dir.endsWith(join('browser-profiles', 'www.xiaohongshu.com'))).toBe(true)
    })

    it('不同域名生成不同 Profile 目录', () => {
      const a = browserAutomation.getDefaultUserDataDir('https://xiaohongshu.com/')
      const b = browserAutomation.getDefaultUserDataDir('https://creator.douyin.com/')
      expect(a).not.toBe(b)
    })

    it('非法 URL 回退到 default 目录', () => {
      const dir = browserAutomation.getDefaultUserDataDir('not-a-url')
      expect(dir.endsWith(join('browser-profiles', 'default'))).toBe(true)
    })

    it('Profile 根目录会自动创建', () => {
      const root = browserAutomation.getBrowserProfilesRootDir()
      expect(existsSync(root)).toBe(true)
    })
  })

  // ===== 2. Cookie 解析（纯函数）=====

  describe('parseCookiesText', () => {
    it('解析 Playwright JSON 数组格式', () => {
      const json = JSON.stringify([
        { name: 'session', value: 'abc', domain: '.xiaohongshu.com', path: '/' },
      ])
      const cookies = browserAutomation.parseCookiesText(json)
      expect(cookies.length).toBe(1)
      expect(cookies[0]!.name).toBe('session')
      expect(cookies[0]!.value).toBe('abc')
      expect(cookies[0]!.domain).toBe('.xiaohongshu.com')
    })

    it('解析 Netscape cookies.txt 格式', () => {
      // domain  flag  path  secure  expires  name  value
      const netscape = [
        '# Netscape HTTP Cookie File',
        '# 这是一行注释',
        'xiaohongshu.com\tTRUE\t/\tTRUE\t1700000000\ttoken\txyz123',
        '.xiaohongshu.com\tTRUE\t/\tFALSE\t0\tguest\tvisitor',
      ].join('\n')
      const cookies = browserAutomation.parseCookiesText(netscape)
      expect(cookies.length).toBe(2)

      const first = cookies[0]!
      expect(first.name).toBe('token')
      expect(first.value).toBe('xyz123')
      // 不以 . 开头的域名会被补上前缀
      expect(first.domain).toBe('.xiaohongshu.com')
      expect(first.secure).toBe(true)
      expect(first.expires).toBe(1700000000)

      const second = cookies[1]!
      expect(second.name).toBe('guest')
      expect(second.secure).toBe(false)
      // expires 为 0 时不设置（undefined）
      expect(second.expires).toBeUndefined()
    })

    it('忽略字段不足的 Netscape 行', () => {
      const malformed = 'xiaohongshu.com\tTRUE\t/\tTRUE\t1700000000\tonly-five-fields'
      const cookies = browserAutomation.parseCookiesText(malformed)
      expect(cookies.length).toBe(0)
    })

    it('空字符串返回空数组', () => {
      expect(browserAutomation.parseCookiesText('')).toEqual([])
      expect(browserAutomation.parseCookiesText('   \n  ')).toEqual([])
    })

    it('非 JSON 非 Netscape 的乱码返回空数组', () => {
      expect(browserAutomation.parseCookiesText('just some random text')).toEqual([])
    })
  })

  // ===== 3. 超时时间解析 =====

  describe('resolveTimeoutMs', () => {
    it('把秒数值转换为毫秒', () => {
      expect(browserAutomation.resolveTimeoutMs('60')).toBe(60_000)
      expect(browserAutomation.resolveTimeoutMs(60)).toBe(60_000)
    })

    it('保留毫秒数值', () => {
      expect(browserAutomation.resolveTimeoutMs('60000')).toBe(60_000)
      expect(browserAutomation.resolveTimeoutMs(120_000)).toBe(120_000)
    })

    it('空值/非法值回退到默认 60 秒', () => {
      expect(browserAutomation.resolveTimeoutMs(undefined)).toBe(60_000)
      expect(browserAutomation.resolveTimeoutMs('')).toBe(60_000)
      expect(browserAutomation.resolveTimeoutMs('abc')).toBe(60_000)
      expect(browserAutomation.resolveTimeoutMs(0)).toBe(60_000)
    })
  })

  // ===== 4. 环境检查与缓存 =====

  describe('checkPythonAndPlaywright', () => {
    it('返回带 available 和 message 字段的结果', () => {
      const result = browserAutomation.checkPythonAndPlaywright()
      expect(typeof result.available).toBe('boolean')
      expect(typeof result.message).toBe('string')
      expect(result.message.length).toBeGreaterThan(0)
    })

    it('结果会被缓存（连续调用返回同一对象引用）', () => {
      const first = browserAutomation.checkPythonAndPlaywright()
      const second = browserAutomation.checkPythonAndPlaywright()
      // 缓存命中时应返回同一引用
      expect(second).toBe(first)
    })

    it('resetPythonPlaywrightCheck 后会重新检查', () => {
      const first = browserAutomation.checkPythonAndPlaywright()
      browserAutomation.resetPythonPlaywrightCheck()
      const second = browserAutomation.checkPythonAndPlaywright()
      // 重置后应重新计算（新对象）
      expect(second).not.toBe(first)
    })

    it('isWebScraperAvailable 与 checkPythonAndPlaywright 的 available 一致', () => {
      const check = browserAutomation.checkPythonAndPlaywright()
      expect(webScraperTool.isWebScraperAvailable()).toBe(check.available)
    })
  })

  // ===== 4. executeScrapingTask 环境变量注入 =====

  describe('executeScrapingTask 环境变量注入', () => {
    it('当 LLM 脚本生成失败时返回失败结果', async () => {
      // mock completePrompt 返回失败，验证错误分支
      const llmModule = await import('../ma-tools/llm-service')
      const restore = spyOn(llmModule, 'completePrompt').mockResolvedValue({
        success: false,
        text: '',
        error: 'mock LLM 不可用',
      })

      try {
        const result = await browserAutomation.executeScrapingTask(
          { url: 'https://example.com', task: '测试任务' },
          { headless: true, timeoutMs: 5000 },
        )
        expect(result.success).toBe(false)
        expect(result.error).toContain('mock LLM 不可用')
        expect(result.taskDir).toBeTruthy()
      } finally {
        restore.mockRestore()
      }
    })

    it('成功路径：注入 Profile、Cookie 并把选项写入环境变量', async () => {
      // 1. 准备一个源 Profile 目录，里面放一个标记文件
      const profilesRoot = browserAutomation.getBrowserProfilesRootDir()
      const sourceProfile = join(profilesRoot, 'test-host.example.com')
      mkdirSync(sourceProfile, { recursive: true })
      writeFileSync(join(sourceProfile, 'login.flag'), 'logged-in')

      // 2. mock completePrompt 生成一个会把环境变量写到 env_dump.json 的脚本
      const llmModule = await import('../ma-tools/llm-service')
      const script = [
        'import os, json',
        'dump = {k: os.environ.get(k) for k in ["HEADLESS","USER_DATA_DIR","COOKIES_FILE","PROXY","USER_AGENT","RESULT_FILE","SCREENSHOT_FILE","USE_SYSTEM_CHROME","CHROME_EXECUTABLE_PATH","CHROME_REMOTE_DEBUGGING_PORT","MIN_ACTION_DELAY_MS","MAX_ACTION_DELAY_MS"]}',
        'with open(os.path.join(os.path.dirname(__file__), "env_dump.json"), "w") as f: json.dump(dump, f)',
        'open(os.environ["RESULT_FILE"], "w").write("[]")',
        'open(os.environ["SCREENSHOT_FILE"], "w").write("")',
      ].join('\n')

      const restore = spyOn(llmModule, 'completePrompt').mockResolvedValue({
        success: true,
        text: script,
      })

      try {
        const cookiesJson = JSON.stringify([
          { name: 'session', value: 'abc', domain: '.example.com', path: '/' },
        ])
        const result = await browserAutomation.executeScrapingTask(
          { url: 'https://example.com', task: '抓取示例' },
          {
            headless: false,
            userDataDir: sourceProfile,
            cookies: cookiesJson,
            proxy: 'http://127.0.0.1:8080',
            userAgent: 'TestUA/1.0',
            timeoutMs: 15_000,
            useSystemChrome: true,
            chromeExecutablePath: '/fake/chrome',
            chromeRemoteDebuggingPort: '9222',
            minActionDelayMs: 2000,
            maxActionDelayMs: 4000,
          },
        )

        // 3. 验证任务目录与产物
        expect(result.success).toBe(true)
        expect(result.taskDir).toBeTruthy()
        const dumpPath = join(result.taskDir, 'env_dump.json')
        expect(existsSync(dumpPath)).toBe(true)

        const dump = JSON.parse(readFileSync(dumpPath, 'utf-8')) as Record<string, string | null>
        expect(dump.HEADLESS).toBe('false')
        expect(dump.PROXY).toBe('http://127.0.0.1:8080')
        expect(dump.USER_AGENT).toBe('TestUA/1.0')
        expect(dump.USER_DATA_DIR).toBeTruthy()
        expect(existsSync(dump.USER_DATA_DIR!)).toBe(true)
        // Profile 被复制到任务目录，标记文件应存在
        expect(existsSync(join(dump.USER_DATA_DIR!, 'login.flag'))).toBe(true)
        expect(dump.COOKIES_FILE).toBeTruthy()
        expect(existsSync(dump.COOKIES_FILE!)).toBe(true)
        const cookieFile = JSON.parse(readFileSync(dump.COOKIES_FILE!, 'utf-8')) as unknown[]
        expect(cookieFile.length).toBe(1)

        // 额外验证系统 Chrome 与随机延迟环境变量
        expect(dump.USE_SYSTEM_CHROME).toBe('true')
        expect(dump.CHROME_EXECUTABLE_PATH).toBe('/fake/chrome')
        expect(dump.CHROME_REMOTE_DEBUGGING_PORT).toBe('9222')
        expect(dump.MIN_ACTION_DELAY_MS).toBe('2000')
        expect(dump.MAX_ACTION_DELAY_MS).toBe('4000')

        // 4. 成功后 Profile 应写回源目录（login.flag 仍在）
        expect(existsSync(join(sourceProfile, 'login.flag'))).toBe(true)

        // 5. 结果文件存在
        expect(result.resultFile).toBe('result.json')

        // 6. 验证传给 LLM 的系统提示词包含反检测指引
        const spyCalls = (restore as unknown as { mock: { calls: unknown[][] } }).mock.calls
        expect(spyCalls.length).toBeGreaterThan(0)
        const systemPrompt = spyCalls[0]![1] as string | undefined
        expect(systemPrompt).toBeTruthy()
        expect(systemPrompt).toMatch(/CHROME_REMOTE_DEBUGGING_PORT|CHROME_EXECUTABLE_PATH/)
        expect(systemPrompt).toMatch(/MIN_ACTION_DELAY_MS|MAX_ACTION_DELAY_MS/)
      } finally {
        restore.mockRestore()
      }
    })
  })

  // ===== 5. Phase 2 增强功能 =====

  describe('Phase 2 增强功能', () => {
    beforeEach(() => {
      upsertKOLMock.mockClear()
    })

    it('批量 URL 爬取为每个 URL 创建子目录并聚合 resultFiles', async () => {
      const llmModule = await import('../ma-tools/llm-service')
      const script = [
        'import os, json',
        'with open(os.environ["RESULT_FILE"], "w") as f: json.dump({"ok": True}, f)',
        'open(os.environ["SCREENSHOT_FILE"], "w").write("")',
      ].join('\n')
      const restore = spyOn(llmModule, 'completePrompt').mockResolvedValue({
        success: true,
        text: script,
      })

      try {
        const result = await browserAutomation.executeScrapingTask(
          {
            urls: ['https://a.example.com', 'https://b.example.com'],
            task: '批量抓取',
          },
          { headless: true, timeoutMs: 15_000 },
        )

        expect(result.success).toBe(true)
        expect(result.resultFiles).toBeDefined()
        expect(result.resultFiles!.length).toBe(2)
        expect(result.resultFiles!).toContain('url-1/result.json')
        expect(result.resultFiles!).toContain('url-2/result.json')
        expect(existsSync(join(result.taskDir, 'url-1', 'result.json'))).toBe(true)
        expect(existsSync(join(result.taskDir, 'url-2', 'result.json'))).toBe(true)
      } finally {
        restore.mockRestore()
      }
    })

    it('失败重试：第一次脚本失败、第二次重试成功', async () => {
      const llmModule = await import('../ma-tools/llm-service')
      const script = [
        'import os, sys, json',
        'flag = os.path.join(os.path.dirname(os.environ["RESULT_FILE"]), "retry.flag")',
        'if os.path.exists(flag):',
        '    with open(os.environ["RESULT_FILE"], "w") as f: json.dump({"retried": True}, f)',
        '    open(os.environ["SCREENSHOT_FILE"], "w").write("")',
        'else:',
        '    open(flag, "w").write("x")',
        '    sys.exit(1)',
      ].join('\n')
      const restore = spyOn(llmModule, 'completePrompt').mockResolvedValue({
        success: true,
        text: script,
      })

      try {
        const result = await browserAutomation.executeScrapingTask(
          { url: 'https://example.com', task: '重试测试' },
          { headless: true, timeoutMs: 15_000, maxRetries: 1 },
        )

        expect(result.success).toBe(true)
        expect(result.resultFile).toBe('result.json')
        const data = JSON.parse(readFileSync(join(result.taskDir, 'result.json'), 'utf-8'))
        expect(data.retried).toBe(true)
      } finally {
        restore.mockRestore()
      }
    })

    it('markdown 输出开启重试时首次成功不重复执行', async () => {
      const llmModule = await import('../ma-tools/llm-service')
      const script = [
        'import os',
        'counter = os.path.join(os.path.dirname(os.environ["RESULT_FILE"]), "exec.count")',
        'count = 0',
        'if os.path.exists(counter):',
        '    count = int(open(counter).read() or "0")',
        'count += 1',
        'open(counter, "w").write(str(count))',
        'with open(os.environ["RESULT_FILE"], "w") as f: f.write("# markdown result")',
        'open(os.environ["SCREENSHOT_FILE"], "w").write("")',
      ].join('\n')
      const restore = spyOn(llmModule, 'completePrompt').mockResolvedValue({
        success: true,
        text: script,
      })

      try {
        const result = await browserAutomation.executeScrapingTask(
          { url: 'https://markdown.example.com', task: 'markdown 重试测试', outputFormat: 'markdown' },
          { headless: true, timeoutMs: 15_000, maxRetries: 2 },
        )

        expect(result.success).toBe(true)
        expect(result.resultFile).toBe('result.md')
        expect(existsSync(join(result.taskDir, 'result.md'))).toBe(true)
        const execCount = readFileSync(join(result.taskDir, 'exec.count'), 'utf-8')
        expect(execCount).toBe('1')
      } finally {
        restore.mockRestore()
      }
    })

    it('自定义脚本模板绕过 LLM 并渲染变量', async () => {
      const llmModule = await import('../ma-tools/llm-service')
      const restore = spyOn(llmModule, 'completePrompt')

      try {
        const template = [
          'import os, json',
          'with open(os.environ["RESULT_FILE"], "w") as f:',
          '    json.dump({"task": "{{task}}", "url": "{{url}}", "fmt": "{{outputFormat}}"}, f)',
          'open(os.environ["SCREENSHOT_FILE"], "w").write("")',
        ].join('\n')

        const result = await browserAutomation.executeScrapingTask(
          { url: 'https://template.example.com', task: '模板任务' },
          { headless: true, timeoutMs: 15_000, scriptTemplate: template },
        )

        expect(result.success).toBe(true)
        expect(restore.mock.calls.length).toBe(0)
        const data = JSON.parse(readFileSync(join(result.taskDir, 'result.json'), 'utf-8'))
        expect(data.task).toBe('模板任务')
        expect(data.url).toBe('https://template.example.com')
        expect(data.fmt).toBe('json')
      } finally {
        restore.mockRestore()
      }
    })

    it('importToKolDatabase 将 JSON 结果导入 KOL 数据库', async () => {
      const llmModule = await import('../ma-tools/llm-service')
      const script = [
        'import os, json',
        'rows = [{"name": "测试 KOL", "platform": "xiaohongshu", "followers": 10000}]',
        'with open(os.environ["RESULT_FILE"], "w") as f: json.dump(rows, f)',
        'open(os.environ["SCREENSHOT_FILE"], "w").write("")',
      ].join('\n')
      const restore = spyOn(llmModule, 'completePrompt').mockResolvedValue({
        success: true,
        text: script,
      })

      try {
        const result = await browserAutomation.executeScrapingTask(
          {
            url: 'https://kol.example.com',
            task: '抓取 KOL 列表',
            importToKolDatabase: true,
          },
          { headless: true, timeoutMs: 15_000 },
        )

        expect(result.success).toBe(true)
        expect(result.kolImport).toBeDefined()
        expect(result.kolImport!.inserted).toBe(1)
        expect(upsertKOLMock).toHaveBeenCalledTimes(1)
      } finally {
        restore.mockRestore()
      }
    })
  })

  // ===== 6. web-scraper-tool 元数据 =====

  describe('web-scraper-tool 元数据', () => {
    it('工具元数据 id 为 web-scraper，参数含 url/task', () => {
      const meta = webScraperTool.WEB_SCRAPER_TOOL_META
      expect(meta.id).toBe('web-scraper')
      const paramNames = meta.params.map((p) => p.name)
      expect(paramNames).toContain('url')
      expect(paramNames).toContain('task')
    })

    it('系统提示词包含登录态与反检测说明', () => {
      const append = webScraperTool.WEB_SCRAPER_TOOL_META.systemPromptAppend ?? ''
      expect(append).toContain('web_scraper')
      expect(append).toMatch(/登录|Profile|Cookie/)
      expect(append).toContain('系统 Chrome')
      expect(append).toContain('随机操作间隔')
    })

    it('isWebScraperToolCall 仅识别 web_scraper', () => {
      expect(webScraperTool.isWebScraperToolCall('web_scraper')).toBe(true)
      expect(webScraperTool.isWebScraperToolCall('web-scraper')).toBe(false)
      expect(webScraperTool.isWebScraperToolCall('')).toBe(false)
    })

    it('工具定义要求 task，并支持 url/urls 参数', () => {
      const defs = webScraperTool.WEB_SCRAPER_TOOL_DEFINITIONS as Array<{
        name: string
        parameters: { required?: string[]; properties?: Record<string, unknown> }
      }>
      expect(defs.length).toBeGreaterThan(0)
      const def = defs[0]!
      expect(def.name).toBe('web_scraper')
      expect(def.parameters.required).toContain('task')
      expect(Object.keys(def.parameters.properties ?? {})).toContain('url')
      expect(Object.keys(def.parameters.properties ?? {})).toContain('urls')
    })
  })
})
