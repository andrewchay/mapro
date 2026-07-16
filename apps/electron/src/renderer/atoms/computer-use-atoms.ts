/**
 * Computer Use 视觉浏览器自动化状态
 */

import { atom } from 'jotai'
import type { ComputerUseUIEvent } from '@ma-proma/shared'

export interface ComputerUseHistoryItem {
  step: number
  thought: string
  action: unknown
}

export interface ComputerUseTaskState {
  taskId: string
  url: string
  task: string
  maxSteps: number
  step: number
  status: 'running' | 'paused' | 'resumed' | 'stopping' | 'finished'
  screenshotBase64?: string
  history: ComputerUseHistoryItem[]
  summary?: string
  error?: string
  taskDir?: string
  success?: boolean
}

/** 面板是否打开 */
export const computerUsePanelOpenAtom = atom(false)

/** 当前任务状态 */
export const computerUseTaskAtom = atom<ComputerUseTaskState | null>(null)

/** 是否默认开启单步模式 */
export const computerUseStepModeAtom = atom(false)

/**
 * 根据 UI 事件更新任务状态
 */
export function reduceComputerUseEvent(
  state: ComputerUseTaskState | null,
  event: ComputerUseUIEvent,
): ComputerUseTaskState | null {
  switch (event.type) {
    case 'started':
      return {
        taskId: event.taskId,
        url: event.url,
        task: event.task,
        maxSteps: event.maxSteps,
        step: 0,
        status: 'running',
        history: [],
      }
    case 'screenshot':
      if (!state || state.taskId !== event.taskId) return state
      return { ...state, step: event.step, screenshotBase64: event.base64 }
    case 'action':
      if (!state || state.taskId !== event.taskId) return state
      return {
        ...state,
        step: event.step,
        history: [
          ...state.history,
          { step: event.step, thought: event.thought, action: event.action },
        ],
      }
    case 'status':
      if (!state || state.taskId !== event.taskId) return state
      return { ...state, status: event.status }
    case 'finished':
      if (!state || state.taskId !== event.taskId) return state
      return {
        ...state,
        status: 'finished',
        success: event.success,
        summary: event.summary,
        error: event.error,
        taskDir: event.taskDir,
      }
    case 'error':
      if (!state || state.taskId !== event.taskId) return state
      return { ...state, status: 'finished', error: event.error }
    default:
      return state
  }
}
