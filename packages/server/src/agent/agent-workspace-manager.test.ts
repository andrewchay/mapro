import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppContext } from '../context/types.ts'
import { AgentWorkspaceManager } from './agent-workspace-manager.ts'
import { ChatToolConfigService } from './chat-tool-config.ts'

function createTestContext(): AppContext {
  const configDir = mkdtempSync(join(tmpdir(), 'mapro-agent-workspace-manager-'))
  return {
    getConfigDir: () => configDir,
    getResourcesPath: () => join(configDir, 'resources'),
    isPackaged: () => false,
  }
}

function cleanupContext(context: AppContext): void {
  try {
    rmSync(context.getConfigDir(), { recursive: true, force: true })
  } catch {
    // ignore
  }
}

describe('AgentWorkspaceManager', () => {
  let context: AppContext
  let chatToolConfigService: ChatToolConfigService
  let manager: AgentWorkspaceManager

  beforeEach(() => {
    context = createTestContext()
    chatToolConfigService = new ChatToolConfigService({ context })
    manager = new AgentWorkspaceManager({ context, chatToolConfigService })
  })

  afterEach(() => {
    cleanupContext(context)
  })

  describe('工作区 CRUD', () => {
    test('创建并列出工作区', () => {
      const ws = manager.createAgentWorkspace('My Workspace')
      expect(ws.name).toBe('My Workspace')
      expect(ws.slug).toBe('my-workspace')

      const list = manager.listAgentWorkspaces()
      expect(list).toHaveLength(1)
      expect(list[0]?.id).toBe(ws.id)
    })

    test('重复名称抛出错误', () => {
      manager.createAgentWorkspace('测试工作区')
      expect(() => manager.createAgentWorkspace('测试工作区')).toThrow('工作区名称')
    })

    test('按 ID 获取工作区', () => {
      const ws = manager.createAgentWorkspace('查找测试')
      const found = manager.getAgentWorkspace(ws.id)
      expect(found?.name).toBe('查找测试')
    })

    test('更新工作区名称', async () => {
      const ws = manager.createAgentWorkspace('旧名称')
      await new Promise((resolve) => setTimeout(resolve, 5))
      const updated = manager.updateAgentWorkspace(ws.id, { name: '新名称' })
      expect(updated.name).toBe('新名称')
      expect(updated.updatedAt).toBeGreaterThan(ws.updatedAt)
    })

    test('删除工作区后索引为空', () => {
      const ws = manager.createAgentWorkspace('待删除')
      manager.deleteAgentWorkspace(ws.id)
      expect(manager.listAgentWorkspaces()).toHaveLength(0)
    })

    test('重排工作区顺序', () => {
      const first = manager.createAgentWorkspace('第一条')
      const second = manager.createAgentWorkspace('第二条')

      const reordered = manager.reorderAgentWorkspaces([second.id, first.id])
      expect(reordered[0]?.id).toBe(second.id)
      expect(reordered[1]?.id).toBe(first.id)
    })
  })

  describe('默认工作区', () => {
    test('首次调用创建默认工作区', () => {
      const ws = manager.ensureDefaultWorkspace()
      expect(ws.slug).toBe('default')
      expect(manager.listAgentWorkspaces()).toHaveLength(1)
    })

    test('重复调用返回同一工作区', () => {
      const first = manager.ensureDefaultWorkspace()
      const second = manager.ensureDefaultWorkspace()
      expect(first.id).toBe(second.id)
    })

    test('默认工作区创建 plugin manifest', () => {
      manager.ensureDefaultWorkspace()
      const manifestPath = join(context.getConfigDir(), 'agent-workspaces', 'default', '.claude-plugin', 'plugin.json')
      expect(existsSync(manifestPath)).toBe(true)
    })
  })

  describe('MCP 配置', () => {
    test('读取不存在配置返回空 servers', () => {
      const config = manager.getWorkspaceMcpConfig('nonexistent')
      expect(config.servers).toEqual({})
    })

    test('保存并读取 MCP 配置', () => {
      manager.createAgentWorkspace('mcp-test')
      manager.saveWorkspaceMcpConfig('mcp-test', {
        servers: {
          kol: { enabled: true, type: 'stdio', command: 'npx', args: ['kol-mcp'] },
        },
      })
      const config = manager.getWorkspaceMcpConfig('mcp-test')
      expect(config.servers.kol).toBeTruthy()
      expect(config.servers.kol?.enabled).toBe(true)
    })
  })

  describe('Skills 管理', () => {
    test('空工作区返回空 Skills 列表', () => {
      manager.createAgentWorkspace('skill-test')
      expect(manager.getWorkspaceSkills('skill-test')).toEqual([])
    })

    test('写入并读取 SKILL.md', () => {
      manager.createAgentWorkspace('skill-test')
      mkdirSync(join(context.getConfigDir(), 'agent-workspaces', 'skill-test', 'skills', 'my-skill'), { recursive: true })
      manager.writeWorkspaceSkillContent('skill-test', 'my-skill', '# Hello Skill')
      const content = manager.readWorkspaceSkillContent('skill-test', 'my-skill')
      expect(content).toBe('# Hello Skill')
    })

    test('切换 Skill 启用/禁用状态', () => {
      manager.createAgentWorkspace('skill-test')
      const skillDir = join(context.getConfigDir(), 'agent-workspaces', 'skill-test', 'skills', 'my-skill')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: My Skill\n---\n', 'utf-8')

      manager.toggleWorkspaceSkill('skill-test', 'my-skill', false)
      expect(manager.getWorkspaceSkills('skill-test')).toHaveLength(0)
      expect(manager.getAllWorkspaceSkills('skill-test')).toHaveLength(1)

      manager.toggleWorkspaceSkill('skill-test', 'my-skill', true)
      expect(manager.getWorkspaceSkills('skill-test')).toHaveLength(1)
    })

    test('列出 Skill 子文件', () => {
      manager.createAgentWorkspace('skill-test')
      const skillDir = join(context.getConfigDir(), 'agent-workspaces', 'skill-test', 'skills', 'my-skill')
      mkdirSync(join(skillDir, 'sub'), { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: My Skill\n---\n', 'utf-8')
      writeFileSync(join(skillDir, 'sub', 'note.md'), '# Note', 'utf-8')

      const tree = manager.listSkillFiles('skill-test', 'my-skill')
      const subDir = tree.find((n) => n.name === 'sub' && n.type === 'directory')
      expect(subDir).toBeTruthy()
      expect(subDir?.children?.some((n) => n.name === 'note.md' && n.type === 'file')).toBe(true)
    })

    test('写入并读取 Skill 子文件', () => {
      manager.createAgentWorkspace('skill-test')
      const skillDir = join(context.getConfigDir(), 'agent-workspaces', 'skill-test', 'skills', 'my-skill')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: My Skill\n---\n', 'utf-8')

      manager.writeSkillFile('skill-test', 'my-skill', 'extra.md', 'extra content')
      const file = manager.readSkillFile('skill-test', 'my-skill', 'extra.md')
      expect(file.content).toBe('extra content')
      expect(file.isText).toBe(true)
    })
  })

  describe('工作区附加目录/文件', () => {
    test('附加目录', () => {
      manager.createAgentWorkspace('attach-test')
      const dirs = manager.attachWorkspaceDirectory('attach-test', '/tmp/project-a')
      expect(dirs).toContain('/tmp/project-a')
      expect(manager.getWorkspaceAttachedDirectories('attach-test')).toContain('/tmp/project-a')
    })

    test('移除附加目录', () => {
      manager.createAgentWorkspace('attach-test')
      manager.attachWorkspaceDirectory('attach-test', '/tmp/project-a')
      const dirs = manager.detachWorkspaceDirectory('attach-test', '/tmp/project-a')
      expect(dirs).not.toContain('/tmp/project-a')
    })

    test('附加文件', () => {
      manager.createAgentWorkspace('attach-test')
      const files = manager.attachWorkspaceFile('attach-test', '/tmp/doc.pdf')
      expect(files).toContain('/tmp/doc.pdf')
    })
  })
})
