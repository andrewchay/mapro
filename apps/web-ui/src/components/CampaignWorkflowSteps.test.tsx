import '../../src/test-setup.ts'

/**
 * CampaignWorkflowSteps 单元测试
 *
 * BDD 行为驱动，验证工作流步骤执行：
 * 1. 渲染步骤列表与执行按钮
 * 2. 点击执行后调用 completeCampaignStep 并刷新状态
 * 3. 执行失败时展示错误信息
 */

import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, afterAll, mock } from 'bun:test'
import { render, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { CampaignWorkflowSteps } from './CampaignWorkflowSteps.tsx'
import { mockWebAPI } from '../test-utils/mock-web-api.ts'
import type { CampaignWorkflow } from '@ma-proma/shared'

mock.module('../api/web-api.ts', () => ({
  webAPI: mockWebAPI,
}))

afterAll(() => {
  mock.restore()
})

function createWorkflow(overrides: Partial<CampaignWorkflow> = {}): CampaignWorkflow {
  return {
    campaignId: 'camp-1',
    currentStepIndex: 0,
    createdAt: 0,
    updatedAt: 0,
    steps: [
      {
        id: 'market_analysis',
        title: '市场分析',
        description: '分析市场趋势与机会',
        status: 'in_progress',
        agentPrompt: '',
        toolName: '',
      },
      {
        id: 'competitor_analysis',
        title: '竞品分析',
        description: '分析竞争对手',
        status: 'pending',
        agentPrompt: '',
        toolName: '',
      },
    ],
    ...overrides,
  }
}

describe('CampaignWorkflowSteps', () => {
  beforeEach(() => {
    mockWebAPI.getCampaignWorkflow = mock(async () => createWorkflow())
    mockWebAPI.listCampaignArtifacts = mock(async () => [])
    mockWebAPI.completeCampaignStep = mock(async () => ({
      success: true,
      workflow: createWorkflow({
        steps: [
          { id: 'market_analysis', title: '市场分析', description: '', status: 'completed', agentPrompt: '', toolName: '' },
          { id: 'competitor_analysis', title: '竞品分析', description: '', status: 'in_progress', agentPrompt: '', toolName: '' },
        ],
        currentStepIndex: 1,
      }),
    }))
  })

  afterEach(() => {
    cleanup()
  })

  it('Given 工作流有步骤 when 渲染 then 显示步骤标题与执行按钮', async () => {
    const { getByText } = render(<CampaignWorkflowSteps campaignId="camp-1" />)

    await waitFor(() => expect(mockWebAPI.getCampaignWorkflow).toHaveBeenCalledWith('camp-1'))
    expect(getByText('市场分析')).toBeTruthy()

    const stepHeader = getByText('市场分析')
    await act(async () => {
      fireEvent.click(stepHeader)
    })

    await waitFor(() => expect(getByText('执行')).toBeTruthy())
  })

  it('Given 点击执行按钮 when 完成成功 then 调用 completeCampaignStep 并更新步骤状态', async () => {
    const { getByText, queryAllByText } = render(<CampaignWorkflowSteps campaignId="camp-1" />)

    await waitFor(() => expect(getByText('市场分析')).toBeTruthy())
    const stepHeader = getByText('市场分析')
    await act(async () => {
      fireEvent.click(stepHeader)
    })

    const executeButton = await waitFor(() => getByText('执行'))
    await act(async () => {
      fireEvent.click(executeButton)
    })

    await waitFor(() => expect(mockWebAPI.completeCampaignStep).toHaveBeenCalledWith('camp-1', 'market_analysis'))
    await waitFor(() => expect(queryAllByText('已完成').length).toBeGreaterThan(0))
  })

  it('Given 执行失败 when 完成返回 success=false then 显示错误信息', async () => {
    mockWebAPI.completeCampaignStep = mock(async () => ({
      success: false,
      workflow: createWorkflow(),
      reason: '产物校验未通过',
    }))

    const { getByText } = render(<CampaignWorkflowSteps campaignId="camp-1" />)

    await waitFor(() => expect(getByText('市场分析')).toBeTruthy())
    const stepHeader = getByText('市场分析')
    await act(async () => {
      fireEvent.click(stepHeader)
    })

    const executeButton = await waitFor(() => getByText('执行'))
    await act(async () => {
      fireEvent.click(executeButton)
    })

    await waitFor(() => expect(getByText(/产物校验未通过/)).toBeTruthy())
  })
})
