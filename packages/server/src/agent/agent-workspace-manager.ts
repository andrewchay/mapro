/**
 * Agent 工作区管理器（服务端版本）
 *
 * 负责 Agent 工作区的 CRUD 操作。
 * - 工作区索引：{configDir}/agent-workspaces.json（轻量元数据）
 * - 工作区目录：{configDir}/agent-workspaces/{slug}/（Agent 的 cwd）
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  cpSync,
  rmSync,
  mkdirSync,
  statSync,
  renameSync,
  openSync,
  readSync,
  closeSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, resolve, relative, isAbsolute, dirname, basename } from 'node:path'
import type {
  AgentWorkspace,
  WorkspaceMcpConfig,
  SkillMeta,
  SkillImportSource,
  OtherWorkspaceSkillsGroup,
  WorkspaceCapabilities,
  SkillFileNode,
  SkillFileContent,
} from '@ma-proma/shared'
import {
  getAgentWorkspacesIndexPath,
  getAgentWorkspacePath,
  getWorkspaceMcpPath,
  getWorkspaceSkillsDir,
  getInactiveSkillsDir,
  getDefaultSkillsDir,
  parseSkillVersion,
} from '../context/config-paths.ts'
import { readJsonFileSafe, writeJsonFileAtomic } from '../utils/safe-file.ts'
import type { AppContext } from '../context/types.ts'
import type { ChatToolConfigService } from './chat-tool-config.ts'

export interface AgentWorkspaceManagerDeps {
  context: AppContext
  chatToolConfigService: ChatToolConfigService
}

interface AgentWorkspacesIndex {
  version: number
  workspaces: AgentWorkspace[]
}

const INDEX_VERSION = 2

/** 营销场景不需要的通用 Skills（不复制到工作区） */
const EXCLUDED_DEFAULT_SKILLS = new Set([
  'find-skills',
  'executing-plans',
  'writing-plans',
  'guizang-ppt-skill',
])

/** 防御性目录基名集合：复制 skill 时永远跳过这些目录 */
const SKILL_COPY_BLOCKLIST = new Set([
  '.git',
  '.DS_Store',
  'node_modules',
  'dist',
  '.next',
  '.cache',
  '.turbo',
  '__pycache__',
])

/** 单个子文件大小上限（10 MB） */
const SKILL_FILE_SIZE_LIMIT = 10 * 1024 * 1024
/** 文件树递归深度上限 */
const SKILL_TREE_MAX_DEPTH = 8

const SOURCE_META_FILE = '.source.json'

export class AgentWorkspaceManager {
  private context: AppContext
  private chatToolConfigService: ChatToolConfigService

  constructor(deps: AgentWorkspaceManagerDeps) {
    this.context = deps.context
    this.chatToolConfigService = deps.chatToolConfigService
  }

