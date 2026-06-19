/**
 * Active View Atom - 主内容区视图状态
 *
 * 控制 MainArea 显示的内容：
 * - conversations: 对话视图（Chat/Agent 模式内容）
 * - campaigns: Campaign 项目管理视图
 */

import { atom } from 'jotai'

export type ActiveView = 'conversations' | 'campaigns' | 'kol_data'

/** 当前活跃视图（不持久化，每次启动默认显示 Campaign 项目） */
export const activeViewAtom = atom<ActiveView>('campaigns')

/** 同步 appMode 和 activeView 的辅助函数 */
export function getDefaultViewForMode(mode: 'chat' | 'agent' | 'scratch'): ActiveView {
  return mode === 'chat' ? 'conversations' : 'campaigns'
}
