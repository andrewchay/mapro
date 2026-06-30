/**
 * 认证状态管理（Jotai）
 */

import { atom } from 'jotai'
import { authAPI } from '../api/auth-api.ts'
import type { AuthUser } from '../api/auth-api.ts'
import { getAccessToken, setAccessToken, clearAccessToken } from './token-store.ts'

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

/** 初始化认证状态：优先尝试 /auth/me（支持服务账号 Token 的 httpOnly Cookie），失败后回退到 refresh cookie */
export function createAuthInitializeAtom() {
  return atom(null, async (_get, set) => {
    try {
      // 页面刷新后内存 access token 丢失，先尝试直接 /auth/me（服务账号 Token 可通过 httpOnly Cookie 自动通过）
      // 失败后回退到 refresh cookie 恢复 JWT access token
      if (!getAccessToken()) {
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
          return
        } catch {
          // 继续尝试 refresh cookie
        }

        try {
          const refreshResult = await authAPI.refresh()
          setAccessToken(refreshResult.accessToken)
        } catch {
          // 无有效 refresh cookie，结束加载态并展示登录页
          set(authStateAtom, (prev) => ({ ...prev, isLoading: false, isAuthenticated: false }))
          return
        }
      }

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
      clearAccessToken()
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
