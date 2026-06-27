#!/usr/bin/env bun
/**
 * Agent 容器隔离 Spike 脚本
 *
 * 验证：Docker 镜像构建 → SDK binary 挂载 → 容器内 query 执行 → 流式结果回传 → 容器销毁
 *
 * 使用方式：
 *   MAPRO_AGENT_SDK_PATH=/path/to/linux/claude \
 *   ANTHROPIC_API_KEY=sk-ant-... \
 *   bun run packages/server/src/agent/agent-spike.ts
 *
 * 若未提供 SDK 路径，脚本会自动尝试从临时安装目录查找 Linux ARM64 binary。
 */

import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { DockerAgentRunner } from './agent-docker-runner.ts'

async function main(): Promise<void> {
  console.log('[Agent Spike] 启动容器隔离验证')

  const runner = new DockerAgentRunner()

  // 1. 检查 Docker
  const dockerOk = await runner.checkAvailable()
  if (!dockerOk) {
    console.error('[Agent Spike] Docker 不可用，请先安装并启动 Docker（推荐 OrbStack）')
    process.exit(1)
  }
  console.log('[Agent Spike] Docker 可用')

  // 2. 确定 SDK binary 路径
  let sdkCliPath = process.env.MAPRO_AGENT_SDK_PATH ?? ''
  if (!sdkCliPath) {
    const fallback = join(tmpdir(), 'mapro-sdk-spike', 'node_modules', '@anthropic-ai', 'claude-agent-sdk-linux-arm64', 'claude')
    if (existsSync(fallback)) {
      sdkCliPath = fallback
      console.log(`[Agent Spike] 使用默认 SDK 路径: ${sdkCliPath}`)
    }
  }

  if (!sdkCliPath || !existsSync(sdkCliPath)) {
    console.error('[Agent Spike] 未找到 Linux SDK binary。请设置 MAPRO_AGENT_SDK_PATH，或先运行：')
    console.error('  cd /tmp && mkdir mapro-sdk-spike && cd mapro-sdk-spike')
    console.error('  bun add --cpu=arm64 --os=linux @anthropic-ai/claude-agent-sdk-linux-arm64@0.3.143')
    process.exit(1)
  }

  // 3. 准备工作区
  const workspacePath = join(tmpdir(), `mapro-agent-spike-${randomUUID()}`)
  mkdirSync(workspacePath, { recursive: true })
  writeFileSync(join(workspacePath, 'hello.txt'), 'Hello from MAPro Agent spike!')
  console.log(`[Agent Spike] 工作区: ${workspacePath}`)

  // 4. 构建镜像
  console.log('[Agent Spike] 构建 Agent 镜像...')
  const imageBuild = Bun.spawn({
    cmd: ['docker', 'build', '-t', 'mapro-agent:latest', join(import.meta.dir)],
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const buildExit = await imageBuild.exited
  if (buildExit !== 0) {
    console.error('[Agent Spike] 镜像构建失败')
    process.exit(1)
  }
  console.log('[Agent Spike] 镜像构建完成')

  // 5. 执行容器内 query
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.warn('[Agent Spike] 未设置 ANTHROPIC_API_KEY，跳过实际 query，仅验证容器启动与文件挂载')
  }

  const prompt = apiKey
    ? 'Please list the files in the current directory and respond with a single sentence.'
    : '--help'

  console.log('[Agent Spike] 启动容器执行 SDK...')
  const start = Date.now()

  let stdoutChunks = 0
  let stderrChunks = 0

  const result = await runner.run(
    {
      sdkCliPath,
      workspacePath,
      prompt,
      env: {
        apiKey: apiKey ?? '',
      },
      timeoutMs: apiKey ? 120_000 : 30_000,
    },
    {
      onStdout: (chunk) => {
        stdoutChunks++
        process.stdout.write(chunk)
      },
      onStderr: (chunk) => {
        stderrChunks++
        process.stderr.write(chunk)
      },
    },
  )

  const elapsed = Date.now() - start

  console.log(`\n[Agent Spike] 容器退出码: ${result.exitCode}`)
  console.log(`[Agent Spike] 是否超时: ${result.timedOut}`)
  console.log(`[Agent Spike] 耗时: ${elapsed}ms`)
  console.log(`[Agent Spike] stdout 块数: ${stdoutChunks}, stderr 块数: ${stderrChunks}`)

  // 6. 验证工作区是否被挂载（容器应能看到 hello.txt）
  if (result.stdout.includes('hello.txt') || result.stderr.includes('hello.txt')) {
    console.log('[Agent Spike] 工作区 volume 挂载验证通过')
  } else if (!apiKey) {
    console.log('[Agent Spike] 未提供 API Key，无法验证 SDK 实际执行')
  }

  // 7. 结论
  if (result.exitCode === 0 && !result.timedOut) {
    console.log('\n[Agent Spike] 容器隔离闭环跑通')
  } else {
    console.log('\n[Agent Spike] 容器隔离闭环未跑通，请检查输出')
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('[Agent Spike] 未捕获异常:', error)
  process.exit(1)
})
