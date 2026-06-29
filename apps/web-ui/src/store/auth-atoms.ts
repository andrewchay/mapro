/**
 * 认证状态管理（Jotai）
 */

import { atom } from 'jotai'
import { authAPI } from '../api/auth-api.ts'
import type { AuthUser } from '../api/auth-api.ts'

export interface AuthState {
  user: AuthUser | null
  roles: string[]
  permissions: string[]
  isSystemAccount: boolean
  isLoading: boolean
  isAuthenticated: boolean
}

export const authStateAtom = atom<AuthState>({
  user: null,
  roles: [],
  permissions: [],
  isSystemAccount: false,
  isLoading: true,
  isAuthenticated: false,
})

export const currentUserAtom = atom((get) => get(authStateAtom).user)
export const isAuthenticatedAtom = atom((get) => get(authStateAtom).isAuthenticated)
export const authLoadingAtom = atom((get) => get(authStateAtom).isLoading)
export const userPermissionsAtom = atom((get) => get(authStateAtom).permissions)

/** 初始化认证状态：尝试 /auth/me */
export function createAuthInitializeAtom() {
  return atom(null, async (_get, set) => {
    try {
      const { userContext } = await authAPI.me()
      set(authStateAtom, {
        user: {
          id: userContext.userId,
          email: '',
          name: '',
          status: 'active',
          tenantId: userContext.tenantId,
        },
        roles: userContext.roles,
        permissions: userContext.permissions,
        isSystemAccount: userContext.isSystemAccount ?? false,
        isLoading: false,
        isAuthenticated: true,
      })
    } catch {
      set(authStateAtom, (prev) => ({ ...prev, isLoading: false, isAuthenticated: false }))
    }
  })
}

export const authInitializeAtom = createAuthInitializeAtom()

/** 登录 */
export const loginAtom = atom(
  null,
  async (_get, set, input: { email: string; password: string }) => {
    const result = await authAPI.login(input)
    set(authStateAtom, {
      user: result.user,
      roles: [],
      permissions: [],
      isSystemAccount: false,
      isLoading: false,
      isAuthenticated: true,
    })
    // 登录后重新拉取完整上下文以获取权限
    try {
      const { userContext } = await authAPI.me()
      set(authStateAtom, (prev) => ({
        ...prev,
        roles: userContext.roles,
        permissions: userContext.permissions,
        isSystemAccount: userContext.isSystemAccount ?? false,
      }))
    } catch {
      // 忽略
    }
  },
)

/** 登出 */
export const logoutAtom = atom(null, async (_get, set) => {
  await authAPI.logout()
  set(authStateAtom, {
    user: null,
    roles: [],
    permissions: [],
    isSystemAccount: false,
    isLoading: false,
    isAuthenticated: false,
  })
})

/** 刷新 access token */
export const refreshTokenAtom = atom(null, async (_get, set) => {
  try {
    const result = await authAPI.refresh()
    set(authStateAtom, (prev) => ({
      ...prev,
      user: result.user,
      isAuthenticated: true,
      isLoading: false,
    }))
    return result.accessToken
  } catch {
    set(authStateAtom, (prev) => ({ ...prev, isAuthenticated: false, isLoading: false }))
    return null
  }
})
