/**
 * Campaign 工作区自愈逻辑
 *
 * 背景：早期 Campaign 若品牌名与已有工作区重名，createAgentWorkspace 会抛
 * 「工作区名称已存在」并被 createCampaign 的 catch 静默吞掉 —— Campaign 目录
 * 存在，但工作区从未注册、skills 从未复制，用户表现为「找不到 ma-market-analysis」。
 *
 * 这里验证三件事：
 * 1. createAgentWorkspace 的 skipNameCheck 允许同名工作区
 * 2. ensureWorkspaceRegistered 能把未注册的目录补进索引
 * 3. repairUnregisteredCampaignWorkspaces 能扫描磁盘并批量修复
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let testConfigDir: string

beforeEach(() => {
  testConfigDir = mkdtempSync(join(tmpdir(), 'mapro-ws-repair-'))
  process.env._MAPRO_TEST_CONFIG_DIR = testConfigDir
})

afterEach(() => {
  delete process.env._MAPRO_TEST_CONFIG_DIR
  try {
    rmSync(testConfigDir, { recursive: true, force: true })
  } catch {
    // ignore
  }
})

/** 动态导入，确保 config 目录环境变量已生效后再加载模块 */
async function loadModule() {
  return await import('../agent-workspace-manager')
}

/** 造一个默认 skill，供 copyDefaultSkills 复制 */
function seedDefaultSkill(name = 'ma-market-analysis') {
  const dir = join(testConfigDir, 'default-skills', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: test\nversion: "1.0.0"\n---\n\n# ${name}\n`,
    'utf-8',
  )
}

function readIndexWorkspaces(): Array<{ name: string; slug: string }> {
  const p = join(testConfigDir, 'agent-workspaces.json')
  if (!existsSync(p)) return []
  return JSON.parse(readFileSync(p, 'utf-8')).workspaces ?? []
}

describe('Campaign 工作区名称查重豁免', () => {
  it('skipNameCheck=true 时允许创建同名工作区', async () => {
    seedDefaultSkill()
    const { createAgentWorkspace } = await loadModule()

    createAgentWorkspace('vonbon', 'campaign-a')
    // 同名再建，默认应抛错
    expect(() => createAgentWorkspace('vonbon', 'campaign-b')).toThrow(/已存在/)

    // 开启豁免则可创建（slug 不同即合法，Campaign slug 是 UUID）
    const ws = createAgentWorkspace('vonbon', 'campaign-c', undefined, { skipNameCheck: true })
    expect(ws.slug).toBe('campaign-c')

    const names = readIndexWorkspaces().map((w) => w.name)
    expect(names.filter((n) => n === 'vonbon').length).toBe(2)
  })

  it('skipNameCheck=true 仍会拦截重复 slug', async () => {
    seedDefaultSkill()
    const { createAgentWorkspace } = await loadModule()
    createAgentWorkspace('a', 'campaign-same')
    expect(() =>
      createAgentWorkspace('b', 'campaign-same', undefined, { skipNameCheck: true }),
    ).toThrow(/slug/)
  })
})

describe('ensureWorkspaceRegistered 自愈', () => {
  it('目录已存在但未注册时，补注册并复制 skills', async () => {
    seedDefaultSkill()
    const { ensureWorkspaceRegistered } = await loadModule()
    const { getAgentWorkspacePath } = await import('../config-paths')

    const slug = 'campaign-legacy-1'
    const wsPath = getAgentWorkspacePath(slug)
    mkdirSync(wsPath, { recursive: true })

    expect(readIndexWorkspaces().some((w) => w.slug === slug)).toBe(false)

    const repaired = ensureWorkspaceRegistered('vonbons', slug)

    expect(repaired).toBe(true)
    expect(readIndexWorkspaces().some((w) => w.slug === slug)).toBe(true)
    // SDK 靠 .claude-plugin/plugin.json 发现 skills，必须有
    expect(existsSync(join(wsPath, '.claude-plugin', 'plugin.json'))).toBe(true)
    // skills 已复制
    expect(existsSync(join(wsPath, 'skills', 'ma-market-analysis', 'SKILL.md'))).toBe(true)
  })

  it('skills 齐全但缺 plugin manifest 时也会补 manifest', async () => {
    seedDefaultSkill()
    const { ensureWorkspaceRegistered } = await loadModule()
    const { getAgentWorkspacePath } = await import('../config-paths')

    const slug = 'campaign-no-manifest'
    const wsPath = getAgentWorkspacePath(slug)
    // 造一个已有内容的 skills 目录，但故意不建 .claude-plugin
    mkdirSync(join(wsPath, 'skills', 'ma-market-analysis'), { recursive: true })
    writeFileSync(join(wsPath, 'skills', 'ma-market-analysis', 'SKILL.md'), '# x', 'utf-8')
    expect(existsSync(join(wsPath, '.claude-plugin', 'plugin.json'))).toBe(false)

    ensureWorkspaceRegistered('brand', slug)

    expect(existsSync(join(wsPath, '.claude-plugin', 'plugin.json'))).toBe(true)
  })

  it('已注册且 skills 齐全时不重复动作', async () => {
    seedDefaultSkill()
    const { ensureWorkspaceRegistered } = await loadModule()
    const slug = 'campaign-ok-1'

    ensureWorkspaceRegistered('brand', slug)
    const second = ensureWorkspaceRegistered('brand', slug)
    expect(second).toBe(false)
  })
})

describe('repairUnregisteredCampaignWorkspaces 批量扫描', () => {
  it('扫描磁盘上未注册的 campaign 目录并补齐', async () => {
    seedDefaultSkill()
    const { repairUnregisteredCampaignWorkspaces } = await loadModule()
    const { getAgentWorkspacesDir } = await import('../config-paths')

    // 造两个 Campaign 目录：都有 campaign.json，但都没注册
    const targets = [
      { slug: 'campaign-x1', name: 'nike' },
      { slug: 'campaign-x2', name: 'vonbons' },
    ]
    for (const t of targets) {
      const dir = join(getAgentWorkspacesDir(), t.slug)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'campaign.json'), JSON.stringify({ name: t.name }), 'utf-8')
    }

    const repaired = repairUnregisteredCampaignWorkspaces()
    expect(repaired).toBe(2)

    const slugs = readIndexWorkspaces().map((w) => w.slug)
    for (const t of targets) {
      expect(slugs).toContain(t.slug)
      expect(existsSync(join(getAgentWorkspacesDir(), t.slug, 'skills', 'ma-market-analysis'))).toBe(true)
    }
  })

  it('没有 campaign.json 的目录不会被注册', async () => {
    seedDefaultSkill()
    const { repairUnregisteredCampaignWorkspaces } = await loadModule()
    const { getAgentWorkspacesDir } = await import('../config-paths')

    const dir = join(getAgentWorkspacesDir(), 'campaign-no-manifest')
    mkdirSync(dir, { recursive: true })

    const repaired = repairUnregisteredCampaignWorkspaces()
    expect(repaired).toBe(0)
    expect(readIndexWorkspaces().some((w) => w.slug === 'campaign-no-manifest')).toBe(false)
  })
})
