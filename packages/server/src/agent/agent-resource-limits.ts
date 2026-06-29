/**
 * Agent 资源限制配置
 *
 * 为 Docker / Native 两种运行模式提供统一的资源限制抽象：
 * - Docker：通过 `--cpus`、`--memory`、`--network` 限制容器资源
 * - Native：通过 `ulimit` 限制子进程 CPU 时间与虚拟内存
 *
 * 配置来源优先级：运行选项 > 环境变量 > 默认值
 */

/** 资源限制配置 */
export interface AgentResourceLimits {
  /** CPU 核数限制（如 1、0.5） */
  cpu?: number
  /** 内存限制字节数 */
  memoryBytes?: number
  /** Docker 网络模式；native 模式下忽略 */
  networkMode?: 'none' | 'bridge' | 'host' | string
}

/** 解析后的资源限制（保证字段存在，未配置则为 undefined） */
export interface ResolvedAgentResourceLimits {
  cpu?: number
  memoryBytes?: number
  networkMode?: string
}

/** 默认资源限制 */
export const DEFAULT_AGENT_RESOURCE_LIMITS: Required<AgentResourceLimits> = {
  cpu: 1,
  memoryBytes: 512 * 1024 * 1024, // 512 MB
  networkMode: 'none',
}

/**
 * 将人类可读的内存字符串解析为字节数
 *
 * 支持：B、K/KB、M/MB、G/GB（不区分大小写）
 */
export function parseMemoryString(value: string): number | undefined {
  const trimmed = value.trim()
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*([kmgt]?b?)$/i)
  if (!match) return undefined

  const num = Number(match[1])
  if (Number.isNaN(num) || num < 0) return undefined

  const unit = match[2]!.toLowerCase()
  switch (unit) {
    case '':
    case 'b':
      return Math.floor(num)
    case 'k':
    case 'kb':
      return Math.floor(num * 1024)
    case 'm':
    case 'mb':
      return Math.floor(num * 1024 * 1024)
    case 'g':
    case 'gb':
      return Math.floor(num * 1024 * 1024 * 1024)
    default:
      return undefined
  }
}

/**
 * 从环境变量解析 CPU 限制
 */
function resolveCpuFromEnv(): number | undefined {
  const value = process.env.MAPRO_AGENT_CPU
  if (!value) return undefined
  const num = Number(value)
  if (Number.isNaN(num) || num <= 0) return undefined
  return num
}

/**
 * 从环境变量解析内存限制
 */
function resolveMemoryFromEnv(): number | undefined {
  const value = process.env.MAPRO_AGENT_MEMORY
  if (!value) return undefined
  return parseMemoryString(value)
}

/**
 * 从环境变量解析网络模式
 */
function resolveNetworkFromEnv(): string | undefined {
  const value = process.env.MAPRO_AGENT_NETWORK
  if (!value) return undefined
  return value.trim()
}

/**
 * 合并运行选项、环境变量与默认值，得到最终资源限制
 */
export function resolveAgentResourceLimits(
  options?: AgentResourceLimits,
): ResolvedAgentResourceLimits {
  return {
    cpu: options?.cpu ?? resolveCpuFromEnv() ?? DEFAULT_AGENT_RESOURCE_LIMITS.cpu,
    memoryBytes:
      options?.memoryBytes ??
      resolveMemoryFromEnv() ??
      DEFAULT_AGENT_RESOURCE_LIMITS.memoryBytes,
    networkMode:
      options?.networkMode ??
      resolveNetworkFromEnv() ??
      DEFAULT_AGENT_RESOURCE_LIMITS.networkMode,
  }
}

/**
 * 生成 Docker `run` 的资源限制参数
 *
 * 返回数组可直接拼接到 `docker run` 参数列表中。
 */
export function buildDockerResourceArgs(limits: ResolvedAgentResourceLimits): string[] {
  const args: string[] = []
  if (limits.cpu !== undefined) {
    args.push('--cpus', String(limits.cpu))
  }
  if (limits.memoryBytes !== undefined) {
    args.push('--memory', `${limits.memoryBytes}b`)
  }
  if (limits.networkMode !== undefined) {
    args.push('--network', limits.networkMode)
  }
  return args
}

/**
 * 生成 Native 运行时的 ulimit 包装命令
 *
 * 返回 { command, args }，其中 args 已包含原始命令，可直接 spawn('sh', args)。
 */
export function buildNativeUlimitCommand(
  limits: ResolvedAgentResourceLimits,
  originalCommand: string,
  originalArgs: string[],
): { command: string; args: string[] } {
  const ulimitCommands: string[] = []

  // CPU 时间限制（秒）
  if (limits.cpu !== undefined && limits.cpu > 0) {
    // 转换为 CPU 秒数：1 核 = 每实际秒 1 秒 CPU 时间
    // 这里按“总 CPU 时间上限”处理，允许短时间 burst
    const cpuTimeSeconds = Math.max(1, Math.floor(limits.cpu * 60))
    ulimitCommands.push(`ulimit -t ${cpuTimeSeconds}`)
  }

  // 虚拟内存限制（KB）
  if (limits.memoryBytes !== undefined && limits.memoryBytes > 0) {
    const memoryKib = Math.floor(limits.memoryBytes / 1024)
    ulimitCommands.push(`ulimit -v ${memoryKib}`)
  }

  const quotedOriginalArgs = originalArgs.map((arg) => shellEscape(arg))
  const execCommand = `exec ${shellEscape(originalCommand)} ${quotedOriginalArgs.join(' ')}`
  const shellScript = ulimitCommands.length > 0
    ? `${ulimitCommands.join('; ')}; ${execCommand}`
    : execCommand

  return { command: 'sh', args: ['-c', shellScript] }
}

/**
 * 简单的 shell 参数转义
 */
function shellEscape(arg: string): string {
  if (/^[a-zA-Z0-9_./:=@-]+$/.test(arg)) return arg
  return `'${arg.replace(/'/g, `'\\''`)}'`
}
