/**
 * 认证 API
 */

import { getAccessToken, setAccessToken, clearAccessToken } from '../store/token-store.ts'

const AUTH_BASE = import.meta.env.VITE_AUTH_BASE || deriveAuthBase(import.meta.env.VITE_API_BASE)

function deriveAuthBase(apiBase: string | undefined): string {
  if (!apiBase) return '/auth'
  try {
    const url = new URL(apiBase)
    url.pathname = url.pathname.replace(/\/api\/?$/, '/auth')
    return url.toString().replace(/\/$/, '')
  } catch {
    return apiBase.replace(/\/api\/?$/, '/auth') || '/auth'
  }
}

export interface LoginInput {
  email: string
  password: string
}

export interface SetupInput {
  email: string
  password: string
  name?: string
}

export interface AuthUser {
  id: string
  email: string
  name: string
  status: string
  tenantId: string
}

export interface AuthResponse {
  success: boolean
  user: AuthUser
  accessToken: string
  expiresAt: number
}

export interface MeResponse {
  success: boolean
  userContext: {
    userId: string
    tenantId: string
    roles: string[]
    permissions: string[]
    isSystemAccount?: boolean
  }
}

async function fetchAuth<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${AUTH_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HTTP ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

export const authAPI = {
  async setup(input: SetupInput): Promise<AuthUser> {
    const { user } = await fetchAuth<{ success: boolean; user: AuthUser }>('/setup', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    return user
  },

  async login(input: LoginInput): Promise<AuthResponse> {
    const result = await fetchAuth<AuthResponse>('/login', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    setAccessToken(result.accessToken)
    return result
  },

  async refresh(): Promise<AuthResponse> {
    const result = await fetchAuth<AuthResponse>('/refresh', {
      method: 'POST',
    })
    setAccessToken(result.accessToken)
    return result
  },

  async logout(): Promise<void> {
    try {
      await fetchAuth<{ success: boolean }>('/logout', { method: 'POST' })
    } finally {
      clearAccessToken()
    }
  },

  async me(): Promise<MeResponse> {
    return fetchAuth<MeResponse>('/me', {
      headers: {
        Authorization: `Bearer ${getAccessToken() ?? ''}`,
      },
    })
  },
}
