#!/usr/bin/env bun
/**
 * 一次性修复：补齐未注册的 Campaign 工作区
 *
 * 用途：修复历史遗留数据 —— 早期 Campaign 若品牌名与已有工作区重名，
 * createAgentWorkspace 抛异常被静默吞掉，导致 Campaign 目录存在但工作区
 * 未注册、skills 未复制，表现为「找不到 ma-market-analysis 等 skill」。
 *
 * 用法（在项目根目录）：
 *   bun run scripts/repair-campaign-workspaces.ts            # 只检查，不写入
 *   bun run scripts/repair-campaign-workspaces.ts --apply    # 实际修复
 *
 * 安全性：
 * - 默认 dry-run，只打印将要做什么
 * - --apply 前会先把 agent-workspaces.json 备份为 .bak_repair_<时间戳>
 * - 只处理 campaign-* 目录且存在 campaign.json 的项
 */

import { readdirSync, readFileSync, existsSync, mkdirSync, cpSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'

const MAPRO_DIR = join(homedir(), '.mapro')
const WORKSPACES_DIR = join(MAPRO_DIR, 'agent-workspaces')
const INDEX_PATH = join(MAPRO_DIR, 'agent-workspaces.json')
const DEFAULT_SKILLS_DIR = join(MAPRO_DIR, 'default-skills')

const apply = process.argv.includes('--apply')

/**
 * 营销场景不需要的通用 skill，与 agent-workspace-manager.ts 的
 * EXCLUDED_DEFAULT_SKILLS 保持一致。此处只做两件事：
 * 1. 补 skills 时不复制它们
 * 2. --clean-excluded 时从已有工作区移除
 */
const EXCLUDED_SKILLS = new Set([
  'find-skills',
  'executing-plans',
  'writing-plans',
  'guizang-ppt-skill',
])

interface WorkspaceRecord {
  id: string
  name: string
  slug: string
  createdAt: number
  updatedAt: number
}

interface IndexFile {
  version: number
  workspaces: WorkspaceRecord[]
}

function loadIndex(): IndexFile {
  if (!existsSync(INDEX_PATH)) {
    return { version: 2, workspaces: [] }
  }
  return JSON.parse(readFileSync(INDEX_PATH, 'utf-8')) as IndexFile
}

function main() {
  if (!existsSync(WORKSPACES_DIR)) {
    console.error(`❌ 工作区目录不存在: ${WORKSPACES_DIR}`)
    process.exit(1)
  }
  if (!existsSync(DEFAULT_SKILLS_DIR)) {
    console.error(`❌ 默认 skills 目录不存在: ${DEFAULT_SKILLS_DIR}`)
    process.exit(1)
  }

  const index = loadIndex()
  const registered = new Set(index.workspaces.map((w) => w.slug))
  const entries = readdirSync(WORKSPACES_DIR, { withFileTypes: true })

  const defaultSkills = readdirSync(DEFAULT_SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !EXCLUDED_SKILLS.has(e.name))
    .map((e) => e.name)

  const needRegister: Array<{ slug: string; name: string }> = []
  const needSkills: string[] = []
  const needManifest: string[] = []

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('campaign-')) continue
    const slug = entry.name
    const wsPath = join(WORKSPACES_DIR, slug)
    const manifestPath = join(wsPath, 'campaign.json')
    if (!existsSync(manifestPath)) continue

    let name: string | undefined
    try {
      name = (JSON.parse(readFileSync(manifestPath, 'utf-8')) as { name?: string }).name
    } catch {
      continue
    }
    if (!name) continue

    if (!registered.has(slug)) {
      needRegister.push({ slug, name })
    }

    // SDK 以工作区根目录作为 local plugin，必须有 .claude-plugin/plugin.json 才会加载 skills/
    const pluginManifest = join(wsPath, '.claude-plugin', 'plugin.json')
    if (!existsSync(pluginManifest)) needManifest.push(slug)

    const skillsDir = join(wsPath, 'skills')
    const skillsEmpty = !existsSync(skillsDir) || readdirSync(skillsDir).length === 0
    if (skillsEmpty) needSkills.push(slug)
  }

  // 可选：清理老工作区里多出的通用 skill，使新老统一为 42 个
  const cleanExcluded = process.argv.includes('--clean-excluded')
  const excludedPresent: Array<{ slug: string; skill: string }> = []
  if (cleanExcluded) {
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('campaign-')) continue
      const skillsDir = join(WORKSPACES_DIR, entry.name, 'skills')
      if (!existsSync(skillsDir)) continue
      for (const skill of EXCLUDED_SKILLS) {
        if (existsSync(join(skillsDir, skill))) {
          excludedPresent.push({ slug: entry.name, skill })
        }
      }
    }
  }

  console.log(`索引中已注册工作区: ${index.workspaces.length}`)
  console.log(`默认 skills 数量: ${defaultSkills.length}`)
  console.log('')

  if (needRegister.length === 0 && needSkills.length === 0 && needManifest.length === 0 && excludedPresent.length === 0) {
    console.log('✅ 无需修复：所有 Campaign 工作区均已注册且 skills 齐全')
    return
  }

  if (needRegister.length > 0) {
    console.log(`待注册 ${needRegister.length} 个:`)
    for (const r of needRegister) console.log(`  - ${r.slug}  (name=${r.name})`)
  }
  if (needManifest.length > 0) {
    console.log(`待补 plugin manifest ${needManifest.length} 个（缺它 SDK 不会加载 skills）:`)
    for (const s of needManifest) console.log(`  - ${s}`)
  }
  if (needSkills.length > 0) {
    console.log(`待补 skills ${needSkills.length} 个:`)
    for (const s of needSkills) console.log(`  - ${s}`)
  }
  if (cleanExcluded && excludedPresent.length > 0) {
    console.log(`待清理多余通用 skill ${excludedPresent.length} 项（统一为 42）:`)
    for (const e of excludedPresent) console.log(`  - ${e.slug}/${e.skill}`)
  }

  if (!apply) {
    console.log('')
    console.log('这是 dry-run。确认无误后加 --apply 实际执行：')
    console.log('  bun run scripts/repair-campaign-workspaces.ts --apply')
    return
  }

  // 备份索引
  if (existsSync(INDEX_PATH)) {
    const backup = `${INDEX_PATH}.bak_repair_${Date.now()}`
    copyFileSync(INDEX_PATH, backup)
    console.log(`\n已备份索引 → ${backup}`)
  }

  // 注册未注册的工作区
  const now = Date.now()
  for (const r of needRegister) {
    index.workspaces.unshift({
      id: randomUUID(),
      name: r.name,
      slug: r.slug,
      createdAt: now,
      updatedAt: now,
    })
    console.log(`已注册: ${r.slug} (name=${r.name})`)
  }
  writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), 'utf-8')

  // 补 plugin manifest（SDK 靠它发现 skills/）
  for (const slug of needManifest) {
    const pluginDir = join(WORKSPACES_DIR, slug, '.claude-plugin')
    mkdirSync(pluginDir, { recursive: true })
    writeFileSync(
      join(pluginDir, 'plugin.json'),
      JSON.stringify({ name: `mapro-workspace-${slug}`, version: '1.0.0' }, null, 2),
      'utf-8',
    )
    console.log(`已补 plugin manifest: ${slug}`)
  }

  // 补 skills
  let copied = 0
  for (const slug of needSkills) {
    const target = join(WORKSPACES_DIR, slug, 'skills')
    mkdirSync(target, { recursive: true })
    for (const skill of defaultSkills) {
      const src = join(DEFAULT_SKILLS_DIR, skill)
      const dst = join(target, skill)
      if (existsSync(dst)) continue
      try {
        cpSync(src, dst, { recursive: true })
      } catch (err) {
        console.warn(`  跳过 ${slug}/${skill}: ${err}`)
      }
    }
    copied++
    console.log(`已补 skills: ${slug} (${defaultSkills.length} 个)`)
  }

  // 可选：移除多余通用 skill
  let removed = 0
  for (const e of excludedPresent) {
    try {
      rmSync(join(WORKSPACES_DIR, e.slug, 'skills', e.skill), { recursive: true, force: true })
      removed++
    } catch (err) {
      console.warn(`  清理失败 ${e.slug}/${e.skill}: ${err}`)
    }
  }
  if (removed > 0) console.log(`已清理多余通用 skill: ${removed} 项`)

  console.log('')
  console.log(`✅ 完成：注册 ${needRegister.length} 个，补 manifest ${needManifest.length} 个，补 skills ${copied} 个工作区，清理 ${removed} 项`)
  console.log('请重启 MAPro 使改动生效。')
}

main()
