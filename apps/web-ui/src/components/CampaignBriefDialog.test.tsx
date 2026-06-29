import '../../src/test-setup.ts'

import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, afterAll, mock } from 'bun:test'
import { render, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { CampaignBriefDialog } from './CampaignBriefDialog.tsx'
import { mockWebAPI } from '../test-utils/mock-web-api.ts'
import type { Campaign, CampaignKOLPoolItem, CampaignBrief } from '@ma-proma/shared'

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

describe('CampaignBriefDialog', () => {
  beforeEach(() => {
    mockWebAPI.getCampaignBrief = mock(async () => null)
    mockWebAPI.saveCampaignBrief = mock(async () => ({
      id: 'b1',
      campaignId: 'c1',
      kolId: 'k1',
      kolName: '达人小A',
      content: 'generated brief',
      aiGenerated: false,
      status: 'draft',
      createdAt: 0,
      updatedAt: Date.now(),
    } as CampaignBrief))
  })

  afterEach(() => {
    cleanup()
  })

  it('Given 打开 Brief 弹窗 when 点击生成 then 调用 saveCampaignBrief 并填充内容', async () => {
    const onClose = mock(() => {})
    const { getByText, getByDisplayValue } = render(
      <CampaignBriefDialog campaign={campaign} kol={kol} open={true} onClose={onClose} />,
    )

    const generateButton = await waitFor(() => getByText('生成基础 Brief'))
    await act(async () => {
      fireEvent.click(generateButton)
    })

    await waitFor(() => expect(mockWebAPI.saveCampaignBrief).toHaveBeenCalled())
    expect(getByDisplayValue('generated brief')).toBeTruthy()
  })

  it('Given 已有 Brief 内容 when 点击保存 then 调用 saveCampaignBrief 并关闭弹窗', async () => {
    const onClose = mock(() => {})
    const { getByText, findByDisplayValue } = render(
      <CampaignBriefDialog campaign={campaign} kol={kol} open={true} onClose={onClose} />,
    )

    const textarea = await findByDisplayValue('')
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '测试 Brief 内容' } })
    })

    const saveButton = getByText('保存')
    await act(async () => {
      fireEvent.click(saveButton)
    })

    await waitFor(() => expect(mockWebAPI.saveCampaignBrief).toHaveBeenCalled())
    expect(onClose).toHaveBeenCalled()
  })
})
