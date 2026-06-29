/**
 * 渠道状态管理
 */

import { atom } from 'jotai'
import type { Channel } from '@ma-proma/shared'

export const channelsAtom = atom<Channel[]>([])
