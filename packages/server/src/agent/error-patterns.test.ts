/**
 * 瞬时网络错误判定测试
 *
 * 验证 isTransientNetworkError 能正确识别上游 API 抖动错误，
 * 避免把瞬时错误当永久错误处理。这些模式决定了 Orchestrator 是否重试。
 */

import { describe, it, expect } from 'bun:test'
import { isTransientNetworkError, TRANSIENT_NETWORK_PATTERN } from './error-patterns.ts'

describe('瞬时网络错误判定', () => {
  describe('识别各类瞬时错误', () => {
    const transientCases: Array<[string, string]> = [
      ['SSE 流终止', 'The SSE stream was terminated'],
      ['TCP 连接重置', 'socket hang up'],
      ['ECONNRESET', 'write ECONNRESET'],
      ['ETIMEDOUT', 'connect ETIMEDOUT 1.2.3.4:443'],
      ['EPIPE', 'write EPIPE'],
      ['DNS 解析失败', 'getaddrinfo ENOTFOUND api.anthropic.com'],
      ['DNS 临时失败', 'getaddrinfo EAI_AGAIN api.anthropic.com'],
      ['连接被拒绝', 'connect ECONNREFUSED 127.0.0.1:8080'],
      ['fetch 失败', 'fetch failed'],
      ['网络错误', 'network error'],
      ['流提前关闭', 'stream closed prematurely'],
      ['流提前断开', 'stream disconnected prematurely'],
      ['premature close', 'premature close'],
    ]

    for (const [name, message] of transientCases) {
      it(`Given ${name} when 判定 then 识别为瞬时错误`, () => {
        expect(isTransientNetworkError(message)).toBe(true)
      })
    }
  })

  describe('识别非瞬时错误', () => {
    const nonTransientCases: Array<[string, string]> = [
      ['鉴权失败', '401 Unauthorized: invalid api key'],
      ['配额超限', '429 Too Many Requests: rate limit exceeded'],
      ['请求格式错误', '400 Bad Request: invalid model'],
      ['内部服务器错误', '500 Internal Server Error'],
      ['模型不存在', 'model not found'],
      ['空字符串', ''],
    ]

    for (const [name, message] of nonTransientCases) {
      it(`Given ${name} when 判定 then 不识别为瞬时错误`, () => {
        expect(isTransientNetworkError(message)).toBe(false)
      })
    }
  })

  describe('边界情况', () => {
    it('Given 两者均空 when 判定 then 返回 false', () => {
      expect(isTransientNetworkError(undefined, undefined)).toBe(false)
      expect(isTransientNetworkError('', '')).toBe(false)
    })

    it('Given message 为空但 stderr 命中 when 判定 then 返回 true', () => {
      // 子进程场景：错误信息可能在 stderr 而非 message
      expect(isTransientNetworkError(undefined, 'ECONNRESET')).toBe(true)
      expect(isTransientNetworkError('', 'socket hang up')).toBe(true)
    })

    it('Given message 不命中但 stderr 命中 when 判定 then 返回 true', () => {
      expect(isTransientNetworkError('401 Unauthorized', 'fetch failed')).toBe(true)
    })

    it('Given 大小写混合 when 判定 then 不区分大小写识别', () => {
      // 正则带 i 标志
      expect(isTransientNetworkError('FETCH FAILED')).toBe(true)
      expect(isTransientNetworkError('EConnReset')).toBe(true)
    })
  })

  describe('正则导出可用', () => {
    it('TRANSIENT_NETWORK_PATTERN 可独立用于测试', () => {
      expect(TRANSIENT_NETWORK_PATTERN.test('ECONNRESET')).toBe(true)
      expect(TRANSIENT_NETWORK_PATTERN.test('401 Unauthorized')).toBe(false)
    })
  })
})
