import { atom } from 'jotai'
import type { Campaign } from '@ma-proma/shared'

/** Campaign 列表 */
export const campaignsAtom = atom<Campaign[]>([])

/** 当前选中的 Campaign ID */
export const currentCampaignIdAtom = atom<string | null>(null)

/** 创建弹窗开关 */
export const campaignCreateDialogOpenAtom = atom(false)
