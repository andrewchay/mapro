/**
 * 跨平台附件服务
 *
 * 为 Electron 与 Web 服务端提供统一的附件保存、读取、删除能力。
 * 存储路径：{dataDir}/attachments/{scope}/{id}/{uuid}.ext
 *
 * - scope: 业务域，如 chat / agent / campaign
 * - id: 作用域内实例 ID，如 conversationId / sessionId / campaignId
 * - fileId: 存储文件名，形如 {uuid}.ext
 */

import { writeFile, readFile, unlink } from 'node:fs/promises'
import { readFileSync, existsSync } from 'node:fs'
import { extname, normalize, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AppContext } from '../context/types.ts'
import { getAttachmentsDir, getAttachmentDirForScope, resolveAttachmentPathForScope } from '../context/config-paths.ts'
import type { FileProvider } from './types.ts'
import type { FileAttachment } from '@ma-proma/shared'
import { MAX_ATTACHMENT_SIZE } from '@ma-proma/shared'

export interface SaveAttachmentInput {
  /** 业务域 */
  scope: string
  /** 作用域内实例 ID */
  id: string
  /** 原始文件名 */
  filename: string
  /** MIME 类型 */
  mediaType: string
  /** base64 编码的文件数据 */
  data: string
}

/** 文件附件元信息（不含文件内容） */
export interface AttachmentMeta {
  id: string
  filename: string
  mediaType: string
  size: number
  modifiedAt: number
}

const SAFE_SEGMENT_PATTERN = /^[a-zA-Z0-9_-]+$/
const SAFE_FILE_ID_PATTERN = /^[a-zA-Z0-9_.-]+$/

function assertSafeName(name: string, label: string): void {
  const pattern = label === 'fileId' ? SAFE_FILE_ID_PATTERN : SAFE_SEGMENT_PATTERN
  if (!pattern.test(name)) {
    throw new Error(`${label} 包含非法字符: ${name}`)
  }
}

function resolveSafeAttachmentPath(context: AppContext, scope: string, id: string, fileId: string): string {
  assertSafeName(scope, 'scope')
  assertSafeName(id, 'id')
  assertSafeName(fileId, 'fileId')
  const baseDir = normalize(getAttachmentsDir(context))
  const fullPath = normalize(resolveAttachmentPathForScope(context, scope, id, fileId))
  if (!fullPath.startsWith(baseDir)) {
    throw new Error('附件路径不在安全目录内')
  }
  return fullPath
}

function getIndexPath(context: AppContext, scope: string, id: string): string {
  return join(getAttachmentDirForScope(context, scope, id), 'attachments.json')
}

function readIndex(context: AppContext, scope: string, id: string): Record<string, FileAttachment> {
  const path = getIndexPath(context, scope, id)
  if (!existsSync(path)) return {}
  try {
    const content = readFileSync(path, 'utf-8')
    return JSON.parse(content) as Record<string, FileAttachment>
  } catch {
    return {}
  }
}

async function writeIndex(
  context: AppContext,
  scope: string,
  id: string,
  index: Record<string, FileAttachment>,
): Promise<void> {
  const path = getIndexPath(context, scope, id)
  await writeFile(path, JSON.stringify(index, null, 2), 'utf-8')
}

/**
 * 附件服务
 *
 * 直接操作本地文件系统，不依赖 Electron dialog。
 */
export class AttachmentService {
  constructor(
    private context: AppContext,
    private fileProvider: FileProvider,
  ) {}

  /**
   * 保存附件
   *
   * @returns 兼容 Electron FileAttachment 的元信息
   */
  async save(input: SaveAttachmentInput): Promise<FileAttachment> {
    const { scope, id, filename, mediaType, data } = input

    if (!filename || !mediaType || !data) {
      throw new Error('filename、mediaType、data 为必填项')
    }

    const rawSize = Math.ceil(data.length * 0.75)
    if (rawSize > MAX_ATTACHMENT_SIZE) {
      throw new Error(`文件 ${filename} 超过 ${MAX_ATTACHMENT_SIZE} 字节大小限制，无法保存`)
    }

    const buffer = Buffer.from(data, 'base64')
    if (buffer.length > MAX_ATTACHMENT_SIZE) {
      throw new Error(`文件 ${filename} 超过 ${MAX_ATTACHMENT_SIZE} 字节大小限制，无法保存`)
    }

    const dir = getAttachmentDirForScope(this.context, scope, id)
    await this.fileProvider.mkdir(dir)

    const ext = extname(filename) || '.bin'
    const fileId = `${randomUUID()}${ext}`
    const fullPath = resolveAttachmentPathForScope(this.context, scope, id, fileId)
    await writeFile(fullPath, buffer)

    const attachment: FileAttachment = {
      id: fileId.replace(ext, ''),
      filename,
      mediaType,
      localPath: `${scope}/${id}/${fileId}`,
      size: buffer.length,
    }

    const index = readIndex(this.context, scope, id)
    index[fileId] = attachment
    await writeIndex(this.context, scope, id, index)

    return attachment
  }

  /**
   * 读取附件为 base64（异步）
   */
  async readAsBase64(scope: string, id: string, fileId: string): Promise<string> {
    const fullPath = resolveSafeAttachmentPath(this.context, scope, id, fileId)
    return this.fileProvider.readFileAsBase64(fullPath)
  }

  /**
   * 读取附件为 base64（同步）
   *
   * 供 ImageAttachmentReader 等同步接口使用。
   */
  readAsBase64Sync(scope: string, id: string, fileId: string): string {
    const fullPath = resolveSafeAttachmentPath(this.context, scope, id, fileId)
    return readFileSync(fullPath).toString('base64')
  }

  /**
   * 读取附件为 Buffer
   */
  async readAsBuffer(scope: string, id: string, fileId: string): Promise<Buffer> {
    const fullPath = resolveSafeAttachmentPath(this.context, scope, id, fileId)
    return readFile(fullPath)
  }

  /**
   * 删除单个附件
   */
  async delete(scope: string, id: string, fileId: string): Promise<void> {
    const fullPath = resolveSafeAttachmentPath(this.context, scope, id, fileId)
    await unlink(fullPath)
    const index = readIndex(this.context, scope, id)
    delete index[fileId]
    await writeIndex(this.context, scope, id, index)
  }

  /**
   * 列出指定 scope/id 下的附件元信息
   */
  async list(scope: string, id: string): Promise<FileAttachment[]> {
    const index = readIndex(this.context, scope, id)
    return Object.values(index)
  }

  /**
   * 获取附件下载/预览的相对 URL
   */
  getAttachmentUrl(scope: string, id: string, fileId: string): string {
    assertSafeName(scope, 'scope')
    assertSafeName(id, 'id')
    assertSafeName(fileId, 'fileId')
    return `/api/attachments/${scope}/${id}/${fileId}`
  }
}

/**
 * 根据扩展名推断 MIME 类型
 */
function inferMediaType(filename: string): string {
  const ext = extname(filename).toLowerCase()
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.csv': 'text/csv',
    '.xml': 'application/xml',
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.ts': 'text/typescript',
    '.py': 'text/x-python',
    '.zip': 'application/zip',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.odt': 'application/vnd.oasis.opendocument.text',
    '.odp': 'application/vnd.oasis.opendocument.presentation',
    '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  }
  return map[ext] || 'application/octet-stream'
}
