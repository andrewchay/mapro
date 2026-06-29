/**
 * 设置与用户档案 REST API
 *
 * 提供应用设置和用户档案的读写能力。
 * 存储路径：{MAPRO_DATA_DIR}/settings.json、{MAPRO_DATA_DIR}/user-profile.json
 * 阶段 C1：按请求用户隔离，system 账号继续使用全局目录，普通用户写入 users/{userId}/。
 */

import { Router } from 'express'
import type { Request, Response } from 'express'
import express from 'express'
import type { AppContext, UserContext } from '@ma-proma/server'
import {
  getAppSettings,
  updateAppSettings,
  validateSettingsPatch,
  getUserProfile,
  updateUserProfile,
} from '@ma-proma/server'
import type { RequestWithUserContext } from '../auth-middleware.ts'
import { createUserAppContext } from '../context.ts'

function getRequestContext(baseContext: AppContext, userContext: UserContext): AppContext {
  return userContext.isSystemAccount ? baseContext : createUserAppContext(baseContext, userContext.userId)
}

export function createSettingsRouter(baseContext: AppContext): Router {
  const router = Router()

  // 此路由可能接收 base64 头像等大 JSON，单独调大 limit，不影响全局
  router.use(express.json({ limit: '8mb' }))

  function resolveContext(req: Request): AppContext {
    const userContext = (req as RequestWithUserContext).userContext
    if (!userContext) {
      throw new Error('Settings 路由缺少 userContext，请确认 authMiddleware 已挂载')
    }
    return getRequestContext(baseContext, userContext)
  }

  // GET /api/settings
  router.get('/settings', (req: Request, res: Response) => {
    try {
      const settings = getAppSettings(resolveContext(req))
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

      const settings = updateAppSettings(resolveContext(req), updates)
      res.json({ success: true, settings })
    } catch (error) {
      const message = error instanceof Error ? error.message : '更新设置失败'
      console.error('[Settings API] 更新设置失败:', error)
      res.status(500).json({ success: false, error: message })
    }
  })

  // GET /api/user-profile
  router.get('/user-profile', (req: Request, res: Response) => {
    try {
      const profile = getUserProfile(resolveContext(req))
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

      const profile = updateUserProfile(resolveContext(req), updates)
      res.json({ success: true, profile })
    } catch (error) {
      const message = error instanceof Error ? error.message : '更新用户档案失败'
      console.error('[Settings API] 更新用户档案失败:', error)
      res.status(500).json({ success: false, error: message })
    }
  })

  return router
}