  /** 校验 slug 只允许小写字母、数字和连字符，防止路径穿越 */
  private assertSafeSlug(slug: string): void {
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) {
      throw new Error(`非法 slug: ${slug}`)
    }
  }

  private workspaceDir(slug: string): string {
    this.assertSafeSlug(slug)
    return getAgentWorkspacePath(this.context, slug)
  }

  private skillsDir(slug: string): string {
    this.assertSafeSlug(slug)
    return getWorkspaceSkillsDir(this.context, slug)
  }

  private inactiveSkillsDir(slug: string): string {
    this.assertSafeSlug(slug)
    return getInactiveSkillsDir(this.context, slug)
  }

  private readIndex(): AgentWorkspacesIndex {
    const indexPath = getAgentWorkspacesIndexPath(this.context)
    const data = readJsonFileSafe<AgentWorkspacesIndex>(indexPath)

    if (data) {
      if ((data.version ?? 1) < INDEX_VERSION) {
        this.migrateIndex(data)
      }
      return data
    }

    return { version: INDEX_VERSION, workspaces: [] }
  }

  private migrateIndex(index: AgentWorkspacesIndex): void {
    const oldVersion = index.version ?? 1

    if (oldVersion < 2) {
      this.activateSkillCreatorInAllWorkspaces(index)
    }

    index.version = INDEX_VERSION
    this.writeIndex(index)
    console.log(`[Agent 工作区] 索引已迁移: v${oldVersion} → v${INDEX_VERSION}`)
  }

  private activateSkillCreatorInAllWorkspaces(index: AgentWorkspacesIndex): void {
    for (const workspace of index.workspaces) {
      const activeDir = this.skillsDir(workspace.slug)
      const inactiveDir = this.inactiveSkillsDir(workspace.slug)

      const inactivePath = join(inactiveDir, 'skill-creator')
      const activePath = join(activeDir, 'skill-creator')

      if (existsSync(activePath) || !existsSync(inactivePath)) continue

      try {
        if (!existsSync(activeDir)) {
          mkdirSync(activeDir, { recursive: true })
        }
        renameSync(inactivePath, activePath)
        console.log(`[Agent 工作区] 已为 ${workspace.slug} 启用 skill-creator`)
      } catch (err) {
        console.warn(`[Agent 工作区] 启用 skill-creator 失败 (${workspace.slug}):`, err)
      }
    }
  }

  private writeIndex(index: AgentWorkspacesIndex): void {
    const indexPath = getAgentWorkspacesIndexPath(this.context)
    try {
      writeJsonFileAtomic(indexPath, index)
    } catch (error) {
      console.error('[Agent 工作区] 写入索引文件失败:', error)
      throw new Error('写入 Agent 工作区索引失败')
    }
  }

  private slugify(name: string, existingSlugs: Set<string>): string {
    let base = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')

    if (!base) {
      base = `workspace-${Date.now()}`
    }

    let slug = base
    let counter = 1
    while (existingSlugs.has(slug)) {
      slug = `${base}-${counter}`
      counter++
    }

    return slug
  }

  /**
   * 返回索引中的存储顺序（与 UI 拖拽顺序一致）
   */
  listAgentWorkspaces(): AgentWorkspace[] {
    const index = this.readIndex()
    return index.workspaces.slice()
  }

  /**
   * 按 updatedAt 降序
   */
  listAgentWorkspacesByUpdatedAt(): AgentWorkspace[] {
    const index = this.readIndex()
    return index.workspaces.slice().sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /**
   * 按指定 ID 顺序重排工作区
   */
  reorderAgentWorkspaces(orderedIds: string[]): AgentWorkspace[] {
    const index = this.readIndex()
    const byId = new Map(index.workspaces.map((w) => [w.id, w]))
    const reordered: AgentWorkspace[] = []
    for (const id of orderedIds) {
      const ws = byId.get(id)
      if (ws) {
        reordered.push(ws)
        byId.delete(id)
      }
    }
    for (const ws of byId.values()) reordered.push(ws)
    index.workspaces = reordered
    this.writeIndex(index)
    return reordered
  }

  /**
   * 按 ID 获取工作区
   */
  getAgentWorkspace(id: string): AgentWorkspace | undefined {
    const index = this.readIndex()
    return index.workspaces.find((w) => w.id === id)
  }

  /**
   * 按 slug 获取工作区
   */
  getAgentWorkspaceBySlug(slug: string): AgentWorkspace | undefined {
    const index = this.readIndex()
    return index.workspaces.find((w) => w.slug === slug)
  }

  private ensureDefaultChatToolsConfig(): void {
    const config = this.chatToolConfigService.getChatToolsConfig()
    this.chatToolConfigService.saveChatToolsConfig(config)
    console.log('[Agent 工作区] 已确保默认 Chat 工具配置（含 KOL Data MCP）')
  }

  private copyDefaultSkills(workspaceSlug: string): void {
    const defaultDir = getDefaultSkillsDir(this.context)
    const targetDir = this.skillsDir(workspaceSlug)

    try {
      const entries = readdirSync(defaultDir, { withFileTypes: true })
      if (entries.length === 0) {
        console.warn(`[Agent 工作区] 默认 Skills 模板为空，工作区 Skills 未初始化: ${workspaceSlug}`)
        return
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        if (EXCLUDED_DEFAULT_SKILLS.has(entry.name)) {
          console.log(`[Agent 工作区] 跳过通用 Skill: ${entry.name}`)
          continue
        }
        const source = join(defaultDir, entry.name)
        const target = join(targetDir, entry.name)
        cpSync(source, target, { recursive: true })
      }
      console.log(`[Agent 工作区] 已复制默认 Skills 到: ${workspaceSlug}`)
    } catch (err) {
      console.error(`[Agent 工作区] 复制默认 Skills 失败 (${workspaceSlug}):`, err)
    }
  }

  /**
   * 创建工作区
   */
  createAgentWorkspace(name: string, slug?: string): AgentWorkspace {
    const index = this.readIndex()

    const duplicate = index.workspaces.find((w) => w.name === name)
    if (duplicate) {
      throw new Error(`工作区名称「${name}」已存在`)
    }

    const existingSlugs = new Set(index.workspaces.map((w) => w.slug))
    const finalSlug = slug ?? this.slugify(name, existingSlugs)
    this.assertSafeSlug(finalSlug)
    if (existingSlugs.has(finalSlug)) {
      throw new Error(`工作区 slug「${finalSlug}」已存在`)
    }

    const now = Date.now()
    const workspace: AgentWorkspace = {
      id: randomUUID(),
      name,
      slug: finalSlug,
      createdAt: now,
      updatedAt: now,
    }

    this.workspaceDir(finalSlug)
    this.ensurePluginManifest(finalSlug, name)
    this.copyDefaultSkills(finalSlug)

    index.workspaces.unshift(workspace)
    this.writeIndex(index)

    console.log(`[Agent 工作区] 已创建工作区: ${name} (slug: ${finalSlug})`)
    return workspace
  }

  /**
   * 更新工作区名称
   */
  updateAgentWorkspace(id: string, updates: { name: string }): AgentWorkspace {
    const index = this.readIndex()
    const idx = index.workspaces.findIndex((w) => w.id === id)

    if (idx === -1) {
      throw new Error(`Agent 工作区不存在: ${id}`)
    }

    const existing = index.workspaces[idx]!
    const duplicate = index.workspaces.find((w) => w.id !== id && w.name === updates.name)
    if (duplicate) {
      throw new Error(`工作区名称「${updates.name}」已存在`)
    }

    const updated: AgentWorkspace = {
      ...existing,
      name: updates.name,
      updatedAt: Date.now(),
    }

    index.workspaces[idx] = updated
    this.writeIndex(index)

    console.log(`[Agent 工作区] 已更新工作区: ${updated.name} (${updated.id})`)
    return updated
  }

  /**
   * 删除工作区索引条目，保留目录避免误删用户文件
   */
  deleteAgentWorkspace(id: string): void {
    const index = this.readIndex()
    const idx = index.workspaces.findIndex((w) => w.id === id)

    if (idx === -1) {
      throw new Error(`Agent 工作区不存在: ${id}`)
    }

    const removed = index.workspaces.splice(idx, 1)[0]!
    this.writeIndex(index)

    console.log(`[Agent 工作区] 已删除工作区索引: ${removed.name} (slug: ${removed.slug}，目录已保留)`)
  }

  /**
   * 确保默认营销工作区存在
   */
  ensureDefaultWorkspace(): AgentWorkspace {
    const index = this.readIndex()
    let defaultWs = index.workspaces.find((w) => w.slug === 'default')

    if (!defaultWs) {
      const now = Date.now()
      defaultWs = {
        id: randomUUID(),
        name: '默认营销工作区',
        slug: 'default',
        createdAt: now,
        updatedAt: now,
      }

      this.workspaceDir('default')
      this.ensurePluginManifest('default', '默认营销工作区')
      this.copyDefaultSkills('default')
      this.ensureDefaultChatToolsConfig()

      index.workspaces.push(defaultWs)
      this.writeIndex(index)

      console.log('[Agent 工作区] 已创建默认营销工作区')
    } else {
      this.ensurePluginManifest(defaultWs.slug, defaultWs.name)
      if (defaultWs.name === '默认工作区') {
        defaultWs = { ...defaultWs, name: '默认营销工作区', updatedAt: Date.now() }
        const idx = index.workspaces.findIndex((w) => w.slug === 'default')
        if (idx !== -1) {
          index.workspaces[idx] = defaultWs
          this.writeIndex(index)
          console.log('[Agent 工作区] 已迁移默认工作区名称为"默认营销工作区"')
        }
      }
    }

    return defaultWs
  }

  // =====================================================================
  // 默认 Skills 自动升级
  // =====================================================================

  /**
   * 同步默认 Skills 到所有工作区
   */
  upgradeDefaultSkillsInWorkspaces(): void {
    const defaultDir = getDefaultSkillsDir(this.context)

    interface DefaultSkillInfo {
      version: string
      sourcePath: string
    }
    const defaultSkills = new Map<string, DefaultSkillInfo>()

    try {
      const entries = readdirSync(defaultDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const sourcePath = join(defaultDir, entry.name)
        defaultSkills.set(entry.name, {
          version: parseSkillVersion(sourcePath),
          sourcePath,
        })
      }
    } catch {
      return
    }

    if (defaultSkills.size === 0) return

    const index = this.readIndex()

    for (const workspace of index.workspaces) {
      const activeDir = this.skillsDir(workspace.slug)
      const inactiveDir = this.inactiveSkillsDir(workspace.slug)

      for (const [slug, info] of defaultSkills) {
        const activePath = join(activeDir, slug)
        const inactivePath = join(inactiveDir, slug)

        if (existsSync(activePath)) {
          const currentVer = parseSkillVersion(activePath)
          if (compareSemver(info.version, currentVer) > 0) {
            if (this.safeReplaceSkillDir(info.sourcePath, activePath)) {
              console.log(
                `[Agent 工作区] 已升级默认 Skill: ${workspace.slug}/${slug} (active, ${currentVer} → ${info.version})`,
              )
            } else {
              console.warn(
                `[Agent 工作区] 升级默认 Skill 失败 (${workspace.slug}/${slug}, active)，跳过`,
              )
            }
          }
          continue
        }

        if (existsSync(inactivePath)) {
          const currentVer = parseSkillVersion(inactivePath)
          if (compareSemver(info.version, currentVer) > 0) {
            if (this.safeReplaceSkillDir(info.sourcePath, inactivePath)) {
              console.log(
                `[Agent 工作区] 已升级默认 Skill: ${workspace.slug}/${slug} (inactive, ${currentVer} → ${info.version})`,
              )
            } else {
              console.warn(
                `[Agent 工作区] 升级默认 Skill 失败 (${workspace.slug}/${slug}, inactive)，跳过`,
              )
            }
          }
          continue
        }

        try {
          if (!existsSync(activeDir)) mkdirSync(activeDir, { recursive: true })
          cpSync(info.sourcePath, activePath, { recursive: true, filter: skillCopyFilter })
          console.log(`[Agent 工作区] 已注入新默认 Skill: ${workspace.slug}/${slug} → active`)
        } catch (err) {
          console.warn(`[Agent 工作区] 注入默认 Skill 失败 (${workspace.slug}/${slug}):`, err)
        }
      }
    }
  }

  private safeReplaceSkillDir(sourcePath: string, targetPath: string): boolean {
    try {
      rmSync(targetPath, { recursive: true, force: true })
      cpSync(sourcePath, targetPath, { recursive: true, filter: skillCopyFilter })
      return true
    } catch (err) {
      console.warn(`[Agent 工作区] safeReplaceSkillDir 失败 (${targetPath}):`, err)
      return false
    }
  }

  // =====================================================================
  // Plugin Manifest
  // =====================================================================

  /**
   * 确保工作区包含 .claude-plugin/plugin.json
   */
  ensurePluginManifest(workspaceSlug: string, workspaceName: string): void {
    const wsPath = this.workspaceDir(workspaceSlug)
    const pluginDir = join(wsPath, '.claude-plugin')
    const manifestPath = join(pluginDir, 'plugin.json')

    if (existsSync(manifestPath)) return

    if (!existsSync(pluginDir)) {
      mkdirSync(pluginDir, { recursive: true })
    }

    const manifest = {
      name: `mapro-workspace-${workspaceSlug}`,
      version: '1.0.0',
    }

    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
    console.log(`[Agent 工作区] 已创建 plugin manifest: ${workspaceSlug}`)
  }

  // =====================================================================
  // MCP 配置管理
  // =====================================================================

  /**
   * 获取工作区 MCP 配置
   */
  getWorkspaceMcpConfig(workspaceSlug: string): WorkspaceMcpConfig {
    this.assertSafeSlug(workspaceSlug)
    const mcpPath = getWorkspaceMcpPath(this.context, workspaceSlug)

    if (!existsSync(mcpPath)) {
      return { servers: {} }
    }

    try {
      const raw = readFileSync(mcpPath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<WorkspaceMcpConfig>
      return { servers: parsed.servers ?? {} }
    } catch (error) {
      console.error('[Agent 工作区] 读取 MCP 配置失败:', error)
      return { servers: {} }
    }
  }

  /**
   * 保存工作区 MCP 配置
   */
  saveWorkspaceMcpConfig(workspaceSlug: string, config: WorkspaceMcpConfig): void {
    this.assertSafeSlug(workspaceSlug)
    const mcpPath = getWorkspaceMcpPath(this.context, workspaceSlug)
    try {
      writeFileSync(mcpPath, JSON.stringify(config, null, 2), 'utf-8')
      console.log(`[Agent 工作区] 已保存 MCP 配置: ${workspaceSlug}`)
    } catch (error) {
      console.error('[Agent 工作区] 保存 MCP 配置失败:', error)
      throw new Error('保存 MCP 配置失败')
    }
  }


  // =====================================================================
  // Skill 目录扫描
  // =====================================================================

  /**
   * 扫描工作区活跃 Skills
   */
  getWorkspaceSkills(workspaceSlug: string): SkillMeta[] {
    return this.scanSkillsInDir(this.skillsDir(workspaceSlug), true)
  }

  /**
   * 获取工作区所有 Skills（含活跃和不活跃）
   */
  getAllWorkspaceSkills(workspaceSlug: string): SkillMeta[] {
    const activeSkills = this.scanSkillsInDir(this.skillsDir(workspaceSlug), true)
    const inactiveSkills = this.scanSkillsInDir(this.inactiveSkillsDir(workspaceSlug), false)
    return [...activeSkills, ...inactiveSkills]
  }

  /**
   * 获取工作区能力摘要
   */
  getWorkspaceCapabilities(workspaceSlug: string): WorkspaceCapabilities {
    const mcpConfig = this.getWorkspaceMcpConfig(workspaceSlug)
    const skills = this.getWorkspaceSkills(workspaceSlug)

    const mcpServers = Object.entries(mcpConfig.servers ?? {}).map(([name, entry]) => ({
      name,
      enabled: entry.enabled,
      type: entry.type,
    }))

    return { mcpServers, skills }
  }

  /**
   * 删除工作区 Skill
   */
  deleteWorkspaceSkill(workspaceSlug: string, skillSlug: string): void {
    this.assertSafeSlug(skillSlug)
    const skillsDir = this.skillsDir(workspaceSlug)
    const skillPath = join(skillsDir, skillSlug)

    if (!existsSync(skillPath)) {
      throw new Error(`Skill 不存在: ${skillSlug}`)
    }

    rmSync(skillPath, { recursive: true, force: true })
    console.log(`[Agent 工作区] 已删除 Skill: ${workspaceSlug}/${skillSlug}`)
  }

  private scanSkillsInDir(dir: string, enabled: boolean): SkillMeta[] {
    const skills: SkillMeta[] = []

    try {
      const entries = readdirSync(dir, { withFileTypes: true })

      for (const entry of entries) {
        const isDir = entry.isDirectory() || (entry.isSymbolicLink() && statSync(join(dir, entry.name)).isDirectory())
        if (!isDir) continue

        const skillMdPath = join(dir, entry.name, 'SKILL.md')
        if (!existsSync(skillMdPath)) continue

        try {
          const content = readFileSync(skillMdPath, 'utf-8')
          const meta = parseSkillFrontmatter(content, entry.name, enabled)

          const importSource = this.readSkillImportSource(join(dir, entry.name))
          if (importSource) {
            meta.importSource = importSource
            const sourceSkillDir = this.resolveSkillDir(importSource.sourceWorkspaceSlug, entry.name)
            if (sourceSkillDir) {
              const currentSourceVersion = parseSkillVersion(sourceSkillDir)
              meta.hasUpdate = isNewerVersion(currentSourceVersion, importSource.sourceVersion)
            }
          }

          skills.push(meta)
        } catch {
          console.warn(`[Agent 工作区] 解析 Skill 失败: ${entry.name}`)
        }
      }
    } catch {
      // 目录可能不存在
    }

    return skills
  }

  /**
   * 在 skills/ 和 skills-inactive/ 之间移动来切换启用/禁用
   */
  toggleWorkspaceSkill(workspaceSlug: string, skillSlug: string, enabled: boolean): void {
    this.assertSafeSlug(skillSlug)
    const activeDir = this.skillsDir(workspaceSlug)
    const inactiveDir = this.inactiveSkillsDir(workspaceSlug)

    const srcDir = enabled ? inactiveDir : activeDir
    const destDir = enabled ? activeDir : inactiveDir

    const srcPath = join(srcDir, skillSlug)
    const destPath = join(destDir, skillSlug)

    if (!existsSync(srcPath)) {
      throw new Error(`Skill 不存在: ${skillSlug}`)
    }

    if (existsSync(destPath)) {
      throw new Error(`目标目录已存在同名 Skill: ${skillSlug}`)
    }

    renameSync(srcPath, destPath)
    console.log(`[Agent 工作区] Skill ${enabled ? '启用' : '禁用'}: ${workspaceSlug}/${skillSlug}`)
  }

  /**
   * 获取其他工作区的 Skill 列表
   */
  getOtherWorkspaceSkills(currentSlug: string): OtherWorkspaceSkillsGroup[] {
    const workspaces = this.listAgentWorkspaces()
    const result: OtherWorkspaceSkillsGroup[] = []

    for (const workspace of workspaces) {
      if (workspace.slug === currentSlug) continue

      const skills = this.getAllWorkspaceSkills(workspace.slug)
      if (skills.length === 0) continue

      result.push({
        workspaceName: workspace.name,
        workspaceSlug: workspace.slug,
        skills,
      })
    }

    return result
  }

  /**
   * 从其他工作区导入 Skill
   */
  importSkillFromWorkspace(targetSlug: string, sourceSlug: string, skillSlug: string): SkillMeta {
    this.assertSafeSlug(skillSlug)
    const sourcePath = this.resolveSkillDir(sourceSlug, skillSlug)

    if (!sourcePath) {
      throw new Error(`源工作区中不存在 Skill: ${skillSlug}`)
    }

    const sourceSkillMdPath = join(sourcePath, 'SKILL.md')
    if (!existsSync(sourceSkillMdPath)) {
      throw new Error(`源 Skill 缺少 SKILL.md: ${skillSlug}`)
    }

    const targetPath = join(this.skillsDir(targetSlug), skillSlug)
    const targetInactivePath = join(this.inactiveSkillsDir(targetSlug), skillSlug)

    if (existsSync(targetPath) || existsSync(targetInactivePath)) {
      throw new Error(`当前工作区已存在同名 Skill: ${skillSlug}`)
    }

    cpSync(sourcePath, targetPath, { recursive: true })

    const sourceWorkspace = this.listAgentWorkspaces().find((w) => w.slug === sourceSlug)
    const importSource: SkillImportSource = {
      sourceWorkspaceSlug: sourceSlug,
      sourceWorkspaceName: sourceWorkspace?.name ?? sourceSlug,
      importedAt: new Date().toISOString(),
      sourceVersion: parseSkillVersion(sourcePath),
    }
    this.writeSkillImportSource(targetPath, importSource)

    console.log(`[Agent 工作区] 已从 ${sourceSlug} 导入 Skill: ${targetSlug}/${skillSlug}`)

    const content = readFileSync(join(targetPath, 'SKILL.md'), 'utf-8')
    const meta = parseSkillFrontmatter(content, skillSlug, true)
    meta.importSource = importSource
    return meta
  }

  /**
   * 从源工作区同步更新已导入的 Skill
   */
  updateSkillFromSource(targetSlug: string, skillSlug: string): SkillMeta {
    this.assertSafeSlug(skillSlug)
    const activeDir = this.skillsDir(targetSlug)
    const inactiveDir = this.inactiveSkillsDir(targetSlug)

    const targetPath = existsSync(join(activeDir, skillSlug))
      ? join(activeDir, skillSlug)
      : existsSync(join(inactiveDir, skillSlug))
        ? join(inactiveDir, skillSlug)
        : null

    if (!targetPath) {
      throw new Error(`当前工作区中不存在 Skill: ${skillSlug}`)
    }

    const existingSource = this.readSkillImportSource(targetPath)
    if (!existingSource) {
      throw new Error(`Skill ${skillSlug} 不是从其他工作区导入的，无法从源更新`)
    }

    const sourcePath = this.resolveSkillDir(existingSource.sourceWorkspaceSlug, skillSlug)
    if (!sourcePath) {
      throw new Error(`源工作区中不再存在 Skill: ${skillSlug}（来源: ${existingSource.sourceWorkspaceName}）`)
    }

    if (!existsSync(join(sourcePath, 'SKILL.md'))) {
      throw new Error(`源 Skill 缺少 SKILL.md: ${skillSlug}`)
    }

    const parentDir = join(targetPath, '..')
    const tmpPath = join(parentDir, `.${skillSlug}.updating`)
    try {
      cpSync(sourcePath, tmpPath, { recursive: true })
    } catch (err) {
      if (existsSync(tmpPath)) rmSync(tmpPath, { recursive: true, force: true })
      throw err
    }
    rmSync(targetPath, { recursive: true, force: true })
    renameSync(tmpPath, targetPath)

    const sourceWorkspace = this.listAgentWorkspaces().find((w) => w.slug === existingSource.sourceWorkspaceSlug)
    const updatedSource: SkillImportSource = {
      sourceWorkspaceSlug: existingSource.sourceWorkspaceSlug,
      sourceWorkspaceName: sourceWorkspace?.name ?? existingSource.sourceWorkspaceName,
      importedAt: existingSource.importedAt,
      sourceVersion: parseSkillVersion(sourcePath),
    }
    this.writeSkillImportSource(targetPath, updatedSource)

    const enabled = targetPath === join(activeDir, skillSlug)
    const content = readFileSync(join(targetPath, 'SKILL.md'), 'utf-8')
    const meta = parseSkillFrontmatter(content, skillSlug, enabled)
    meta.importSource = updatedSource
    meta.hasUpdate = false

    console.log(`[Agent 工作区] 已从源更新 Skill: ${targetSlug}/${skillSlug}`)
    return meta
  }

  private readSkillImportSource(skillDir: string): SkillImportSource | undefined {
    const p = join(skillDir, SOURCE_META_FILE)
    if (!existsSync(p)) return undefined
    try {
      return JSON.parse(readFileSync(p, 'utf-8')) as SkillImportSource
    } catch {
      return undefined
    }
  }

  private writeSkillImportSource(skillDir: string, source: SkillImportSource): void {
    writeFileSync(join(skillDir, SOURCE_META_FILE), JSON.stringify(source, null, 2), 'utf-8')
  }

  private resolveSkillDir(workspaceSlug: string, skillSlug: string): string | null {
    this.assertSafeSlug(skillSlug)
    const active = join(this.skillsDir(workspaceSlug), skillSlug)
    if (existsSync(active)) return active
    const inactive = join(this.inactiveSkillsDir(workspaceSlug), skillSlug)
    if (existsSync(inactive)) return inactive
    return null
  }

  /**
   * 读取工作区 SKILL.md 内容
   */
  readWorkspaceSkillContent(workspaceSlug: string, skillSlug: string): string {
    const dir = this.resolveSkillDir(workspaceSlug, skillSlug)
    if (!dir) throw new Error(`Skill 不存在: ${workspaceSlug}/${skillSlug}`)
    const mdPath = join(dir, 'SKILL.md')
    if (!existsSync(mdPath)) throw new Error(`SKILL.md 不存在: ${mdPath}`)
    return readFileSync(mdPath, 'utf-8')
  }

  /**
   * 写入工作区 SKILL.md 内容
   */
  writeWorkspaceSkillContent(workspaceSlug: string, skillSlug: string, content: string): void {
    const dir = this.resolveSkillDir(workspaceSlug, skillSlug)
    if (!dir) throw new Error(`Skill 不存在: ${workspaceSlug}/${skillSlug}`)
    writeFileSync(join(dir, 'SKILL.md'), content, 'utf-8')
    console.log(`[Agent 工作区] 已更新 SKILL.md: ${workspaceSlug}/${skillSlug}`)
  }


  // =====================================================================
  // Skill 子文件管理
  // =====================================================================

  /**
   * 列出 Skill 子文件树
   */
  listSkillFiles(workspaceSlug: string, skillSlug: string): SkillFileNode[] {
    const dir = this.resolveSkillDir(workspaceSlug, skillSlug)
    if (!dir) throw new Error(`Skill 不存在: ${workspaceSlug}/${skillSlug}`)
    return this.buildSkillFileTree(dir, dir, 0)
  }

  /**
   * 读取 Skill 子文件
   */
  readSkillFile(workspaceSlug: string, skillSlug: string, relativePath: string): SkillFileContent {
    const dir = this.resolveSkillDir(workspaceSlug, skillSlug)
    if (!dir) throw new Error(`Skill 不存在: ${workspaceSlug}/${skillSlug}`)
    const abs = this.resolveSkillChildPath(dir, relativePath)
    if (!existsSync(abs)) throw new Error(`文件不存在: ${relativePath}`)

    const st = statSync(abs)
    if (!st.isFile()) throw new Error(`目标不是文件: ${relativePath}`)
    if (st.size > SKILL_FILE_SIZE_LIMIT) {
      throw new Error(`文件过大（${(st.size / 1024 / 1024).toFixed(2)} MB），超过 10 MB 限制`)
    }

    const binary = this.isLikelyBinaryFile(abs, st.size)
    return {
      relativePath: relative(dir, abs).split(/[\\/]/).join('/'),
      isText: !binary,
      size: st.size,
      content: binary ? undefined : readFileSync(abs, 'utf-8'),
    }
  }

  /**
   * 写入 Skill 子文件
   */
  writeSkillFile(workspaceSlug: string, skillSlug: string, relativePath: string, content: string): void {
    const dir = this.resolveSkillDir(workspaceSlug, skillSlug)
    if (!dir) throw new Error(`Skill 不存在: ${workspaceSlug}/${skillSlug}`)
    const abs = this.resolveSkillChildPath(dir, relativePath)

    const byteLen = Buffer.byteLength(content, 'utf-8')
    if (byteLen > SKILL_FILE_SIZE_LIMIT) {
      throw new Error(`内容过大（${(byteLen / 1024 / 1024).toFixed(2)} MB），超过 10 MB 限制`)
    }

    if (existsSync(abs) && statSync(abs).isDirectory()) {
      throw new Error(`目标是目录，无法写入文件内容: ${relativePath}`)
    }

    const parent = dirname(abs)
    if (!existsSync(parent)) {
      mkdirSync(parent, { recursive: true })
    }

    writeFileSync(abs, content, 'utf-8')
    console.log(`[Agent 工作区] 已更新 Skill 子文件: ${workspaceSlug}/${skillSlug}/${relativePath}`)
  }

  /**
   * 创建 Skill 子项
   */
  createSkillEntry(
    workspaceSlug: string,
    skillSlug: string,
    relativePath: string,
    type: 'file' | 'directory',
  ): void {
    this.assertSafeSlug(skillSlug)
    const dir = this.resolveSkillDir(workspaceSlug, skillSlug)
    if (!dir) throw new Error(`Skill 不存在: ${workspaceSlug}/${skillSlug}`)
    const abs = this.resolveSkillChildPath(dir, relativePath)

    if (existsSync(abs)) {
      throw new Error(`目标已存在: ${relativePath}`)
    }

    if (type === 'directory') {
      mkdirSync(abs, { recursive: true })
    } else {
      const parent = dirname(abs)
      if (!existsSync(parent)) {
        mkdirSync(parent, { recursive: true })
      }
      writeFileSync(abs, '', 'utf-8')
    }
    console.log(`[Agent 工作区] 已创建 Skill 子${type === 'directory' ? '目录' : '文件'}: ${workspaceSlug}/${skillSlug}/${relativePath}`)
  }

  /**
   * 删除 Skill 子项
   */
  deleteSkillEntry(workspaceSlug: string, skillSlug: string, relativePath: string): void {
    const dir = this.resolveSkillDir(workspaceSlug, skillSlug)
    if (!dir) throw new Error(`Skill 不存在: ${workspaceSlug}/${skillSlug}`)
    const abs = this.resolveSkillChildPath(dir, relativePath)
    if (!existsSync(abs)) {
      throw new Error(`目标不存在: ${relativePath}`)
    }
    rmSync(abs, { recursive: true, force: true })
    console.log(`[Agent 工作区] 已删除 Skill 子项: ${workspaceSlug}/${skillSlug}/${relativePath}`)
  }

  /**
   * 重命名 Skill 子项
   */
  renameSkillEntry(
    workspaceSlug: string,
    skillSlug: string,
    fromRelative: string,
    toRelative: string,
  ): void {
    this.assertSafeSlug(skillSlug)
    const dir = this.resolveSkillDir(workspaceSlug, skillSlug)
    if (!dir) throw new Error(`Skill 不存在: ${workspaceSlug}/${skillSlug}`)
    const fromAbs = this.resolveSkillChildPath(dir, fromRelative)
    const toAbs = this.resolveSkillChildPath(dir, toRelative)
    if (!existsSync(fromAbs)) {
      throw new Error(`源不存在: ${fromRelative}`)
    }
    if (existsSync(toAbs)) {
      throw new Error(`目标已存在: ${toRelative}`)
    }
    const parent = dirname(toAbs)
    if (!existsSync(parent)) {
      mkdirSync(parent, { recursive: true })
    }
    renameSync(fromAbs, toAbs)
    console.log(`[Agent 工作区] Skill 子项重命名: ${workspaceSlug}/${skillSlug}: ${fromRelative} → ${toRelative}`)
  }

  private resolveSkillChildPath(skillDir: string, relativePath: string, opts: { allowSkillMd?: boolean } = {}): string {
    if (typeof relativePath !== 'string' || relativePath.length === 0) {
      throw new Error('相对路径不能为空')
    }
    if (isAbsolute(relativePath)) {
      throw new Error('禁止传入绝对路径')
    }
    const normalized = relativePath.replace(/\\/g, '/')
    const resolved = resolve(skillDir, normalized)
    const rel = relative(skillDir, resolved)
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error('非法路径：禁止访问 Skill 目录外')
    }
    if (!opts.allowSkillMd && rel.split(/[\\/]/).join('/').toLowerCase() === 'skill.md') {
      throw new Error('SKILL.md 由专用接口管理，请通过 readWorkspaceSkillContent / writeWorkspaceSkillContent')
    }
    return resolved
  }

  private isLikelyBinaryFile(absPath: string, size: number): boolean {
    if (size === 0) return false
    let fd: number | undefined
    try {
      fd = openSync(absPath, 'r')
      const buf = Buffer.alloc(Math.min(size, 8192))
      const n = readSync(fd, buf, 0, buf.length, 0)
      return buf.subarray(0, n).includes(0)
    } catch {
      return true
    } finally {
      if (fd !== undefined) closeSync(fd)
    }
  }

  private buildSkillFileTree(rootDir: string, currentDir: string, depth: number): SkillFileNode[] {
    if (depth > SKILL_TREE_MAX_DEPTH) return []
    let entries: import('node:fs').Dirent[]
    try {
      entries = readdirSync(currentDir, { withFileTypes: true })
    } catch {
      return []
    }

    const nodes: SkillFileNode[] = []
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const absPath = join(currentDir, entry.name)
      const rel = relative(rootDir, absPath).split(/[\\/]/).join('/')

      if (rel === 'SKILL.md') continue

      const isDir = entry.isDirectory()
      if (isDir) {
        nodes.push({
          relativePath: rel,
          name: entry.name,
          type: 'directory',
          children: this.buildSkillFileTree(rootDir, absPath, depth + 1),
        })
      } else if (entry.isFile()) {
        let size = 0
        try {
          size = statSync(absPath).size
        } catch {
          // ignore
        }
        nodes.push({
          relativePath: rel,
          name: entry.name,
          type: 'file',
          size,
          isText: !this.isLikelyBinaryFile(absPath, size),
        })
      }
    }

    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    return nodes
  }

  // =====================================================================
  // 工作区配置管理
  // =====================================================================

  private getWorkspaceConfigPath(workspaceSlug: string): string {
    return join(this.workspaceDir(workspaceSlug), 'config.json')
  }

  private readWorkspaceConfig(workspaceSlug: string): WorkspaceConfig {
    const configPath = this.getWorkspaceConfigPath(workspaceSlug)

    if (!existsSync(configPath)) {
      return {}
    }

    try {
      const raw = readFileSync(configPath, 'utf-8')
      const data = JSON.parse(raw) as Partial<WorkspaceConfig>
      return {
        attachedDirectories: Array.isArray(data.attachedDirectories)
          ? data.attachedDirectories.filter((dir): dir is string => typeof dir === 'string')
          : undefined,
        attachedFiles: Array.isArray(data.attachedFiles)
          ? data.attachedFiles.filter((file): file is string => typeof file === 'string')
          : undefined,
      }
    } catch {
      return {}
    }
  }

  private writeWorkspaceConfig(workspaceSlug: string, config: WorkspaceConfig): void {
    const configPath = this.getWorkspaceConfigPath(workspaceSlug)
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
  }

  /**
   * 获取工作区附加目录
   */
  getWorkspaceAttachedDirectories(workspaceSlug: string): string[] {
    const config = this.readWorkspaceConfig(workspaceSlug)
    return config.attachedDirectories ?? []
  }

  /**
   * 附加目录到工作区
   */
  attachWorkspaceDirectory(workspaceSlug: string, directoryPath: string): string[] {
    const config = this.readWorkspaceConfig(workspaceSlug)
    const existing = config.attachedDirectories ?? []

    if (existing.includes(directoryPath)) {
      return existing
    }

    const updated = [...existing, directoryPath]
    this.writeWorkspaceConfig(workspaceSlug, { ...config, attachedDirectories: updated })
    console.log(`[Agent 工作区] 已附加工作区目录: ${directoryPath} → ${workspaceSlug}`)
    return updated
  }

  /**
   * 移除工作区附加目录
   */
  detachWorkspaceDirectory(workspaceSlug: string, directoryPath: string): string[] {
    const config = this.readWorkspaceConfig(workspaceSlug)
    const existing = config.attachedDirectories ?? []
    const updated = existing.filter((d) => d !== directoryPath)
    this.writeWorkspaceConfig(workspaceSlug, { ...config, attachedDirectories: updated })
    console.log(`[Agent 工作区] 已移除工作区目录: ${directoryPath} ← ${workspaceSlug}`)
    return updated
  }

  /**
   * 获取工作区附加文件
   */
  getWorkspaceAttachedFiles(workspaceSlug: string): string[] {
    const config = this.readWorkspaceConfig(workspaceSlug)
    return config.attachedFiles ?? []
  }

  /**
   * 附加文件到工作区
   */
  attachWorkspaceFile(workspaceSlug: string, filePath: string): string[] {
    const config = this.readWorkspaceConfig(workspaceSlug)
    const existing = config.attachedFiles ?? []

    if (existing.includes(filePath)) {
      return existing
    }

    const updated = [...existing, filePath]
    this.writeWorkspaceConfig(workspaceSlug, { ...config, attachedFiles: updated })
    console.log(`[Agent 工作区] 已附加工作区文件: ${filePath} → ${workspaceSlug}`)
    return updated
  }

  /**
   * 移除工作区附加文件
   */
  detachWorkspaceFile(workspaceSlug: string, filePath: string): string[] {
    const config = this.readWorkspaceConfig(workspaceSlug)
    const existing = config.attachedFiles ?? []
    const updated = existing.filter((f) => f !== filePath)
    this.writeWorkspaceConfig(workspaceSlug, { ...config, attachedFiles: updated })
    console.log(`[Agent 工作区] 已移除工作区文件: ${filePath} ← ${workspaceSlug}`)
    return updated
  }
}

