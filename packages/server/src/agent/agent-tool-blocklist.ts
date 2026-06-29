/**
 * Agent 工具黑名单服务
 *
 * 提供可配置的工具/命令禁用能力，作为权限系统之外的强制安全兜底。
 *
 * 配置来源（优先级从高到低）：
 * 1. 构造选项 / 运行选项
 * 2. 环境变量：MAPRO_AGENT_DISABLED_TOOLS、MAPRO_AGENT_DISABLED_BASH_PATTERNS
 * 3. 内置默认黑名单（可选）
 *
 * 命中黑名单时直接返回 deny，不进入用户审批流程。
 */

/** 黑名单命中结果 */
export interface ToolBlocklistResult {
  /** 是否被黑名单拦截 */
  blocked: boolean
  /** 拦截原因（human-readable） */
  reason?: string
  /** 命中的规则类型 */
  ruleType?: 'tool' | 'bash_pattern'
  /** 命中的规则值 */
  matchedRule?: string
}

/** 黑名单配置 */
export interface ToolBlocklistConfig {
  /** 禁用的工具名列表（如 ['Bash', 'NotebookEdit']） */
  disabledTools?: string[]
  /** 禁用的 Bash 命令前缀/模式列表（如 ['rm', 'sudo', 'curl']） */
  disabledBashPatterns?: string[]
}

/** 内置默认黑名单：始终禁止的高危工具与命令 */
const DEFAULT_DISABLED_TOOLS: readonly string[] = []
const DEFAULT_DISABLED_BASH_PATTERNS: readonly string[] = []

/** 从逗号分隔的环境变量解析列表 */
function parseCommaList(value: string | undefined): string[] | undefined {
  if (!value) return undefined
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return items.length > 0 ? items : undefined
}

/**
 * 按优先级选择黑名单配置
 *
 * 优先级：显式配置 > 环境变量 > 内置默认值
 */
function resolveBlocklistConfig(explicitConfig?: ToolBlocklistConfig): Required<ToolBlocklistConfig> {
  return {
    disabledTools: explicitConfig?.disabledTools
      ?? parseCommaList(process.env.MAPRO_AGENT_DISABLED_TOOLS)
      ?? [...DEFAULT_DISABLED_TOOLS],
    disabledBashPatterns: explicitConfig?.disabledBashPatterns
      ?? parseCommaList(process.env.MAPRO_AGENT_DISABLED_BASH_PATTERNS)
      ?? [...DEFAULT_DISABLED_BASH_PATTERNS],
  }
}

/**
 * 工具黑名单检查器
 *
 * 单例或按实例均可；本类支持通过环境变量动态读取配置。
 */
export class AgentToolBlocklist {
  private config: Required<ToolBlocklistConfig>

  constructor(explicitConfig?: ToolBlocklistConfig) {
    this.config = resolveBlocklistConfig(explicitConfig)
  }

  /**
   * 检查工具是否被禁用
   */
  checkTool(toolName: string): ToolBlocklistResult {
    const normalizedTool = toolName.trim()
    if (this.config.disabledTools.includes(normalizedTool)) {
      return {
        blocked: true,
        reason: `工具 "${normalizedTool}" 已被系统管理员禁用`,
        ruleType: 'tool',
        matchedRule: normalizedTool,
      }
    }
    return { blocked: false }
  }

  /**
   * 检查 Bash 命令是否命中禁用模式
   */
  checkBashCommand(command: string): ToolBlocklistResult {
    const trimmed = command.trim().toLowerCase()
    for (const pattern of this.config.disabledBashPatterns) {
      const normalizedPattern = pattern.trim().toLowerCase()
      if (!normalizedPattern) continue
      // 支持前缀匹配：命令以禁用模式开头
      if (trimmed.startsWith(normalizedPattern)) {
        return {
          blocked: true,
          reason: `Bash 命令包含被禁用的模式 "${pattern}"`,
          ruleType: 'bash_pattern',
          matchedRule: pattern,
        }
      }
      // 支持子串匹配：命令任意位置包含禁用模式（用于检测管道/连接中的危险命令）
      if (trimmed.includes(` ${normalizedPattern} `) ||
          trimmed.includes(`|${normalizedPattern} `) ||
          trimmed.includes(`| ${normalizedPattern} `) ||
          trimmed.includes(`;${normalizedPattern} `) ||
          trimmed.includes(`; ${normalizedPattern} `) ||
          trimmed.includes(`&&${normalizedPattern} `) ||
          trimmed.includes(`&& ${normalizedPattern} `)) {
        return {
          blocked: true,
          reason: `Bash 命令包含被禁用的模式 "${pattern}"`,
          ruleType: 'bash_pattern',
          matchedRule: pattern,
        }
      }
    }
    return { blocked: false }
  }

  /**
   * 统一检查工具与输入
   */
  check(toolName: string, input: Record<string, unknown>): ToolBlocklistResult {
    const toolResult = this.checkTool(toolName)
    if (toolResult.blocked) return toolResult

    if (toolName === 'Bash') {
      const command = typeof input.command === 'string' ? input.command : ''
      if (command) {
        const bashResult = this.checkBashCommand(command)
        if (bashResult.blocked) return bashResult
      }
    }

    return { blocked: false }
  }

  /**
   * 获取当前生效的黑名单（用于日志/调试）
   */
  getConfig(): Required<ToolBlocklistConfig> {
    return {
      disabledTools: [...this.config.disabledTools],
      disabledBashPatterns: [...this.config.disabledBashPatterns],
    }
  }
}

/**
 * 全局黑名单实例
 *
 * 在大多数场景下直接使用此单例，确保配置从环境变量只读取一次。
 */
export const agentToolBlocklist = new AgentToolBlocklist()
