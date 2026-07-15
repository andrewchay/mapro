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
}))

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

  // ===== 3. 环境检查与缓存 =====

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
        'dump = {k: os.environ.get(k) for k in ["HEADLESS","USER_DATA_DIR","COOKIES_FILE","PROXY","USER_AGENT","RESULT_FILE","SCREENSHOT_FILE"]}',
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

        // 4. 成功后 Profile 应写回源目录（login.flag 仍在）
        expect(existsSync(join(sourceProfile, 'login.flag'))).toBe(true)

        // 5. 结果文件存在
        expect(result.resultFile).toBe('result.json')
      } finally {
        restore.mockRestore()
      }
    })
  })

  // ===== 5. web-scraper-tool 元数据 =====

  describe('web-scraper-tool 元数据', () => {
    it('工具元数据 id 为 web-scraper，参数含 url/task', () => {
      const meta = webScraperTool.WEB_SCRAPER_TOOL_META
      expect(meta.id).toBe('web-scraper')
      const paramNames = meta.params.map((p) => p.name)
      expect(paramNames).toContain('url')
      expect(paramNames).toContain('task')
    })

    it('系统提示词包含登录态说明', () => {
      const append = webScraperTool.WEB_SCRAPER_TOOL_META.systemPromptAppend ?? ''
      expect(append).toContain('web_scraper')
      expect(append).toMatch(/登录|Profile|Cookie/)
    })

    it('isWebScraperToolCall 仅识别 web_scraper', () => {
      expect(webScraperTool.isWebScraperToolCall('web_scraper')).toBe(true)
      expect(webScraperTool.isWebScraperToolCall('web-scraper')).toBe(false)
      expect(webScraperTool.isWebScraperToolCall('')).toBe(false)
    })

    it('工具定义要求 url 和 task', () => {
      const defs = webScraperTool.WEB_SCRAPER_TOOL_DEFINITIONS as Array<{
        name: string
        parameters: { required?: string[] }
      }>
      expect(defs.length).toBeGreaterThan(0)
      const def = defs[0]!
      expect(def.name).toBe('web_scraper')
      expect(def.parameters.required).toContain('url')
      expect(def.parameters.required).toContain('task')
    })
  })
})
