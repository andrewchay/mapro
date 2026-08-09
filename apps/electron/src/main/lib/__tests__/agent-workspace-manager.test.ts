/**
 * getAgentWorkspaceCwd · Campaign 本地项目文件夹支持
 *
 * 验证：当 Campaign 工作区（slug 以 campaign- 开头）绑定了本地项目文件夹（rootPath）时，
 * Agent 运行目录应指向 `<项目文件夹>/campaign-{id}/` 子目录，与产物校验路径保持一致；
 * 普通项目工作区绑定 rootPath 时仍返回 rootPath 本身（原有语义不变）。
 */
import { describe, it, expect, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentWorkspace } from '@ma-proma/shared'
import { getAgentWorkspaceCwd } from '../agent-workspace-manager'

const tempDirs: string[] = []

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mapro-cwd-test-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
})

describe('getAgentWorkspaceCwd · Campaign 本地项目文件夹', () => {
  it('Campaign workspace + rootPath → 返回 <rootPath>/campaign-{id} 子目录', () => {
    const root = makeTmpDir()
    const ws: AgentWorkspace = {
      id: 'w1',
      name: '测试',
      slug: 'campaign-abc123',
      rootPath: root,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    const cwd = getAgentWorkspaceCwd(ws, 'session-1')
    expect(cwd).toBe(join(root, 'campaign-abc123'))
    // 子目录应被创建，且是目录
    expect(existsSync(cwd)).toBe(true)
    expect(statSync(cwd).isDirectory()).toBe(true)
  })

  it('普通项目 workspace + rootPath → 返回 rootPath 本身（不生成 campaign-{id} 子目录）', () => {
    const root = makeTmpDir()
    const ws: AgentWorkspace = {
      id: 'w2',
      name: '普通项目',
      slug: 'my-project',
      rootPath: root,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    const cwd = getAgentWorkspaceCwd(ws, 'session-1')
    expect(cwd).toBe(root)
    // 不应在该 rootPath 下额外创建 campaign-* 子目录
    expect(existsSync(join(root, 'my-project'))).toBe(false)
  })

  it('rootPath 不可用（不存在）→ 抛错', () => {
    const missing = join(tmpdir(), 'mapro-cwd-test-does-not-exist-' + Date.now())
    const ws: AgentWorkspace = {
      id: 'w3',
      name: 'bad',
      slug: 'campaign-zzz',
      rootPath: missing,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    expect(() => getAgentWorkspaceCwd(ws, 's')).toThrow()
  })
})
