/**
 * Agent 执行器抽象
 *
 * 阶段 B 支持两种运行模式：
 * - DockerAgentRunner：在隔离容器内运行 SDK binary（服务端/多租户推荐）
 * - NativeAgentRunner：在宿主进程直接 spawn SDK binary（桌面端/开发）
 *
 * 未来可扩展：gVisorAgentRunner、KataAgentRunner 等更强隔离方案。
 */

import type { ChildProcess } from 'node:child_process'
import type { AgentResourceLimits } from './agent-resource-limits.ts'

/** Agent 运行环境配置 */
export interface AgentRunEnv {
  /** API Key（已解密） */
  apiKey: string
  /** Anthropic Base URL（可选） */
  baseUrl?: string
  /** 代理 URL（可选） */
  proxyUrl?: string
  /** 额外环境变量 */
  extra?: Record<string, string | undefined>
}

/** Agent 运行选项 */
export interface AgentRunOptions {
  /** SDK native binary 绝对路径 */
  sdkCliPath: string
  /** 工作区目录（容器内挂载为 /workspace） */
  workspacePath: string
  /** 用户 prompt */
  prompt: string
  /** 环境变量 */
  env: AgentRunEnv
  /** 容器镜像名（Docker 模式使用） */
  imageName?: string
  /** 容器工作目录 */
  containerCwd?: string
  /** 运行超时（毫秒，默认 120000） */
  timeoutMs?: number
  /** AbortSignal */
  signal?: AbortSignal
  /** 资源限制（Docker / Native 按各自方式实现） */
  resourceLimits?: AgentResourceLimits
}

/** Agent 运行回调 */
export interface AgentRunCallbacks {
  /** stdout 增量 */
  onStdout?: (chunk: string) => void
  /** stderr 增量 */
  onStderr?: (chunk: string) => void
  /** SDK session ID 捕获 */
  onSessionId?: (sessionId: string) => void
  /** 模型确认 */
  onModelResolved?: (model: string) => void
}

/** Agent 运行结果 */
export interface AgentRunResult {
  /** 退出码 */
  exitCode: number | null
  /** 完整 stdout */
  stdout: string
  /** 完整 stderr */
  stderr: string
  /** 是否因超时被杀 */
  timedOut: boolean
}

/** Agent 执行器接口 */
export interface AgentRunner {
  /** 在隔离环境中运行一次 Agent query */
  run(options: AgentRunOptions, callbacks?: AgentRunCallbacks): Promise<AgentRunResult>
  /** 检查当前 runner 是否可用 */
  checkAvailable(): Promise<boolean>
}

/** 通用环境变量构建 */
export function buildAgentEnvironment(env: AgentRunEnv): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {
    ...env.extra,
    ANTHROPIC_API_KEY: env.apiKey,
    HOME: '/tmp/mapro-agent-home',
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  }

  if (env.baseUrl) {
    result.ANTHROPIC_BASE_URL = env.baseUrl
  }

  if (env.proxyUrl) {
    result.HTTP_PROXY = env.proxyUrl
    result.HTTPS_PROXY = env.proxyUrl
  }

  return result
}

/** 通用超时/abort 包装 */
export function attachTimeoutAndAbort(
  child: ChildProcess,
  timeoutMs: number,
  signal?: AbortSignal,
): { timedOut: boolean; clear: () => void } {
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    child.kill('SIGKILL')
  }, timeoutMs)

  const abortHandler = () => {
    child.kill('SIGKILL')
  }

  if (signal) {
    signal.addEventListener('abort', abortHandler, { once: true })
  }

  return {
    timedOut,
    clear: () => {
      clearTimeout(timeout)
      if (signal) {
        signal.removeEventListener('abort', abortHandler)
      }
    },
  }
}
