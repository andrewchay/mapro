import "../../src/test-setup.ts"

/**
 * AgentPage 单元测试
 *
 * BDD 行为驱动，验证渲染层关键行为：
 * 1. 流式输出时同一条 assistant 消息重复推送不会累加文本
 * 2. 切换会话时停止上一个会话的流，防止旧流写入当前会话视图
 */

import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, afterAll, mock } from 'bun:test'
import { render, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { Provider as JotaiProvider, createStore } from 'jotai'
import { AgentPage, extractTextFromPayload } from './AgentPage.tsx'
import {
  agentSessionsAtom,
  agentWorkspacesAtom,
  agentLoadingAtom,
  agentErrorAtom,
} from '../store/agent-atoms.ts'
import { mockWebAPI } from '../test-utils/mock-web-api.ts'
import type { AgentSessionMeta, AgentWorkspace } from '@ma-proma/shared'
import type { AgentStreamEvent } from '../api/platform-api.ts'

mock.module('../api/web-api.ts', () => ({
  webAPI: mockWebAPI,
}))

function renderWithStore(
  ui: React.ReactElement,
  {
    sessions = [] as AgentSessionMeta[],
    workspaces = [] as AgentWorkspace[],
  }: { sessions?: AgentSessionMeta[]; workspaces?: AgentWorkspace[] } = {},
) {
  const store = createStore()
  store.set(agentSessionsAtom, sessions)
  store.set(agentWorkspacesAtom, workspaces)
  store.set(agentLoadingAtom, false)
  store.set(agentErrorAtom, null)
  return {
    store,
    ...render(<JotaiProvider store={store}>{ui}</JotaiProvider>),
  }
}

describe('AgentPage', () => {
  const sessionA: AgentSessionMeta = {
    id: 'session-a',
    title: '会话 A',
    updatedAt: Date.now(),
    createdAt: Date.now(),
  }
  const sessionB: AgentSessionMeta = {
    id: 'session-b',
    title: '会话 B',
    updatedAt: Date.now(),
    createdAt: Date.now(),
  }

  beforeEach(() => {
    mockWebAPI.sendAgentMessage = mock((_sessionId: string, _userMessage: string, _onEvent: (event: AgentStreamEvent) => void) => () => {})
    mockWebAPI.listAgentSessions = mock(async () => [])
    mockWebAPI.listAgentWorkspaces = mock(async () => [])
    mockWebAPI.getAgentSession = mock(async (_sessionId: string) => ({ session: null as unknown as AgentSessionMeta, messages: [] }))
  })

  afterEach(() => {
    cleanup()
  })

  describe('extractTextFromPayload', () => {
    it('Given assistant 消息 payload when 提取文本 then 返回完整内容', () => {
      const payload = {
        kind: 'sdk_message' as const,
        message: {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: '你好' }],
          },
        },
      }
      expect(extractTextFromPayload(payload)).toBe('你好')
    })
  })

  describe('流式输出不重复累加', () => {
    it('Given SDK 多次推送同一条完整 assistant 消息 when 渲染 then 最终文本只出现一次', async () => {
      mockWebAPI.listAgentSessions = mock(async () => [sessionA])
      let onEventRef: ((event: AgentStreamEvent) => void) | null = null

      mockWebAPI.sendAgentMessage = mock((_sessionId, _userMessage, onEvent) => {
        onEventRef = onEvent
        return () => {}
      })

      const { getByText, getByPlaceholderText, findByText } = renderWithStore(<AgentPage />)

      // 等待加载后点击会话
      const sessionAButton = await findByText('会话 A')
      await act(async () => {
        fireEvent.click(sessionAButton)
      })

      // 输入并发送
      const textarea = getByPlaceholderText('输入消息...')
      await act(async () => {
        fireEvent.change(textarea, { target: { value: 'hello' } })
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })
      })

      await waitFor(() => expect(mockWebAPI.sendAgentMessage).toHaveBeenCalled())
      expect(onEventRef).not.toBeNull()

      // 模拟 SDK 对同一条 assistant 消息推送三次（每次都是完整文本）
      const assistantPayload = {
        kind: 'sdk_message' as const,
        message: {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: '完整回复' }],
          },
        },
      }
      await act(async () => {
        onEventRef!({ type: 'payload', payload: assistantPayload })
        onEventRef!({ type: 'payload', payload: assistantPayload })
        onEventRef!({ type: 'payload', payload: assistantPayload })
      })

      await waitFor(() => {
        const messages = getByText('完整回复')
        expect(messages).toBeTruthy()
      })
    })
  })

  describe('切换会话停止旧流', () => {
    it('Given 当前会话正在流式输出 when 切换到另一个会话 then 停止旧会话的流', async () => {
      mockWebAPI.listAgentSessions = mock(async () => [sessionA, sessionB])
      const stopA = mock(() => {})
      const stopB = mock(() => {})

      mockWebAPI.sendAgentMessage = mock((sessionId) => {
        return sessionId === sessionA.id ? stopA : stopB
      })

      const { findByText, getByPlaceholderText } = renderWithStore(<AgentPage />)

      const sessionAButton = await findByText('会话 A')
      await act(async () => {
        fireEvent.click(sessionAButton)
      })

      const textarea = getByPlaceholderText('输入消息...')
      await act(async () => {
        fireEvent.change(textarea, { target: { value: 'msg to A' } })
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })
      })

      await waitFor(() => expect(mockWebAPI.sendAgentMessage).toHaveBeenCalledWith(sessionA.id, 'msg to A', expect.any(Function)))

      // 切换到会话 B
      const sessionBButton = await findByText('会话 B')
      await act(async () => {
        fireEvent.click(sessionBButton)
      })

      await waitFor(() => expect(stopA).toHaveBeenCalled())
    })
  })
})
