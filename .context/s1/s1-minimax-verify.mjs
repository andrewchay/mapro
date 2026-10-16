#!/usr/bin/env bun
/**
 * S1 最小调用验证 — MiniMax 视频生成（按量付费，无订阅）
 *
 * 用法：
 *   MINIMAX_API_KEY=ey... bun run s1-minimax-verify.mjs            # 国内站（api.minimaxi.com）
 *   MINIMAX_API_KEY=ey... MINIMAX_BASE=intl bun run s1-minimax-verify.mjs   # 国际站（api.minimax.io）
 *
 * 默认最省组合：MiniMax-Hailuo-2.3 / 768P / 6s（官方价格约 $0.28/条，失败不扣费）
 * 产物：本目录 s1-output/{summary.json, s1-sample.mp4}
 * 证据脱敏：不打印 key；summary 只含 task_id / 耗时 / 文件信息
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const key = process.env.MINIMAX_API_KEY?.trim()
if (!key) {
  console.error('✗ 缺少 MINIMAX_API_KEY（不要把 key 提交进任何仓库）')
  process.exit(1)
}
const base = process.env.MINIMAX_BASE === 'intl'
  ? 'https://api.minimax.io/v1'
  : 'https://api.minimaxi.com/v1'
const MODEL = process.env.MINIMAX_MODEL ?? 'MiniMax-Hailuo-2.3'
const RES = process.env.MINIMAX_RES ?? '768P'
const DUR = Number(process.env.MINIMAX_DUR ?? 6)
const outDir = join(import.meta.dir, 's1-output')
mkdirSync(outDir, { recursive: true })
const t0 = Date.now()
const log = (...a) => console.log(`[${Math.round((Date.now() - t0) / 1000)}s]`, ...a)

// 1. 创建任务（文生视频，prompt 演示 [Push in] 运镜语法）
log(`POST ${base}/video_generation  model=${MODEL} ${RES}/${DUR}s`)
const createRes = await fetch(`${base}/video_generation`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: MODEL,
    prompt: '一台复古咖啡机在木质吧台上缓缓出液，热气升腾，[Push in] 镜头缓慢推近，暖色调，商业广告质感',
    duration: DUR,
    resolution: RES,
    prompt_optimizer: true,
  }),
})
const createText = await createRes.text()
log('create status:', createRes.status)
if (!createRes.ok) {
  console.error('✗ 创建失败（不扣费）:', createText.slice(0, 500))
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ step: 'create', httpStatus: createRes.status, body: JSON.parse(createText || '{}') }, null, 2))
  process.exit(1)
}
const created = JSON.parse(createText)
if (created.base_resp?.status_code !== 0) {
  console.error('✗ 业务错误:', JSON.stringify(created.base_resp))
  process.exit(1)
}
const taskId = created.task_id
log('task_id =', taskId)

// 2. 轮询（官方视频生成常需 2–6 分钟；最长 12 分钟，20s 间隔）
const deadline = Date.now() + 12 * 60 * 1000
let fileId = null
while (Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 20000))
  const q = await fetch(`${base}/query/video_generation?task_id=${taskId}`, {
    headers: { Authorization: `Bearer ${key}` },
  }).then(r => r.json()).catch(e => ({ poll_error: String(e) }))
  const st = q.status ?? q.task?.status ?? 'unknown'
  log('status:', st)
  if (st === 'success' || st === 'completed') {
    fileId = q.file_id ?? q.task?.file_id ?? null
    if (!fileId) { console.error('✓ 完成但未找到 file_id:', JSON.stringify(q).slice(0, 400)); process.exit(1) }
    break
  }
  if (st === 'failed') {
    console.error('✗ 生成失败:', JSON.stringify(q).slice(0, 400))
    writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ taskId, lastPoll: q }, null, 2))
    process.exit(1)
  }
}
if (!fileId) { console.error('✗ 12 分钟超时'); process.exit(1) }

// 3. 取下载地址并下载
log('file_id =', fileId, '→ 获取下载 URL')
const fileRes = await fetch(`${base}/files/retrieve?file_id=${fileId}`, {
  headers: { Authorization: `Bearer ${key}` },
}).then(r => r.json())
const url = fileRes.file?.download_url ?? fileRes.file?.url
if (!url) { console.error('✗ 无下载地址:', JSON.stringify(fileRes).slice(0, 400)); process.exit(1) }
const mp4Path = join(outDir, 's1-sample.mp4')
const buf = Buffer.from(await fetch(url).then(r => r.arrayBuffer()))
writeFileSync(mp4Path, buf)
log(`下载完成: ${(buf.length / 1024 / 1024).toFixed(2)} MB`)

// 4. ffprobe 校验（S1 验收：可播放成片）
let probe = {}
try {
  probe = JSON.parse(execFileSync('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', mp4Path]).toString())
} catch { console.error('⚠ ffprobe 不可用（安装 ffmpeg 后重跑校验段），下载文件已保存') }
const v = probe.streams?.find(s => s.codec_type === 'video')
const summary = {
  provider: 'minimax', baseUrl: base, model: MODEL, resolution: RES, duration: DUR,
  taskId, fileId, elapsedSec: Math.round((Date.now() - t0) / 1000),
  file: { path: mp4Path, bytes: buf.length },
  probe: v ? { codec: v.codec_name, width: v.width, height: v.height, durationSec: v.duration } : 'ffprobe 不可用',
  verdict: v ? 'S1 最小调用 PASS' : '下载成功，待 ffprobe 复核',
}
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))
console.log('\n=== S1 结果 ==='); console.log(JSON.stringify(summary, null, 2))
