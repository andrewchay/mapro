/**
 * Computer Use 视觉浏览器自动化服务单元测试
 *
 * 覆盖 plan《web-scraper-login-anti-crawl-plan.md》Phase 2 核心逻辑：
 * 1. executeComputerUseTask 的观察-思考-行动循环
 * 2. LLM 返回 JSON 的解析与错误处理
 * 3. BrowserDriver 方法调用顺序、选项透传、资源释放
 * 4. 最大步数限制与异常处理
 *
 * 采用依赖注入：测试使用 FakeBrowserDriver 和 FakeLLMCaller，不依赖真实 Playwright。
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import { mkdirSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// 被测模块（测试阶段可能不存在，先 import 会在运行时报错，驱动实现）
import type {
  ComputerUseTaskInput,
  ComputerUseOptions,
  ComputerAction,
  BrowserDriver,
  LLMVisionCaller,
  LLMVisionCallParams,
  ComputerUseTaskResult,
} from '../browser-automation/computer-use-types'

interface ComputerUseModule {
  executeComputerUseTask: (
    input: ComputerUseTaskInput,
    options: ComputerUseOptions,
    driver: BrowserDriver,
    callLLM: LLMVisionCaller,
  ) => Promise<ComputerUseTaskResult>
  parseLLMAction: (text: string) => { thought: string; action: ComputerAction }
}

let computerUse: ComputerUseModule

beforeEach(async () => {
  computerUse = (await import('../browser-automation/computer-use-service')) as ComputerUseModule
})

/** 伪造 BrowserDriver，记录所有调用并返回固定截图 */
class FakeBrowserDriver implements BrowserDriver {
  calls: Array<{ method: string; args: unknown[] }> = []
  initOptions?: ComputerUseOptions
  screenshotData = 'fake-screenshot-base64'
  errorOnMethod?: string

  async init(options: ComputerUseOptions): Promise<void> {
    this.initOptions = options
    this.calls.push({ method: 'init', args: [options] })
  }

  async goto(url: string): Promise<void> {
    this.calls.push({ method: 'goto', args: [url] })
    if (this.errorOnMethod === 'goto') throw new Error('goto failed')
  }

  async click(x: number, y: number): Promise<void> {
    this.calls.push({ method: 'click', args: [x, y] })
    if (this.errorOnMethod === 'click') throw new Error('click failed')
  }

  async type(text: string): Promise<void> {
    this.calls.push({ method: 'type', args: [text] })
  }

  async scroll(dx: number, dy: number): Promise<void> {
    this.calls.push({ method: 'scroll', args: [dx, dy] })
  }

  async key(key: string): Promise<void> {
    this.calls.push({ method: 'key', args: [key] })
  }

  async wait(ms: number): Promise<void> {
    this.calls.push({ method: 'wait', args: [ms] })
  }

  async screenshot(): Promise<string> {
    this.calls.push({ method: 'screenshot', args: [] })
    if (this.errorOnMethod === 'screenshot') throw new Error('screenshot failed')
    return this.screenshotData
  }

  async finish(): Promise<void> {
    this.calls.push({ method: 'finish', args: [] })
  }

  async close(): Promise<void> {
    this.calls.push({ method: 'close', args: [] })
    if (this.errorOnMethod === 'close') throw new Error('close failed')
  }
}

/** 构造一个按预设序列返回 action 的 Fake LLM Caller */
function createFakeLLMCaller(actions: ComputerAction[]): LLMVisionCaller {
  let index = 0
  return async () => {
    const action = actions[index++] ?? { type: 'finish', summary: 'default finish' }
    return { thought: `thought-${index}`, action }
  }
}

