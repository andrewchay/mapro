import { atom } from 'jotai'
import { webAPI } from '../api/web-api.ts'
import type {
  AgentSessionMeta,
  AgentWorkspace,
  AgentMessage,
  PermissionRequest,
  AskUserRequest,
  ExitPlanModeRequest,
} from '@ma-proma/shared'

export const agentSessionsAtom = atom<AgentSessionMeta[]>([])
export const agentWorkspacesAtom = atom<AgentWorkspace[]>([])
export const agentLoadingAtom = atom(false)
export const agentErrorAtom = atom<string | null>(null)

/** 按 sessionId 分组的待处理权限请求 */
export const agentPermissionRequestsAtom = atom<Map<string, PermissionRequest[]>>(new Map())
/** 按 sessionId 分组的待处理 AskUser 请求 */
export const agentAskUserRequestsAtom = atom<Map<string, AskUserRequest[]>>(new Map())
/** 按 sessionId 分组的待处理 ExitPlanMode 请求 */
export const agentExitPlanRequestsAtom = atom<Map<string, ExitPlanModeRequest[]>>(new Map())
/** 处于计划模式的会话集合 */
export const agentPlanModeSessionsAtom = atom<Set<string>>(new Set<string>())

export const refreshAgentSessionsAtom = atom(null, async (_get, set) => {
  set(agentLoadingAtom, true)
  set(agentErrorAtom, null)
  try {
    const sessions = await webAPI.listAgentSessions()
    set(agentSessionsAtom, sessions)
  } catch (error) {
    set(agentErrorAtom, error instanceof Error ? error.message : String(error))
  } finally {
    set(agentLoadingAtom, false)
  }
})

export const refreshAgentWorkspacesAtom = atom(null, async (_get, set) => {
  try {
    const workspaces = await webAPI.listAgentWorkspaces()
    set(agentWorkspacesAtom, workspaces)
  } catch (error) {
    console.error('加载工作区失败:', error)
  }
})

export const createAgentSessionAtom = atom(
  null,
  async (_get, set, input: { title?: string; workspaceId?: string }) => {
    const session = await webAPI.createAgentSession(input)
    set(agentSessionsAtom, (prev) => [session, ...prev])
    return session
  },
)

export const loadAgentSessionMessagesAtom = atom(
  null,
  async (_get, _set, sessionId: string): Promise<AgentMessage[]> => {
    const { messages } = await webAPI.getAgentSession(sessionId)
    return messages
  },
)
