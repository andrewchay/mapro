/**
 * 认证状态原子测试
 *
 * 验证页面刷新后 authInitializeAtom 会先调用 refresh，再调 me 恢复登录态。
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { createStore } from 'jotai'

const mockMe = mock(() => Promise.resolve({
  success: true,
  userContext: {
    userId: 'user-1',
    tenantId: 'default',
    roles: ['super_admin'],
    permissions: ['*'],
    isSystemAccount: false,
  },
}))

const mockRefresh = mock(() => Promise.resolve({
  success: true,
  user: { id: 'user-1', email: 'a@b.com', name: 'Admin', status: 'active', tenantId: 'default' },
  accessToken: 'refreshed-token',
  expiresAt: Date.now() + 900_000,
}))

mock.module('../api/auth-api.ts', () => ({
  authAPI: {
    me: mockMe,
    refresh: mockRefresh,
    login: mock(() => Promise.resolve({ success: true, user: {}, accessToken: '', expiresAt: 0 })),
    logout: mock(() => Promise.resolve()),
  },
}))

const tokenStore: { accessToken: string | null } = { accessToken: null }

mock.module('./token-store.ts', () => ({
  getAccessToken: () => tokenStore.accessToken,
  setAccessToken: (token: string) => { tokenStore.accessToken = token },
  clearAccessToken: () => { tokenStore.accessToken = null },
}))

const { authInitializeAtom, authStateAtom } = await import('./auth-atoms.ts')

describe('authInitializeAtom', () => {
  beforeEach(() => {
    tokenStore.accessToken = null
    mockMe.mockClear()
    mockRefresh.mockClear()
  })

  afterEach(() => {
    tokenStore.accessToken = null
  })

  test('无 access token 时先 refresh 再 me', async () => {
    const store = createStore()

    await store.set(authInitializeAtom)

    expect(mockRefresh).toHaveBeenCalledTimes(1)
    expect(mockMe).toHaveBeenCalledTimes(1)
    expect(tokenStore.accessToken).toBe('refreshed-token')
    expect(store.get(authStateAtom).isAuthenticated).toBe(true)
    expect(store.get(authStateAtom).user?.id).toBe('user-1')
  })

  test('内存已有 access token 时直接 me', async () => {
    tokenStore.accessToken = 'existing-token'
    const store = createStore()

    await store.set(authInitializeAtom)

    expect(mockRefresh).toHaveBeenCalledTimes(0)
    expect(mockMe).toHaveBeenCalledTimes(1)
    expect(store.get(authStateAtom).isAuthenticated).toBe(true)
  })

  test('refresh 失败时结束 loading 并视为未登录', async () => {
    mockRefresh.mockImplementationOnce(() => Promise.reject(new Error('no cookie')))

    const store = createStore()

    await store.set(authInitializeAtom)

    expect(mockRefresh).toHaveBeenCalledTimes(1)
    expect(mockMe).toHaveBeenCalledTimes(0)
    expect(store.get(authStateAtom).isLoading).toBe(false)
    expect(store.get(authStateAtom).isAuthenticated).toBe(false)
  })
})
