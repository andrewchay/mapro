/**
 * ComputerUsePanel 组件测试
 *
 * 验证面板能正确响应 Computer Use 事件并渲染截图、动作历史和控制按钮。
 */

import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { render, cleanup, act } from '@testing-library/react'
import { Provider as JotaiProvider, createStore } from 'jotai'
import { ComputerUsePanel } from './ComputerUsePanel'
import { computerUsePanelOpenAtom, computerUseTaskAtom, reduceComputerUseEvent } from '@/atoms/computer-use-atoms'
import type { ComputerUseUIEvent } from '@ma-proma/shared'

interface MockElectronAPI {
  onComputerUseEvent: ReturnType<typeof mock>
  controlComputerUse: ReturnType<typeof mock>
  openPath: ReturnType<typeof mock>
}

function setupMockAPI(): MockElectronAPI {
  const api: MockElectronAPI = {
    onComputerUseEvent: mock(() => () => {}),
    controlComputerUse: mock(async () => {}),
    openPath: mock(async () => undefined),
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).window.electronAPI = api
  return api
}

function renderWithStore(ui: React.ReactElement, store = createStore()) {
  return {
    store,
    ...render(<JotaiProvider store={store}>{ui}</JotaiProvider>),
  }
}

describe('ComputerUsePanel', () => {
  beforeEach(() => {
    setupMockAPI()
  })

  afterEach(() => {
    cleanup()
  })

  it('Given 未收到 started 事件 when 渲染 then 面板默认关闭', () => {
    const { queryByText } = renderWithStore(<ComputerUsePanel />)
    expect(queryByText('视觉浏览器自动化')).toBeNull()
  })

  it('Given 收到 started 事件 when 渲染 then 面板打开并显示任务信息', () => {
    const store = createStore()
    store.set(computerUsePanelOpenAtom, true)
    store.set(computerUseTaskAtom, {
      taskId: 'cu-test',
      url: 'https://example.com',
      task: '登录并抓取数据',
      maxSteps: 10,
      step: 0,
      status: 'running',
      history: [],
    })

    const { getByText } = renderWithStore(<ComputerUsePanel />, store)
    expect(getByText('登录并抓取数据')).toBeDefined()
    expect(getByText('步骤 0 / 10')).toBeDefined()
  })

  it('Given 收到 screenshot 和 action 事件 then 渲染截图和动作历史', () => {
    const store = createStore()
    store.set(computerUsePanelOpenAtom, true)
    let state = reduceComputerUseEvent(null, {
      type: 'started',
      taskId: 'cu-test',
      url: 'https://example.com',
      task: '测试任务',
      maxSteps: 5,
      timestamp: 1,
    })
    state = reduceComputerUseEvent(state, {
      type: 'screenshot',
      taskId: 'cu-test',
      step: 1,
      base64: 'iVBORw0KGgo=',
      timestamp: 2,
    })
    state = reduceComputerUseEvent(state, {
      type: 'action',
      taskId: 'cu-test',
      step: 1,
      thought: '点击登录按钮',
      action: { type: 'click', x: 100, y: 200 },
      timestamp: 3,
    })
    store.set(computerUseTaskAtom, state)

    const { getByText } = renderWithStore(<ComputerUsePanel />, store)
    const img = document.querySelector('img')
    expect(img?.getAttribute('src')).toContain('iVBORw0KGgo=')
    expect(getByText('点击登录按钮')).toBeDefined()
  })

  it('Given 任务已暂停 when 点击继续 then 发送 resume 命令', async () => {
    const store = createStore()
    store.set(computerUsePanelOpenAtom, true)
    store.set(computerUseTaskAtom, {
      taskId: 'cu-test',
      url: 'https://example.com',
      task: '测试任务',
      maxSteps: 5,
      step: 1,
      status: 'paused',
      history: [],
    })

    const api = (globalThis as unknown as { window: { electronAPI: MockElectronAPI } }).window.electronAPI
    const { getByText } = renderWithStore(<ComputerUsePanel />, store)
    const resumeButton = getByText('继续')
    await act(async () => {
      resumeButton.click()
    })
    expect(api.controlComputerUse).toHaveBeenCalledWith('cu-test', { type: 'resume' })
  })

  it('Given 任务运行中 when 点击终止 then 发送 stop 命令', async () => {
    const store = createStore()
    store.set(computerUsePanelOpenAtom, true)
    store.set(computerUseTaskAtom, {
      taskId: 'cu-test',
      url: 'https://example.com',
      task: '测试任务',
      maxSteps: 5,
      step: 1,
      status: 'running',
      history: [],
    })

    const api = (globalThis as unknown as { window: { electronAPI: MockElectronAPI } }).window.electronAPI
    const { getByText } = renderWithStore(<ComputerUsePanel />, store)
    const stopButton = getByText('终止')
    await act(async () => {
      stopButton.click()
    })
    expect(api.controlComputerUse).toHaveBeenCalledWith('cu-test', { type: 'stop' })
  })
})
