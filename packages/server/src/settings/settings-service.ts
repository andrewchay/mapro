/**
 * 跨平台应用设置服务
 *
 * 管理应用设置（主题模式等）的读写。
 * 存储在 {configDir}/settings.json
 *
 * 设计要点：
 * - 读取完整 JSON 时使用 Record<string, unknown>，保留 Electron 端桌面专用字段
 * - 对外返回类型化的 AppSettings
 * - 使用原子写，避免崩溃时截断文件
 */

import type { AppContext } from '../context/types.ts'
import { getSettingsPath } from '../context/config-paths.ts'
import { readJsonFileSafe, writeJsonFileAtomic } from '../utils/safe-file.ts'
import type { AppSettings, ThemeMode, ThemeStyle, MAProPermissionMode } from '@ma-proma/shared'
import { DEFAULT_THEME_MODE, MAPRO_PERMISSION_MODES } from '@ma-proma/shared'

const VALID_THEME_MODES: ThemeMode[] = ['light', 'dark', 'system', 'special']
const VALID_THEME_STYLES: ThemeStyle[] = [
  'default',
  'ocean-light',
  'ocean-dark',
  'forest-light',
  'forest-dark',
  'slate-light',
  'slate-dark',
]

function isValidThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && VALID_THEME_MODES.includes(value as ThemeMode)
}

function isValidThemeStyle(value: unknown): value is ThemeStyle {
  return typeof value === 'string' && VALID_THEME_STYLES.includes(value as ThemeStyle)
}

function isValidPermissionMode(value: unknown): value is MAProPermissionMode {
  return typeof value === 'string' && MAPRO_PERMISSION_MODES.includes(value as MAProPermissionMode)
}

function normalizeSettings(raw: Record<string, unknown>): AppSettings {
  const data = raw as Partial<AppSettings>
  return {
    themeMode: isValidThemeMode(data.themeMode) ? data.themeMode : DEFAULT_THEME_MODE,
    themeStyle: isValidThemeStyle(data.themeStyle) ? data.themeStyle : undefined,
    onboardingCompleted: data.onboardingCompleted ?? false,
    environmentCheckSkipped: data.environmentCheckSkipped ?? false,
    notificationsEnabled: data.notificationsEnabled ?? true,
    notificationSoundEnabled: data.notificationSoundEnabled ?? true,
    archiveAfterDays: data.archiveAfterDays ?? 0,
    sendWithCmdEnter: data.sendWithCmdEnter ?? false,
    defaultAgentChannelId: data.defaultAgentChannelId,
    defaultAgentModelId: data.defaultAgentModelId,
    defaultAgentWorkspaceId: data.defaultAgentWorkspaceId,
    defaultAgentPermissionMode: isValidPermissionMode(data.defaultAgentPermissionMode)
      ? data.defaultAgentPermissionMode
      : undefined,
  }
}

/**
 * 获取应用设置
 *
 * 如果文件不存在，返回默认设置。
 */
export function getAppSettings(context: AppContext): AppSettings {
  const filePath = getSettingsPath(context)
  const raw = readJsonFileSafe<Record<string, unknown>>(filePath)

  if (!raw) {
    return normalizeSettings({})
  }

  try {
    return normalizeSettings(raw)
  } catch (error) {
    console.error('[设置] 读取失败:', error)
    return normalizeSettings({})
  }
}

/**
 * 获取应用设置的原始完整对象
 *
 * 用于 PATCH 时保留文件中未在白名单中的字段。
 */
function getRawSettings(context: AppContext): Record<string, unknown> {
  const filePath = getSettingsPath(context)
  return readJsonFileSafe<Record<string, unknown>>(filePath) ?? {}
}

/** PATCH 白名单字段校验与转换结果 */
export interface SettingsPatchResult {
  /** 校验后的更新字段 */
  updates: Partial<AppSettings>
  /** 校验失败的字段及其原因 */
  errors?: Record<string, string>
}

/**
  * 校验并提取允许 PATCH 的字段
  *
  * 未知字段直接忽略；枚举/类型不合法返回 errors。
  */
export function validateSettingsPatch(input: Record<string, unknown>): SettingsPatchResult {
  const updates: Partial<AppSettings> = {}
  const errors: Record<string, string> = {}

  for (const [key, value] of Object.entries(input)) {
    switch (key) {
      case 'themeMode':
        if (isValidThemeMode(value)) {
          updates.themeMode = value
        } else {
          errors.themeMode = `themeMode 必须是 ${VALID_THEME_MODES.join('/')} 之一`
        }
        break
      case 'themeStyle':
        if (value === null || value === undefined) {
          updates.themeStyle = undefined
        } else if (isValidThemeStyle(value)) {
          updates.themeStyle = value
        } else {
          errors.themeStyle = `themeStyle 必须是 ${VALID_THEME_STYLES.join('/')} 之一`
        }
        break
      case 'onboardingCompleted':
      case 'environmentCheckSkipped':
      case 'notificationsEnabled':
      case 'notificationSoundEnabled':
      case 'sendWithCmdEnter':
        if (typeof value === 'boolean') {
          ;(updates as Record<string, boolean>)[key] = value
        } else {
          errors[key] = `${key} 必须是布尔值`
        }
        break
      case 'archiveAfterDays':
        if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
          updates.archiveAfterDays = value
        } else {
          errors.archiveAfterDays = 'archiveAfterDays 必须是非负整数'
        }
        break
      case 'defaultAgentChannelId':
      case 'defaultAgentModelId':
      case 'defaultAgentWorkspaceId':
        if (value === null || value === undefined || value === '') {
          ;(updates as Record<string, string | undefined>)[key] = undefined
        } else if (typeof value === 'string') {
          ;(updates as Record<string, string | undefined>)[key] = value
        } else {
          errors[key] = `${key} 必须是字符串`
        }
        break
      case 'defaultAgentPermissionMode':
        if (value === null || value === undefined) {
          updates.defaultAgentPermissionMode = undefined
        } else if (isValidPermissionMode(value)) {
          updates.defaultAgentPermissionMode = value
        } else {
          errors.defaultAgentPermissionMode = `defaultAgentPermissionMode 必须是 ${MAPRO_PERMISSION_MODES.join('/')} 之一`
        }
        break
      default:
        // 未知字段直接忽略
        break
    }
  }

  return Object.keys(errors).length > 0 ? { updates, errors } : { updates }
}

/**
 * 更新应用设置
 *
 * 合并白名单字段并写入文件，保留文件中其他字段。
 */
export function updateAppSettings(
  context: AppContext,
  updates: Partial<AppSettings>,
): AppSettings {
  const current = getRawSettings(context)
  const updated: Record<string, unknown> = {
    ...current,
    ...updates,
  }

  const filePath = getSettingsPath(context)

  try {
    writeJsonFileAtomic(filePath, updated)
    console.log('[设置] 已更新 keys:', Object.keys(updates).join(', '))
  } catch (error) {
    console.error('[设置] 写入失败:', error)
    throw new Error('写入应用设置失败')
  }

  return normalizeSettings(updated)
}
