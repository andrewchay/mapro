import { describe, it, expect, afterAll, mock, beforeEach } from 'bun:test'
import type { ComputerUseUIEvent } from '@ma-proma/shared'
import type {
  ComputerUseOptions,
  ComputerAction,
  BrowserDriver,
  LLMVisionCaller,
  LLMVisionCallParams,
} from '../browser-automation/computer-use-types'

const sentEvents: Array<{ windowId: number; event: ComputerUseUIEvent }> = []

mock.module('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          send: (_channel: string, event: ComputerUseUIEvent) => {
            sentEvents.push({ windowId: 1, event })
          },
        },
      },
      {
        isDestroyed: () => false,
        webContents: {
          send: (_channel: string, event: ComputerUseUIEvent) => {
            sentEvents.push({ windowId: 2, event })
          },
        },
      },
    ],
  },
}))

afterAll(() => {
  mock.restore()
})

class FakeBrowserDriver implements BrowserDriver {
  calls: Array<{ method: string; args: unknown[] }> = []
  screenshotData = 'fake-screenshot-base64'

  async init(options: ComputerUseOptions): Promise<void> {
    this.calls.push({ method: 'init', args: [options] })
  }

  async goto(url: string): Promise<void> {
    this.calls.push({ method: 'goto', args: [url] })
  }

  async click(x: number, y: number): Promise<void> {
    this.calls.push({ method: 'click', args: [x, y] })
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
    return this.screenshotData
  }

  async finish(): Promise<void> {
    this.calls.push({ method: 'finish', args: [] })
  }

  async close(): Promise<void> {
    this.calls.push({ method: 'close', args: [] })
  }
}

function createFakeLLMCaller(actions: ComputerAction[]): LLMVisionCaller {
  let index = 0
  return async (_params: LLMVisionCallParams) => {
    const action = actions[index++] ?? { type: 'finish', summary: 'default finish' }
    return { thought: `thought-${index}`, action }
  }
}

describe('computer-use-controller', () => {
  beforeEach(() => {
    sentEvents.length = 0
  })

  it('创建后可在活动索引中查找', async () => {
    const { createComputerUseController, getComputerUseController, getActiveComputerUseControllers, finishComputerUseController } =
      await import('../browser-automation/computer-use-controller')
    const controller = createComputerUseController({ taskId: 'cu-1' })
    expect(getComputerUseController('cu-1')).toBe(controller)
    expect(getActiveComputerUseControllers().has('cu-1')).toBe(true)
    finishComputerUseController(controller)
    expect(getActiveComputerUseControllers().has('cu-1')).toBe(false)
  })

  it('emit 会广播到所有窗口', async () => {
    const { createComputerUseController, finishComputerUseController } =
      await import('../browser-automation/computer-use-controller')
    const controller = createComputerUseController({ taskId: 'cu-2' })
    controller.emit({ type: 'started', taskId: 'cu-2', url: 'https://example.com', task: '测试', maxSteps: 10, timestamp: 1 })
    expect(sentEvents.length).toBe(2)
    expect(sentEvents[0]?.windowId).toBe(1)
    expect(sentEvents[1]?.windowId).toBe(2)
    finishComputerUseController(controller)
  })

  it('pause 后 waitForResume 会阻塞，resume 后继续', async () => {
    const { createComputerUseController, finishComputerUseController } =
      await import('../browser-automation/computer-use-controller')
    const controller = createComputerUseController({ taskId: 'cu-3' })
    controller.pause()
    expect(controller.isPaused()).toBe(true)

    const waitPromise = controller.waitForResume()
    let resolved = false
    waitPromise.then(() => { resolved = true })

    // 给事件循环一个机会，确认仍未 resolve
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(resolved).toBe(false)

    controller.resume()
    await waitPromise
    expect(controller.isPaused()).toBe(false)
    finishComputerUseController(controller)
  })

  it('stop 会取消暂停并标记停止', async () => {
    const { createComputerUseController, finishComputerUseController } =
      await import('../browser-automation/computer-use-controller')
    const controller = createComputerUseController({ taskId: 'cu-4' })
    controller.pause()
    const waitPromise = controller.waitForResume()
    controller.stop()
    await waitPromise
    expect(controller.isStopped()).toBe(true)
    finishComputerUseController(controller)
  })

  it('step 会恢复一次并在后续自动暂停（stepMode）', async () => {
    const { createComputerUseController, finishComputerUseController } =
      await import('../browser-automation/computer-use-controller')
    const controller = createComputerUseController({ taskId: 'cu-5', stepMode: true })
    expect(controller.isPaused()).toBe(true)
    controller.step()
    expect(controller.isPaused()).toBe(false)
    finishComputerUseController(controller)
  })

  it('setStepMode(true) 会在运行中自动暂停', async () => {
    const { createComputerUseController, finishComputerUseController } =
      await import('../browser-automation/computer-use-controller')
    const controller = createComputerUseController({ taskId: 'cu-6' })
    expect(controller.isPaused()).toBe(false)
    controller.setStepMode(true)
    expect(controller.isStepMode()).toBe(true)
    expect(controller.isPaused()).toBe(true)
    finishComputerUseController(controller)
  })

  it('handleCommand 支持所有控制命令', async () => {
    const { createComputerUseController, finishComputerUseController } =
      await import('../browser-automation/computer-use-controller')
    const controller = createComputerUseController({ taskId: 'cu-7' })
    controller.handleCommand({ type: 'pause' })
    expect(controller.isPaused()).toBe(true)
    controller.handleCommand({ type: 'resume' })
    expect(controller.isPaused()).toBe(false)
    controller.handleCommand({ type: 'step' })
    expect(controller.isStepMode()).toBe(true)
    controller.handleCommand({ type: 'set-step-mode', enabled: false })
    expect(controller.isStepMode()).toBe(false)
    controller.handleCommand({ type: 'stop' })
    expect(controller.isStopped()).toBe(true)
    finishComputerUseController(controller)
  })
})

