/**
 * Computer Use 任务控制器
 *
 * 支持对视觉浏览器自动化任务进行人工干预：
 * - 暂停 / 继续
 * - 单步执行
 * - 终止任务
 * - 向所有渲染进程广播实时事件（截图、动作、状态变化）
 */

import { BrowserWindow } from 'electron'
import type { ComputerUseControlCommand, ComputerUseUIEvent } from '@ma-proma/shared'
import { COMPUTER_USE_IPC_CHANNELS } from '@ma-proma/shared'

export interface ComputerUseControllerOptions {
  /** 任务唯一标识 */
  taskId: string
  /** 是否初始即进入单步模式（每步都等待用户确认） */
  stepMode?: boolean
}

export interface ComputerUseController {
  /** 任务 ID */
  taskId: string
  /** 当前是否处于暂停状态 */
  isPaused: () => boolean
  /** 当前是否处于单步模式 */
  isStepMode: () => boolean
  /** 用户是否已要求终止 */
  isStopped: () => boolean
  /** 暂停任务 */
  pause: () => void
  /** 继续任务 */
  resume: () => void
  /** 单步执行一次 */
  step: () => void
  /** 终止任务 */
  stop: () => void
  /** 设置/取消单步模式 */
  setStepMode: (enabled: boolean) => void
  /** 如果处于暂停状态，阻塞直到被继续或终止 */
  waitForResume: () => Promise<void>
  /** 向所有渲染进程广播事件 */
  emit: (event: ComputerUseUIEvent) => void
  /** 处理来自渲染进程的控制命令 */
  handleCommand: (command: ComputerUseControlCommand) => void
}

interface Deferred {
  promise: Promise<void>
  resolve: () => void
  reject: (reason?: unknown) => void
}

function createDeferred(): Deferred {
  let resolve: () => void = () => {}
  let reject: (reason?: unknown) => void = () => {}
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** 活动控制器索引，便于外部按 taskId 查找 */
const activeControllers = new Map<string, ComputerUseController>()

export function getActiveComputerUseControllers(): ReadonlyMap<string, ComputerUseController> {
  return activeControllers
}

export function getComputerUseController(taskId: string): ComputerUseController | undefined {
  return activeControllers.get(taskId)
}

/**
 * 创建一个新的 Computer Use 任务控制器
 */
export function createComputerUseController(options: ComputerUseControllerOptions): ComputerUseController {
  const { taskId, stepMode = false } = options

  let paused = stepMode
  let stopped = false
  let currentStepMode = stepMode
  let resumeDeferred = createDeferred()
  let finished = false

  function broadcast(event: ComputerUseUIEvent): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue
      try {
        window.webContents.send(COMPUTER_USE_IPC_CHANNELS.EVENT, event)
      } catch (error) {
        console.warn('[ComputerUseController] 向渲染进程推送事件失败:', error)
      }
    }
  }

  type ComputerUseStatus = Extract<ComputerUseUIEvent, { type: 'status' }>['status']
  function emitStatus(status: ComputerUseStatus): void {
    broadcast({ type: 'status', taskId, status, timestamp: Date.now() })
  }

  function resolveResume(): void {
    const prev = resumeDeferred
    resumeDeferred = createDeferred()
    prev.resolve()
  }

  function cleanup(): void {
    finished = true
    activeControllers.delete(taskId)
    // 如果有等待 resume 的 promise，以终止方式拒绝
    resumeDeferred.reject(new Error('任务已结束'))
  }

  const controller: ComputerUseController = {
    taskId,

    isPaused: () => paused,
    isStepMode: () => currentStepMode,
    isStopped: () => stopped,

    pause: () => {
      if (finished || stopped) return
      paused = true
      emitStatus('paused')
    },

    resume: () => {
      if (finished || stopped) return
      paused = false
      emitStatus('resumed')
      resolveResume()
    },

    step: () => {
      if (finished || stopped) return
      paused = false
      currentStepMode = true
      emitStatus('resumed')
      resolveResume()
    },

    stop: () => {
      if (finished) return
      stopped = true
      paused = false
      emitStatus('stopping')
      resolveResume()
    },

    setStepMode: (enabled: boolean) => {
      currentStepMode = enabled
      if (enabled && !paused && !finished && !stopped) {
        controller.pause()
      }
    },

    waitForResume: async () => {
      if (finished || stopped) return
      if (!paused) return
      try {
        await resumeDeferred.promise
      } catch {
        // 任务结束时拒绝，属于正常情况
      }
    },

    emit: (event: ComputerUseUIEvent) => {
      if (finished && event.type !== 'finished' && event.type !== 'error') return
      broadcast(event)
    },

    handleCommand: (command: ComputerUseControlCommand) => {
      switch (command.type) {
        case 'pause':
          controller.pause()
          break
        case 'resume':
          controller.resume()
          break
        case 'step':
          controller.step()
          break
        case 'stop':
          controller.stop()
          break
        case 'set-step-mode':
          controller.setStepMode(command.enabled)
          break
      }
    },
  }

  activeControllers.set(taskId, controller)
  return controller
}

/**
 * 标记控制器已结束，清理索引
 */
export function finishComputerUseController(controller: ComputerUseController): void {
  const existing = activeControllers.get(controller.taskId)
  if (existing !== controller) return
  activeControllers.delete(controller.taskId)
}
