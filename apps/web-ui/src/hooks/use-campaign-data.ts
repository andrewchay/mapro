import * as React from 'react'
import type { CampaignKOLPoolItem, KOLContentTracking } from '@ma-proma/shared'
import { webAPI } from '../api/web-api.ts'

export function usePoolKOLs(campaignId: string | undefined, refreshToken = 0) {
  const [pool, setPool] = React.useState<CampaignKOLPoolItem[]>([])
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    if (!campaignId) return
    setLoading(true)
    webAPI.getPoolKOLs(campaignId)
      .then(setPool)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [campaignId, refreshToken])

  return { pool, loading }
}

export function useContentTracking(campaignId: string | undefined, refreshToken = 0) {
  const [tracking, setTracking] = React.useState<KOLContentTracking[]>([])
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    if (!campaignId) return
    setLoading(true)
    webAPI.listContentTracking(campaignId)
      .then(setTracking)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [campaignId, refreshToken])

  return { tracking, loading }
}