describe('executeComputerUseTask with controller', () => {
  beforeEach(() => {
    sentEvents.length = 0
  })

  it('会向控制器 emit started、screenshot、action、finished 事件', async () => {
    const { createComputerUseController, finishComputerUseController } =
      await import('../browser-automation/computer-use-controller')
    const { executeComputerUseTask } = await import('../browser-automation/computer-use-service')

    const controller = createComputerUseController({ taskId: 'cu-integration' })
    const driver = new FakeBrowserDriver()
    const callLLM = createFakeLLMCaller([
      { type: 'click', x: 10, y: 20 },
      { type: 'finish', summary: 'done' },
    ])

    const result = await executeComputerUseTask(
      { url: 'https://example.com', task: '集成测试' },
      {},
      driver,
      callLLM,
      controller,
    )

    expect(result.success).toBe(true)
    const types = sentEvents.map((e) => e.event.type)
    expect(types).toContain('started')
    expect(types).toContain('screenshot')
    expect(types).toContain('action')
    expect(types).toContain('finished')

    const started = sentEvents.find((e) => e.event.type === 'started')?.event
    expect(started?.type === 'started' && started.taskId).toBe('cu-integration')
    finishComputerUseController(controller)
  })

  it('stop 命令会终止正在运行的任务', async () => {
    const { createComputerUseController, finishComputerUseController } =
      await import('../browser-automation/computer-use-controller')
    const { executeComputerUseTask } = await import('../browser-automation/computer-use-service')

    const controller = createComputerUseController({ taskId: 'cu-stop-test' })
    const driver = new FakeBrowserDriver()
    const callLLM: LLMVisionCaller = async () => ({ thought: 'continue', action: { type: 'wait', ms: 10 } })

    controller.stop()

    const result = await executeComputerUseTask(
      { url: 'https://example.com', task: '停止测试', maxSteps: 100 },
      {},
      driver,
      callLLM,
      controller,
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('终止')
    finishComputerUseController(controller)
  })
})
