/**
 * Campaign 详情页派生数据原子测试
 *
 * 验证 Jotai atoms 统一拉取 KOL 候选池、内容追踪、内容审核数据，
 * 并在 refresh 时重新请求。
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { createStore } from 'jotai'
import type { CampaignKOLPoolItem, KOLContentTracking, ContentAudit } from '@ma-proma/shared'

const mockPool: CampaignKOLPoolItem[] = [
  { campaignId: 'c1', kolId: 'k1', name: 'KOL A', platform: 'xhs', followers: '10k', engagement: '5%', category: 'beauty', price: '1000', city: '上海', status: 'candidate', notes: '', addedAt: Date.now() },
]

const mockTracking: KOLContentTracking[] = [
  {
    id: 't1',
    campaignId: 'c1',
    kolId: 'k1',
    kolName: 'KOL A',
    platform: 'xhs',
    contentUrl: 'https://example.com/1',
    contentType: 'organic',
    publishDate: '2026-06-01',
    exposure: 1000,
    views: 800,
    likes: 100,
    saves: 20,
    comments: 10,
    shares: 5,
    cpm: 10,
    cpe: 2,
    ctr: 0.05,
    engagementRate: 0.1,
    dataSource: 'manual',
    collectedAt: Date.now(),
    performanceGrade: 'good',
    benchmarkComparison: '{}',
    aiAnalysis: '',
    recommendations: '',
    paidData: '{}',
    paidSpend: 0,
    paidExposure: 0,
    paidViews: 0,
    paidLikes: 0,
    phase: 1,
    testGroup: '',
    noteType: '',
    cost: 0,
    isOrganic: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
]

const mockAudits: ContentAudit[] = [
  {
    auditId: 'a1',
    campaignId: 'c1',
    kolId: 'k1',
    kolName: 'KOL A',
    contentUrl: 'https://example.com/1',
    platform: 'xhs',
    auditStatus: 'passed',
    complianceScore: 90,
    brandAlignmentScore: 85,
    qualityScore: 88,
    overallScore: 87,
    auditReport: '符合要求',
    auditor: 'system',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
]

const mockGetPoolKOLs = mock(() => Promise.resolve(mockPool))
const mockListContentTracking = mock(() => Promise.resolve(mockTracking))
const mockListContentAudits = mock(() => Promise.resolve(mockAudits))

mock.module('../api/web-api.ts', () => ({
  webAPI: {
    getPoolKOLs: mockGetPoolKOLs,
    listContentTracking: mockListContentTracking,
    listContentAudits: mockListContentAudits,
  },
}))

const { campaignPoolAtom, campaignTrackingAtom, campaignAuditsAtom } = await import('./campaign-detail-atoms.ts')

describe('campaign-detail-atoms', () => {
  beforeEach(() => {
    mockGetPoolKOLs.mockClear()
    mockListContentTracking.mockClear()
    mockListContentAudits.mockClear()
  })

  test('campaignPoolAtom 初始为空，refresh 后加载 KOL 候选池', async () => {
    const store = createStore()
    const poolAtom = campaignPoolAtom('c1')

    expect(store.get(poolAtom)).toEqual({ data: [], loading: false, error: null })

    await store.set(poolAtom)

    expect(mockGetPoolKOLs).toHaveBeenCalledTimes(1)
    expect(mockGetPoolKOLs).toHaveBeenCalledWith('c1')
    expect(store.get(poolAtom)).toEqual({ data: mockPool, loading: false, error: null })
  })

  test('campaignTrackingAtom refresh 后加载内容追踪', async () => {
    const store = createStore()
    const trackingAtom = campaignTrackingAtom('c1')

    await store.set(trackingAtom)

    expect(mockListContentTracking).toHaveBeenCalledTimes(1)
    expect(mockListContentTracking).toHaveBeenCalledWith('c1')
    expect(store.get(trackingAtom)).toEqual({ data: mockTracking, loading: false, error: null })
  })

  test('campaignAuditsAtom refresh 后加载内容审核', async () => {
    const store = createStore()
    const auditsAtom = campaignAuditsAtom('c1')

    await store.set(auditsAtom)

    expect(mockListContentAudits).toHaveBeenCalledTimes(1)
    expect(mockListContentAudits).toHaveBeenCalledWith('c1')
    expect(store.get(auditsAtom)).toEqual({ data: mockAudits, loading: false, error: null })
  })

  test('refresh 会重新发起请求', async () => {
    const store = createStore()
    const poolAtom = campaignPoolAtom('c1')

    await store.set(poolAtom)
    await store.set(poolAtom)

    expect(mockGetPoolKOLs).toHaveBeenCalledTimes(2)
  })

  test('API 失败时设置 error 状态', async () => {
    mockGetPoolKOLs.mockImplementationOnce(() => Promise.reject(new Error('network error')))
    const store = createStore()
    const poolAtom = campaignPoolAtom('c1')

    await store.set(poolAtom)

    expect(store.get(poolAtom).loading).toBe(false)
    expect(store.get(poolAtom).error).toBe('network error')
    expect(store.get(poolAtom).data).toEqual([])
  })

  test('campaignId 为 undefined 时不调用 API 且保持空状态', async () => {
    const store = createStore()
    const poolAtom = campaignPoolAtom(undefined)

    await store.set(poolAtom)

    expect(mockGetPoolKOLs).toHaveBeenCalledTimes(0)
    expect(store.get(poolAtom)).toEqual({ data: [], loading: false, error: null })
  })
})
