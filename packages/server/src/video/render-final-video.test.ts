/**
 * renderFinalVideo 集成测试（需真实 ffmpeg）
 *
 * 验证"终版渲染"分阶段合成：拼接分镜 → 字幕 burn-in → BGM 混入 → 多平台输出。
 * 若环境无 ffmpeg，测试跳过（用 markSkip）。
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

function hasFFmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const ffmpeg = hasFFmpeg()

const { renderFinalVideo } = await import('./video-composition-service.ts')

describe('renderFinalVideo（终版渲染，需 ffmpeg）', () => {
  let root: string
  const clips: string[] = []
  const outputFinal = join(tmpdir(), 'mapro-final-test.mp4')

  beforeAll(() => {
    if (!ffmpeg) return
    root = mkdtempSync(join(tmpdir(), 'mapro-render-test-'))
    // 生成两个不同颜色的 1 秒测试片段（含音轨）
    for (const [i, color] of ['red', 'blue'].entries()) {
      const p = join(root, `clip-${i}.mp4`)
      execFileSync('ffmpeg', [
        '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=640x360:d=1`,
        '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
        '-shortest', '-c:v', 'libx264', '-c:a', 'aac', p,
      ])
      clips.push(p)
    }
  })

  afterAll(() => {
    if (ffmpeg && root) rmSync(root, { recursive: true, force: true })
    if (existsSync(outputFinal)) rmSync(outputFinal, { force: true })
  })

  it('无字幕无 BGM：拼接两个片段产出成片', async () => {
    if (!ffmpeg) return
    const res = await renderFinalVideo({
      inputVideos: clips,
      outputPath: outputFinal,
      outputFormat: { resolution: '1080x1920' },
    })
    expect(res.success).toBe(true)
    expect(existsSync(outputFinal)).toBe(true)
    expect(res.videoInfo?.resolution).toBe('1080x1920')
  })

  it('带字幕 burn-in + BGM 混入', async () => {
    if (!ffmpeg) return
    // 生成 SRT 字幕
    const srtPath = join(root, 'sub.srt')
    writeFileSync(srtPath, '1\n00:00:00,000 --> 00:00:01,000\n框架字幕一\n\n2\n00:00:01,000 --> 00:00:02,000\n框架字幕二\n')
    // 生成 BGM（短正弦波）
    const bgmPath = join(root, 'bgm.wav')
    execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', bgmPath])

    const out = join(root, 'final-sub-bgm.mp4')
    const res = await renderFinalVideo({
      inputVideos: clips,
      outputPath: out,
      subtitlePath: srtPath,
      bgmPath,
      outputFormat: { resolution: '1920x1080' },
    })
    expect(res.success).toBe(true)
    expect(existsSync(out)).toBe(true)
    expect(res.videoInfo?.duration).toBeGreaterThan(0)
  })
})
