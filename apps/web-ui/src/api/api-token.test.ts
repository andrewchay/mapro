/**
 * api-token.ts 单元测试
 *
 * 验证 getApiToken / setApiToken / clearApiToken 的 localStorage 行为。
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { getApiToken, setApiToken, clearApiToken } from './api-token.ts'

describe('api-token', () => {
  beforeEach(() => {
    clearApiToken()
  })

  test('初始无 token 返回 undefined', () => {
    clearApiToken()
    expect(getApiToken()).toBeUndefined()
  })

  test('setApiToken 持久化到 localStorage', () => {
    setApiToken('my-token')
    expect(getApiToken()).toBe('my-token')
  })

  test('clearApiToken 清除存储', () => {
    setApiToken('my-token')
    clearApiToken()
    expect(getApiToken()).toBeUndefined()
  })
})

describe('webAPI Authorization header', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    clearApiToken()
    // 恢复可能被 React 组件测试全局 mock 的 web-api 模块
    mock.restore()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    clearApiToken()
  })

  test('未配置 token 时不发送 Authorization', async () => {
    // 使用 query 参数绕过可能被 React 组件测试 mock 的模块缓存
    // @ts-ignore 动态导入带 query 参数用于绕过模块缓存，TypeScript 静态解析会报错
    const { webAPI } = await import('./web-api.ts?no-mock')
    let capturedHeaders: Record<string, string> | undefined
    const fetchMock = mock((_url, options) => {
      capturedHeaders = options?.headers as Record<string, string> | undefined
      return Promise.resolve(new Response(JSON.stringify({ campaigns: [] }), { status: 200 }))
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await webAPI.listCampaigns()

    expect(capturedHeaders?.Authorization).toBeUndefined()
  })

  test('配置 token 后 fetch 携带 Bearer Authorization', async () => {
    // @ts-ignore 动态导入带 query 参数用于绕过模块缓存，TypeScript 静态解析会报错
    const { webAPI } = await import('./web-api.ts?no-mock')
    setApiToken('rest-token')
    let capturedHeaders: Record<string, string> | undefined
    const fetchMock = mock((_url, options) => {
      capturedHeaders = options?.headers as Record<string, string> | undefined
      return Promise.resolve(new Response(JSON.stringify({ campaigns: [] }), { status: 200 }))
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await webAPI.listCampaigns()

    expect(capturedHeaders?.Authorization).toBe('Bearer rest-token')
  })
})
