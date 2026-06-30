/**
 * 内容追踪列表测试
 */

import { describe, it, expect, afterEach } from 'bun:test'
import { render, cleanup } from '@testing-library/react'
import type { KOLContentTracking } from '@ma-proma/shared'
import { ContentTrackingList } from './ContentTrackingList.tsx'

const item: KOLContentTracking = {
  id: 't1',
  campaignId: 'c1',
  kolId: 'k1',
  kolName: '达人 A',
  platform: 'xiaohongshu',
  contentUrl: 'https://xhs.example/1',
  contentType: 'organic',
  publishDate: '2026-06-01',
  exposure: 10000,
  views: 5000,
  likes: 300,
  saves: 50,
  comments: 40,
  shares: 10,
  cpm: 0,
  cpe: 0,
  ctr: 0,
  engagementRate: 0,
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

describe('ContentTrackingList', () => {
  afterEach(() => {
    cleanup()
  })

  it('Given loading when 渲染 then 展示骨架屏', () => {
    const { container } = render(<ContentTrackingList tracking={[]} loading />)
    const rows = container.querySelectorAll('tbody tr')
    expect(rows.length).toBe(5)
  })

  it('Given 空列表 when 渲染 then 展示空状态提示', () => {
    const { getByText } = render(<ContentTrackingList tracking={[]} />)
    expect(getByText('暂无内容追踪数据')).toBeTruthy()
  })

  it('Given 有数据 when 渲染 then 展示 KOL 名称与等级', () => {
    const { getByText } = render(<ContentTrackingList tracking={[item]} />)
    expect(getByText('达人 A')).toBeTruthy()
    expect(getByText('良好')).toBeTruthy()
  })
})
