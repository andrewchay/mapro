import "../../../src/test-setup.ts"

/**
 * PermissionBanner 单元测试
 *
 * BDD 行为驱动，验证权限请求横幅的核心交互：
 * 1. 关闭 Banner 应调用 respondAgentPermission('deny') 并清理请求队列
 * 2. 关闭 Banner 不应清除 planModeSessions（普通权限请求与计划模式无关）
 * 3. 允许/拒绝/总是允许按钮调用对应响应
 */

import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, afterAll, mock } from 'bun:test'
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { Provider as JotaiProvider, createStore } from 'jotai'
import { PermissionBanner } from './PermissionBanner.tsx'
import { agentPermissionRequestsAtom, agentPlanModeSessionsAtom } from '../../store/agent-atoms.ts'
import { mockWebAPI } from '../../test-utils/mock-web-api.ts'
import type { PermissionRequest } from '@ma-proma/shared'

mock.module('../../api/web-api.ts', () => ({
  webAPI: mockWebAPI,
}))

afterAll(() => {
  mock.restore()
})

function renderWithStore(
  ui: React.ReactElement,
  {
    initialRequests = new Map<string, PermissionRequest[]>(),
    initialPlanSessions = new Set<string>(),
  }: {
    initialRequests?: Map<string, PermissionRequest[]>
    initialPlanSessions?: Set<string>
  } = {},
) {
  const store = createStore()
  store.set(agentPermissionRequestsAtom, initialRequests)
  store.set(agentPlanModeSessionsAtom, initialPlanSessions)
  return {
    store,
    ...render(<JotaiProvider store={store}>{ui}</JotaiProvider>),
  }
}

describe('PermissionBanner', () => {
  const sessionId = 'session-001'
  const request: PermissionRequest = {
    requestId: 'req-001',
    sessionId,
    toolName: 'Bash',
    description: '执行 ls 命令',
    command: 'ls -la',
    dangerLevel: 'normal',
    toolInput: { command: 'ls -la' },
  }

  beforeEach(() => {
    mockWebAPI.respondAgentPermission = mock(() => {})
  })

  afterEach(() => {
    cleanup()
  })

  describe('关闭权限请求 Banner', () => {
    it('Given 有待处理权限请求 when 点击关闭按钮 then 发送 deny 并清理请求队列', async () => {
      const initialRequests = new Map([[sessionId, [request]]])
      const { store, getByTitle } = renderWithStore(<PermissionBanner sessionId={sessionId} />, { initialRequests })

      const closeButton = getByTitle('关闭')
      fireEvent.click(closeButton)

      await waitFor(() => {
        expect(mockWebAPI.respondAgentPermission).toHaveBeenCalledWith(sessionId, request.requestId, 'deny', false)
      })
      expect(store.get(agentPermissionRequestsAtom).has(sessionId)).toBe(false)
    })

    it('Given 会话处于计划模式 when 点击关闭普通权限 Banner then 不清理 planModeSessions', async () => {
      const initialRequests = new Map([[sessionId, [request]]])
      const initialPlanSessions = new Set([sessionId])

      const { store, getByTitle } = renderWithStore(<PermissionBanner sessionId={sessionId} />, {
        initialRequests,
        initialPlanSessions,
      })

      const closeButton = getByTitle('关闭')
      fireEvent.click(closeButton)

      await waitFor(() => {
        expect(mockWebAPI.respondAgentPermission).toHaveBeenCalled()
      })
      expect(store.get(agentPlanModeSessionsAtom).has(sessionId)).toBe(true)
    })
  })

  describe('连接断开错误展示', () => {
    it('Given respondAgentPermission 抛错 when 点击关闭 then 显示错误信息', async () => {
      mockWebAPI.respondAgentPermission = mock(() => {
        throw new Error('Agent 连接已断开')
      })

      const initialRequests = new Map([[sessionId, [request]]])
      const { getByTitle, getByText } = renderWithStore(<PermissionBanner sessionId={sessionId} />, { initialRequests })

      const closeButton = getByTitle('关闭')
      fireEvent.click(closeButton)

      await waitFor(() => {
        expect(getByText('Agent 连接已断开')).toBeTruthy()
      })
    })
  })

  describe('响应权限请求', () => {
    it('Given 允许按钮 when 点击 then 发送 allow', async () => {
      const initialRequests = new Map([[sessionId, [request]]])
      const { getByText } = renderWithStore(<PermissionBanner sessionId={sessionId} />, { initialRequests })

      const allowButton = getByText('允许')
      fireEvent.click(allowButton)

      await waitFor(() => {
        expect(mockWebAPI.respondAgentPermission).toHaveBeenCalledWith(sessionId, request.requestId, 'allow', false)
      })
    })

    it('Given 总是允许按钮 when 点击 then 发送 allow 且 alwaysAllow=true', async () => {
      const initialRequests = new Map([[sessionId, [request]]])
      const { getByText } = renderWithStore(<PermissionBanner sessionId={sessionId} />, { initialRequests })

      const alwaysAllowButton = getByText('本次会话总是允许')
      fireEvent.click(alwaysAllowButton)

      await waitFor(() => {
        expect(mockWebAPI.respondAgentPermission).toHaveBeenCalledWith(sessionId, request.requestId, 'allow', true)
      })
    })

    it('Given 拒绝按钮 when 点击 then 发送 deny', async () => {
      const initialRequests = new Map([[sessionId, [request]]])
      const { getByText } = renderWithStore(<PermissionBanner sessionId={sessionId} />, { initialRequests })

      const denyButton = getByText('拒绝')
      fireEvent.click(denyButton)

      await waitFor(() => {
        expect(mockWebAPI.respondAgentPermission).toHaveBeenCalledWith(sessionId, request.requestId, 'deny', false)
      })
    })
  })
})
