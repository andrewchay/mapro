import { describe, test, expect } from 'bun:test'
import { createJWTService } from './jwt-service.ts'
import type { JWTPayload } from './types.ts'

describe('JWTService', () => {
  test('签发并验证 token', () => {
    const jwt = createJWTService({ secret: 'secret-a', accessTokenTtlSeconds: 60 })
    const token = jwt.sign({
      sub: 'user-1',
      email: 'a@test.com',
      tenantId: 'default',
      roles: ['admin'],
      permissions: ['campaign:read'],
    })

    const payload = jwt.verify(token)
    expect(payload.sub).toBe('user-1')
    expect(payload.email).toBe('a@test.com')
    expect(payload.permissions).toContain('campaign:read')
    expect(payload.exp - payload.iat).toBe(60)
  })

  test('过期 token 校验失败', () => {
    const jwt = createJWTService({ secret: 'secret-b', accessTokenTtlSeconds: -1 })
    const token = jwt.sign({
      sub: 'user-1',
      email: 'a@test.com',
      tenantId: 'default',
      roles: [],
      permissions: [],
    })

    expect(() => jwt.verify(token)).toThrow(/过期|expired/i)
  })

  test('不同 secret 签发的 token 无法验证', () => {
    const signer = createJWTService({ secret: 'secret-1', accessTokenTtlSeconds: 60 })
    const verifier = createJWTService({ secret: 'secret-2', accessTokenTtlSeconds: 60 })
    const token = signer.sign({
      sub: 'user-1',
      email: 'a@test.com',
      tenantId: 'default',
      roles: [],
      permissions: [],
    })

    expect(() => verifier.verify(token)).toThrow(/签名|signature/i)
  })

  test('篡改 payload 导致验证失败', () => {
    const jwt = createJWTService({ secret: 'secret-c', accessTokenTtlSeconds: 60 })
    const token = jwt.sign({
      sub: 'user-1',
      email: 'a@test.com',
      tenantId: 'default',
      roles: [],
      permissions: [],
    })

    const tampered = token.replace(/[A-Za-z0-9_-]+$/, 'bad-signature')
    expect(() => jwt.verify(tampered)).toThrow()
  })
})
