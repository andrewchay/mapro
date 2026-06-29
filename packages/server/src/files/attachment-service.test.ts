/**
 * AttachmentService 单元测试
 *
 * BDD 行为驱动，验证附件保存/读取/删除闭环与路径安全：
 * 1. 正常保存 → 读取 → 删除闭环
 * 2. save 拒绝含 ../ 的 scope/id（回归一致性缺陷）
 * 3. 超大 base64 被拒
 * 4. readAsBase64 / delete 拒绝路径穿越（已有逻辑，补测试固化）
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppContext } from '../context/types.ts'
import type { FileProvider } from './types.ts'
import type { FileAttachment } from '@ma-proma/shared'
import type { AttachmentService as AttachmentServiceType } from './attachment-service.ts'
import * as actualShared from '@ma-proma/shared'

mock.module('@ma-proma/shared', () => ({
  ...actualShared,
  MAX_ATTACHMENT_SIZE: 100,
}))

const { AttachmentService } = await import('./attachment-service.ts')
const { LocalFileProvider } = await import('./local-file-provider.ts')

function createTestContext(root: string): AppContext {
  return {
    getConfigDir: () => root,
    getResourcesPath: () => root,
    isPackaged: () => false,
  }
}

describe('AttachmentService', () => {
  let root: string
  let context: AppContext
  let fileProvider: FileProvider
  let service: AttachmentServiceType

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'attachment-service-test-'))
    context = createTestContext(root)
    fileProvider = new LocalFileProvider()
    service = new AttachmentService(context, fileProvider)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  describe('附件生命周期', () => {
    it('Given 合法附件 when 保存 then 可读取并删除闭环', async () => {
      const data = Buffer.from('hello world').toString('base64')
      const saved = await service.save({
        scope: 'chat',
        id: 'conv-001',
        filename: 'hello.txt',
        mediaType: 'text/plain',
        data,
      })

      expect(saved.filename).toBe('hello.txt')
      expect(saved.size).toBe(11)
      expect(saved.localPath).toMatch(/^chat\/conv-001\/[a-f0-9-]+\.txt$/)

      const parts = saved.localPath.split('/')
      const fileId = parts[2]!
      const base64 = await service.readAsBase64('chat', 'conv-001', fileId)
      expect(Buffer.from(base64, 'base64').toString('utf-8')).toBe('hello world')

      await service.delete('chat', 'conv-001', fileId)
      await expect(service.readAsBase64('chat', 'conv-001', fileId)).rejects.toThrow()
    })
  })

  describe('路径安全', () => {
    it('Given scope 含路径穿越 when 保存 then 抛出非法字符错误（回归一致性缺陷）', async () => {
      await expect(
        service.save({
          scope: 'chat/../etc',
          id: 'conv-001',
          filename: 'x.txt',
          mediaType: 'text/plain',
          data: Buffer.from('x').toString('base64'),
        }),
      ).rejects.toThrow('scope 包含非法字符')
    })

    it('Given id 含路径穿越 when 保存 then 抛出非法字符错误', async () => {
      await expect(
        service.save({
          scope: 'chat',
          id: 'conv-001/../../etc',
          filename: 'x.txt',
          mediaType: 'text/plain',
          data: Buffer.from('x').toString('base64'),
        }),
      ).rejects.toThrow('id 包含非法字符')
    })

    it('Given readAsBase64 使用路径穿越 fileId when 调用 then 抛出非法字符错误', async () => {
      await expect(
        service.readAsBase64('chat', 'conv-001', '../secret.txt'),
      ).rejects.toThrow('fileId 包含非法字符')
    })

    it('Given delete 使用路径穿越 id when 调用 then 抛出非法字符错误', async () => {
      await expect(
        service.delete('chat', '../other', 'file.txt'),
      ).rejects.toThrow('id 包含非法字符')
    })
  })

  describe('大小限制', () => {
    it('Given 超过大小限制的 base64 when 保存 then 抛出大小限制错误', async () => {
      const hugeData = Buffer.alloc(200).toString('base64') // rawSize = 200 > 100
      await expect(
        service.save({
          scope: 'chat',
          id: 'conv-001',
          filename: 'big.bin',
          mediaType: 'application/octet-stream',
          data: hugeData,
        }),
      ).rejects.toThrow('超过')
    })
  })
})
