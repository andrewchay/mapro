/**
 * 批量内容审核弹窗测试
 *
 * 验证批量为多个 KOL 创建审核、进度展示、错误处理。
 */

import '../../src/test-setup.ts'

import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, afterAll, mock } from 'bun:test'
import { render, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { BatchContentAuditDialog } from './BatchContentAuditDialog.tsx'
import { mockWebAPI } from '../test-utils/mock-web-api.ts'
import type { Campaign, CampaignKOLPoolItem, ContentAudit } from '@ma-proma/shared'

mock.module('../api/web-api.ts', () => ({
  webAPI: mockWebAPI,
}))

afterAll(() => {
  mock.restore()
})

const campaign: Campaign = {
  id: 'c1',
  name: 'Test Campaign',
  brand: 'Test Brand',
  platform: 'xiaohongshu',
  budget: 100000,
  durationMonths: 12,
  targetCity: ['上海'],
  targetAudience: '年轻女性',
  currentPhase: 1,
  phasePlans: [],
  creativePlan: {
    bigIdea: '',
    coreMessage: '',
    contentPillars: [],
    tone: '',
    mandatoryElements: [],
    forbiddenElements: [],
  },
  status: 'draft',
  createdAt: 0,
  updatedAt: 0,
}

const kols: CampaignKOLPoolItem[] = [
  { campaignId: 'c1', kolId: 'k1', name: '达人 A', platform: 'xhs', followers: '10k', engagement: '5%', category: 'beauty', price: '1000', city: '上海', status: 'candidate', notes: '', addedAt: 0 },
  { campaignId: 'c1', kolId: 'k2', name: '达人 B', platform: 'douyin', followers: '50k', engagement: '8%', category: 'food', price: '3000', city: '北京', status: 'candidate', notes: '', addedAt: 0 },
]

const baseAudit: ContentAudit = {
  auditId: 'a1',
  campaignId: 'c1',
  kolId: 'k1',
  kolName: '达人 A',
  contentUrl: '',
  platform: 'xhs',
  auditStatus: 'passed',
  complianceScore: 90,
  brandAlignmentScore: 85,
  qualityScore: 88,
  overallScore: 87,
  auditReport: '符合要求',
  auditor: 'system',
  createdAt: 0,
  updatedAt: 0,
}

describe('BatchContentAuditDialog', () => {
  beforeEach(() => {
    mockWebAPI.createContentAudit = mock(async () => ({ ...baseAudit }))
  })

  afterEach(() => {
    cleanup()
  })

  it('Given 打开批量审核 when 未输入内容描述 then 提交按钮禁用', () => {
    const { getByText } = render(
      <BatchContentAuditDialog campaign={campaign} kols={kols} open={true} onClose={mock(() => {})} />,
    )

    const submitButton = getByText('提交批量审核') as HTMLButtonElement
    expect(submitButton.disabled).toBe(true)
  })

  it('Given 输入内容描述并提交 when 成功 then 依次为每个 KOL 调用 createContentAudit', async () => {
    const onClose = mock(() => {})
    const onAudited = mock(() => {})
    const { getByText, getByPlaceholderText } = render(
      <BatchContentAuditDialog campaign={campaign} kols={kols} open={true} onClose={onClose} onAudited={onAudited} />,
    )

    fireEvent.change(getByPlaceholderText(/批量审核的内容文案/), { target: { value: '测试内容' } })

    const submitButton = getByText('提交批量审核')
    await act(async () => {
      fireEvent.click(submitButton)
    })

    await waitFor(() => expect(mockWebAPI.createContentAudit).toHaveBeenCalledTimes(2))
    expect(onAudited).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('Given 提交批量审核 when 中间失败 then 显示错误信息', async () => {
    mockWebAPI.createContentAudit = mock(async () => {
      throw new Error('审核服务异常')
    })

    const onAudited = mock(() => {})
    const { getByText, getByPlaceholderText } = render(
      <BatchContentAuditDialog campaign={campaign} kols={kols} open={true} onClose={mock(() => {})} onAudited={onAudited} />,
    )

    fireEvent.change(getByPlaceholderText(/批量审核的内容文案/), { target: { value: '测试内容' } })

    const submitButton = getByText('提交批量审核')
    await act(async () => {
      fireEvent.click(submitButton)
    })

    await waitFor(() => expect(getByText('审核服务异常')).toBeTruthy())
    expect(onAudited).not.toHaveBeenCalled()
  })
})