// =====================================================================
// 独立帮助函数
// =====================================================================

interface WorkspaceConfig {
  attachedDirectories?: string[]
  attachedFiles?: string[]
}

function skillCopyFilter(src: string): boolean {
  return !SKILL_COPY_BLOCKLIST.has(basename(src))
}

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function parseSkillFrontmatter(content: string, slug: string, enabled: boolean): SkillMeta {
  const meta: SkillMeta = { slug, name: slug, enabled }

  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!fmMatch) return meta

  const yaml = fmMatch[1]
  if (!yaml) return meta

  const validKeys = new Set(['name', 'description', 'icon', 'version'])
  const entries: Record<string, string> = {}
  let currentKey = ''
  let isFolded = false

  for (const line of yaml.split('\n')) {
    const indented = /^\s/.test(line)

    if (!indented) {
      const colonIdx = line.indexOf(':')
      if (colonIdx === -1) { currentKey = ''; continue }

      const key = line.slice(0, colonIdx).trim()
      const raw = line.slice(colonIdx + 1).trim()

      if (!validKeys.has(key)) { currentKey = ''; isFolded = false; continue }

      if (raw === '|' || raw === '>') {
        currentKey = key
        isFolded = raw === '>'
        entries[key] = ''
        continue
      }

      currentKey = key
      isFolded = false
      entries[key] = raw.replace(/^["']|["']$/g, '')
    } else if (currentKey) {
      const text = line.trim()
      if (!text) { if (entries[currentKey]) entries[currentKey] += '\n'; continue }
      const sep = isFolded ? ' ' : '\n'
      entries[currentKey] = entries[currentKey] ? entries[currentKey] + sep + text : text
    }
  }

  if (entries.name) meta.name = entries.name.trim()
  if (entries.description) meta.description = entries.description.trim()
  if (entries.icon) meta.icon = entries.icon.trim()
  if (entries.version) meta.version = entries.version.trim()

  return meta
}

function isNewerVersion(a: string, b: string): boolean {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff > 0
  }
  return false
}
