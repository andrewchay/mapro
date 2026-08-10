/**
 * VideoPipelineOrchestrator 单元测试
 *
 * BDD 行为驱动，验证流水线编排逻辑（不依赖真实视频 API / FFmpeg）：
 * 1. 全镜头成功 → 拼接成片，返回最终路径
 * 2. 受限并发：同时执行的镜头数不超过 concurrency
 * 3. 单镜瞬时失败可重试，最终成功
 * 4. 鉴权错误 (401/Invalid key) 不重试，直接失败
 * 5. 任一镜头失败 → 整体 failed 且返回失败镜头
 * 6. 进度回调逐步上报（phase/completedShots）
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Storyboard } from './storyboard-engine'
import { generateStoryboard, type VideoInput } from './storyboard-engine'

// ── Mock 视频生成 / 下载 / 合成 ──
let failPlan: string[] = [] // 形如 ["auth","once","transient"] 的失败计划
let maxConcurrent = 0
let active = 0

mock.module('./video-generation-service', () => ({
  generateVideo: async () => {
    active += 1
    maxConcurrent = Math.max(maxConcurrent, active)
    await new Promise((r) => setTimeout(r, 5))
    active -= 1
    // 用一个可控的失败计划模拟不同错误
    const kind = failPlan.shift()
    if (kind === 'auth') throw new Error('Invalid API key')
    if (kind === 'timeout') throw new Error('ETIMEDOUT: SSE 超时')
    if (kind === 'transient') throw new Error('ECONNRESET')
    return { status: 'success', taskId: 't1', videoUrl: 'https://mock/video.mp4', engine: 'seedance' }
  },
  downloadVideo: async (url: string, out: string) => { await Bun.write(out, 'FAKE_MP4'); return out },
}))

mock.module('./video-composition-service', () => ({
  composeVideo: async (cfg: { outputPath: string }) => ({
    success: true,
    outputPath: cfg.outputPath,
    videoInfo: { duration: 15, resolution: '1080x1920', fileSize: '1.0 MB', bitrate: '5000k' },
  }),
  // NOT yet used in orchestrator test path, but provide to satisfy import
  generateSubtitlesFromStoryboard: async () => '/tmp/mock.srt',
}))

const { runVideoPipeline } = await import('./video-pipeline-orchestrator.ts')

function sampleStoryboard(): Storyboard {
  const input: VideoInput = {
    product: '抗初老精华液',
    category: '护肤品',
    sellingPoints: ['A醇抗老', '温和不刺激'],
    targetAudience: '25-35 都市女性',
    platform: 'xiaohongshu',
    duration: 15,
    textInput: 'test',
  }
  return generateStoryboard(input)
}

describe('VideoPipelineOrchestrator', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'video-pipeline-test-'))
    failPlan = []
    maxConcurrent = 0
    active = 0
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('全部镜头成功 → 拼接成片并返回最终路径', async () => {
    const sb = sampleStoryboard()
    const result = await runVideoPipeline({
      campaignId: 'c1',
      assetsRoot: root,
      storyboard: sb,
      aspectRatio: '3:4' as const,
      engine: 'seedance',
      concurrency: 2,
    })

    expect(result.success).toBe(true)
    expect(result.finalVideoPath).toBeDefined()
    expect(result.rawVideoPaths.length).toBe(sb.shots.length)
    // final 目录应生成 mp4
    expect(result.finalVideoPath).toContain('video-assets/final')
  })

  it('受限并发：同时执行的镜头数 ≤ 并发上限', async () => {
    const sb = sampleStoryboard()
    await runVideoPipeline({
      campaignId: 'c1',
      assetsRoot: root,
      storyboard: sb,
      aspectRatio: '3:4' as const,
      engine: 'seedance',
      concurrency: 2,
    })

    expect(maxConcurrent).toBeLessThanOrEqual(2)
  })

  it('瞬时错误可重试并最终成功', async () => {
    const sb = sampleStoryboard()
    // 所有镜头第一次都瞬时失败，重试后成功（maxRetries≥1）
    failPlan = sb.shots.map(() => 'transient')
    const result = await runVideoPipeline({
      campaignId: 'c1',
      assetsRoot: root,
      storyboard: sb,
      aspectRatio: '3:4' as const,
      engine: 'seedance',
      concurrency: 2,
      maxRetries: 2,
    })

    expect(result.success).toBe(true)
  })

  it('鉴权错误 (401/Invalid key) 不重试，直接整体失败', async () => {
    const sb = sampleStoryboard()
    failPlan = ['auth']
    const result = await runVideoPipeline({
      campaignId: 'c1',
      assetsRoot: root,
      storyboard: sb,
      aspectRatio: '3:4' as const,
      engine: 'seedance',
      concurrency: 2,
      maxRetries: 3, // 即使允许重试，鉴权也不应重试
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('失败')
  })

  it('进度回调：phase 逐步推进到 done，且 completedShots 最终等于总镜头数', async () => {
    const sb = sampleStoryboard()
    const phases: string[] = []
    const completions: number[] = []

    await runVideoPipeline({
      campaignId: 'c1',
      assetsRoot: root,
      storyboard: sb,
      aspectRatio: '3:4' as const,
      engine: 'seedance',
      concurrency: 2,
      onProgress: (p) => {
        phases.push(p.phase)
        completions.push(p.completedShots)
      },
    })

    expect(phases).toContain('done')
    expect(completions[completions.length - 1]).toBe(sb.shots.length)
  })
})
