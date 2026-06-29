import "../../../src/test-setup.ts"

/**
 * ExitPlanModeBanner 单元测试
 *
 * BDD 行为驱动，验证计划审批横幅的核心交互：
 * 1. 关闭 Banner 应调用 respondAgentExitPlanMode('deny') 并清理计划模式会话
 * 2. approve_auto / approve_edit / deny / feedback 四个 action 均正确发送
 * 3. feedback 携带用户输入文本
 */

import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, afterAll, mock } from 'bun:test'
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { Provider as JotaiProvider, createStore } from 'jotai'
import { ExitPlanModeBanner } from './ExitPlanModeBanner.tsx'
import { agentExitPlanRequestsAtom, agentPlanModeSessionsAtom } from '../../store/agent-atoms.ts'
import { mockWebAPI } from '../../test-utils/mock-web-api.ts'
import type { ExitPlanModeRequest } from '@ma-proma/shared'

mock.module('../../api/web-api.ts', () => ({
  webAPI: mockWebAPI,
}))

afterAll(() => {
  mock.restore()
})

function renderWithStore(
  ui: React.ReactElement,
  {
    initialRequests = new Map<string, ExitPlanModeRequest[]>(),
    initialPlanSessions = new Set<string>(),
  }: {
    initialRequests?: Map<string, ExitPlanModeRequest[]>
    initialPlanSessions?: Set<string>
  } = {},
) {
  const store = createStore()
  store.set(agentExitPlanRequestsAtom, initialRequests)
  store.set(agentPlanModeSessionsAtom, initialPlanSessions)
  return {
    store,
    ...render(<JotaiProvider store={store}>{ui}</JotaiProvider>),
  }
}

describe('ExitPlanModeBanner', () => {
  const sessionId = 'session-001'
  const request: ExitPlanModeRequest = {
    requestId: 'req-001',
    sessionId,
    allowedPrompts: [{ tool: 'Bash', prompt: '执行构建脚本' }],
    toolInput: { allowedPrompts: [{ tool: 'Bash', prompt: '执行构建脚本' }] },
  }

  beforeEach(() => {
    mockWebAPI.respondAgentExitPlanMode = mock(() => {})
  })

  afterEach(() => {
    cleanup()
  })

  describe('关闭计划审批 Banner', () => {
    it('Given 有待处理计划审批 when 点击关闭按钮 then 发送 deny 并清理 planModeSessions', async () => {
      const initialRequests = new Map([[sessionId, [request]]])
      const initialPlanSessions = new Set([sessionId])

      const { store, getByTitle } = renderWithStore(<ExitPlanModeBanner sessionId={sessionId} />, {
        initialRequests,
        initialPlanSessions,
      })

      const closeButton = getByTitle('关闭')
      fireEvent.click(closeButton)

      await waitFor(() => {
        expect(mockWebAPI.respondAgentExitPlanMode).toHaveBeenCalledWith(sessionId, request.requestId, 'deny')
      })
      expect(store.get(agentExitPlanRequestsAtom).has(sessionId)).toBe(false)
      expect(store.get(agentPlanModeSessionsAtom).has(sessionId)).toBe(false)
    })
  })

  describe('连接断开错误展示', () => {
    it('Given respondAgentExitPlanMode 抛错 when 点击关闭 then 显示错误信息', async () => {
      mockWebAPI.respondAgentExitPlanMode = mock(() => {
        throw new Error('Agent 连接已断开')
      })

      const initialRequests = new Map([[sessionId, [request]]])
      const { getByTitle, getByText } = renderWithStore(<ExitPlanModeBanner sessionId={sessionId} />, { initialRequests })

      const closeButton = getByTitle('关闭')
      fireEvent.click(closeButton)

      await waitFor(() => {
        expect(getByText('Agent 连接已断开')).toBeTruthy()
      })
    })
  })

  describe('选择审批动作', () => {
    it('Given 批准并完全自动执行 when 点击 then 发送 approve_auto 并退出计划模式', async () => {
      const initialRequests = new Map([[sessionId, [request]]])
      const { getByText } = renderWithStore(<ExitPlanModeBanner sessionId={sessionId} />, { initialRequests })

      fireEvent.click(getByText('批准并完全自动执行'))

      await waitFor(() => {
        expect(mockWebAPI.respondAgentExitPlanMode).toHaveBeenCalledWith(sessionId, request.requestId, 'approve_auto', undefined)
      })
    })

    it('Given 批准并自动审批 when 点击 then 发送 approve_edit', async () => {
      const initialRequests = new Map([[sessionId, [request]]])
      const { getByText } = renderWithStore(<ExitPlanModeBanner sessionId={sessionId} />, { initialRequests })

      fireEvent.click(getByText('批准并自动审批'))

      await waitFor(() => {
        expect(mockWebAPI.respondAgentExitPlanMode).toHaveBeenCalledWith(sessionId, request.requestId, 'approve_edit', undefined)
      })
    })

    it('Given 拒绝计划 when 点击 then 发送 deny', async () => {
      const initialRequests = new Map([[sessionId, [request]]])
      const { getByText } = renderWithStore(<ExitPlanModeBanner sessionId={sessionId} />, { initialRequests })

      fireEvent.click(getByText('拒绝计划'))

      await waitFor(() => {
        expect(mockWebAPI.respondAgentExitPlanMode).toHaveBeenCalledWith(sessionId, request.requestId, 'deny', undefined)
      })
    })

    it('Given 提供修改意见 when 输入反馈并发送 then 发送 feedback 与文本', async () => {
      const initialRequests = new Map([[sessionId, [request]]])
      const { getByText, getByPlaceholderText } = renderWithStore(<ExitPlanModeBanner sessionId={sessionId} />, { initialRequests })

      fireEvent.click(getByText('提供修改意见'))

      const input = getByPlaceholderText('输入修改意见...')
      fireEvent.change(input, { target: { value: '请补充预算明细' } })

      fireEvent.click(getByText('发送'))

      await waitFor(() => {
        expect(mockWebAPI.respondAgentExitPlanMode).toHaveBeenCalledWith(
          sessionId,
          request.requestId,
          'feedback',
          '请补充预算明细',
        )
      })
    })
  })
})
