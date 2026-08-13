/**
 * 审核反馈 CSV 可视化转换（内联版，替代原 python3 normalize_review_feedback.py）
 *
 * 输入：draft-review-feedback.csv（bot 每次审核落盘的原始 CSV，5 列：
 *       @谁,达人名称,稿件文字部分,稿件图片部分,bot回复审核内容）
 * 输出：draft-review-feedback-viz.csv（13 列结构化可视化版，UTF-8 with BOM，Excel 直接打开不乱码）
 * 幂等：每次审核后整体重写 viz CSV，保持整洁
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const VIZ_HEADER = [
  '@谁', '达人名称', '审核结论', '版本号', '审核时间',
  '必改条数', '争议条数', '可优化条数',
  '稿件标题', '话题标签', '稿件图片', '稿件文字(单行)', 'bot最终审核意见(单行)',
]

/** 审核结论：从 bot 回复模板提取 red/yellow/green/fail，无模板标记（旧格式）时按区块结构兜底推断 */
function extractVerdict(reply: string): string {
  if (!reply) return ''
  if (reply.includes('需修改（红卡）') || reply.includes('（红卡）')) return 'red'
  if (reply.includes('需人工判断（黄卡）') || reply.includes('（黄卡）')) return 'yellow'
  if (reply.includes('待确认放行（绿卡）') || reply.includes('（绿卡）')) return 'green'
  if (reply.includes('审核失败')) return 'fail'
  if (reply.includes('必须修改')) return 'red'
  if (reply.includes('需你判断')) return 'yellow'
  return ''
}

/** 版本号：第 N 版 */
function extractVersion(reply: string): string {
  const m = reply.match(/第\s*(\d+)\s*版/)
  return m?.[1] ?? ''
}

/**
 * 统计某一审核区块的条目数：
 * 先按空行把回复切成区块，只取含 marker 的区块；
 * 优先取「区块（N 处）」显式数字，否则统计区块内 "- [" 条目数（"- 无建议"不含 [，不计数）
 */
function countItems(reply: string, marker: string, explicitPattern: RegExp | null): string {
  if (!reply) return ''
  const blocks = reply.split(/\n\s*\n/)
  for (const block of blocks) {
    const lines = block.split('\n')
    if (!lines.some((l) => l.includes(marker))) continue
    if (explicitPattern) {
      const m = block.match(explicitPattern)
      if (m) return m[1] ?? ''
    }
    return String(lines.filter((l) => /^-\s*\[/.test(l)).length)
  }
  return ''
}

/**
 * 清洗 bot 回复：去掉 Agent 处理过程的内部叙事，只留最终审核模板
 * 1. 含「📋 稿件审核」→ 从该处截取
 * 2. 否则含「📦 第」→ 从上一行 @锚点 处截取
 * 3. 否则 → 保留原文（兜底）
 */
function cleanReply(reply: string): string {
  if (!reply) return ''
  const idx = reply.indexOf('📋 稿件审核')
  if (idx >= 0) return reply.slice(idx).trim()
  const m = reply.match(/@[^\n]+?\n📦\s*第/)
  if (m && m.index !== undefined) return reply.slice(m.index).trim()
  return reply.trim()
}

/** 稿件标题：## 标题 后一行 → 标题：行 → 首行 */
function extractTitle(text: string): string {
  const lines = (text ?? '').split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s*标题/.test(lines[i] ?? '')) return (lines[i + 1] ?? '').trim()
  }
  for (const line of lines) {
    const m = line.match(/^标题[：:]\s*(.+)/)
    if (m) return (m[1] ?? '').trim()
  }
  for (const line of lines) {
    const s = line.trim()
    if (s) return s
  }
  return ''
}

