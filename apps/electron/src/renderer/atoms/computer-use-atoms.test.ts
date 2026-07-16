/**
 * Computer Use atoms 测试
 *
 * 验证 reduceComputerUseEvent 能根据 IPC 事件正确更新任务状态。
 */

import { describe, it, expect } from 'bun:test'
import { reduceComputerUseEvent } from './computer-use-atoms'
import type { ComputerUseUIEvent } from '@ma-proma/shared'

describe('reduceComputerUseEvent', () => {
  it('started 事件创建新的任务状态', () => {
    const event: ComputerUseUIEvent = {
      type: 'started',
      taskId: 'cu-1',
      url: 'https://example.com',
      task: '登录并抓取',
      maxSteps: 10,
      timestamp: 1,
    }
    const state = reduceComputerUseEvent(null, event)
    expect(state).toEqual({
      taskId: 'cu-1',
      url: 'https://example.com',
      task: '登录并抓取',
      maxSteps: 10,
      step: 0,
      status: 'running',
      history: [],
    })
  })

  it('screenshot 事件更新当前步骤与截图', () => {
    const started: ComputerUseUIEvent = {
      type: 'started',
      taskId: 'cu-1',
      url: 'https://example.com',
      task: '测试',
      maxSteps: 5,
      timestamp: 1,
    }
    let state = reduceComputerUseEvent(null, started)
    state = reduceComputerUseEvent(state, {
      type: 'screenshot',
      taskId: 'cu-1',
      step: 2,
      base64: 'base64png',
      timestamp: 2,
    })
    expect(state?.step).toBe(2)
    expect(state?.screenshotBase64).toBe('base64png')
  })

  it('action 事件追加到历史', () => {
    const started: ComputerUseUIEvent = {
      type: 'started',
      taskId: 'cu-1',
      url: 'https://example.com',
      task: '测试',
      maxSteps: 5,
      timestamp: 1,
    }
    let state = reduceComputerUseEvent(null, started)
    state = reduceComputerUseEvent(state, {
      type: 'action',
      taskId: 'cu-1',
      step: 1,
      thought: '点击登录',
      action: { type: 'click', x: 100, y: 200 },
      timestamp: 2,
    })
    expect(state?.history).toHaveLength(1)
    expect(state?.history[0]).toEqual({
      step: 1,
      thought: '点击登录',
      action: { type: 'click', x: 100, y: 200 },
    })
  })

  it('status 事件更新状态', () => {
    const started: ComputerUseUIEvent = {
      type: 'started',
      taskId: 'cu-1',
      url: 'https://example.com',
      task: '测试',
      maxSteps: 5,
      timestamp: 1,
    }
    let state = reduceComputerUseEvent(null, started)
    state = reduceComputerUseEvent(state, {
      type: 'status',
      taskId: 'cu-1',
      status: 'paused',
      timestamp: 2,
    })
    expect(state?.status).toBe('paused')
  })

  it('finished 事件标记完成并保存结果', () => {
    const started: ComputerUseUIEvent = {
      type: 'started',
      taskId: 'cu-1',
      url: 'https://example.com',
      task: '测试',
      maxSteps: 5,
      timestamp: 1,
    }
    let state = reduceComputerUseEvent(null, started)
    state = reduceComputerUseEvent(state, {
      type: 'finished',
      taskId: 'cu-1',
      success: true,
      summary: '完成',
      steps: 3,
      taskDir: '/tmp/cu-1',
      timestamp: 2,
    })
    expect(state?.status).toBe('finished')
    expect(state?.success).toBe(true)
    expect(state?.summary).toBe('完成')
    expect(state?.taskDir).toBe('/tmp/cu-1')
  })

  it('error 事件标记失败', () => {
    const started: ComputerUseUIEvent = {
      type: 'started',
      taskId: 'cu-1',
      url: 'https://example.com',
      task: '测试',
      maxSteps: 5,
      timestamp: 1,
    }
    let state = reduceComputerUseEvent(null, started)
    state = reduceComputerUseEvent(state, {
      type: 'error',
      taskId: 'cu-1',
      error: '浏览器崩溃',
      timestamp: 2,
    })
    expect(state?.status).toBe('finished')
    expect(state?.error).toBe('浏览器崩溃')
  })

  it('忽略 taskId 不匹配的事件', () => {
    const started: ComputerUseUIEvent = {
      type: 'started',
      taskId: 'cu-1',
      url: 'https://example.com',
      task: '测试',
      maxSteps: 5,
      timestamp: 1,
    }
    let state = reduceComputerUseEvent(null, started)
    state = reduceComputerUseEvent(state, {
      type: 'screenshot',
      taskId: 'cu-2',
      step: 1,
      base64: 'other',
      timestamp: 2,
    })
    expect(state?.step).toBe(0)
    expect(state?.screenshotBase64).toBeUndefined()
  })
})
