/**
 * FrameGenerator 单元测试
 *
 * BDD 行为驱动，验证首帧图生成逻辑（mock 图片生成 API，不发起真实调用）：
 * 1. baseUrl 归一化（带 /api/v1 后缀也能拼接正确）
 * 2. 正常批量生成 → 为每镜头产出图片文件
 * 3. 某镜头 API 失败 → 仅该镜头标记失败，不影响其他
 * 4. 受限并发：并发生成数不超过设定值
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FrameGeneratorConfig } from './frame-generator'
import { normalizeBaseUrl } from './frame-generator'

type FetchImpl = typeof fetch
const savedFetch: FetchImpl = (globalThis as unknown as { fetch: FetchImpl }).fetch

/** 安装一个可控的 fetch mock：
 *  - /tools/gpt-image-2/generate → 走 handler，返回 images URL
 *  - 其它（图片下载） → 返回二进制 buffer
 */
function installFetchMock(handler: (callIndex: number) => { images?: string[] } | { httpError: number }): void {
  let callIndex = 0
  const imgBuffer = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) // PNG magic
  ;(globalThis as unknown as { fetch: FetchImpl }).fetch = (async (url: unknown, init?: unknown) => {
    const u = String(url)
    if (u.includes('/tools/gpt-image-2/generate')) {
      callIndex += 1
      const res = handler(callIndex)
      if ('httpError' in res) {
        return new Response('unauthorized', { status: res.httpError })
      }
      return new Response(JSON.stringify({ images: res.images }), { status: 200 })
    }
    // 图片下载
    return new Response(imgBuffer, { status: 200 })
  }) as unknown as FetchImpl
}

function restoreFetch(): void {
  ;(globalThis as unknown as { fetch: FetchImpl }).fetch = savedFetch
}

const { generateFrames } = await import('./frame-generator.ts')

describe('FrameGenerator', () => {
  let root: string
  const cfg: FrameGeneratorConfig = {
    apiKey: 'pk_test',
    baseUrl: 'https://api.proma.cool',
    concurrency: 2,
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'frame-gen-test-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    restoreFetch()
  })

  it('baseUrl 带 /api/v1 后缀被归一化为根域名', () => {
    expect(normalizeBaseUrl('https://api.proma.cool/api/v1')).toBe('https://api.proma.cool')
    expect(normalizeBaseUrl('https://api.proma.cool')).toBe('https://api.proma.cool')
    expect(normalizeBaseUrl('https://api.proma.cool/api/v1/')).toBe('https://api.proma.cool')
  })

  it('正常批量生成 → 为每镜头产出真实图片文件', async () => {
    installFetchMock(() => ({ images: ['https://mock.img/a.png'] }))

    const results = await generateFrames(
      [
        { shotId: '01', prompt: 'a close-up' },
        { shotId: '02', prompt: 'a scene' },
      ],
      root,
      cfg,
    )

    expect(results).toHaveLength(2)
    expect(results.every((r) => r.success)).toBe(true)
    const files = readdirSync(root)
    expect(files.length).toBe(2)
    // 校验保存的是 PNG magic（说明确实写入了图片字节）
    const first = readFileSync(join(root, files[0]!))
    expect(first[0]).toBe(137) // 0x89
  })

  it('某镜头 API 401 → 仅该镜头失败，其他成功', async () => {
    // 第 1 次调用失败（401），第 2 次成功
    installFetchMock((i) => (i === 1 ? { httpError: 401 } : { images: ['https://mock.img/x.png'] }))

    const results = await generateFrames(
      [
        { shotId: '01', prompt: 'p1' },
        { shotId: '02', prompt: 'p2' },
      ],
      root,
      cfg,
    )

    // 并发下调用顺序不可控，但必然 1 成功 1 失败
    const ok = results.filter((r) => r.success)
    const bad = results.filter((r) => !r.success)
    expect(ok).toHaveLength(1)
    expect(bad).toHaveLength(1)
  })

  it('受限并发：并发生成数不超过配置上限', async () => {
    let active = 0
    let maxConcurrent = 0
    installFetchMock((_i) => {
      return { images: ['https://mock.img/x.png'] }
    })
    // 覆盖为一个可观测活跃数的 fetch
    ;(globalThis as unknown as { fetch: FetchImpl }).fetch = (async (url: unknown) => {
      // 对下载请求也计数；这里主要观测生成阶段的并发
      const u = String(url)
      active += 1
      maxConcurrent = Math.max(maxConcurrent, active)
      await new Promise((r) => setTimeout(r, 8))
      active -= 1
      if (u.includes('/tools/gpt-image-2/generate')) {
        return new Response(JSON.stringify({ images: ['https://mock.img/x.png'] }), { status: 200 })
      }
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
    }) as unknown as FetchImpl

    await generateFrames(
      Array.from({ length: 6 }, (_, i) => ({ shotId: String(i + 1).padStart(2, '0'), prompt: 'p' })),
      root,
      cfg,
    )

    expect(maxConcurrent).toBeLessThanOrEqual(cfg.concurrency!)
  })
})
