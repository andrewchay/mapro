/**
 * Computer Use 视觉浏览器自动化服务
 *
 * 实现“截图 → 调用多模态 LLM → 执行动作 → 截图”的观察-思考-行动循环。
 * 通过 BrowserDriver 接口与具体浏览器实现解耦，便于测试和替换底层引擎。
 */

import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { getConfigDir } from '../config-paths.ts'
import type {
  ComputerUseTaskInput,
  ComputerUseOptions,
  ComputerAction,
  BrowserDriver,
  LLMVisionCaller,
  ComputerUseTaskResult,
} from './computer-use-types.ts'
import type { ComputerUseController } from './computer-use-controller.ts'

const DEFAULT_MAX_STEPS = 30
const DEFAULT_TIMEOUT_MS = 60_000
const COMPUTER_USE_DIR_NAME = 'computer-use'

/**
 * 获取 Computer Use 任务根目录
 */
function getComputerUseRootDir(): string {
  const dir = join(getConfigDir(), COMPUTER_USE_DIR_NAME)
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
  const dir = join(getComputerUseRootDir(), taskId)
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 解析 LLM 返回的 JSON，提取 thought 和 action
 */
export function parseLLMAction(text: string): { thought: string; action: ComputerAction } {
  const trimmed = text.trim()

  let parsed: unknown

  // 1. 直接 JSON
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      // continue
    }
  }

  // 2. Markdown code block
  if (!parsed) {
    const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (codeBlockMatch?.[1]) {
      try {
        parsed = JSON.parse(codeBlockMatch[1].trim())
      } catch {
        // continue
      }
    }
  }

  // 3. 查找第一个 { ... }
  if (!parsed) {
    const objectStart = trimmed.indexOf('{')
    const objectEnd = trimmed.lastIndexOf('}')
    if (objectStart !== -1 && objectEnd !== -1 && objectEnd > objectStart) {
      try {
        parsed = JSON.parse(trimmed.slice(objectStart, objectEnd + 1))
      } catch {
        // continue
      }
    }
  }

  if (!parsed || typeof parsed !== 'object' || parsed === null) {
    throw new Error('无法从 LLM 响应中解析出有效 JSON')
  }

  const record = parsed as Record<string, unknown>
  const action = record.action as ComputerAction | undefined
  if (!action || typeof action !== 'object' || action === null) {
    throw new Error('LLM 响应缺少 action 字段')
  }

  if (!isValidComputerAction(action)) {
    throw new Error(`LLM 返回了未知的 action 类型: ${(action as { type?: string }).type ?? 'undefined'}`)
  }

  return {
    thought: typeof record.thought === 'string' ? record.thought : '',
    action,
  }
}

/**
 * 校验 action 是否合法
 */
function isValidComputerAction(action: ComputerAction): action is ComputerAction {
  const validTypes = ['goto', 'click', 'type', 'scroll', 'key', 'wait', 'screenshot', 'finish']
  return validTypes.includes((action as { type?: string }).type ?? '')
}

/**
 * 执行 Computer Use 视觉任务
 *
 * @param controller 可选的人工干预控制器；传入后会向渲染进程广播实时事件
 */
