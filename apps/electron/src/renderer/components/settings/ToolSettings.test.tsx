/**
 * ToolSettings 组件测试
 *
 * 覆盖设置页到执行器的关键链路：
 * 1. 超时时间保存时进行秒 → 毫秒单位转换
 * 2. headless / 默认导入 KOL 数据库 Switch 保存新值
 * 3. 旧版按秒保存的凭据加载后正确显示为秒
 */

import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { render, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { Provider as JotaiProvider, createStore } from 'jotai'
import {
  BrowserAutomationSettings,
  ScheduledScrapingSettings,
} from './ToolSettings.tsx'

interface MockElectronAPI {
  getChatTools: ReturnType<typeof mock>
  getChatToolCredentials: ReturnType<typeof mock>
  updateChatToolCredentials: ReturnType<typeof mock>
  updateChatToolState: ReturnType<typeof mock>
  testChatTool: ReturnType<typeof mock>
  openPath: ReturnType<typeof mock>
  getScheduledScrapingTasks: ReturnType<typeof mock>
  saveScheduledScrapingTasks: ReturnType<typeof mock>
}

const defaultTools = [
  {
    meta: {
      id: 'web-scraper',
      name: '网页爬取',
      description: '',
      params: [],
      icon: 'Globe',
      category: 'builtin',
      executorType: 'builtin',
      systemPromptAppend: '',
    },
    enabled: true,
    available: true,
  },
]

function setupMockAPI(): MockElectronAPI {
  const api: MockElectronAPI = {
    getChatTools: mock(async () => defaultTools),
    getChatToolCredentials: mock(async () => ({})),
    updateChatToolCredentials: mock(async () => {}),
    updateChatToolState: mock(async () => {}),
    testChatTool: mock(async () => ({ success: true, message: 'ok' })),
    openPath: mock(async () => undefined),
    getScheduledScrapingTasks: mock(async () => []),
    saveScheduledScrapingTasks: mock(async () => {}),
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).window.electronAPI = api
  return api
}

function renderWithStore(ui: React.ReactElement) {
  const store = createStore()
  return {
    store,
    ...render(<JotaiProvider store={store}>{ui}</JotaiProvider>),
  }
}

describe('ToolSettings 浏览器自动化设置', () => {
  beforeEach(() => {
    setupMockAPI()
    // ScheduledScrapingSettings 使用 crypto.randomUUID
    if (!globalThis.crypto) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalThis as any).crypto = { randomUUID: () => 'test-task-id' }
    }
  })

  afterEach(() => {
    cleanup()
  })

  it('Given 超时时间为旧版秒值 when 渲染 then 显示为秒', async () => {
    const api = (globalThis as unknown as { window: { electronAPI: MockElectronAPI } }).window.electronAPI
    api.getChatToolCredentials = mock(async () => ({ timeoutMs: '60' }))

    const { findByLabelText } = renderWithStore(
      <BrowserAutomationSettings
        toolId="web-scraper"
        title="网页爬取"
        description=""
        guideTitle=""
        guideContent={null}
      />,
    )

    const input = (await findByLabelText('超时时间（秒）')) as HTMLInputElement
    expect(input.value).toBe('60')
  })

  it('Given 超时时间为新版毫秒值 when 渲染 then 回显为秒', async () => {
    const api = (globalThis as unknown as { window: { electronAPI: MockElectronAPI } }).window.electronAPI
    api.getChatToolCredentials = mock(async () => ({ timeoutMs: '120000' }))

    const { findByLabelText } = renderWithStore(
      <BrowserAutomationSettings
        toolId="web-scraper"
        title="网页爬取"
        description=""
        guideTitle=""
        guideContent={null}
      />,
    )

    const input = (await findByLabelText('超时时间（秒）')) as HTMLInputElement
    expect(input.value).toBe('120')
  })

  it('Given 修改超时时间 when blur then 保存毫秒值', async () => {
    const api = (globalThis as unknown as { window: { electronAPI: MockElectronAPI } }).window.electronAPI
    api.getChatToolCredentials = mock(async () => ({ timeoutMs: '60000' }))

    const { findByLabelText } = renderWithStore(
      <BrowserAutomationSettings
        toolId="web-scraper"
        title="网页爬取"
        description=""
        guideTitle=""
        guideContent={null}
      />,
    )

    const input = (await findByLabelText('超时时间（秒）')) as HTMLInputElement
    fireEvent.change(input, { target: { value: '90' } })
    fireEvent.blur(input)

    await waitFor(() => {
      expect(api.updateChatToolCredentials).toHaveBeenCalled()
    })

    const calls = api.updateChatToolCredentials.mock.calls as [string, Record<string, string>][]
    const lastCall = calls[calls.length - 1]!
    expect(lastCall[0]).toBe('web-scraper')
    expect(lastCall[1].timeoutMs).toBe('90000')
  })

  it('Given headless 关闭 when 打开 Switch then 保存 headless=true', async () => {
    const api = (globalThis as unknown as { window: { electronAPI: MockElectronAPI } }).window.electronAPI
    api.getChatToolCredentials = mock(async () => ({ headless: 'false' }))

    const { findByLabelText } = renderWithStore(
      <BrowserAutomationSettings
        toolId="web-scraper"
        title="网页爬取"
        description=""
        guideTitle=""
        guideContent={null}
      />,
    )

    const switchEl = await findByLabelText('headless 模式')
    await act(async () => {
      fireEvent.click(switchEl)
    })

    await waitFor(() => {
      const calls = api.updateChatToolCredentials.mock.calls as [string, Record<string, string>][]
      expect(calls.some((call) => call[1].headless === 'true')).toBe(true)
    })
  })

  it('Given 默认导入 KOL 数据库关闭 when 打开 Switch then 保存 importToKolDatabase=true', async () => {
    const api = (globalThis as unknown as { window: { electronAPI: MockElectronAPI } }).window.electronAPI
    api.getChatToolCredentials = mock(async () => ({ importToKolDatabase: 'false' }))

    const { findByLabelText } = renderWithStore(
      <BrowserAutomationSettings
        toolId="web-scraper"
        title="网页爬取"
        description=""
        guideTitle=""
        guideContent={null}
      />,
    )

    const switchEl = await findByLabelText('默认导入 KOL 数据库')
    await act(async () => {
      fireEvent.click(switchEl)
    })

    await waitFor(() => {
      const calls = api.updateChatToolCredentials.mock.calls as [string, Record<string, string>][]
      expect(calls.some((call) => call[1].importToKolDatabase === 'true')).toBe(true)
    })
  })
})

describe('ToolSettings 定时爬取设置', () => {
  beforeEach(() => {
    setupMockAPI()
    if (!globalThis.crypto) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalThis as any).crypto = { randomUUID: () => 'test-task-id' }
    }
  })

  afterEach(() => {
    cleanup()
  })

  it('Given 添加定时任务 when 保存 then 调用 saveScheduledScrapingTasks', async () => {
    const api = (globalThis as unknown as { window: { electronAPI: MockElectronAPI } }).window.electronAPI
    api.getScheduledScrapingTasks = mock(async () => [])

    const { getByText } = renderWithStore(
      <ScheduledScrapingSettings />,
    )

    const addButton = await waitFor(() => getByText('添加任务'))
    fireEvent.click(addButton)

    const saveButton = getByText('保存并应用')
    fireEvent.click(saveButton)

    await waitFor(() => {
      expect(api.saveScheduledScrapingTasks).toHaveBeenCalled()
    })
  })
})
