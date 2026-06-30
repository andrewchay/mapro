/**
 * security.ts 单元测试
 *
 * 验证 HTTP Bearer Token、WebSocket Token 解析、CORS origin 策略。
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import type { IncomingMessage } from 'node:http'
import {
  validateBearerToken,
  parseWebSocketToken,
  isValidWebSocketToken,
  isLocalOrigin,
  createCorsOptions,
  getApiTokenFromCookies,
  API_TOKEN_COOKIE_NAME,
} from './security.ts'

describe('validateBearerToken', () => {
  const originalToken = process.env.MAPRO_API_TOKEN

  afterEach(() => {
    if (originalToken !== undefined) {
      process.env.MAPRO_API_TOKEN = originalToken
    } else {
      delete process.env.MAPRO_API_TOKEN
    }
  })

  test('未配置 token 时任意请求都通过', () => {
    delete process.env.MAPRO_API_TOKEN
    expect(validateBearerToken(undefined)).toBe(true)
    expect(validateBearerToken('Bearer anything')).toBe(true)
  })

  test('配置 token 后仅正确 Bearer Token 通过', () => {
    process.env.MAPRO_API_TOKEN = 'secret-token'
    expect(validateBearerToken(undefined)).toBe(false)
    expect(validateBearerToken('Bearer wrong')).toBe(false)
    expect(validateBearerToken('secret-token')).toBe(false)
    expect(validateBearerToken('Bearer secret-token')).toBe(true)
  })
})

describe('parseWebSocketToken', () => {
  test('从 query string 解析 token', () => {
    const req = { url: '/?token=ws-token' } as IncomingMessage
    expect(parseWebSocketToken(req)).toBe('ws-token')
  })

  test('无 token 返回 undefined', () => {
    const req = { url: '/' } as IncomingMessage
    expect(parseWebSocketToken(req)).toBeUndefined()
  })

  test('保留 URL 中其他 query 参数', () => {
    const req = { url: '/?foo=bar&token=abc&baz=qux' } as IncomingMessage
    expect(parseWebSocketToken(req)).toBe('abc')
  })

  test('从 httpOnly Cookie 解析 token', () => {
    const req = { url: '/', headers: { cookie: `${API_TOKEN_COOKIE_NAME}=cookie-token` } } as IncomingMessage
    expect(parseWebSocketToken(req)).toBe('cookie-token')
  })

  test('query token 优先于 cookie token', () => {
    const req = {
      url: '/?token=query-token',
      headers: { cookie: `${API_TOKEN_COOKIE_NAME}=cookie-token` },
    } as IncomingMessage
    expect(parseWebSocketToken(req)).toBe('query-token')
  })
})

describe('getApiTokenFromCookies', () => {
  test('无 cookie 返回 undefined', () => {
    const req = { headers: {} } as IncomingMessage
    expect(getApiTokenFromCookies(req)).toBeUndefined()
  })

  test('从多段 cookie 中解析 token', () => {
    const req = {
      headers: { cookie: `other=1; ${API_TOKEN_COOKIE_NAME}=secret%20token; foo=2` },
    } as IncomingMessage
    expect(getApiTokenFromCookies(req)).toBe('secret token')
  })
})

describe('isValidWebSocketToken', () => {
  const originalToken = process.env.MAPRO_API_TOKEN

  afterEach(() => {
    if (originalToken !== undefined) {
      process.env.MAPRO_API_TOKEN = originalToken
    } else {
      delete process.env.MAPRO_API_TOKEN
    }
  })

  test('未配置 token 时任意 token 通过', () => {
    delete process.env.MAPRO_API_TOKEN
    expect(isValidWebSocketToken(undefined)).toBe(true)
    expect(isValidWebSocketToken('anything')).toBe(true)
  })

  test('配置 token 后仅匹配值通过', () => {
    process.env.MAPRO_API_TOKEN = 'ws-secret'
    expect(isValidWebSocketToken(undefined)).toBe(false)
    expect(isValidWebSocketToken('wrong')).toBe(false)
    expect(isValidWebSocketToken('ws-secret')).toBe(true)
  })
})

describe('isLocalOrigin', () => {
  test('识别 localhost / 127.0.0.1 的 http/https 地址', () => {
    expect(isLocalOrigin('http://localhost:3000')).toBe(true)
    expect(isLocalOrigin('http://localhost')).toBe(true)
    expect(isLocalOrigin('https://127.0.0.1:8081')).toBe(true)
  })

  test('拒绝外部 origin', () => {
    expect(isLocalOrigin('https://example.com')).toBe(false)
    expect(isLocalOrigin('http://192.168.1.1')).toBe(false)
  })
})

describe('createCorsOptions origin 策略', () => {
  const originalToken = process.env.MAPRO_API_TOKEN
  const originalAllowedOrigins = process.env.MAPRO_ALLOWED_ORIGINS

  function callOrigin(
    options: ReturnType<typeof createCorsOptions>,
    origin: string,
    callback: (err: Error | null, allow: boolean) => void,
  ): void {
    const originFn = options.origin as (origin: string, callback: (err: Error | null, allow: boolean) => void) => void
    originFn(origin, callback)
  }

  beforeEach(() => {
    delete process.env.MAPRO_API_TOKEN
    delete process.env.MAPRO_ALLOWED_ORIGINS
  })

  afterEach(() => {
    if (originalToken !== undefined) {
      process.env.MAPRO_API_TOKEN = originalToken
    } else {
      delete process.env.MAPRO_API_TOKEN
    }
    if (originalAllowedOrigins !== undefined) {
      process.env.MAPRO_ALLOWED_ORIGINS = originalAllowedOrigins
    } else {
      delete process.env.MAPRO_ALLOWED_ORIGINS
    }
  })

  test('无 token 时允许本地 origin', (done) => {
    const options = createCorsOptions()
    callOrigin(options, 'http://localhost:3000', (err, allow) => {
      expect(err).toBeNull()
      expect(allow).toBe(true)
      done()
    })
  })

  test('无 token 时拒绝外部 origin', (done) => {
    const options = createCorsOptions()
    callOrigin(options, 'https://evil.com', (err, allow) => {
      expect(err).toBeInstanceOf(Error)
      expect(allow).toBe(false)
      done()
    })
  })

  test('有 token 时默认拒绝跨域', (done) => {
    process.env.MAPRO_API_TOKEN = 'secret'
    const options = createCorsOptions()
    callOrigin(options, 'http://localhost:3000', (err, allow) => {
      expect(err).toBeInstanceOf(Error)
      expect(allow).toBe(false)
      done()
    })
  })

  test('MAPRO_ALLOWED_ORIGINS 显式放行', (done) => {
    process.env.MAPRO_ALLOWED_ORIGINS = 'https://app.example.com,https://admin.example.com'
    const options = createCorsOptions()
    callOrigin(options, 'https://admin.example.com', (err, allow) => {
      expect(err).toBeNull()
      expect(allow).toBe(true)
      done()
    })
  })
})
