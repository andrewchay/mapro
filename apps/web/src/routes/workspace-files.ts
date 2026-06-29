/**
 * 工作区文件 REST API
 *
 * 为 Agent / Campaign 工作区提供安全的文件上传、下载、删除、列表能力。
 * 所有路径按 `workspace/{slug}` 或 `campaign/{id}` 隔离。
 */

import express, { Router } from 'express'
import type { Request, Response } from 'express'
import type { AppContext, FileProvider, WorkspaceFileService } from '@ma-proma/server'
import { WorkspaceFileService as WorkspaceFileServiceClass } from '@ma-proma/server'
import { MAX_ATTACHMENT_SIZE } from '@ma-proma/shared'

export interface WorkspaceFilesRouterDeps {
  context: AppContext
  fileProvider: FileProvider
}

interface TextWriteBody {
  content: string
  encoding?: 'utf-8'
}

interface Base64UploadBody {
  filename?: string
  mediaType?: string
  data: string
}

function inferMediaType(filename: string): string {
  const extIndex = filename.lastIndexOf('.')
  const ext = extIndex >= 0 ? filename.slice(extIndex).toLowerCase() : ''
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
  }
  return map[ext] || 'application/octet-stream'
}

function isTextual(mediaType: string): boolean {
  return (
    mediaType.startsWith('text/') ||
    mediaType === 'application/json' ||
    mediaType === 'application/xml' ||
    mediaType === 'application/javascript'
  )
}

function isWorkspaceFileError(error: unknown): error is { statusCode: number; message: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    typeof (error as { statusCode: unknown }).statusCode === 'number'
  )
}

function handleWorkspaceError(error: unknown, res: Response): void {
  const message = error instanceof Error ? error.message : '操作失败'
  if (isWorkspaceFileError(error)) {
    res.status(error.statusCode).json({ success: false, error: message })
    return
  }
  if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
    res.status(404).json({ success: false, error: message })
    return
  }
  console.error('[Workspace Files API] 操作失败:', error)
  res.status(500).json({ success: false, error: message })
}

function normalizeRelativePath(value: unknown): string {
  if (typeof value !== 'string') return ''
  // Express 通配符可能保留前导 `/`，统一去掉
  return value.replace(/^\/+/, '')
}

export function createWorkspaceFilesRouter(deps: WorkspaceFilesRouterDeps): Router {
  const service: WorkspaceFileService = new WorkspaceFileServiceClass(deps.context, deps.fileProvider)
  const router = Router()

  // GET /:scope/:id 列出目录
  router.get('/:scope/:id', async (req: Request, res: Response) => {
    try {
      const scope = req.params.scope as string
      const id = req.params.id as string
      const recursive = req.query.recursive === 'true'
      const dir = typeof req.query.dir === 'string' ? req.query.dir : ''
      const files = await service.listFiles(scope, id, dir, recursive)
      res.json({ success: true, files })
    } catch (error) {
      handleWorkspaceError(error, res)
    }
  })

  // GET /:scope/:id/* 读取文件
  router.get('/:scope/:id/*', async (req: Request, res: Response) => {
    try {
      const scope = req.params.scope as string
      const id = req.params.id as string
      const relativePath = normalizeRelativePath(req.params[0])
      const format = req.query.format === 'base64' ? 'base64' : 'auto'

      if (format === 'base64') {
        const data = await service.readFileAsBase64(scope, id, relativePath)
        res.json({ success: true, data, encoding: 'base64' })
        return
      }

      const text = await service.readTextFile(scope, id, relativePath)
      const mediaType = inferMediaType(relativePath)
      if (isTextual(mediaType) || relativePath.toLowerCase().endsWith('.md')) {
        res.json({ success: true, content: text, mediaType })
        return
      }
      const data = await service.readFileAsBase64(scope, id, relativePath)
      res.json({ success: true, data, encoding: 'base64', mediaType })
    } catch (error) {
      handleWorkspaceError(error, res)
    }
  })

  // POST /:scope/:id/upload/* 上传二进制文件（base64）
  // 注意：upload 路由必须放在通用 `/:scope/:id/*` 之前，否则会被文本写入路由吞掉
  router.post(
    '/:scope/:id/upload/*',
    express.json({ limit: MAX_ATTACHMENT_SIZE }),
    async (req: Request, res: Response) => {
      try {
        const scope = req.params.scope as string
        const id = req.params.id as string
        const relativePath = normalizeRelativePath(req.params[0])
        const body = req.body as Base64UploadBody
        if (typeof body.data !== 'string' || !body.data) {
          res.status(400).json({ success: false, error: 'data 必填' })
          return
        }
        const rawSize = Math.ceil(body.data.length * 0.75)
        if (rawSize > MAX_ATTACHMENT_SIZE) {
          res.status(413).json({ success: false, error: `文件超过 ${MAX_ATTACHMENT_SIZE} 字节限制` })
          return
        }
        await service.writeFileFromBase64(scope, id, relativePath, body.data)
        res.json({
          success: true,
          path: relativePath,
          mediaType: body.mediaType || inferMediaType(body.filename || relativePath),
        })
      } catch (error) {
        handleWorkspaceError(error, res)
      }
    },
  )

  // POST /:scope/:id/* 写入文本文件
  router.post(
    '/:scope/:id/*',
    express.json({ limit: '8mb' }),
    async (req: Request, res: Response) => {
      try {
        const scope = req.params.scope as string
        const id = req.params.id as string
        const relativePath = normalizeRelativePath(req.params[0])
        const body = req.body as TextWriteBody
        if (typeof body.content !== 'string') {
          res.status(400).json({ success: false, error: 'content 必填' })
          return
        }
        await service.writeTextFile(scope, id, relativePath, body.content)
        res.json({ success: true })
      } catch (error) {
        handleWorkspaceError(error, res)
      }
    },
  )

  // DELETE /:scope/:id/* 删除文件
  router.delete('/:scope/:id/*', async (req: Request, res: Response) => {
    try {
      const scope = req.params.scope as string
      const id = req.params.id as string
      const relativePath = normalizeRelativePath(req.params[0])
      await service.deleteFile(scope, id, relativePath)
      res.json({ success: true })
    } catch (error) {
      handleWorkspaceError(error, res)
    }
  })

  return router
}
