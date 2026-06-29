/**
 * 应用设置类型
 *
 * 核心字段由 Web 端与 Electron 端共享；Electron 端可在此基础上扩展桌面专用字段。
 */

/** 主题模式 */
export type ThemeMode = 'light' | 'dark' | 'system' | 'special'

/** 特殊风格主题 */
export type ThemeStyle =
  | 'default'
  | 'ocean-light'
  | 'ocean-dark'
  | 'forest-light'
  | 'forest-dark'
  | 'slate-light'
  | 'slate-dark'

/** 默认主题模式 */
export const DEFAULT_THEME_MODE: ThemeMode = 'dark'

/** 默认特殊风格主题 */
export const DEFAULT_THEME_STYLE: ThemeStyle = 'default'

import type { MAProPermissionMode } from './agent.ts'

/** 应用设置（核心字段） */
export interface AppSettings {
  /** 主题模式 */
  themeMode: ThemeMode
  /** 特殊风格主题 */
  themeStyle?: ThemeStyle
  /** 是否已完成 Onboarding 流程 */
  onboardingCompleted?: boolean
  /** 是否跳过了环境检测 */
  environmentCheckSkipped?: boolean
  /** 是否启用桌面通知 */
  notificationsEnabled?: boolean
  /** 是否启用通知提示音 */
  notificationSoundEnabled?: boolean
  /** 自动归档天数（0 = 禁用） */
  archiveAfterDays?: number
  /** 发送消息快捷键模式：true = Cmd/Ctrl+Enter 发送，false(默认) = Enter 发送 */
  sendWithCmdEnter?: boolean
  /** Agent 默认渠道 ID */
  defaultAgentChannelId?: string
  /** Agent 默认模型 ID（在默认渠道中选择一个启用的模型） */
  defaultAgentModelId?: string
  /** Agent 默认工作区 ID */
  defaultAgentWorkspaceId?: string
  /** Agent 默认权限模式 */
  defaultAgentPermissionMode?: MAProPermissionMode
}