export async function executeComputerUseTask(
  input: ComputerUseTaskInput,
  options: ComputerUseOptions,
  driver: BrowserDriver,
  callLLM: LLMVisionCaller,
  controller?: ComputerUseController,
): Promise<ComputerUseTaskResult> {
  const taskDir = createTaskDir()
  const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const history: Array<{ thought: string; action: ComputerAction }> = []

  const systemPrompt = buildSystemPrompt()
  const screenshotPath = join(taskDir, 'screenshot.png')

  function emitScreenshot(step: number, base64: string): void {
    controller?.emit({ type: 'screenshot', taskId: controller.taskId, step, base64, timestamp: Date.now() })
  }

  function emitAction(step: number, thought: string, action: ComputerAction): void {
    controller?.emit({
      type: 'action',
      taskId: controller.taskId,
      step,
      thought,
      action,
      timestamp: Date.now(),
    })
  }

  function emitFinished(result: ComputerUseTaskResult): void {
    controller?.emit({
      type: 'finished',
      taskId: controller.taskId,
      success: result.success,
      summary: result.summary,
      steps: result.steps,
      taskDir: result.taskDir,
      error: result.error,
      timestamp: Date.now(),
    })
  }

  try {
    const initOptions = { ...options, taskDir }
    await driver.init(initOptions)
    await driver.goto(input.url)

    controller?.emit({
      type: 'started',
      taskId: controller.taskId,
      url: input.url,
      task: input.task,
      maxSteps,
      timestamp: Date.now(),
    })

    for (let step = 0; step < maxSteps; step++) {
      if (controller?.isStopped()) {
        throw new Error('用户已终止任务')
      }

      // 人工暂停：等待继续/单步/终止
      if (controller?.isPaused()) {
        await controller.waitForResume()
        if (controller.isStopped()) {
          throw new Error('用户已终止任务')
        }
      }

      const screenshotBase64 = await driver.screenshot()
      // 保存最终截图到任务目录
      writeFileSync(screenshotPath, Buffer.from(screenshotBase64, 'base64'))
      emitScreenshot(step + 1, screenshotBase64)

      const llmResult = await callLLM({
        systemPrompt,
        task: input.task,
        screenshotBase64,
        history,
      })

      const { thought, action } = llmResult
      history.push({ thought, action })
      emitAction(step + 1, thought, action)

      if (action.type === 'finish') {
        await driver.finish()
        const result: ComputerUseTaskResult = {
          success: true,
          summary: action.summary ?? '任务已完成',
          taskDir,
          screenshotFile: 'screenshot.png',
          steps: step + 1,
        }
        emitFinished(result)
        return result
      }

      await executeAction(driver, action)

      // 单步模式：每执行完一步后自动暂停，等待用户确认
      if (controller?.isStepMode() && step < maxSteps - 1) {
        controller.pause()
      }
    }

    const result: ComputerUseTaskResult = {
      success: false,
      summary: '',
      taskDir,
      screenshotFile: 'screenshot.png',
      error: `达到最大步数限制（${maxSteps} 步），任务未完成`,
      steps: maxSteps,
    }
    emitFinished(result)
    return result
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const result: ComputerUseTaskResult = {
      success: false,
      summary: '',
      taskDir,
      screenshotFile: existsSync(screenshotPath) ? 'screenshot.png' : undefined,
      error: errorMessage,
      steps: history.length,
    }
    controller?.emit({ type: 'error', taskId: controller.taskId, error: errorMessage, timestamp: Date.now() })
    emitFinished(result)
    return result
  } finally {
    try {
      await driver.close()
    } catch (closeError) {
      console.error('[Computer Use] 关闭浏览器失败:', closeError)
    }
  }
}

/**
 * 执行单个 action
 */
async function executeAction(driver: BrowserDriver, action: ComputerAction): Promise<void> {
  switch (action.type) {
    case 'goto':
      await driver.goto(action.url)
      break
    case 'click':
      await driver.click(action.x, action.y)
      break
    case 'type':
      await driver.type(action.text)
      break
    case 'scroll':
      await driver.scroll(action.dx, action.dy)
      break
    case 'key':
      await driver.key(action.key)
      break
    case 'wait':
      await driver.wait(action.ms)
      break
    case 'screenshot':
      await driver.screenshot()
      break
    default:
      // finish 已在上面处理，这里不会到达
      break
  }
}

/**
 * 构造 Computer Use 系统提示词
 */
function buildSystemPrompt(): string {
  return `你是一名浏览器自动化操作专家。你的任务是根据当前页面截图和用户目标，决定下一步浏览器操作。

可用动作（必须严格返回 JSON 格式）：
- { "type": "goto", "url": "https://..." } — 打开指定 URL
- { "type": "click", "x": 120, "y": 340 } — 点击屏幕坐标（像素，左上角为原点）
- { "type": "type", "text": "要输入的内容" } — 在焦点元素输入文本
- { "type": "scroll", "dx": 0, "dy": 500 } — 滚动页面
- { "type": "key", "key": "Enter" } — 按下键盘按键
- { "type": "wait", "ms": 1000 } — 等待指定毫秒
- { "type": "screenshot" } — 重新截图（通常不需要，循环会自动截图）
- { "type": "finish", "summary": "任务结果摘要" } — 任务完成

输出格式要求：
{
  "thought": "简要说明当前观察和下一步计划",
  "action": { "type": "...", ... }
}

注意事项：
1. 先观察截图，再做决策。
2. 坐标使用实际像素值，基于 1280x800 的视口。
3. 遇到登录、验证码等需要人类介入的场景，可调用 finish 并说明情况。
4. 不要输出任何解释文字，只输出 JSON。`
}
