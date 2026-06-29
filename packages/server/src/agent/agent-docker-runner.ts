/**
 * Docker Agent 执行器
 *
 * 在 Docker 容器内运行 SDK native binary，每个 session 一个独立容器。
 * 工作区目录挂载为 /workspace，SDK binary 以只读方式挂载为 /usr/local/bin/claude。
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import type { AgentRunner, AgentRunOptions, AgentRunResult, AgentRunCallbacks } from './agent-runner.ts'
import { buildAgentEnvironment } from './agent-runner.ts'
import {
  resolveAgentResourceLimits,
  buildDockerResourceArgs,
  type AgentResourceLimits,
} from './agent-resource-limits.ts'

export interface DockerAgentRunnerOptions {
  /** 容器镜像名（默认 mapro-agent:latest） */
  imageName?: string
  /** 容器内工作目录（默认 /workspace） */
  containerCwd?: string
  /** 单次运行超时（毫秒，默认 120000） */
  defaultTimeoutMs?: number
  /** 默认资源限制 */
  resourceLimits?: AgentResourceLimits
}

export class DockerAgentRunner implements AgentRunner {
  private imageName: string
  private containerCwd: string
  private defaultTimeoutMs: number
  private resourceLimits?: AgentResourceLimits

  constructor(options: DockerAgentRunnerOptions = {}) {
    this.imageName = options.imageName ?? 'mapro-agent:latest'
    this.containerCwd = options.containerCwd ?? '/workspace'
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 120_000
    this.resourceLimits = options.resourceLimits
  }

  async run(options: AgentRunOptions, callbacks?: AgentRunCallbacks): Promise<AgentRunResult> {
    const {
      sdkCliPath,
      workspacePath,
      prompt,
      env,
      imageName = this.imageName,
      containerCwd = this.containerCwd,
      timeoutMs = this.defaultTimeoutMs,
      signal,
      resourceLimits = this.resourceLimits,
    } = options

    if (!existsSync(sdkCliPath)) {
      throw new Error(`SDK binary 不存在: ${sdkCliPath}`)
    }

    if (!existsSync(workspacePath)) {
      mkdirSync(workspacePath, { recursive: true })
    }

    const environment = buildAgentEnvironment(env)
    const envArgs: string[] = []
    for (const [key, value] of Object.entries(environment)) {
      if (value !== undefined) {
        envArgs.push('-e', `${key}=${value}`)
      }
    }

    const resolvedLimits = resolveAgentResourceLimits(resourceLimits)
    const resourceArgs = buildDockerResourceArgs(resolvedLimits)

    const dockerArgs = [
      'run',
      '--rm',
      ...resourceArgs,
      '-v',
      `${workspacePath}:${containerCwd}`,
      '-v',
      `${sdkCliPath}:/usr/local/bin/claude:ro`,
      '-w',
      containerCwd,
      ...envArgs,
      imageName,
      'query',
      prompt,
    ]

    return new Promise((resolve, reject) => {
      const child = spawn('docker', dockerArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let stdout = ''
      let stderr = ''
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

      child.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString('utf-8')
        stdout += chunk
        callbacks?.onStdout?.(chunk)

        // 尝试从 stderr/stdout 捕获 SDK session ID（SDK 会输出到 stderr）
        const sessionMatch = chunk.match(/session[_\s]id[:\s]+([a-zA-Z0-9_-]+)/i)
        if (sessionMatch) {
          callbacks?.onSessionId?.(sessionMatch[1]!)
        }
      })

      child.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString('utf-8')
        stderr += chunk
        callbacks?.onStderr?.(chunk)

        const sessionMatch = chunk.match(/session[_\s]id[:\s]+([a-zA-Z0-9_-]+)/i)
        if (sessionMatch) {
          callbacks?.onSessionId?.(sessionMatch[1]!)
        }

        const modelMatch = chunk.match(/resolved model[:\s]+([a-zA-Z0-9._-]+)/i)
        if (modelMatch) {
          callbacks?.onModelResolved?.(modelMatch[1]!)
        }
      })

      child.on('error', (error) => {
        clearTimeout(timeout)
        if (signal) {
          signal.removeEventListener('abort', abortHandler)
        }
        reject(error)
      })

      child.on('close', (exitCode) => {
        clearTimeout(timeout)
        if (signal) {
          signal.removeEventListener('abort', abortHandler)
        }
        resolve({ exitCode, stdout, stderr, timedOut })
      })
    })
  }

  async checkAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn('docker', ['version'], { stdio: 'ignore' })
      child.on('error', () => resolve(false))
      child.on('close', (code) => resolve(code === 0))
    })
  }
}

/**
 * 兼容旧 API：在 Docker 容器内启动 SDK 并执行一次 query
 *
 * 已废弃，请使用 DockerAgentRunner。
 */
export async function runAgentInDocker(
  options: AgentRunOptions,
): Promise<AgentRunResult> {
  const runner = new DockerAgentRunner()
  return runner.run(options)
}

/** 检查 Docker 是否可用 */
export function checkDockerAvailable(): Promise<boolean> {
  return new DockerAgentRunner().checkAvailable()
}
