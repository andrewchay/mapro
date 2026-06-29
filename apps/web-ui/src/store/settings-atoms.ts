/**
 * 设置状态管理
 *
 * 使用 Jotai 管理应用设置，支持初始加载与局部更新。
 */

import { atom } from 'jotai'
import type { AppSettings, ThemeMode, ThemeStyle, MAProPermissionMode } from '@ma-proma/shared'
import { DEFAULT_THEME_MODE, DEFAULT_THEME_STYLE, MAPRO_DEFAULT_PERMISSION_MODE } from '@ma-proma/shared'

export const settingsAtom = atom<AppSettings>({
  themeMode: DEFAULT_THEME_MODE,
  themeStyle: DEFAULT_THEME_STYLE,
  onboardingCompleted: false,
  environmentCheckSkipped: false,
  notificationsEnabled: true,
  notificationSoundEnabled: true,
  archiveAfterDays: 0,
  sendWithCmdEnter: false,
  defaultAgentChannelId: undefined,
  defaultAgentModelId: undefined,
  defaultAgentWorkspaceId: undefined,
  defaultAgentPermissionMode: MAPRO_DEFAULT_PERMISSION_MODE,
})

export const themeModeAtom = atom(
  (get) => get(settingsAtom).themeMode,
  (_get, set, value: ThemeMode) => {
    set(settingsAtom, (prev) => ({ ...prev, themeMode: value }))
  },
)

export const themeStyleAtom = atom(
  (get) => get(settingsAtom).themeStyle ?? DEFAULT_THEME_STYLE,
  (_get, set, value: ThemeStyle | undefined) => {
    set(settingsAtom, (prev) => ({ ...prev, themeStyle: value }))
  },
)

export const sendWithCmdEnterAtom = atom(
  (get) => get(settingsAtom).sendWithCmdEnter ?? false,
  (_get, set, value: boolean) => {
    set(settingsAtom, (prev) => ({ ...prev, sendWithCmdEnter: value }))
  },
)

export const defaultAgentChannelIdAtom = atom(
  (get) => get(settingsAtom).defaultAgentChannelId,
  (_get, set, value: string | undefined) => {
    set(settingsAtom, (prev) => ({ ...prev, defaultAgentChannelId: value }))
  },
)

export const defaultAgentModelIdAtom = atom(
  (get) => get(settingsAtom).defaultAgentModelId,
  (_get, set, value: string | undefined) => {
    set(settingsAtom, (prev) => ({ ...prev, defaultAgentModelId: value }))
  },
)

export const defaultAgentWorkspaceIdAtom = atom(
  (get) => get(settingsAtom).defaultAgentWorkspaceId,
  (_get, set, value: string | undefined) => {
    set(settingsAtom, (prev) => ({ ...prev, defaultAgentWorkspaceId: value }))
  },
)

export const defaultAgentPermissionModeAtom = atom(
  (get) => get(settingsAtom).defaultAgentPermissionMode ?? MAPRO_DEFAULT_PERMISSION_MODE,
  (_get, set, value: MAProPermissionMode) => {
    set(settingsAtom, (prev) => ({ ...prev, defaultAgentPermissionMode: value }))
  },
)
