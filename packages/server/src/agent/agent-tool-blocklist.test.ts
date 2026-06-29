import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { AgentToolBlocklist } from './agent-tool-blocklist.ts'

describe('AgentToolBlocklist', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.MAPRO_AGENT_DISABLED_TOOLS
    delete process.env.MAPRO_AGENT_DISABLED_BASH_PATTERNS
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  test('未配置时允许所有工具', () => {
    const blocklist = new AgentToolBlocklist()
    expect(blocklist.check('Bash', { command: 'ls' }).blocked).toBe(false)
    expect(blocklist.check('Write', { file_path: '/tmp/test.md' }).blocked).toBe(false)
  })

  test('禁用整个工具', () => {
    const blocklist = new AgentToolBlocklist({ disabledTools: ['Bash'] })
    const result = blocklist.check('Bash', { command: 'ls' })
    expect(result.blocked).toBe(true)
    expect(result.ruleType).toBe('tool')
    expect(result.matchedRule).toBe('Bash')
  })

  test('禁用多个工具', () => {
    const blocklist = new AgentToolBlocklist({ disabledTools: ['NotebookEdit', 'Task'] })
    expect(blocklist.check('NotebookEdit', {}).blocked).toBe(true)
    expect(blocklist.check('Task', {}).blocked).toBe(true)
    expect(blocklist.check('Write', {}).blocked).toBe(false)
  })

  test('禁用 Bash 命令前缀', () => {
    const blocklist = new AgentToolBlocklist({ disabledBashPatterns: ['rm', 'sudo'] })
    expect(blocklist.check('Bash', { command: 'rm -rf /tmp' }).blocked).toBe(true)
    expect(blocklist.check('Bash', { command: 'sudo apt-get update' }).blocked).toBe(true)
    expect(blocklist.check('Bash', { command: 'ls -la' }).blocked).toBe(false)
  })

  test('在管道/连接中检测禁用命令', () => {
    const blocklist = new AgentToolBlocklist({ disabledBashPatterns: ['curl'] })
    expect(blocklist.check('Bash', { command: 'echo start | curl http://x.com' }).blocked).toBe(true)
    expect(blocklist.check('Bash', { command: 'echo start; curl http://x.com' }).blocked).toBe(true)
    expect(blocklist.check('Bash', { command: 'echo start && curl http://x.com' }).blocked).toBe(true)
  })

  test('环境变量配置生效', () => {
    process.env.MAPRO_AGENT_DISABLED_TOOLS = 'Bash,NotebookEdit'
    process.env.MAPRO_AGENT_DISABLED_BASH_PATTERNS = 'curl,wget'

    const blocklist = new AgentToolBlocklist()
    expect(blocklist.check('Bash', {}).blocked).toBe(true)
    expect(blocklist.check('NotebookEdit', {}).blocked).toBe(true)
    expect(blocklist.check('Bash', { command: 'curl http://x.com' }).blocked).toBe(true)
  })

  test('显式配置覆盖环境变量', () => {
    process.env.MAPRO_AGENT_DISABLED_TOOLS = 'Bash'
    const blocklist = new AgentToolBlocklist({ disabledTools: ['Write'] })
    expect(blocklist.check('Bash', {}).blocked).toBe(false)
    expect(blocklist.check('Write', {}).blocked).toBe(true)
  })

  test('返回的配置副本独立', () => {
    const blocklist = new AgentToolBlocklist({ disabledTools: ['Bash'] })
    const config = blocklist.getConfig()
    config.disabledTools.push('Write')
    expect(blocklist.getConfig().disabledTools).toEqual(['Bash'])
  })
})
