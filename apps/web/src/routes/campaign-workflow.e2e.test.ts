/**
 * Campaign 13 步工作流端到端测试
 *
 * 验证从创建 Campaign 开始，依次完成全部 13 个工作流步骤，
 * 产物校验通过且最终工作流标记为已完成。
 *
 * 注意：工作流 GET 使用 node:http.get 而非 fetch，
 * 以绕过 Bun fetch 在同一 URL 上的响应缓存行为。
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import express from 'express'
import type { Server } from 'node:http'
import { get } from 'node:http'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppContext, UserContext } from '@ma-proma/server'
import type { RequestWithUserContext } from '../auth-middleware.ts'
import { createCampaignRouter } from './campaign.ts'
import { DEFAULT_WORKFLOW_STEPS, STEP_DIR_MAP } from '@ma-proma/server'
import type { Campaign, CampaignWorkflowStepId } from '@ma-proma/shared'

function createTestContext(dataDir: string): AppContext {
  return {
    getConfigDir: () => dataDir,
    getResourcesPath: () => dataDir,
    isPackaged: () => false,
  }
}

function httpGetJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          resolve(JSON.parse(data) as T)
        } catch (err) {
          reject(err)
        }
      })
    }).on('error', reject)
  })
}

function writeArtifact(dataDir: string, campaignId: string, stepId: CampaignWorkflowStepId): void {
  const dirName = STEP_DIR_MAP[stepId]
  const fullDir = join(dataDir, 'agent-workspaces', `campaign-${campaignId}`, dirName)
  mkdirSync(fullDir, { recursive: true })

  const step = DEFAULT_WORKFLOW_STEPS.find((s) => s.id === stepId)
  const anchors = step?.artifactRequirements?.map((r) => [r.name, ...r.aliases].join(' ')).join('\n') ?? stepId
  const content = `# ${step?.title ?? stepId}\n\n${anchors}\n${'内容'.repeat(200)}\n`

  // 如果步骤声明了必需产物文件，则写入每个必需文件；否则写入默认 artifact.md
  const requiredFiles = step?.requiredFiles
  if (requiredFiles && requiredFiles.length > 0) {
    for (const filename of requiredFiles) {
      writeFileSync(join(fullDir, filename), content, 'utf-8')
    }
  } else {
    writeFileSync(join(fullDir, 'artifact.md'), content, 'utf-8')
  }
}

describe('Campaign 14 步工作流 E2E', () => {
  let dataDir: string
  let context: AppContext
  let server: Server
  let baseUrl: string
  let campaign: Campaign

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'mapro-campaign-workflow-e2e-'))
    context = createTestContext(dataDir)

    const app = express()
    app.use(express.json())
    app.use('/campaigns', (req, _res, next) => {
      const ctx: UserContext = { userId: 'system', sessionId: '', tenantId: 'default', roles: ['system'], permissions: ['*'], isSystemAccount: true }
      ;(req as unknown as RequestWithUserContext).userContext = ctx
      next()
    })
    app.use('/campaigns', await createCampaignRouter(context))

    await new Promise<void>((resolve, reject) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (address && typeof address === 'object') {
          baseUrl = `http://127.0.0.1:${address.port}/campaigns`
        }
        resolve()
      })
      server.on('error', reject)
    })

    const createRes = await fetch(`${baseUrl}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'E2E 工作流 Campaign',
        brand: 'E2EBrand',
        platform: 'xiaohongshu',
        budget: 50000,
        durationMonths: 2,
      }),
    })
    const createJson = (await createRes.json()) as { success: boolean; campaign: Campaign }
    campaign = createJson.campaign
  })

  afterAll(() => {
    server?.close()
    rmSync(dataDir, { recursive: true, force: true })
  })

  test('初始工作流包含 14 步且未开始', async () => {
    const json = await httpGetJson<{ success: boolean; workflow: { steps: { id: string; status: string }[]; currentStepIndex: number } }>(`${baseUrl}/${campaign.id}/workflow`)
    expect(json.success).toBe(true)
    expect(json.workflow.steps.length).toBe(14)
    expect(json.workflow.currentStepIndex).toBe(-1)
  })

  test('依次完成 14 步工作流', async () => {
    for (let i = 0; i < DEFAULT_WORKFLOW_STEPS.length; i++) {
      const stepId = DEFAULT_WORKFLOW_STEPS[i]!.id
      writeArtifact(dataDir, campaign.id, stepId)

      // 步骤设为进行中
      const patchRes = await fetch(`${baseUrl}/${campaign.id}/workflow/steps/${stepId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'in_progress' }),
      })
      expect(patchRes.status).toBe(200)

      // 产物校验应通过
      const validateRes = await fetch(`${baseUrl}/${campaign.id}/workflow/steps/${stepId}/validate`, { method: 'POST' })
      const validateJson = (await validateRes.json()) as { success: boolean; result: { valid: boolean; missing: string[] } }
      expect(validateJson.success).toBe(true)
      expect(validateJson.result.valid).toBe(true)

      // 完成当前步骤
      const completeRes = await fetch(`${baseUrl}/${campaign.id}/workflow/steps/${stepId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [] }),
      })
      const completeJson = (await completeRes.json()) as { success: boolean; result: { success: boolean; reason?: string } }
      expect(completeJson.success).toBe(true)
      expect(completeJson.result.success).toBe(true)

      // 推进到下一步（最后一步无需推进）
      if (i < DEFAULT_WORKFLOW_STEPS.length - 1) {
        const nextId = DEFAULT_WORKFLOW_STEPS[i + 1]!.id
        const midJson = await httpGetJson<{ success: boolean; workflow: { currentStepIndex: number; steps: { id: string; status: string }[] } }>(`${baseUrl}/${campaign.id}/workflow`)
        expect(midJson.workflow.steps[i]?.status).toBe('completed')

        const advanceRes = await fetch(`${baseUrl}/${campaign.id}/workflow/advance`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stepId, nextStepId: nextId }),
        })
        const advanceJson = (await advanceRes.json()) as { success: boolean; workflow: { currentStepIndex: number; steps: { id: string; status: string }[] } }
        expect(advanceJson.success).toBe(true)
        expect(advanceJson.workflow.steps[i]?.status).toBe('completed')
        expect(advanceJson.workflow.steps[i + 1]?.status).toBe('in_progress')
        expect(advanceJson.workflow.currentStepIndex).toBe(i + 1)
      }
    }

    const finalJson = await httpGetJson<{ success: boolean; workflow: { steps: { id: string; status: string }[]; currentStepIndex: number } }>(`${baseUrl}/${campaign.id}/workflow`)
    expect(finalJson.success).toBe(true)
    expect(finalJson.workflow.steps.every((s) => s.status === 'completed')).toBe(true)
    expect(finalJson.workflow.currentStepIndex).toBe(DEFAULT_WORKFLOW_STEPS.length - 1)
  })

  test('重置工作流后回到初始状态', async () => {
    const resetRes = await fetch(`${baseUrl}/${campaign.id}/workflow/reset`, { method: 'POST' })
    const resetJson = (await resetRes.json()) as { success: boolean; workflow: { currentStepIndex: number; steps: { status: string }[] } }
    expect(resetJson.success).toBe(true)
    expect(resetJson.workflow.currentStepIndex).toBe(-1)
    expect(resetJson.workflow.steps.every((s) => s.status === 'pending')).toBe(true)
  })
})