/** 话题标签：## 话题标签 后连续行 → 标签：行 → 含 #xxx 的行（排除 markdown 标题行） */
function extractTags(text: string): string {
  const lines = (text ?? '').split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (!/^##\s*话题标签/.test(lines[i] ?? '')) continue
    const out: string[] = []
    for (const l of lines.slice(i + 1)) {
      const s = l.trim()
      if (!s) break
      out.push(s)
    }
    return out.join(' ')
  }
  for (const line of lines) {
    const m = line.match(/^\s*标签[：:]\s*(.+)/)
    if (m) return (m[1] ?? '').trim()
  }
  for (const line of lines) {
    if (/#[^\s#]+/.test(line) && !/^#+\s/.test(line)) return line.trim()
  }
  return ''
}

/** 多行文本单行化（\n 转义为 \\n，JSON 转义风格） */
function singleLine(text: string): string {
  return (text ?? '').replace(/\r/g, '').replace(/\n/g, '\\n')
}

/** 加载 draft-review-state.jsonl → {(达人, 版本): ts}（键用 \u0000 分隔避免歧义；达人字段兼容 kol / influencer 两种历史命名） */
function loadStateTs(statePath: string): Map<string, string> {
  const result = new Map<string, string>()
  if (!existsSync(statePath)) return result
  for (const line of readFileSync(statePath, 'utf-8').split('\n')) {
    const s = line.trim()
    if (!s) continue
    try {
      const rec = JSON.parse(s) as { influencer?: string; kol?: string; version?: number | string; ts?: string }
      const influencer = rec.influencer ?? rec.kol ?? ''
      result.set(`${influencer}\u0000${String(rec.version ?? '')}`, rec.ts ?? '')
    } catch {
      // 忽略损坏行
    }
  }
  return result
}

/** RFC4180 CSV 解析：支持引号内逗号/换行/双引号转义（等价 Python csv.reader） */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += c
      i++
      continue
    }
    if (c === '"') {
      inQuotes = true
      i++
      continue
    }
    if (c === ',') {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      rows.push(row)
      row = []
      i++
      continue
    }
    field += c
    i++
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/** CSV 字段转义（等价 Python csv.writer：含逗号/引号/换行时用引号包裹并转义） */
function escapeCsvField(value: string): string {
  const s = value ?? ''
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * 生成清洗版 viz CSV（幂等，整体重写）
 *
 * @param workspaceFilesDir 工作区文件目录（含 draft-review-feedback.csv / draft-review-state.jsonl）
 */
export function regenerateDraftReviewVizCsv(workspaceFilesDir: string): void {
  try {
    const rawPath = join(workspaceFilesDir, 'draft-review-feedback.csv')
    if (!existsSync(rawPath)) {
      console.warn(`[飞书 Bridge] 生成 viz CSV：未找到原始 CSV ${rawPath}`)
      return
    }
    const outPath = join(workspaceFilesDir, 'draft-review-feedback-viz.csv')

    const raw = readFileSync(rawPath, 'utf-8').replace(/^\uFEFF/, '')
    const dataRows = parseCsv(raw).slice(1)
    const stateTs = loadStateTs(join(workspaceFilesDir, 'draft-review-state.jsonl'))

    const outRows: string[][] = []
    for (const r of dataRows) {
      if (r.length < 5) continue // 跳过残缺行
      const mentioned = r[0] ?? ''
      const influencer = r[1] ?? ''
      const rawText = r[2] ?? ''
      const image = r[3] ?? ''
      const reply = r[4] ?? ''
      const clean = cleanReply(reply)
      const version = extractVersion(clean)
      outRows.push([
        mentioned,
        influencer,
        extractVerdict(clean),
        version,
        stateTs.get(`${influencer}\u0000${version}`) ?? '',
        countItems(clean, '必须修改', /必须修改[（(]\s*(\d+)\s*[）)]/),
        countItems(clean, '需你判断', /需你判断[（(]\s*(\d+)\s*[）)]/),
        countItems(clean, '可优化', null),
        extractTitle(rawText),
        extractTags(rawText),
        image,
        singleLine(rawText),
        singleLine(clean),
      ])
    }

    const body = outRows.map((r) => r.map(escapeCsvField).join(',')).join('\n')
    // 末尾补换行（与 csv.writer 行为一致：每行含最后一行都以换行结尾）
    writeFileSync(outPath, `\uFEFF${VIZ_HEADER.join(',')}\n${body}${body ? '\n' : ''}`, 'utf-8')
    console.log(`[飞书 Bridge] 已生成清洗版 viz CSV: ${outPath}（${outRows.length} 行）`)
  } catch (error) {
    console.warn(`[飞书 Bridge] 生成 viz CSV 失败:`, error)
  }
}
