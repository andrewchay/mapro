/**
 * 文件附件 REST API
 *
 * 提供上传、下载/预览、删除、列表能力。
 * 存储路径：{MAPRO_DATA_DIR}/attachments/{scope}/{id}/{fileId}
 * 阶段 C1：按请求用户隔离，system 账号继续使用全局目录，普通用户写入 users/{userId}/。
 */

import express, { Router } from 'express'
import type { Request, Response } from 'express'
import type { AppContext, FileProvider, UserContext } from '@ma-proma/server'
import { AttachmentService, inferMediaType } from '@ma-proma/server'
import type { FileAttachment } from '@ma-proma/shared'
import { MAX_ATTACHMENT_SIZE } from '@ma-proma/shared'
import type { RequestWithUserContext } from '../auth-middleware.ts'
import { createUserAppContext } from '../context.ts'

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

/**
 * 即使在 isPreviewable 范围内也必须强制下载的类型：
 * HTML/SVG/XML 内联渲染时可在 API 源下执行脚本（存储型 XSS）
 */
const FORCE_DOWNLOAD_TYPES: ReadonlySet<string> = new Set([
  'text/html',
  'image/svg+xml',
  'application/xml',
  'text/xml',
])

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

function getRequestContext(baseContext: AppContext, userContext: UserContext): AppContext {
  return userContext.isSystemAccount ? baseContext : createUserAppContext(baseContext, userContext.userId)
}

export function createAttachmentsRouter(deps: AttachmentRouterDeps): Router {
  const { context: baseContext, fileProvider } = deps
  const router = Router()
  router.use(express.json({ limit: '110mb' }))

  function resolveService(req: Request): AttachmentService {
    const userContext = (req as RequestWithUserContext).userContext
    if (!userContext) {
      throw new Error('Attachments 路由缺少 userContext，请确认 authMiddleware 已挂载')
    }
    return new AttachmentService(getRequestContext(baseContext, userContext), fileProvider)
  }

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

      const attachment = await resolveService(req).save({
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
      const attachments = await resolveService(req).list(scope, id)
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

      const service = resolveService(req)
      const buffer = await service.readAsBuffer(scope, id, fileId)
      // Content-Type 只能来自上传时存储的元数据（旧附件无索引时按扩展名推断），
      // 不接受 query 参数指定，防止伪造 text/html 在 API 源内联执行脚本（存储型 XSS）
      const metadata = await service.getMetadata(scope, id, fileId)
      const contentType = metadata?.mediaType ?? inferMediaType(fileId)

      res.setHeader('Content-Type', contentType)
      res.setHeader('X-Content-Type-Options', 'nosniff')
      if (!isPreviewable(contentType) || FORCE_DOWNLOAD_TYPES.has(contentType)) {
        res.setHeader('Content-Disposition', `attachment; filename="${fileId}"`)
      } else {
        // 内联预览兜底：禁止脚本执行（如 PDF 阅读器之外的场景）
        res.setHeader('Content-Security-Policy', 'sandbox')
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

      await resolveService(req).delete(scope, id, fileId)
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