describe('computer-use-service', () => {
  it('当 LLM 直接返回 finish 时任务成功并返回 summary', async () => {
    const driver = new FakeBrowserDriver()
    const callLLM = createFakeLLMCaller([{ type: 'finish', summary: '任务完成' }])

    const result = await computerUse.executeComputerUseTask(
      { url: 'https://example.com', task: '测试任务' },
      { headless: true },
      driver,
      callLLM,
    )

    expect(result.success).toBe(true)
    expect(result.summary).toContain('任务完成')
    expect(result.steps).toBe(1)
    expect(driver.calls.some((c) => c.method === 'goto' && c.args[0] === 'https://example.com')).toBe(true)
    expect(driver.calls.some((c) => c.method === 'screenshot')).toBe(true)
    expect(driver.calls.some((c) => c.method === 'finish')).toBe(true)
    expect(driver.calls.at(-1)!.method).toBe('close')
  })

  it('按顺序执行多步操作后再 finish', async () => {
    const driver = new FakeBrowserDriver()
    const callLLM = createFakeLLMCaller([
      { type: 'click', x: 100, y: 200 },
      { type: 'type', text: 'hello' },
      { type: 'scroll', dx: 0, dy: 500 },
      { type: 'finish', summary: 'done' },
    ])

    const result = await computerUse.executeComputerUseTask(
      { url: 'https://example.com', task: '多步任务' },
      {},
      driver,
      callLLM,
    )

    expect(result.success).toBe(true)
    expect(result.steps).toBe(4)

    const methodNames = driver.calls.filter((c) => c.method !== 'init' && c.method !== 'close').map((c) => c.method)
    expect(methodNames).toEqual(['goto', 'screenshot', 'click', 'screenshot', 'type', 'screenshot', 'scroll', 'screenshot', 'finish'])
  })

  it('每次循环都把截图和历史动作传给 LLM', async () => {
    const driver = new FakeBrowserDriver()
    const received: Array<{ screenshotBase64: string; historyLength: number; history: LLMVisionCallParams['history'] }> = []
    const callLLM: LLMVisionCaller = async (params) => {
      received.push({ screenshotBase64: params.screenshotBase64, historyLength: params.history.length, history: params.history })
      if (received.length === 1) return { thought: 'first', action: { type: 'click', x: 1, y: 2 } }
      return { thought: 'last', action: { type: 'finish', summary: 'ok' } }
    }

    await computerUse.executeComputerUseTask(
      { url: 'https://example.com', task: '验证上下文' },
      {},
      driver,
      callLLM,
    )

    expect(received.length).toBe(2)
    expect(received[0]!.screenshotBase64).toBe('fake-screenshot-base64')
    expect(received[0]!.historyLength).toBe(0)
    expect(received[1]!.historyLength).toBe(1)
    expect(received[1]!.history.at(0)!.action).toEqual({ type: 'click', x: 1, y: 2 })
  })

  it('达到最大步数时自动结束并标记为失败', async () => {
    const driver = new FakeBrowserDriver()
    const callLLM = createFakeLLMCaller([
      { type: 'click', x: 1, y: 1 },
      { type: 'click', x: 2, y: 2 },
      { type: 'click', x: 3, y: 3 },
    ])

    const result = await computerUse.executeComputerUseTask(
      { url: 'https://example.com', task: '步数限制', maxSteps: 2 },
      {},
      driver,
      callLLM,
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('最大步数')
    expect(result.steps).toBe(2)
    expect(driver.calls.some((c) => c.method === 'close')).toBe(true)
  })

  it('LLM 返回无效 JSON 时任务失败并关闭浏览器', async () => {
    const driver = new FakeBrowserDriver()
    const callLLM: LLMVisionCaller = async () => {
      throw new Error('LLM 响应无法解析')
    }

    const result = await computerUse.executeComputerUseTask(
      { url: 'https://example.com', task: '错误处理' },
      {},
      driver,
      callLLM,
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('LLM 响应无法解析')
    expect(driver.calls.at(-1)!.method).toBe('close')
  })

  it('driver 执行动作报错时任务失败并关闭浏览器', async () => {
    const driver = new FakeBrowserDriver()
    driver.errorOnMethod = 'click'
    const callLLM = createFakeLLMCaller([
      { type: 'click', x: 1, y: 1 },
      { type: 'finish', summary: 'done' },
    ])

    const result = await computerUse.executeComputerUseTask(
      { url: 'https://example.com', task: 'driver 错误' },
      {},
      driver,
      callLLM,
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('click failed')
    expect(driver.calls.at(-1)!.method).toBe('close')
  })

  it('init 选项正确透传给 driver', async () => {
    const driver = new FakeBrowserDriver()
    const callLLM = createFakeLLMCaller([{ type: 'finish', summary: 'ok' }])
    const options: ComputerUseOptions = {
      headless: false,
      userDataDir: '/tmp/profile',
      cookies: '[]',
      proxy: 'http://proxy',
      userAgent: 'TestUA',
      timeoutMs: 30_000,
    }

    await computerUse.executeComputerUseTask(
      { url: 'https://example.com', task: '选项透传' },
      options,
      driver,
      callLLM,
    )

    expect(driver.initOptions).toMatchObject(options)
    expect(typeof driver.initOptions.taskDir).toBe('string')
  })
})

describe('parseLLMAction', () => {
  it('解析标准 JSON action', () => {
    const text = JSON.stringify({ thought: '点击登录', action: { type: 'click', x: 120, y: 340 } })
    const result = computerUse.parseLLMAction(text)
    expect(result.thought).toBe('点击登录')
    expect(result.action).toEqual({ type: 'click', x: 120, y: 340 })
  })

  it('解析被 markdown 代码块包裹的 JSON', () => {
    const text = '```json\n' + JSON.stringify({ thought: '完成', action: { type: 'finish', summary: 'ok' } }) + '\n```'
    const result = computerUse.parseLLMAction(text)
    expect(result.action.type).toBe('finish')
  })

  it('解析只有 action 没有 thought 的 JSON', () => {
    const text = JSON.stringify({ action: { type: 'goto', url: 'https://x.com' } })
    const result = computerUse.parseLLMAction(text)
    expect(result.thought).toBe('')
    expect(result.action).toEqual({ type: 'goto', url: 'https://x.com' })
  })

  it('缺少 action 字段时抛出错误', () => {
    const text = JSON.stringify({ thought: '无动作' })
    expect(() => computerUse.parseLLMAction(text)).toThrow()
  })

  it('无效 action type 时抛出错误', () => {
    const text = JSON.stringify({ action: { type: 'invalid', foo: 'bar' } })
    expect(() => computerUse.parseLLMAction(text)).toThrow()
  })
})
