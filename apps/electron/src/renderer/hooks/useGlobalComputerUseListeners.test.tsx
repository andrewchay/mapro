/**
 * Computer Use 全局监听器测试
 *
 * 验证监听器能把主进程事件正确写入 Jotai atoms。
 */

import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { render, cleanup, act } from '@testing-library/react'
import { Provider as JotaiProvider, createStore } from 'jotai'
import { useGlobalComputerUseListeners } from './useGlobalComputerUseListeners'
import { computerUsePanelOpenAtom, computerUseTaskAtom } from '@/atoms/computer-use-atoms'
import type { ComputerUseUIEvent } from '@ma-proma/shared'

interface MockElectronAPI {
  onComputerUseEvent: ReturnType<typeof mock>
}

function setupMockAPI(): MockElectronAPI {
  const api: MockElectronAPI = {
    onComputerUseEvent: mock(() => () => {}),
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).window.electronAPI = api
  return api
}

function TestWrapper({ store, children }: { store: ReturnType<typeof createStore>; children: React.ReactNode }): React.ReactElement {
  return <JotaiProvider store={store}>{children}</JotaiProvider>
}

function TestComponent(): null {
  useGlobalComputerUseListeners()
  return null
}

describe('useGlobalComputerUseListeners', () => {
  beforeEach(() => {
    setupMockAPI()
  })

  afterEach(() => {
    cleanup()
  })

  it('started 事件打开面板并写入任务状态', async () => {
    const store = createStore()
    const api = (globalThis as unknown as { window: { electronAPI: MockElectronAPI } }).window.electronAPI
    let emit: ((event: ComputerUseUIEvent) => void) | undefined
    api.onComputerUseEvent = mock((callback: (event: ComputerUseUIEvent) => void) => {
      emit = callback
      return () => {}
    })

    render(
      <TestWrapper store={store}>
        <TestComponent />
      </TestWrapper>,
    )

    await act(async () => {
      emit?.({
        type: 'started',
        taskId: 'cu-listener',
        url: 'https://example.com',
        task: '监听测试',
        maxSteps: 5,
        timestamp: 1,
      })
    })

    expect(store.get(computerUsePanelOpenAtom)).toBe(true)
    expect(store.get(computerUseTaskAtom)?.taskId).toBe('cu-listener')
    expect(store.get(computerUseTaskAtom)?.task).toBe('监听测试')
  })

  it('screenshot / action 事件更新任务状态', async () => {
    const store = createStore()
    const api = (globalThis as unknown as { window: { electronAPI: MockElectronAPI } }).window.electronAPI
    let emit: ((event: ComputerUseUIEvent) => void) | undefined
    api.onComputerUseEvent = mock((callback: (event: ComputerUseUIEvent) => void) => {
      emit = callback
      return () => {}
    })

    render(
      <TestWrapper store={store}>
        <TestComponent />
      </TestWrapper>,
    )

    await act(async () => {
      emit?.({
        type: 'started',
        taskId: 'cu-listener',
        url: 'https://example.com',
        task: '监听测试',
        maxSteps: 5,
        timestamp: 1,
      })
      emit?.({
        type: 'screenshot',
        taskId: 'cu-listener',
        step: 1,
        base64: 'iVBORw0KGgo=',
        timestamp: 2,
      })
      emit?.({
        type: 'action',
        taskId: 'cu-listener',
        step: 1,
        thought: '点击按钮',
        action: { type: 'click', x: 10, y: 20 },
        timestamp: 3,
      })
    })

    const task = store.get(computerUseTaskAtom)
    expect(task?.step).toBe(1)
    expect(task?.screenshotBase64).toBe('iVBORw0KGgo=')
    expect(task?.history).toHaveLength(1)
  })

  it('组件卸载时清理监听器', () => {
    const cleanupFn = mock(() => {})
    const api = (globalThis as unknown as { window: { electronAPI: MockElectronAPI } }).window.electronAPI
    api.onComputerUseEvent = mock(() => cleanupFn)

    const { unmount } = render(
      <TestWrapper store={createStore()}>
        <TestComponent />
      </TestWrapper>,
    )

    unmount()
    expect(cleanupFn).toHaveBeenCalled()
  })
})
