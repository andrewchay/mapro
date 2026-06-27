/**
 * Token 估算测试
 *
 * 验证 estimateTokenCount / isCjkCodePoint 的字符级启发式估算，
 * 用于在 canUseTool 中拦截可能因 token 截断而失败的大文件写入。
 * 估算偏保守：宁可高估触发分块，也不要低估导致截断。
 */

import { describe, it, expect } from 'bun:test'
import {
  estimateTokenCount,
  isCjkCodePoint,
  WRITE_CONTENT_TOKEN_THRESHOLD,
} from './agent-tool-token-estimator.ts'

describe('Token 估算', () => {
  describe('isCjkCodePoint 中日韩字符识别', () => {
    const cjkCases: Array<[string, number]> = [
      ['CJK 统一汉字 一', 0x4E00],
      ['CJK 统一汉字 龥', 0x9FFF],
      ['CJK 符号标点 、', 0x3001],
      ['全角数字 １', 0xFF11],
      ['韩文音节 가', 0xAC00],
      ['平假名 あ', 0x3042],
      ['片假名 ア', 0x30A2],
      ['CJK 扩展 A', 0x3400],
      ['CJK 扩展 B', 0x20000],
    ]

    for (const [name, cp] of cjkCases) {
      it(`Given ${name} when 判定 then 是 CJK`, () => {
        expect(isCjkCodePoint(cp)).toBe(true)
      })
    }

    const nonCjkCases: Array<[string, number]> = [
      ['ASCII 字母', 0x41], // 'A'
      ['ASCII 数字', 0x30], // '0'
      ['西里尔字母', 0x0410], // 'А'
      ['CJK 区间外 0x4DC0', 0x4DC0], // 易混淆的易经卦象区，不在 CJK 范围
      ['0x2A6E0 扩展 B 之外', 0x2A6E0],
    ]

    for (const [name, cp] of nonCjkCases) {
      it(`Given ${name} when 判定 then 非 CJK`, () => {
        expect(isCjkCodePoint(cp)).toBe(false)
      })
    }
  })

  describe('estimateTokenCount 各类文本估算', () => {
    it('Given 空字符串 when 估算 then 返回 0', () => {
      expect(estimateTokenCount('')).toBe(0)
    })

    it('Given 纯 ASCII when 估算 then 约 0.25 tokens/char', () => {
      const text = 'a'.repeat(100)
      const tokens = estimateTokenCount(text)
      expect(tokens).toBe(25) // ceil(100 * 0.25)
    })

    it('Given 纯 CJK when 估算 then 约 1.5 tokens/char（偏保守）', () => {
      const text = '一'.repeat(100)
      const tokens = estimateTokenCount(text)
      expect(tokens).toBe(150) // ceil(100 * 1.5)
    })

    it('Given 混合文本 when 估算 then 按字符类型分别累加', () => {
      // 4 ASCII + 2 CJK = 4*0.25 + 2*1.5 = 1 + 3 = 4
      expect(estimateTokenCount('abcd你好')).toBe(4)
    })

    it('Given 含 emoji（代理对）when 估算 then 按码点正确计数', () => {
      // 😀 是代理对，for...of 按码点遍历，应算 1 个 other 字符
      const tokens = estimateTokenCount('😀')
      expect(tokens).toBe(1) // ceil(1 * 0.75) = 1
    })

    it('Given 非 ASCII 非 CJK（西文）when 估算 then 约 0.75 tokens/char', () => {
      // 西里尔字母 4 个 = ceil(4 * 0.75) = 3
      expect(estimateTokenCount('АБВГ')).toBe(3)
    })
  })

  describe('保守性（高估而非低估）', () => {
    it('Given 等长 ASCII 与 CJK when 比较 then CJK 估算显著更高', () => {
      const ascii = 'a'.repeat(1000)
      const cjk = '一'.repeat(1000)
      expect(estimateTokenCount(cjk)).toBeGreaterThan(estimateTokenCount(ascii) * 4)
    })

    it('WRITE_CONTENT_TOKEN_THRESHOLD 是合理的大文件写入门槛', () => {
      // 16000 tokens 对应约 64KB ASCII 或约 10KB CJK，符合分块写入触发点
      expect(WRITE_CONTENT_TOKEN_THRESHOLD).toBe(16_000)
      expect(WRITE_CONTENT_TOKEN_THRESHOLD).toBeGreaterThan(0)
    })

    it('给定刚超阈值的内容能被识别为需要分块', () => {
      // 构造刚好超过 16000 token 的 CJK 文本：16000/1.5 ≈ 10667 字符
      const text = '一'.repeat(11000)
      expect(estimateTokenCount(text)).toBeGreaterThan(WRITE_CONTENT_TOKEN_THRESHOLD)
    })

    it('给定阈值以下的内容不被误判为超限', () => {
      const text = 'a'.repeat(1000) // 250 tokens
      expect(estimateTokenCount(text)).toBeLessThan(WRITE_CONTENT_TOKEN_THRESHOLD)
    })
  })
})
