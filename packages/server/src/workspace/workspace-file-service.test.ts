import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppContext } from '../context/types.ts'
import { LocalFileProvider } from '../files/local-file-provider.ts'
import { WorkspaceFileService, WorkspaceFileError } from './workspace-file-service.ts'

function createTestContext(): AppContext {
  const configDir = mkdtempSync(join(tmpdir(), 'mapro-workspace-file-service-'))
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
    // 测试清理忽略错误
  }
}

describe('WorkspaceFileService', () => {
  let context: AppContext
  let service: WorkspaceFileService

  beforeEach(() => {
    context = createTestContext()
    service = new WorkspaceFileService(context, new LocalFileProvider())
  })

  afterEach(() => {
    cleanupContext(context)
  })

  describe('作用域与路径安全', () => {
    test('允许 workspace 作用域', async () => {
      await service.writeTextFile('workspace', 'my-slug', 'a.md', 'hello')
      expect(await service.readTextFile('workspace', 'my-slug', 'a.md')).toBe('hello')
    })

    test('允许 campaign 作用域并映射到 campaign-{id} 目录', async () => {
      await service.writeTextFile('campaign', 'abc123', 'brief/brief.md', 'campaign')
      const files = await service.listFiles('campaign', 'abc123', '', true)
      expect(files.map((f) => f.path)).toContain('brief/brief.md')
    })

    test('非法作用域抛出 403', async () => {
      await expect(service.listFiles('agent', 'x', '')).rejects.toMatchObject({
        statusCode: 403,
      })
    })

    test('ID 含非法字符抛出 400', async () => {
      await expect(service.listFiles('workspace', 'a/b', '')).rejects.toMatchObject({
        statusCode: 400,
      })
    })

    test('路径穿越 segment 被拦截', async () => {
      await expect(service.readTextFile('workspace', 'slug', '../secret.md')).rejects.toMatchObject({
        statusCode: 400,
      })
    })

    test('嵌套路径穿越被拦截', async () => {
      await expect(service.readTextFile('workspace', 'slug', 'a/../../secret.md')).rejects.toMatchObject({
        statusCode: 400,
      })
    })

    test('绝对路径 segment 被拦截', async () => {
      await expect(service.readTextFile('workspace', 'slug', '/etc/passwd')).rejects.toMatchObject({
        statusCode: 400,
      })
    })

    test('Windows 盘符 segment 被拦截', async () => {
      await expect(service.readTextFile('workspace', 'slug', 'C:/windows/system32')).rejects.toMatchObject({
        statusCode: 400,
      })
    })
  })

  describe('文本读写', () => {
    test('写入并读取文本文件', async () => {
      await service.writeTextFile('workspace', 'slug', 'notes/hello.md', '# 你好')
      const content = await service.readTextFile('workspace', 'slug', 'notes/hello.md')
      expect(content).toBe('# 你好')
    })

    test('写入时自动创建父目录', async () => {
      await service.writeTextFile('workspace', 'slug', 'a/b/c.md', 'deep')
      expect(existsSync(join(context.getConfigDir(), 'agent-workspaces', 'slug', 'a', 'b', 'c.md'))).toBe(true)
    })

    test('空路径写入抛出 400', async () => {
      await expect(service.writeTextFile('workspace', 'slug', '', 'x')).rejects.toMatchObject({
        statusCode: 400,
      })
    })
  })

  describe('base64 上传', () => {
    test('base64 写入后内容与原始一致', async () => {
      const original = Buffer.from('二进制内容 🎉')
      const base64 = original.toString('base64')
      await service.writeFileFromBase64('workspace', 'slug', 'assets/blob.bin', base64)
      const read = await service.readTextFile('workspace', 'slug', 'assets/blob.bin')
      expect(read).toBe('二进制内容 🎉')
    })

    test('超大 base64 被 413 拒绝', async () => {
      const huge = 'a'.repeat(200 * 1024 * 1024)
      await expect(service.writeFileFromBase64('workspace', 'slug', 'big.bin', huge)).rejects.toMatchObject({
        statusCode: 413,
      })
    })
  })

  describe('文件列表', () => {
    test('列出文件返回相对路径', async () => {
      await service.writeTextFile('workspace', 'slug', 'x.md', 'x')
      await service.writeTextFile('workspace', 'slug', 'dir/y.md', 'y')
      const files = await service.listFiles('workspace', 'slug', '')
      const paths = files.map((f) => f.path).sort()
      expect(paths).toEqual(['dir', 'x.md'])
    })

    test('递归列表包含嵌套文件', async () => {
      await service.writeTextFile('workspace', 'slug', 'a/b/c.md', 'nested')
      const files = await service.listFiles('workspace', 'slug', '', true)
      expect(files.map((f) => f.path)).toContain('a/b/c.md')
    })

    test('目录不存在时返回空数组', async () => {
      const files = await service.listFiles('workspace', 'missing-slug', '')
      expect(files).toEqual([])
    })

    test('列表不泄露服务器绝对路径', async () => {
      await service.writeTextFile('workspace', 'slug', 'z.md', 'z')
      const files = await service.listFiles('workspace', 'slug', '')
      for (const file of files) {
        expect(file.path.startsWith(context.getConfigDir())).toBe(false)
      }
    })
  })

  describe('.context 保留目录保护', () => {
    test('写入 .context/todo.md 被禁止', async () => {
      await expect(service.writeTextFile('workspace', 'slug', '.context/todo.md', 'todo')).rejects.toMatchObject({
        statusCode: 403,
      })
    })

    test('删除 .context/campaign.md 被禁止', async () => {
      await expect(service.deleteFile('workspace', 'slug', '.context/campaign.md')).rejects.toMatchObject({
        statusCode: 403,
      })
    })

    test('读取 .context 文件仍允许', async () => {
      const contextDir = join(context.getConfigDir(), 'agent-workspaces', 'slug', '.context')
      const provider = new LocalFileProvider()
      await provider.mkdir(contextDir)
      await provider.writeTextFile(join(contextDir, 'todo.md'), 'read ok')
      const content = await service.readTextFile('workspace', 'slug', '.context/todo.md')
      expect(content).toBe('read ok')
    })
  })

  describe('非 ASCII 文件名', () => {
    test('中文文件名可读写', async () => {
      await service.writeTextFile('workspace', 'slug', '报告.md', '# 报告')
      expect(await service.readTextFile('workspace', 'slug', '报告.md')).toBe('# 报告')
    })

    test('含空格文件名可读写', async () => {
      await service.writeTextFile('workspace', 'slug', 'my notes/hello world.md', 'space')
      expect(await service.readTextFile('workspace', 'slug', 'my notes/hello world.md')).toBe('space')
    })
  })

  describe('删除文件', () => {
    test('删除已存在的文件', async () => {
      await service.writeTextFile('workspace', 'slug', 'del.md', 'x')
      await service.deleteFile('workspace', 'slug', 'del.md')
      await expect(service.readTextFile('workspace', 'slug', 'del.md')).rejects.toThrow()
    })

    test('删除不存在的文件返回 404', async () => {
      await expect(service.deleteFile('workspace', 'slug', 'no.md')).rejects.toMatchObject({
        statusCode: 404,
      })
    })

    test('删除目录被拒绝', async () => {
      const dir = join(context.getConfigDir(), 'agent-workspaces', 'slug', 'folder')
      await new LocalFileProvider().mkdir(dir)
      await expect(service.deleteFile('workspace', 'slug', 'folder')).rejects.toMatchObject({
        statusCode: 400,
      })
    })
  })
})

describe('WorkspaceFileError', () => {
  test('暴露状态码', () => {
    const err = new WorkspaceFileError('test', 418)
    expect(err.statusCode).toBe(418)
  })
})
