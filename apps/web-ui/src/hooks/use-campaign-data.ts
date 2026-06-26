import * as React from 'react'
import type { CampaignKOLPoolItem, KOLContentTracking } from '@ma-proma/shared'
import { webAPI } from '../api/web-api.ts'

export function usePoolKOLs(campaignId: string | undefined) {
  const [pool, setPool] = React.useState<CampaignKOLPoolItem[]>([])
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    if (!campaignId) return
    setLoading(true)
    webAPI.getPoolKOLs(campaignId)
      .then(setPool)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [campaignId])

  return { pool, loading }
}

export function useContentTracking(campaignId: string | undefined) {
  const [tracking, setTracking] = React.useState<KOLContentTracking[]>([])
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    if (!campaignId) return
    setLoading(true)
    webAPI.listContentTracking(campaignId)
      .then(setTracking)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [campaignId])

  return { tracking, loading }
}
