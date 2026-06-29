import "../../../src/test-setup.ts"

/**
 * AskUserBanner 单元测试
 *
 * BDD 行为驱动，验证用户追问横幅的核心交互：
 * 1. 关闭 Banner 应调用 respondAgentAskUser(sessionId, requestId, {})
 * 2. 多问题提交必须每个问题都有答案（every 校验）
 * 3. 提交时按 question 文本聚合答案
 */

import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, afterAll, mock } from 'bun:test'
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { Provider as JotaiProvider, createStore } from 'jotai'
import { AskUserBanner } from './AskUserBanner.tsx'
import { agentAskUserRequestsAtom } from '../../store/agent-atoms.ts'
import { mockWebAPI } from '../../test-utils/mock-web-api.ts'
import type { AskUserRequest, AskUserQuestion } from '@ma-proma/shared'

mock.module('../../api/web-api.ts', () => ({
  webAPI: mockWebAPI,
}))

afterAll(() => {
  mock.restore()
})

function renderWithStore(
  ui: React.ReactElement,
  { initialRequests = new Map<string, AskUserRequest[]>() }: { initialRequests?: Map<string, AskUserRequest[]> } = {},
) {
  const store = createStore()
  store.set(agentAskUserRequestsAtom, initialRequests)
  return {
    store,
    ...render(<JotaiProvider store={store}>{ui}</JotaiProvider>),
  }
}

describe('AskUserBanner', () => {
  const sessionId = 'session-001'

  beforeEach(() => {
    mockWebAPI.respondAgentAskUser = mock(() => {})
  })

  afterEach(() => {
    cleanup()
  })

  function buildRequest(questions: AskUserQuestion[]): AskUserRequest {
    return {
      requestId: 'req-001',
      sessionId,
      questions,
      toolInput: { questions },
    }
  }

  describe('关闭追问 Banner', () => {
    it('Given 有待处理追问 when 点击关闭按钮 then 发送空 answers 并清理队列', async () => {
      const questions: AskUserQuestion[] = [
        {
          question: '你喜欢什么颜色？',
          header: '颜色',
          options: [{ label: '红色' }, { label: '蓝色' }],
          multiSelect: false,
        },
      ]
      const request = buildRequest(questions)
      const initialRequests = new Map([[sessionId, [request]]])

      const { store, getByTitle } = renderWithStore(<AskUserBanner sessionId={sessionId} />, { initialRequests })

      const closeButton = getByTitle('关闭')
      fireEvent.click(closeButton)

      await waitFor(() => {
        expect(mockWebAPI.respondAgentAskUser).toHaveBeenCalledWith(sessionId, request.requestId, {})
      })
      expect(store.get(agentAskUserRequestsAtom).has(sessionId)).toBe(false)
    })
  })

  describe('连接断开错误展示', () => {
    it('Given respondAgentAskUser 抛错 when 点击关闭 then 显示错误信息', async () => {
      mockWebAPI.respondAgentAskUser = mock(() => {
        throw new Error('Agent 连接已断开')
      })

      const questions: AskUserQuestion[] = [
        { question: '问题', options: [{ label: 'A' }], multiSelect: false },
      ]
      const request = buildRequest(questions)
      const initialRequests = new Map([[sessionId, [request]]])

      const { getByTitle, getByText } = renderWithStore(<AskUserBanner sessionId={sessionId} />, { initialRequests })

      const closeButton = getByTitle('关闭')
      fireEvent.click(closeButton)

      await waitFor(() => {
        expect(getByText('Agent 连接已断开')).toBeTruthy()
      })
    })
  })

  describe('多问题 every 校验', () => {
    it('Given 两个问题且只答了第一个 when 提交按钮 then 禁用且不会发送响应', async () => {
      const questions: AskUserQuestion[] = [
        { question: '问题1', options: [{ label: 'A1' }], multiSelect: false },
        { question: '问题2', options: [{ label: 'B1' }], multiSelect: false },
      ]
      const request = buildRequest(questions)
      const initialRequests = new Map([[sessionId, [request]]])

      const { getByText } = renderWithStore(<AskUserBanner sessionId={sessionId} />, { initialRequests })

      // 默认第一个选项被选中；切换到第二个问题并选择"其他"但不输入文本
      const tab2 = getByText(/问题 2/)
      fireEvent.click(tab2)
      fireEvent.click(getByText('其他...'))

      const submitButton = getByText('确认') as HTMLButtonElement
      expect(submitButton.disabled).toBe(true)

      fireEvent.click(submitButton)
      expect(mockWebAPI.respondAgentAskUser).not.toHaveBeenCalled()
    })

    it('Given 两个问题都回答 when 提交 then 发送完整答案', async () => {
      const questions: AskUserQuestion[] = [
        { question: '问题1', options: [{ label: 'A1' }, { label: 'A2' }], multiSelect: false },
        { question: '问题2', options: [{ label: 'B1' }, { label: 'B2' }], multiSelect: false },
      ]
      const request = buildRequest(questions)
      const initialRequests = new Map([[sessionId, [request]]])

      const { getByText } = renderWithStore(<AskUserBanner sessionId={sessionId} />, { initialRequests })

      // 第一个问题默认选中 A1，选择 A2
      fireEvent.click(getByText('A2'))

      // 切换到第二个问题并选择 B2
      fireEvent.click(getByText(/问题 2/))
      fireEvent.click(getByText('B2'))

      const submitButton = getByText('确认') as HTMLButtonElement
      expect(submitButton.disabled).toBe(false)

      fireEvent.click(submitButton)

      await waitFor(() => {
        expect(mockWebAPI.respondAgentAskUser).toHaveBeenCalledWith(sessionId, request.requestId, {
          问题1: 'A2',
          问题2: 'B2',
        })
      })
    })
  })
})
