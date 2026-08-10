/**
 * error-patterns 错误分类单测
 *
 * 覆盖本次「LLM 请求挂起/Key 无效」修复新增的判定：
 * - isAuthorizationFailure：401/403/API Key 无效 → 永不重试、直接透出
 * - isTimeoutLikeError：ETIMEDOUT/超时/停滞 → 限制重试次数
 * - isTransientNetworkError：仍是瞬时网络错误判定（回归）
 */
import { describe, it, expect } from 'bun:test'
import {
  isAuthorizationFailure,
  isTimeoutLikeError,
  isTransientNetworkError,
  AUTHORIZATION_FAILURE_PATTERN,
  TIMEOUT_LIKE_PATTERN,
} from '../error-patterns'

describe('isAuthorizationFailure（Key 无效/未授权）', () => {
  it('HTTP 401 / 403 明确判定为鉴权失败', () => {
    expect(isAuthorizationFailure('deepseek API 错误 (401): Authentication Fails...')).toBe(true)
    expect(isAuthorizationFailure('403 Forbidden')).toBe(true)
    expect(isAuthorizationFailure('API 错误 (401):\n{"error":{"message":"invalid api key"}}')).toBe(true)
  })

  it('“Invalid API key”文案命中', () => {
    expect(isAuthorizationFailure('Invalid API key. Please check your credentials.')).toBe(true)
    expect(isAuthorizationFailure('Your api key ****QAIA is invalid')).toBe(true)
  })

  it('普通错误文案不误判为鉴权失败', () => {
    expect(isAuthorizationFailure('LLM 响应超时，请重试')).toBe(false)
    expect(isAuthorizationFailure('stream ended prematurely')).toBe(false)
    expect(isAuthorizationFailure(undefined, '')).toBe(false)
  })
})

describe('isTimeoutLikeError（超时/停滞挂起）', () => {
  it('ETIMEDOUT 与流停滞命中', () => {
    expect(isTimeoutLikeError('ETIMEDOUT: SSE 连接超时（45 秒未收到响应头）')).toBe(true)
    expect(isTimeoutLikeError('ETIMEDOUT: SSE 流空闲超时（60 秒无有效数据）')).toBe(true)
    expect(isTimeoutLikeError('请求超时')).toBe(true)
  })

  it('普通请求错误不误判为超时', () => {
    expect(isTimeoutLikeError('API 错误 (401): invalid api key')).toBe(false)
    expect(isTimeoutLikeError('ECONNRESET')).toBe(false)
  })
})

describe('isTransientNetworkError（瞬时网络错误，回归）', () => {
  it('ECONNRESET / terminated 仍判定为瞬时错误', () => {
    expect(isTransientNetworkError('socket hang up')).toBe(true)
    expect(isTransientNetworkError('terminated')).toBe(true)
  })
})

describe('正则模式可用性', () => {
  it('模式已导出且可执行', () => {
    expect(AUTHORIZATION_FAILURE_PATTERN instanceof RegExp).toBe(true)
    expect(TIMEOUT_LIKE_PATTERN instanceof RegExp).toBe(true)
  })
})

describe('语义：鉴权失败时不卡在超时分支（回归护栏）', () => {
  // 修复的关键点：同一段错误文本，鉴权识别应优先于超时识别，
  // 避免 401 被当成可重试的超时/瞬时错误吞进循环。
  it('401 错误文本命中鉴权但不应命中“可重试的超时”', () => {
    const msg = 'deepseek API 错误 (401): Authentication Fails'
    expect(isAuthorizationFailure(msg)).toBe(true)
    // 401 不包含 ETIMEDOUT 等超时关键词（不误判为可重试超时）
    expect(isTimeoutLikeError(msg)).toBe(false)
  })
})
