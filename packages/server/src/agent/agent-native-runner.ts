/**
 * 本地 Agent 执行器
 *
 * 在宿主进程直接 spawn SDK native binary。
 * 适用于桌面端开发、Electron 主进程、或已经受信任的服务器环境。
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import type { AgentRunner, AgentRunOptions, AgentRunResult, AgentRunCallbacks } from './agent-runner.ts'
import { buildAgentEnvironment } from './agent-runner.ts'
import {
  resolveAgentResourceLimits,
  buildNativeUlimitCommand,
  type AgentResourceLimits,
} from './agent-resource-limits.ts'

export interface NativeAgentRunnerOptions {
  /** 单次运行超时（毫秒，默认 120000） */
  defaultTimeoutMs?: number
  /** 工作目录（默认 options.workspacePath） */
  cwd?: string
  /** 默认资源限制 */
  resourceLimits?: AgentResourceLimits
}

export class NativeAgentRunner implements AgentRunner {
  private defaultTimeoutMs: number
  private cwd?: string
  private resourceLimits?: AgentResourceLimits

  constructor(options: NativeAgentRunnerOptions = {}) {
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 120_000
    this.cwd = options.cwd
    this.resourceLimits = options.resourceLimits
  }

  async run(options: AgentRunOptions, callbacks?: AgentRunCallbacks): Promise<AgentRunResult> {
    const {
      sdkCliPath,
      workspacePath,
      prompt,
      env,
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
    // 本地运行时 HOME 保持宿主 HOME，不要强制改为 /tmp
    delete environment.HOME

    const cwd = this.cwd ?? workspacePath
    const resolvedLimits = resolveAgentResourceLimits(resourceLimits)
    const { command, args } = buildNativeUlimitCommand(resolvedLimits, sdkCliPath, ['query', prompt])

    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env: { ...process.env, ...environment } as NodeJS.ProcessEnv,
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
      })

      child.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString('utf-8')
        stderr += chunk
        callbacks?.onStderr?.(chunk)
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
    return true
  }
}
