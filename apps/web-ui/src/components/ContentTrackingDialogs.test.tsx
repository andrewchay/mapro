import '../../src/test-setup.ts'

import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, afterAll, mock } from 'bun:test'
import { render, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { ContentTrackingFormDialog, PaidDataDialog, AnalysisDialog } from './ContentTrackingDialogs.tsx'
import { mockWebAPI } from '../test-utils/mock-web-api.ts'
import type { CampaignKOLPoolItem, KOLContentTracking } from '@ma-proma/shared'

mock.module('../api/web-api.ts', () => ({
  webAPI: mockWebAPI,
}))

afterAll(() => {
  mock.restore()
})

const pool: CampaignKOLPoolItem[] = [
  { campaignId: 'c1', kolId: 'k1', name: '达人小A', platform: 'xiaohongshu', followers: '10k', engagement: '5%', category: 'beauty', price: '1000', city: '上海', status: 'candidate', notes: '', addedAt: 0 },
]

const baseTracking: KOLContentTracking = {
  id: 't1',
  campaignId: 'c1',
  kolId: 'k1',
  kolName: '达人小A',
  platform: 'xiaohongshu',
  contentUrl: 'https://example.com/post/1',
  contentType: 'organic',
  publishDate: '2024-01-01',
  exposure: 10000,
  views: 5000,
  likes: 300,
  saves: 50,
  comments: 80,
  shares: 20,
  cpm: 10,
  cpe: 5,
  ctr: 2,
  engagementRate: 5,
  completionRate: 60,
  dataSource: 'manual',
  collectedAt: 0,
  performanceGrade: 'good',
  benchmarkComparison: '',
  aiAnalysis: '',
  recommendations: '',
  paidData: '',
  paidSpend: 0,
  paidExposure: 0,
  paidViews: 0,
  paidLikes: 0,
  phase: 1,
  testGroup: '',
  noteType: '',
  cost: 0,
  isOrganic: true,
  createdAt: 0,
  updatedAt: 0,
}

function renderForm(props: Partial<React.ComponentProps<typeof ContentTrackingFormDialog>> = {}) {
  return render(
    <ContentTrackingFormDialog
      open={true}
      onClose={mock(() => {})}
      campaignId="c1"
      pool={pool}
      editingItem={null}
      onSaved={mock(() => {})}
      {...props}
    />,
  )
}

describe('ContentTrackingFormDialog', () => {
  beforeEach(() => {
    mockWebAPI.addContentTracking = mock(async () => ({ ...baseTracking }))
    mockWebAPI.updateContentTrackingData = mock(async () => ({ ...baseTracking, exposure: 20000 }))
  })

  afterEach(() => {
    cleanup()
  })

  it('Given 创建内容追踪 when 未选择 KOL then 提交按钮禁用', async () => {
    const { getByText } = renderForm()

    const submitButton = getByText('添加数据') as HTMLButtonElement
    expect(submitButton.disabled).toBe(true)
    expect(mockWebAPI.addContentTracking).not.toHaveBeenCalled()
  })

  it('Given 创建内容追踪 when 从选择器选择 KOL 并提交 then 调用 addContentTracking 并关闭弹窗', async () => {
    const onClose = mock(() => {})
    const onSaved = mock(() => {})
    const { getByText, getByRole, getByLabelText } = renderForm({ onClose, onSaved })

    fireEvent.click(getByRole('button', { expanded: false }))
    const option = await waitFor(() => getByRole('option', { name: /达人小A/ }))
    await act(async () => {
      fireEvent.click(option)
    })

    fireEvent.input(getByLabelText(/内容链接/), { target: { value: 'https://example.com/post/1' } })

    const submitButton = getByText('添加数据')
    await act(async () => {
      fireEvent.click(submitButton)
    })

    await waitFor(() => expect(mockWebAPI.addContentTracking).toHaveBeenCalled())
    expect(onSaved).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('Given 编辑内容追踪 when 修改曝光并提交 then 调用 updateContentTrackingData', async () => {
    const onClose = mock(() => {})
    const onSaved = mock(() => {})
    const { getByText, getByLabelText } = renderForm({ editingItem: baseTracking, onClose, onSaved })

    fireEvent.change(getByLabelText('曝光'), { target: { value: '20000' } })

    const submitButton = getByText('更新数据')
    await act(async () => {
      fireEvent.click(submitButton)
    })

    await waitFor(() => expect(mockWebAPI.updateContentTrackingData).toHaveBeenCalled())
    expect(onSaved).toHaveBeenCalled()
  })
})

describe('PaidDataDialog', () => {
  beforeEach(() => {
    mockWebAPI.addContentPaidData = mock(async () => ({ ...baseTracking, paidSpend: 1000 }))
  })

  afterEach(() => {
    cleanup()
  })

  it('Given 打开投流弹窗 when 输入投放金额并保存 then 调用 addContentPaidData', async () => {
    const onClose = mock(() => {})
    const onSaved = mock(() => {})
    const { getByText, getByLabelText } = render(
      <PaidDataDialog item={baseTracking} open={true} onClose={onClose} onSaved={onSaved} />,
    )

    fireEvent.change(getByLabelText(/投放金额/), { target: { value: '1000' } })

    const saveButton = getByText('保存投流数据')
    await act(async () => {
      fireEvent.click(saveButton)
    })

    await waitFor(() => expect(mockWebAPI.addContentPaidData).toHaveBeenCalled())
    expect(onSaved).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})

describe('AnalysisDialog', () => {
  beforeEach(() => {
    mockWebAPI.updateContentTrackingAnalysis = mock(async () => ({ ...baseTracking, performanceGrade: 'excellent' }))
  })

  afterEach(() => {
    cleanup()
  })

  it('Given 打开分析弹窗 when 选择性能等级并保存 then 调用 updateContentTrackingAnalysis', async () => {
    const onClose = mock(() => {})
    const onSaved = mock(() => {})
    const { getByText } = render(
      <AnalysisDialog item={baseTracking} open={true} onClose={onClose} onSaved={onSaved} />,
    )

    const excellentButton = getByText('优秀')
    await act(async () => {
      fireEvent.click(excellentButton)
    })

    const saveButton = getByText('保存分析')
    await act(async () => {
      fireEvent.click(saveButton)
    })

    await waitFor(() => expect(mockWebAPI.updateContentTrackingAnalysis).toHaveBeenCalled())
    expect(onSaved).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})
