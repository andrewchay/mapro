import { atom } from 'jotai'
import type { PrimitiveAtom, WritableAtom } from 'jotai'
import type { CampaignKOLPoolItem, KOLContentTracking, ContentAudit } from '@ma-proma/shared'
import { webAPI } from '../api/web-api.ts'

interface AsyncListState<T> {
  data: T[]
  loading: boolean
  error: string | null
}

const emptyPoolState: AsyncListState<CampaignKOLPoolItem> = { data: [], loading: false, error: null }
const emptyTrackingState: AsyncListState<KOLContentTracking> = { data: [], loading: false, error: null }
const emptyAuditsState: AsyncListState<ContentAudit> = { data: [], loading: false, error: null }

/**
 * 按 campaignId 缓存独立的 atom。
 * 不依赖 jotai/utils 中已废弃的 atomFamily。
 */
function atomFamily<T>(factory: (campaignId: string) => T): (campaignId: string) => T {
  const cache = new Map<string, T>()
  return (campaignId: string) => {
    if (!cache.has(campaignId)) {
      cache.set(campaignId, factory(campaignId))
    }
    return cache.get(campaignId)!
  }
}

// =====================================================================
// KOL 候选池
// =====================================================================

const poolDataFamily = atomFamily<PrimitiveAtom<AsyncListState<CampaignKOLPoolItem>>>((campaignId: string) =>
  atom<AsyncListState<CampaignKOLPoolItem>>({ ...emptyPoolState })
)

const refreshPoolFamily = atomFamily<WritableAtom<null, [], Promise<void>>>((campaignId: string) =>
  atom(null, async (_get, set) => {
    set(poolDataFamily(campaignId), (prev) => ({ ...prev, loading: true, error: null }))
    try {
      const pool = await webAPI.getPoolKOLs(campaignId)
      set(poolDataFamily(campaignId), { data: pool, loading: false, error: null })
    } catch (err) {
      const message = err instanceof Error ? err.message : '获取 KOL 候选池失败'
      console.error('[campaign-detail-atoms] 获取 KOL 候选池失败:', err)
      set(poolDataFamily(campaignId), { data: [], loading: false, error: message })
    }
  })
)

const poolAtomFamily = atomFamily((campaignId: string) =>
  atom(
    (get) => get(poolDataFamily(campaignId)),
    (_get, set) => set(refreshPoolFamily(campaignId)),
  )
)

const noOpPoolAtom = atom(emptyPoolState, async (_get, _set) => {})

export const campaignPoolAtom = (campaignId: string | undefined) => {
  if (!campaignId) return noOpPoolAtom
  return poolAtomFamily(campaignId)
}

// =====================================================================
// 内容追踪
// =====================================================================

const trackingDataFamily = atomFamily<PrimitiveAtom<AsyncListState<KOLContentTracking>>>((campaignId: string) =>
  atom<AsyncListState<KOLContentTracking>>({ ...emptyTrackingState })
)

const refreshTrackingFamily = atomFamily<WritableAtom<null, [], Promise<void>>>((campaignId: string) =>
  atom(null, async (_get, set) => {
    set(trackingDataFamily(campaignId), (prev) => ({ ...prev, loading: true, error: null }))
    try {
      const tracking = await webAPI.listContentTracking(campaignId)
      set(trackingDataFamily(campaignId), { data: tracking, loading: false, error: null })
    } catch (err) {
      const message = err instanceof Error ? err.message : '获取内容追踪失败'
      console.error('[campaign-detail-atoms] 获取内容追踪失败:', err)
      set(trackingDataFamily(campaignId), { data: [], loading: false, error: message })
    }
  })
)

const trackingAtomFamily = atomFamily((campaignId: string) =>
  atom(
    (get) => get(trackingDataFamily(campaignId)),
    (_get, set) => set(refreshTrackingFamily(campaignId)),
  )
)

const noOpTrackingAtom = atom(emptyTrackingState, async (_get, _set) => {})

export const campaignTrackingAtom = (campaignId: string | undefined) => {
  if (!campaignId) return noOpTrackingAtom
  return trackingAtomFamily(campaignId)
}

// =====================================================================
// 内容审核
// =====================================================================

const auditsDataFamily = atomFamily<PrimitiveAtom<AsyncListState<ContentAudit>>>((campaignId: string) =>
  atom<AsyncListState<ContentAudit>>({ ...emptyAuditsState })
)

const refreshAuditsFamily = atomFamily<WritableAtom<null, [], Promise<void>>>((campaignId: string) =>
  atom(null, async (_get, set) => {
    set(auditsDataFamily(campaignId), (prev) => ({ ...prev, loading: true, error: null }))
    try {
      const audits = await webAPI.listContentAudits(campaignId)
      set(auditsDataFamily(campaignId), { data: audits, loading: false, error: null })
    } catch (err) {
      const message = err instanceof Error ? err.message : '获取内容审核记录失败'
      console.error('[campaign-detail-atoms] 获取内容审核记录失败:', err)
      set(auditsDataFamily(campaignId), { data: [], loading: false, error: message })
    }
  })
)

const auditsAtomFamily = atomFamily((campaignId: string) =>
  atom(
    (get) => get(auditsDataFamily(campaignId)),
    (_get, set) => set(refreshAuditsFamily(campaignId)),
  )
)

const noOpAuditsAtom = atom(emptyAuditsState, async (_get, _set) => {})

export const campaignAuditsAtom = (campaignId: string | undefined) => {
  if (!campaignId) return noOpAuditsAtom
  return auditsAtomFamily(campaignId)
}
