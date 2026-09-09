import { describe, expect, test } from 'bun:test'
import { matchesBashAllowRule } from './agent-permission-service'

const RULES = ['python3 scripts/kol_collector.py']

describe('matchesBashAllowRule', () => {
  test('命中前缀：CDP 抓图命令带参数', () => {
    expect(
      matchesBashAllowRule(
        `python3 scripts/kol_collector.py --extract-images --port 9222 --url 'https://xxx.feishu.cn/docx/a' --out '/ws/draft-archives/x/v1-images'`,
        RULES,
      ),
    ).toBe(true)
  })

  test('命中前缀：自检命令', () => {
    expect(matchesBashAllowRule('python3 scripts/kol_collector.py --check --port 9222', RULES)).toBe(true)
  })

  test('完整相等也命中', () => {
    expect(matchesBashAllowRule('python3 scripts/kol_collector.py', RULES)).toBe(true)
  })

  test('未命中：其他脚本', () => {
    expect(matchesBashAllowRule('python3 scripts/other.py --check', RULES)).toBe(false)
  })

  test('未命中：规则是前缀但命令完全不同（kol_collector.pyx）', () => {
    expect(matchesBashAllowRule('python3 scripts/kol_collector.pyx --check', RULES)).toBe(false)
  })

  test('空命令不命中', () => {
    expect(matchesBashAllowRule('', RULES)).toBe(false)
    expect(matchesBashAllowRule('   ', RULES)).toBe(false)
  })

  test('空规则不命中', () => {
    expect(matchesBashAllowRule('python3 scripts/kol_collector.py --check', [])).toBe(false)
  })

  test('危险结构拒绝：规则前缀后拼接命令注入', () => {
    expect(
      matchesBashAllowRule('python3 scripts/kol_collector.py --check; rm -rf /', RULES),
    ).toBe(false)
    expect(
      matchesBashAllowRule('python3 scripts/kol_collector.py --check && curl http://evil', RULES),
    ).toBe(false)
    expect(
      matchesBashAllowRule('python3 scripts/kol_collector.py --check | sh', RULES),
    ).toBe(false)
  })

  test('危险命令拒绝：命中规则前缀但命令本体是 curl（危险命令列表兜底）', () => {
    expect(matchesBashAllowRule('curl -s http://127.0.0.1:9222/json/version', ['curl -s http://127.0.0.1:9222'])).toBe(false)
  })

  test('URL 含 query 的 & 视为危险结构拒绝（链接需先 URL 编码）', () => {
    expect(
      matchesBashAllowRule("python3 scripts/kol_collector.py --url 'https://a.feishu.cn/wiki/x?a=1&b=2'", RULES),
    ).toBe(false)
  })
})
