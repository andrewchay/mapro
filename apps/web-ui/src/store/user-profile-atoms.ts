/**
 * 用户档案状态管理
 */

import { atom } from 'jotai'
import type { UserProfile } from '@ma-proma/shared'
import { DEFAULT_USER_NAME, DEFAULT_USER_AVATAR } from '@ma-proma/shared'

export const userProfileAtom = atom<UserProfile>({
  userName: DEFAULT_USER_NAME,
  avatar: DEFAULT_USER_AVATAR,
})
