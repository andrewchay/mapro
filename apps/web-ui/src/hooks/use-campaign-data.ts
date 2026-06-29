import * as React from 'react'
import { useAtom } from 'jotai'
import type { CampaignKOLPoolItem, KOLContentTracking, ContentAudit } from '@ma-proma/shared'
import {
  campaignPoolAtom,
  campaignTrackingAtom,
  campaignAuditsAtom,
} from '../store/campaign-detail-atoms.ts'

export function usePoolKOLs(campaignId: string | undefined) {
  const [{ data: pool, loading, error }, refresh] = useAtom(campaignPoolAtom(campaignId))

  React.useEffect(() => {
    if (campaignId) {
      refresh()
    }
  }, [campaignId, refresh])

  return { pool, loading, error, refresh }
}

export function useContentTracking(campaignId: string | undefined) {
  const [{ data: tracking, loading, error }, refresh] = useAtom(campaignTrackingAtom(campaignId))

  React.useEffect(() => {
    if (campaignId) {
      refresh()
    }
  }, [campaignId, refresh])

  return { tracking, loading, error, refresh }
}

export function useContentAudits(campaignId: string | undefined) {
  const [{ data: audits, loading, error }, refresh] = useAtom(campaignAuditsAtom(campaignId))

  React.useEffect(() => {
    if (campaignId) {
      refresh()
    }
  }, [campaignId, refresh])

  return { audits, loading, error, refresh }
}

export type { CampaignKOLPoolItem, KOLContentTracking, ContentAudit }
