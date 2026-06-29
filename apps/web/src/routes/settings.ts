/**
 * 设置与用户档案 REST API
 *
 * 提供应用设置和用户档案的读写能力。
 * 存储路径：{MAPRO_DATA_DIR}/settings.json、{MAPRO_DATA_DIR}/user-profile.json
 */

import { Router } from 'express'
import type { Request, Response } from 'express'
import express from 'express'
import type { AppContext } from '@ma-proma/server'
import {
  getAppSettings,
  updateAppSettings,
  validateSettingsPatch,
  getUserProfile,
  updateUserProfile,
} from '@ma-proma/server'

export function createSettingsRouter(context: AppContext): Router {
  const router = Router()

  // 此路由可能接收 base64 头像等大 JSON，单独调大 limit，不影响全局
  router.use(express.json({ limit: '8mb' }))

  // GET /api/settings
  router.get('/settings', (_req: Request, res: Response) => {
    try {
      const settings = getAppSettings(context)
      res.json({ success: true, settings })
    } catch (error) {
      const message = error instanceof Error ? error.message : '获取设置失败'
      console.error('[Settings API] 获取设置失败:', error)
      res.status(500).json({ success: false, error: message })
    }
  })

  // PATCH /api/settings
  router.patch('/settings', (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, unknown>
      const { updates, errors } = validateSettingsPatch(body)

      if (errors && Object.keys(errors).length > 0) {
        res.status(400).json({ success: false, errors })
        return
      }

      const settings = updateAppSettings(context, updates)
      res.json({ success: true, settings })
    } catch (error) {
      const message = error instanceof Error ? error.message : '更新设置失败'
      console.error('[Settings API] 更新设置失败:', error)
      res.status(500).json({ success: false, error: message })
    }
  })

  // GET /api/user-profile
  router.get('/user-profile', (_req: Request, res: Response) => {
    try {
      const profile = getUserProfile(context)
      res.json({ success: true, profile })
    } catch (error) {
      const message = error instanceof Error ? error.message : '获取用户档案失败'
      console.error('[Settings API] 获取用户档案失败:', error)
      res.status(500).json({ success: false, error: message })
    }
  })

  // PATCH /api/user-profile
  router.patch('/user-profile', (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, unknown>
      const updates: Partial<{ userName: string; avatar: string }> = {}

      if ('userName' in body) {
        if (typeof body.userName !== 'string') {
          res.status(400).json({ success: false, errors: { userName: 'userName 必须是字符串' } })
          return
        }
        updates.userName = body.userName
      }

      if ('avatar' in body) {
        if (typeof body.avatar !== 'string') {
          res.status(400).json({ success: false, errors: { avatar: 'avatar 必须是字符串' } })
          return
        }
        updates.avatar = body.avatar
      }

      const profile = updateUserProfile(context, updates)
      res.json({ success: true, profile })
    } catch (error) {
      const message = error instanceof Error ? error.message : '更新用户档案失败'
      console.error('[Settings API] 更新用户档案失败:', error)
      res.status(500).json({ success: false, error: message })
    }
  })

  return router
}
