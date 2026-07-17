/**
 * Python 脚本执行环境白名单测试
 *
 * 回归：LLM 生成的脚本不得以子进程方式继承 API Key 等敏感环境变量。
 */

import { describe, test, expect } from 'bun:test'
import { buildScriptEnv } from '../browser-automation/script-env.ts'

describe('buildScriptEnv 环境白名单', () => {
  test('白名单变量被保留', () => {
    process.env.PATH = '/usr/bin:/bin'
    process.env.HTTP_PROXY = 'http://127.0.0.1:7890'

    const env = buildScriptEnv({})

    expect(env.PATH).toBe('/usr/bin:/bin')
    expect(env.HTTP_PROXY).toBe('http://127.0.0.1:7890')
  })

  test('敏感环境变量被剔除', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-secret'
    process.env.MAPRO_API_TOKEN = 'token-secret'
    process.env.MY_CUSTOM_SECRET = 'secret'

    const env = buildScriptEnv({})

    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.MAPRO_API_TOKEN).toBeUndefined()
    expect(env.MY_CUSTOM_SECRET).toBeUndefined()

    delete process.env.ANTHROPIC_API_KEY
    delete process.env.MAPRO_API_TOKEN
    delete process.env.MY_CUSTOM_SECRET
  })

  test('显式传入的业务参数原样透传', () => {
    const env = buildScriptEnv({ HEADLESS: 'true', COOKIES_FILE: '/tmp/c.json' })

    expect(env.HEADLESS).toBe('true')
    expect(env.COOKIES_FILE).toBe('/tmp/c.json')
  })
})
