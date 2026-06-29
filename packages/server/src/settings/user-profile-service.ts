/**
 * 跨平台用户档案服务
 *
 * 管理用户档案（用户名 + 头像）的读写。
 * 存储在 {configDir}/user-profile.json
 */

import type { AppContext } from '../context/types.ts'
import { getUserProfilePath } from '../context/config-paths.ts'
import { readJsonFileSafe, writeJsonFileAtomic } from '../utils/safe-file.ts'
import type { UserProfile } from '@ma-proma/shared'
import { DEFAULT_USER_NAME, DEFAULT_USER_AVATAR } from '@ma-proma/shared'

function normalizeUserProfile(raw: Record<string, unknown>): UserProfile {
  const data = raw as Partial<UserProfile>
  return {
    userName: data.userName?.toString().trim() || DEFAULT_USER_NAME,
    avatar: data.avatar?.toString() || DEFAULT_USER_AVATAR,
  }
}

/**
 * 获取用户档案
 *
 * 如果文件不存在，返回默认档案。
 */
export function getUserProfile(context: AppContext): UserProfile {
  const filePath = getUserProfilePath(context)
  const raw = readJsonFileSafe<Record<string, unknown>>(filePath)

  if (!raw) {
    return normalizeUserProfile({})
  }

  try {
    return normalizeUserProfile(raw)
  } catch (error) {
    console.error('[用户档案] 读取失败:', error)
    return normalizeUserProfile({})
  }
}

/**
 * 更新用户档案
 *
 * 合并更新字段并写入文件。
 */
export function updateUserProfile(
  context: AppContext,
  updates: Partial<UserProfile>,
): UserProfile {
  const current = getUserProfile(context)
  const updated: UserProfile = {
    ...current,
    ...updates,
  }

  // 空用户名回退到默认值
  if (updated.userName.trim() === '') {
    updated.userName = DEFAULT_USER_NAME
  }

  const filePath = getUserProfilePath(context)

  try {
    writeJsonFileAtomic(filePath, updated)
    console.log(`[用户档案] 已更新: ${updated.userName}`)
  } catch (error) {
    console.error('[用户档案] 写入失败:', error)
    throw new Error('写入用户档案失败')
  }

  return updated
}
