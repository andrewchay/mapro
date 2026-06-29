/**
 * 文件附件 REST API
 *
 * 提供上传、下载/预览、删除、列表能力。
 * 存储路径：{MAPRO_DATA_DIR}/attachments/{scope}/{id}/{fileId}
 */

import express, { Router } from 'express'
import type { Request, Response } from 'express'
import type { AppContext, FileProvider } from '@ma-proma/server'
import { AttachmentService } from '@ma-proma/server'
import type { FileAttachment } from '@ma-proma/shared'
import { MAX_ATTACHMENT_SIZE } from '@ma-proma/shared'

const SAFE_SEGMENT_PATTERN = /^[a-zA-Z0-9_-]+$/
const SAFE_FILE_ID_PATTERN = /^[a-zA-Z0-9_.-]+$/

function validateSegment(value: unknown, label: string): string {
  const pattern = label === 'fileId' ? SAFE_FILE_ID_PATTERN : SAFE_SEGMENT_PATTERN
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`${label} 格式非法`)
  }
  return value
}

function isPreviewable(mediaType: string): boolean {
  return (
    mediaType.startsWith('image/') ||
    mediaType === 'application/pdf' ||
    mediaType.startsWith('text/') ||
    mediaType === 'application/json' ||
    mediaType === 'application/xml'
  )
}

export interface AttachmentRouterDeps {
  context: AppContext
  fileProvider: FileProvider
}

function isValidationError(message: string): boolean {
  return message.includes('格式非法') || message.includes('必填')
}

function isNotFoundError(error: unknown, message: string): boolean {
  if (message.includes('不存在') || message.includes('不在安全目录')) return true
  if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return true
  return false
}

export function createAttachmentsRouter(deps: AttachmentRouterDeps): Router {
  const { context, fileProvider } = deps
  const attachmentService = new AttachmentService(context, fileProvider)
  const router = Router()
  router.use(express.json({ limit: '110mb' }))

  // POST /:scope/:id 上传附件
  router.post('/:scope/:id', async (req: Request, res: Response) => {
    try {
      const scope = validateSegment(req.params.scope, 'scope')
      const id = validateSegment(req.params.id, 'id')
      const { filename, mediaType, data } = req.body as Record<string, unknown>

      if (typeof filename !== 'string' || !filename) {
        res.status(400).json({ success: false, error: 'filename 必填' })
        return
      }
      if (typeof mediaType !== 'string' || !mediaType) {
        res.status(400).json({ success: false, error: 'mediaType 必填' })
        return
      }
      if (typeof data !== 'string' || !data) {
        res.status(400).json({ success: false, error: 'data 必填' })
        return
      }

      const rawSize = Math.ceil(data.length * 0.75)
      if (rawSize > MAX_ATTACHMENT_SIZE) {
        res.status(413).json({ success: false, error: `文件超过 ${MAX_ATTACHMENT_SIZE} 字节限制` })
        return
      }

      const attachment = await attachmentService.save({
        scope,
        id,
        filename,
        mediaType,
        data,
      })

      res.json({ success: true, attachment })
    } catch (error) {
      const message = error instanceof Error ? error.message : '上传失败'
      if (isValidationError(message)) {
        res.status(400).json({ success: false, error: message })
      } else {
        console.error('[Attachments API] 上传失败:', error)
        res.status(500).json({ success: false, error: message })
      }
    }
  })

  // GET /:scope/:id 列表附件
  router.get('/:scope/:id', async (req: Request, res: Response) => {
    try {
      const scope = validateSegment(req.params.scope, 'scope')
      const id = validateSegment(req.params.id, 'id')
      const attachments = await attachmentService.list(scope, id)
      res.json({ success: true, attachments })
    } catch (error) {
      const message = error instanceof Error ? error.message : '获取列表失败'
      console.error('[Attachments API] 获取列表失败:', error)
      res.status(500).json({ success: false, error: message })
    }
  })

  // GET /:scope/:id/:fileId 下载/预览附件
  router.get('/:scope/:id/:fileId', async (req: Request, res: Response) => {
    try {
      const scope = validateSegment(req.params.scope, 'scope')
      const id = validateSegment(req.params.id, 'id')
      const fileId = validateSegment(req.params.fileId, 'fileId')

      const buffer = await attachmentService.readAsBuffer(scope, id, fileId)
      const contentType = req.query.mediaType ? String(req.query.mediaType) : 'application/octet-stream'

      res.setHeader('Content-Type', contentType)
      if (!isPreviewable(contentType)) {
        res.setHeader('Content-Disposition', `attachment; filename="${fileId}"`)
      }
      res.send(buffer)
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取失败'
      if (isValidationError(message)) {
        res.status(400).json({ success: false, error: message })
      } else if (isNotFoundError(error, message)) {
        res.status(404).json({ success: false, error: message })
      } else {
        console.error('[Attachments API] 读取失败:', error)
        res.status(500).json({ success: false, error: message })
      }
    }
  })

  // DELETE /:scope/:id/:fileId 删除附件
  router.delete('/:scope/:id/:fileId', async (req: Request, res: Response) => {
    try {
      const scope = validateSegment(req.params.scope, 'scope')
      const id = validateSegment(req.params.id, 'id')
      const fileId = validateSegment(req.params.fileId, 'fileId')

      await attachmentService.delete(scope, id, fileId)
      res.json({ success: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : '删除失败'
      if (isValidationError(message)) {
        res.status(400).json({ success: false, error: message })
      } else if (isNotFoundError(error, message)) {
        res.status(404).json({ success: false, error: message })
      } else {
        console.error('[Attachments API] 删除失败:', error)
        res.status(500).json({ success: false, error: message })
      }
    }
  })

  return router
}
