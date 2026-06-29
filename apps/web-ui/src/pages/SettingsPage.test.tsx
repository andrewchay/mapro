import '../../src/test-setup.ts'

/**
 * SettingsPage 单元测试
 *
 * BDD 行为驱动，验证 Agent 默认设置面板：
 * 1. 渲染默认渠道、模型、工作区和权限模式选择器
 * 2. 切换默认渠道时联动清空模型并调用 updateSettings
 * 3. 选择权限模式时调用 updateSettings
 */

import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, afterAll, mock } from 'bun:test'
import { render, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { Provider as JotaiProvider, createStore } from 'jotai'
import { SettingsPage } from './SettingsPage.tsx'
import { settingsAtom } from '../store/settings-atoms.ts'
import { channelsAtom } from '../store/channels-atoms.ts'
import { agentWorkspacesAtom } from '../store/agent-atoms.ts'
import { mockWebAPI } from '../test-utils/mock-web-api.ts'
import type { Channel, AgentWorkspace, MAProPermissionMode } from '@ma-proma/shared'

mock.module('../api/web-api.ts', () => ({
  webAPI: mockWebAPI,
}))

afterAll(() => {
  mock.restore()
})

const testChannel: Channel = {
  id: 'ch-1',
  name: 'OpenAI 渠道',
  provider: 'openai',
  baseUrl: 'https://api.openai.com',
  apiKey: '',
  enabled: true,
  models: [
    { id: 'gpt-4', name: 'GPT-4', enabled: true },
    { id: 'gpt-3.5', name: 'GPT-3.5', enabled: false },
    { id: 'o1', name: 'o1', enabled: true },
  ],
  createdAt: 0,
  updatedAt: 0,
}

const testWorkspace: AgentWorkspace = {
  id: 'ws-1',
  name: '默认工作区',
  slug: 'default',
  createdAt: 0,
  updatedAt: 0,
}

function renderWithStore(
  ui: React.ReactElement,
  {
    settings = {},
    channels = [testChannel],
    workspaces = [testWorkspace],
  }: {
    settings?: Record<string, unknown>
    channels?: Channel[]
    workspaces?: AgentWorkspace[]
  } = {},
) {
  const store = createStore()
  store.set(settingsAtom, {
    themeMode: 'dark',
    themeStyle: 'default',
    onboardingCompleted: false,
    environmentCheckSkipped: false,
    notificationsEnabled: true,
    notificationSoundEnabled: true,
    archiveAfterDays: 0,
    sendWithCmdEnter: false,
    defaultAgentChannelId: undefined,
    defaultAgentModelId: undefined,
    defaultAgentWorkspaceId: undefined,
    defaultAgentPermissionMode: 'bypassPermissions',
    ...settings,
  })
  store.set(channelsAtom, channels)
  store.set(agentWorkspacesAtom, workspaces)
  return {
    store,
    ...render(<JotaiProvider store={store}>{ui}</JotaiProvider>),
  }
}

describe('SettingsPage', () => {
  beforeEach(() => {
    mockWebAPI.getUserProfile = mock(async () => ({ userName: '用户', avatar: '🧑‍💻' }))
    mockWebAPI.listChannels = mock(async () => [testChannel])
    mockWebAPI.listAgentWorkspaces = mock(async () => [testWorkspace])
    mockWebAPI.updateSettings = mock(async (updates) => ({ themeMode: 'dark', ...updates }))
  })

  afterEach(() => {
    cleanup()
  })

  it('Given 进入设置页 when 渲染 then 显示 Agent 默认设置面板与四个选择器', async () => {
    const { findByTestId, getByText } = renderWithStore(<SettingsPage />)

    const section = await findByTestId('agent-settings-section')
    expect(section).toBeTruthy()
    expect(getByText('默认渠道', { selector: 'label' })).toBeTruthy()
    expect(getByText('默认模型', { selector: 'label' })).toBeTruthy()
    expect(getByText('默认工作区', { selector: 'label' })).toBeTruthy()
    expect(getByText('默认权限模式', { selector: 'label' })).toBeTruthy()
  })

  it('Given 选择默认渠道 when 切换渠道 then 清空模型并保存渠道与模型', async () => {
    const { findByTestId } = renderWithStore(<SettingsPage />)

    const section = await findByTestId('agent-settings-section')
    const channelSelect = section.querySelector('select') as HTMLSelectElement

    await act(async () => {
      fireEvent.change(channelSelect, { target: { value: 'ch-1' } })
    })

    await waitFor(() =>
      expect(mockWebAPI.updateSettings).toHaveBeenCalledWith({
        defaultAgentChannelId: 'ch-1',
        defaultAgentModelId: undefined,
      }),
    )
  })

  it('Given 已选默认渠道 when 选择模型 then 保存模型 ID', async () => {
    const { findByTestId } = renderWithStore(<SettingsPage />, {
      settings: { defaultAgentChannelId: 'ch-1' },
    })

    const section = await findByTestId('agent-settings-section')
    const modelSelect = section.querySelectorAll('select')[1] as HTMLSelectElement

    await act(async () => {
      fireEvent.change(modelSelect, { target: { value: 'o1' } })
    })

    await waitFor(() =>
      expect(mockWebAPI.updateSettings).toHaveBeenCalledWith({
        defaultAgentModelId: 'o1',
      }),
    )
  })

  it('Given 可选工作区 when 选择默认工作区 then 保存工作区 ID', async () => {
    const { findByTestId } = renderWithStore(<SettingsPage />)

    const section = await findByTestId('agent-settings-section')
    const workspaceSelect = section.querySelectorAll('select')[2] as HTMLSelectElement

    await act(async () => {
      fireEvent.change(workspaceSelect, { target: { value: 'ws-1' } })
    })

    await waitFor(() =>
      expect(mockWebAPI.updateSettings).toHaveBeenCalledWith({
        defaultAgentWorkspaceId: 'ws-1',
      }),
    )
  })

  it('Given 可选权限模式 when 点击 plan 模式 then 保存权限模式', async () => {
    const { getByText } = renderWithStore(<SettingsPage />)

    const planButton = getByText('计划模式')
    await act(async () => {
      fireEvent.click(planButton)
    })

    await waitFor(() =>
      expect(mockWebAPI.updateSettings).toHaveBeenCalledWith({
        defaultAgentPermissionMode: 'plan',
      }),
    )
  })
})
