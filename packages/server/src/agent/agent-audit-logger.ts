/**
 * Agent 命令审计日志
 *
 * 记录 Agent 执行期间的工具调用、权限决策、交互式审批等关键事件，
 * 用于事后审计、安全分析与合规检查。
 *
 * 存储格式：{MAPRO_DATA_DIR}/logs/agent-audit-{YYYY-MM-DD}.jsonl
 * 每条记录为单行 JSON，便于按日期轮转和外部工具读取。
 */

import { appendFileSync } from 'node:fs'
import type { AppContext } from '../context/types.ts'
import { getAgentAuditLogPath } from '../context/config-paths.ts'

/** 审计事件类型 */
export type AgentAuditEventType =
  | 'tool_request'   // 工具调用请求（来自 SDK assistant 消息中的 tool_use）
  | 'tool_result'    // 工具执行结果（来自 SDK user 消息中的 tool_result）
  | 'permission_decision' // 本地权限决策（allow / deny）
  | 'ask_user'       // AskUserQuestion 交互
  | 'exit_plan'      // ExitPlanMode 审批
  | 'error'          // 编排器内部错误

/** 单条审计日志条目 */
export interface AgentAuditEntry {
  /** 事件时间戳（毫秒） */
  timestamp: number
  /** 会话 ID */
  sessionId: string
  /** 事件类型 */
  eventType: AgentAuditEventType
  /** SDK 工具调用唯一标识 */
  toolUseId?: string
  /** 工具名称 */
  toolName?: string
  /** 工具输入（已做敏感字段脱敏） */
  input?: Record<string, unknown>
  /** 工具输出摘要或错误信息 */
  output?: string
  /** 输出原始字节数（用于审计体积） */
  outputSize?: number
  /** 是否为错误结果 */
  isError?: boolean
  /** 权限决策：allow / deny */
  decision?: 'allow' | 'deny'
  /** 决策原因 */
  decisionReason?: string
  /** 当前权限模式 */
  permissionMode?: string
  /** 执行耗时（毫秒） */
  durationMs?: number
}

/** 审计日志记录器配置 */
export interface AgentAuditLoggerOptions {
  /** 自动刷盘间隔（毫秒），默认 1000 */
  flushIntervalMs?: number
  /** 单次缓冲区最大条数，达到后强制刷盘，默认 10 */
  bufferSize?: number
  /** 输出摘要最大字符数，默认 2000 */
  maxOutputSummaryLength?: number
}

/** 敏感字段集合：这些字段的值在审计日志中会被替换为占位符 */
const SENSITIVE_INPUT_KEYS = new Set([
  'api_key',
  'apiKey',
  'api-key',
  'token',
  'password',
  'secret',
  'auth',
  'authorization',
])

/** 判断值是否可能是敏感内容 */
function looksSensitive(key: string): boolean {
  const lower = key.toLowerCase()
  return SENSITIVE_INPUT_KEYS.has(key) ||
    lower.includes('key') ||
    lower.includes('token') ||
    lower.includes('secret') ||
    lower.includes('password') ||
    lower.includes('auth')
}

/** 脱敏工具输入 */
export function sanitizeToolInput(input: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (looksSensitive(key)) {
      result[key] = '***'
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = sanitizeToolInput(value as Record<string, unknown>)
    } else {
      result[key] = value
    }
  }
  return result
}

/** 截断输出摘要 */
function truncateOutput(output: unknown, maxLength: number): string {
  const text = typeof output === 'string' ? output : JSON.stringify(output)
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + `... [truncated ${text.length - maxLength} chars]`
}

/**
 * Agent 审计日志记录器
 *
 * 采用内存缓冲 + 定时刷盘策略，降低高频工具调用的 I/O 开销。
 */
export class AgentAuditLogger {
  private context: AppContext
  private buffer: AgentAuditEntry[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private flushIntervalMs: number
  private bufferSize: number
  private maxOutputSummaryLength: number

  constructor(context: AppContext, options: AgentAuditLoggerOptions = {}) {
    this.context = context
    this.flushIntervalMs = options.flushIntervalMs ?? 1000
    this.bufferSize = options.bufferSize ?? 10
    this.maxOutputSummaryLength = options.maxOutputSummaryLength ?? 2000
    this.startFlushTimer()
  }

  /**
   * 记录一条审计事件
   */
  log(entry: Omit<AgentAuditEntry, 'timestamp'>): void {
    const fullEntry: AgentAuditEntry = { ...entry, timestamp: Date.now() }
    if (fullEntry.input) {
      fullEntry.input = sanitizeToolInput(fullEntry.input)
    }
    if (fullEntry.output !== undefined) {
      fullEntry.outputSize = String(fullEntry.output).length
      fullEntry.output = truncateOutput(fullEntry.output, this.maxOutputSummaryLength)
    }
    this.buffer.push(fullEntry)
    if (this.buffer.length >= this.bufferSize) {
      this.flush()
    }
  }

  /**
   * 立即将缓冲区写入磁盘
   */
  flush(): void {
    if (this.buffer.length === 0) return
    const path = getAgentAuditLogPath(this.context)
    const lines = this.buffer.map((e) => JSON.stringify(e)).join('\n') + '\n'
    try {
      appendFileSync(path, lines, 'utf-8')
      this.buffer = []
    } catch (err) {
      console.error('[AgentAuditLogger] 写入审计日志失败:', err)
    }
  }

  /**
   * 释放资源并强制刷盘
   */
  dispose(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    this.flush()
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => this.flush(), this.flushIntervalMs)
  }
}
