import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import {
  parseMemoryString,
  resolveAgentResourceLimits,
  buildDockerResourceArgs,
  buildNativeUlimitCommand,
  DEFAULT_AGENT_RESOURCE_LIMITS,
} from './agent-resource-limits.ts'

describe('parseMemoryString', () => {
  test('应解析纯数字为字节', () => {
    expect(parseMemoryString('512')).toBe(512)
  })

  test('应解析 KB', () => {
    expect(parseMemoryString('2K')).toBe(2 * 1024)
    expect(parseMemoryString('2kb')).toBe(2 * 1024)
  })

  test('应解析 MB', () => {
    expect(parseMemoryString('512M')).toBe(512 * 1024 * 1024)
    expect(parseMemoryString('512mb')).toBe(512 * 1024 * 1024)
  })

  test('应解析 GB', () => {
    expect(parseMemoryString('1G')).toBe(1024 * 1024 * 1024)
  })

  test('非法值返回 undefined', () => {
    expect(parseMemoryString('abc')).toBeUndefined()
    expect(parseMemoryString('-1')).toBeUndefined()
  })
})

describe('resolveAgentResourceLimits', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.MAPRO_AGENT_CPU
    delete process.env.MAPRO_AGENT_MEMORY
    delete process.env.MAPRO_AGENT_NETWORK
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  test('无配置时使用默认值', () => {
    const limits = resolveAgentResourceLimits()
    expect(limits.cpu).toBe(DEFAULT_AGENT_RESOURCE_LIMITS.cpu)
    expect(limits.memoryBytes).toBe(DEFAULT_AGENT_RESOURCE_LIMITS.memoryBytes)
    expect(limits.networkMode).toBe(DEFAULT_AGENT_RESOURCE_LIMITS.networkMode)
  })

  test('运行选项优先级最高', () => {
    process.env.MAPRO_AGENT_CPU = '4'
    process.env.MAPRO_AGENT_MEMORY = '1G'
    process.env.MAPRO_AGENT_NETWORK = 'bridge'

    const limits = resolveAgentResourceLimits({ cpu: 0.5, memoryBytes: 128 * 1024 * 1024, networkMode: 'host' })
    expect(limits.cpu).toBe(0.5)
    expect(limits.memoryBytes).toBe(128 * 1024 * 1024)
    expect(limits.networkMode).toBe('host')
  })

  test('环境变量次之', () => {
    process.env.MAPRO_AGENT_CPU = '2'
    process.env.MAPRO_AGENT_MEMORY = '256M'
    process.env.MAPRO_AGENT_NETWORK = 'bridge'

    const limits = resolveAgentResourceLimits()
    expect(limits.cpu).toBe(2)
    expect(limits.memoryBytes).toBe(256 * 1024 * 1024)
    expect(limits.networkMode).toBe('bridge')
  })

  test('非法环境变量回退到默认值', () => {
    process.env.MAPRO_AGENT_CPU = 'abc'
    process.env.MAPRO_AGENT_MEMORY = 'xxx'

    const limits = resolveAgentResourceLimits()
    expect(limits.cpu).toBe(DEFAULT_AGENT_RESOURCE_LIMITS.cpu)
    expect(limits.memoryBytes).toBe(DEFAULT_AGENT_RESOURCE_LIMITS.memoryBytes)
  })
})

describe('buildDockerResourceArgs', () => {
  test('应生成完整的 Docker 资源限制参数', () => {
    const args = buildDockerResourceArgs({
      cpu: 0.5,
      memoryBytes: 256 * 1024 * 1024,
      networkMode: 'none',
    })
    expect(args).toEqual([
      '--cpus', '0.5',
      '--memory', `${256 * 1024 * 1024}b`,
      '--network', 'none',
    ])
  })

  test('未配置的资源不生成参数', () => {
    const args = buildDockerResourceArgs({ cpu: 1 })
    expect(args).toEqual(['--cpus', '1'])
  })
})

describe('buildNativeUlimitCommand', () => {
  test('应生成带 ulimit 的 sh 命令', () => {
    const { command, args } = buildNativeUlimitCommand(
      { cpu: 1, memoryBytes: 512 * 1024 * 1024 },
      '/usr/local/bin/claude',
      ['query', 'hello world'],
    )
    expect(command).toBe('sh')
    expect(args).toHaveLength(2)
    expect(args[0]).toBe('-c')
    const script = args[1]!
    expect(script).toContain('ulimit -t')
    expect(script).toContain('ulimit -v')
    expect(script).toContain("exec /usr/local/bin/claude query 'hello world'")
  })

  test('无资源限制时直接 exec', () => {
    const { command, args } = buildNativeUlimitCommand(
      {},
      '/usr/local/bin/claude',
      ['query', 'hello'],
    )
    expect(args[1]).toBe("exec /usr/local/bin/claude query hello")
  })

  test('应对特殊字符做转义', () => {
    const { args } = buildNativeUlimitCommand(
      { cpu: 0.5 },
      '/path/with space/claude',
      ['query', "it's ok"],
    )
    expect(args[1]).toContain("'/path/with space/claude'")
    expect(args[1]).toContain("'it'\\''s ok'")
  })
})
