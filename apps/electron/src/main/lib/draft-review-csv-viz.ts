/**
 * 审核反馈 CSV 可视化转换（内联版，替代原 python3 normalize_review_feedback.py）
 *
 * 输入：draft-review-feedback.csv（Agent 每次审核后自行落盘的原始 CSV，6 列：
 *       @谁,达人名称,稿件文字部分,稿件图片部分,bot回复审核内容,已反馈内容）
 * 输出：draft-review-feedback-viz.csv（14 列结构化可视化版，UTF-8 with BOM，Excel 直接打开不乱码）
 * 结构化拆分：稿件标题/话题标签按 md 区块（## 标题 / ## 话题标签，兼容 ###/# 层级、空行、内联写法）提取；
 *       稿件文字列只保留正文（去掉归档头 `# 稿件 v{N} · 达人` 与标题/话题标签区块）
 * 幂等：每次审核后整体重写 viz CSV，保持整洁
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const VIZ_HEADER = [
  '@谁', '达人名称', '审核结论', '版本号', '审核时间',
  '必改条数', '争议条数', '可优化条数',
  '稿件标题', '话题标签', '稿件图片', '稿件文字', 'bot最终审核意见', '已反馈内容',
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

/**
 * 提取 md 区块内容（标题/话题标签），兼容多种写法：
 * - 区块式：`## 标题`（支持 `###`/`#` 层级，`## 标题（可选）` 等后缀），内容为后续连续非空行
 *   （允许区块头与内容之间有空行，遇空行/下一 md 标题结束）
 * - 内联式：`## 标题：xxx` / `标题：xxx` / `【标题】xxx`
 * @param keywords 区块关键词（如 "标题" / "话题标签"），首命中优先
 */
function extractSection(text: string, keywords: string[]): string {
  const lines = (text ?? '').split('\n')
  const headingRe = (kw: string) => new RegExp(`^#{1,3}\\s*${kw}`)
  // 1) 区块式：区块头行 → 跳过内容前的空行 → 收集连续非空内容行（已见内容后遇空行/下一 md 标题结束）
  for (let i = 0; i < lines.length; i++) {
    const t = (lines[i] ?? '').trim()
    if (!keywords.some((kw) => headingRe(kw).test(t))) continue
    // 内联形式（## 标题：xxx）直接取值，避免误入区块式收集下一行
    for (const kw of keywords) {
      const m = t.match(new RegExp(`^#{1,3}\\s*${kw}\\s*[：:]\\s*(.+)`))
      if (m) return (m[1] ?? '').trim()
    }
    const out: string[] = []
    let seenContent = false
    for (let j = i + 1; j < lines.length; j++) {
      const u = (lines[j] ?? '').trim()
      if (seenContent && !u) break // 已收集内容后遇空行 → 区块结束
      if (/^#{1,3}\s/.test(u)) break // 下一 md 标题 → 区块结束
      if (!u) continue // 区块头与内容之间的空行 → 继续找内容
      seenContent = true
      out.push(u)
    }
    if (out.length) return out.join(' ')
    break
  }
  // 2) 内联式：`## 标题：xxx` / `标题：xxx` / `【标题】xxx`
  for (const line of lines) {
    const t = line.trim()
    for (const kw of keywords) {
      const m = t.match(new RegExp(`^#{1,3}\\s*${kw}\\s*[：:]\\s*(.+)`)) ?? t.match(new RegExp(`^${kw}\\s*[：:]\\s*(.+)`))
      if (m) return (m[1] ?? '').trim()
    }
    const bracket = t.match(/^【(.+)】/)
    if (bracket && keywords.includes('标题')) return (bracket[1] ?? '').trim()
  }
  return ''
}

/** 稿件标题：md 区块式/内联式优先，兜底取首个非空且非 md 标题行 */
export function extractTitle(text: string): string {
  const section = extractSection(text, ['标题'])
  if (section) return section
  for (const line of (text ?? '').split('\n')) {
    const s = line.trim()
    if (s && !/^#+\s/.test(s)) return s
  }
  return ''
}

/** 话题标签：md 区块式/内联式优先，兜底取含 #xxx 的行（排除 md 标题行） */
export function extractTags(text: string): string {
  const section = extractSection(text, ['话题标签', '话题', '标签'])
  if (section) return section
  for (const line of (text ?? '').split('\n')) {
    if (/#[^\s#]+/.test(line) && !/^#+\s/.test(line)) return line.trim()
  }
  return ''
}

/**
 * 正文：去掉归档头（`# 稿件 v{N} · 达人`）与"标题/话题标签"区块（含区块内容），
 * 其余内容（含稿件内 md 子标题）原样保留，避免整份 md 作为"稿件文字"一个整块写入
 */
export function extractBody(text: string): string {
  const s = (text ?? '').trim().replace(/^# 稿件 v\d+[^\n]*\n+/, '')
  if (!s) return ''
  const lines = s.split('\n')
  const out: string[] = []
  let skipping = false
  let seenContent = false
  for (const line of lines) {
    const t = line.trim()
    if (skipping) {
      // 跳过区块头与内容之间的空行；已见内容后遇空行/下一 md 标题 → 区块结束
      if (seenContent && (!t || /^#{1,3}\s/.test(t))) {
        skipping = false
        seenContent = false
        continue
      }
      if (!t) continue
      seenContent = true
      continue
    }
    // 内联区块行（标题/内容同行）直接丢弃
    if (/^#{1,3}\s*(标题|话题标签|话题|标签)\s*[：:]\s*\S/.test(t)) continue
    if (/^#{1,3}\s*(标题|话题标签|话题|标签)\s*$/.test(t)) {
      skipping = true
      seenContent = false
      continue
    }
    out.push(line)
  }
  return out.join('\n').trim()
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
      // 已反馈内容：上一轮红卡反馈的"必须修改"清单（旧 5 列历史行补空）
      const lastFeedback = r[5] ?? ''
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
        // 稿件文字：按 md 区块拆出正文（去归档头与标题/话题标签区块），避免整份 md 整块写入
        extractBody(rawText),
        clean,
        lastFeedback,
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
