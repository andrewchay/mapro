import { atom } from 'jotai'
import type { Campaign } from '@ma-proma/shared'
import { webAPI } from '../api/web-api.ts'

export const campaignListAtom = atom<Campaign[]>([])
export const currentCampaignAtom = atom<Campaign | null>(null)
export const campaignLoadingAtom = atom<boolean>(false)
export const campaignErrorAtom = atom<string | null>(null)

export const refreshCampaignsAtom = atom(null, async (_, set) => {
  set(campaignLoadingAtom, true)
  set(campaignErrorAtom, null)
  try {
    const campaigns = await webAPI.listCampaigns()
    set(campaignListAtom, campaigns)
  } catch (error) {
    const message = error instanceof Error ? error.message : '获取 Campaign 失败'
    set(campaignErrorAtom, message)
  } finally {
    set(campaignLoadingAtom, false)
  }
})

export const loadCampaignAtom = atom(null, async (_, set, id: string) => {
  set(campaignLoadingAtom, true)
  set(campaignErrorAtom, null)
  try {
    const campaign = await webAPI.getCampaignById(id)
    set(currentCampaignAtom, campaign)
  } catch (error) {
    const message = error instanceof Error ? error.message : '获取 Campaign 详情失败'
    set(campaignErrorAtom, message)
  } finally {
    set(campaignLoadingAtom, false)
  }
})

export const createCampaignAtom = atom(null, async (_, set, input: Parameters<typeof webAPI.createCampaign>[0]) => {
  set(campaignLoadingAtom, true)
  set(campaignErrorAtom, null)
  try {
    const campaign = await webAPI.createCampaign(input)
    set(currentCampaignAtom, campaign)
    set(refreshCampaignsAtom)
    return campaign
  } catch (error) {
    const message = error instanceof Error ? error.message : '创建 Campaign 失败'
    set(campaignErrorAtom, message)
    throw error
  } finally {
    set(campaignLoadingAtom, false)
  }
})
