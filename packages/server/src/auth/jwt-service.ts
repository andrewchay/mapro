/**
 * JWT 服务（HS256）
 *
 * 使用 Node.js 内置 crypto 实现，避免引入外部 JWT 库。
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { JWTPayload, JWTConfig } from './types.ts'

const ALGORITHM = 'HS256'
const TOKEN_TYPE = 'JWT'

function base64UrlEncode(input: Buffer | string): string {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf-8')
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4)
  return Buffer.from(normalized + padding, 'base64')
}

function hmacSha256(message: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(message).digest()
}

export interface SignOptions {
  secret: string
  expiresInSeconds: number
  issuer?: string
  audience?: string
}

export interface JWTService {
  sign(payload: Omit<JWTPayload, 'iat' | 'exp' | 'jti'>): string
  verify(token: string): JWTPayload
}

export function createJWTService(config: JWTConfig): JWTService {
  return {
    sign(payload: Omit<JWTPayload, 'iat' | 'exp' | 'jti'>): string {
      const now = Math.floor(Date.now() / 1000)
      const fullPayload: JWTPayload = {
        ...payload,
        jti: randomUUID(),
        iat: now,
        exp: now + config.accessTokenTtlSeconds,
      }

      const header = { alg: ALGORITHM, typ: TOKEN_TYPE }
      const encodedHeader = base64UrlEncode(JSON.stringify(header))
      const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload))
      const signingInput = `${encodedHeader}.${encodedPayload}`
      const signature = hmacSha256(signingInput, config.secret)
      const encodedSignature = base64UrlEncode(signature)

      return `${signingInput}.${encodedSignature}`
    },

    verify(token: string): JWTPayload {
      const parts = token.split('.')
      if (parts.length !== 3) {
        throw new Error('JWT 格式错误')
      }

      const encodedHeader = parts[0]
      const encodedPayload = parts[1]
      const encodedSignature = parts[2]
      if (!encodedHeader || !encodedPayload || !encodedSignature) {
        throw new Error('JWT 格式错误')
      }

      let header: Record<string, unknown>
      try {
        header = JSON.parse(base64UrlDecode(encodedHeader).toString('utf-8')) as Record<string, unknown>
      } catch {
        throw new Error('JWT Header 解析失败')
      }

      if (header.alg !== ALGORITHM) {
        throw new Error(`不支持的 JWT 算法: ${header.alg}`)
      }

      const signingInput = `${encodedHeader}.${encodedPayload}`
      const expectedSignature = hmacSha256(signingInput, config.secret)
      const actualSignature = base64UrlDecode(encodedSignature)

      if (expectedSignature.length !== actualSignature.length) {
        throw new Error('JWT 签名无效')
      }

      if (!timingSafeEqual(expectedSignature, actualSignature)) {
        throw new Error('JWT 签名无效')
      }

      let payload: JWTPayload
      try {
        payload = JSON.parse(base64UrlDecode(encodedPayload).toString('utf-8')) as JWTPayload
      } catch {
        throw new Error('JWT Payload 解析失败')
      }

      const now = Math.floor(Date.now() / 1000)
      if (payload.exp !== undefined && payload.exp < now) {
        throw new Error('JWT 已过期')
      }

      if (config.issuer && payload.iss !== config.issuer) {
        throw new Error('JWT issuer 不匹配')
      }

      if (config.audience && payload.aud !== config.audience) {
        throw new Error('JWT audience 不匹配')
      }

      return payload
    },
  }
}
