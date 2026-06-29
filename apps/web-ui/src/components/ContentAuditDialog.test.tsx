import '../../src/test-setup.ts'

import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, afterAll, mock } from 'bun:test'
import { render, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { ContentAuditDialog } from './ContentAuditDialog.tsx'
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
  name: '测试 Campaign',
  brand: '品牌A',
  platform: 'xiaohongshu',
  budget: 100000,
  durationMonths: 3,
  targetCity: ['上海'],
  targetAudience: '25-35 岁女性',
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

const kol: CampaignKOLPoolItem = {
  campaignId: 'c1',
  kolId: 'k1',
  name: '达人小A',
  platform: 'xiaohongshu',
  followers: '10万',
  engagement: '5%',
  category: '美妆',
  price: '5000',
  city: '上海',
  status: 'candidate',
  notes: '',
  addedAt: 0,
}

describe('ContentAuditDialog', () => {
  beforeEach(() => {
    mockWebAPI.createContentAudit = mock(async () => ({
      auditId: 'a1',
      campaignId: 'c1',
      kolId: 'k1',
      kolName: '达人小A',
      contentUrl: '',
      platform: 'xiaohongshu',
      auditStatus: 'passed',
      complianceScore: 85,
      brandAlignmentScore: 80,
      qualityScore: 82,
      overallScore: 82,
      auditReport: '审核通过',
      auditor: 'ai',
      createdAt: 0,
      updatedAt: 0,
    } as ContentAudit))
  })

  afterEach(() => {
    cleanup()
  })

  it('Given 打开审核弹窗 when 输入内容并提交 then 调用 createContentAudit 并显示结果', async () => {
    const onClose = mock(() => {})
    const onAudited = mock(() => {})
    const { getByText, getByPlaceholderText } = render(
      <ContentAuditDialog campaign={campaign} kol={kol} open={true} onClose={onClose} onAudited={onAudited} />,
    )

    const textarea = getByPlaceholderText('粘贴 KOL 提交的内容文案或脚本...')
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '这是一条测试内容' } })
    })

    const submitButton = getByText('提交审核')
    await act(async () => {
      fireEvent.click(submitButton)
    })

    await waitFor(() => expect(mockWebAPI.createContentAudit).toHaveBeenCalled())
    expect(onAudited).toHaveBeenCalled()
    expect(getByText('审核通过')).toBeTruthy()
  })
})
