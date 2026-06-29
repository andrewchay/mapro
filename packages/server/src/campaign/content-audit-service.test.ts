/**
 * ContentAuditService 单元测试
 *
 * BDD 行为驱动，验证规则打分路径：
 * 1. 普通品牌名正确计品牌契合度
 * 2. 品牌名含正则特殊字符不崩溃且仍能评分（回归 Bug 1）
 * 3. 风险词降低合规分
 * 4. determineStatus 阈值（70/50）
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { ContentAuditService } from './content-audit-service.ts'
import type { CampaignRepository } from './campaign-repository.ts'
import type { ContentAudit, CreateContentAuditInput } from '@ma-proma/shared'

function createMockRepository(): CampaignRepository {
  return {
    createContentAudit: mock(async (input: CreateContentAuditInput & {
      auditStatus: ContentAudit['auditStatus']
      complianceScore: number
      brandAlignmentScore: number
      qualityScore: number
      overallScore: number
      auditReport: string
      auditor: string
    }): Promise<ContentAudit> => ({
      auditId: 'audit-001',
      campaignId: input.campaignId,
      kolId: input.kolId,
      kolName: input.kolName,
      contentUrl: input.contentUrl ?? '',
      platform: input.platform,
      auditStatus: input.auditStatus,
      complianceScore: input.complianceScore,
      brandAlignmentScore: input.brandAlignmentScore,
      qualityScore: input.qualityScore,
      overallScore: input.overallScore,
      auditReport: input.auditReport,
      auditor: input.auditor,
      createdAt: 0,
      updatedAt: 0,
    })),
  } as unknown as CampaignRepository
}

function buildInput(overrides: Partial<CreateContentAuditInput> = {}): CreateContentAuditInput {
  return {
    campaignId: 'c1',
    kolId: 'k1',
    kolName: '达人小A',
    brand: 'VONBON',
    product: '益生菌',
    platform: 'xiaohongshu',
    contentType: '图文',
    contentDescription: '这是一篇关于 VONBON 益生菌的使用分享。',
    ...overrides,
  }
}

describe('ContentAuditService', () => {
  let repository: CampaignRepository
  let service: ContentAuditService

  beforeEach(() => {
    repository = createMockRepository()
    service = new ContentAuditService(null, repository)
  })

  describe('规则打分路径', () => {
    it('Given 普通品牌名在描述中出现 when 审核 then 品牌契合度加分', async () => {
      const audit = await service.audit(buildInput())

      expect(audit.brandAlignmentScore).toBeGreaterThan(40)
      expect(audit.auditor).toBe('rule')
    })

    it('Given 品牌名含正则特殊字符 when 审核 then 不崩溃且仍能正常评分（回归 Bug 1）', async () => {
      const audit = await service.audit(buildInput({
        brand: 'A+B',
        contentDescription: '这是一篇关于 A+B 益生菌的使用分享。',
      }))

      expect(audit.brandAlignmentScore).toBeGreaterThan(40)
      expect(audit.auditReport).toContain('A+B')
    })

    it('Given 品牌名含括号与中括号 when 审核 then 不抛出 SyntaxError', async () => {
      const audit = await service.audit(buildInput({
        brand: '品牌(Pro)',
        contentDescription: '品牌(Pro) 新品上市，欢迎体验 [限时]。',
      }))

      expect(audit.brandAlignmentScore).toBeGreaterThan(40)
    })

    it('Given 空品牌名 when 审核 then 品牌契合度按基础分计算', async () => {
      const audit = await service.audit(buildInput({
        brand: '',
        contentDescription: '这是一篇使用分享。',
      }))

      expect(audit.brandAlignmentScore).toBe(40)
    })

    it('Given 描述含广告法风险词 when 审核 then 合规分降低', async () => {
      const audit = await service.audit(buildInput({
        contentDescription: '这是最好的产品，绝对有效，保证治愈。',
      }))

      expect(audit.complianceScore).toBeLessThan(100)
      expect(audit.complianceScore).toBeGreaterThanOrEqual(0)
    })
  })

  describe('determineStatus 阈值', () => {
    it('Given 综合评分 >= 70 when 审核 then 状态为 passed', async () => {
      const audit = await service.audit(buildInput({
        brand: 'X',
        product: 'X',
        contentDescription: 'X '.repeat(200),
      }))

      expect(audit.overallScore).toBeGreaterThanOrEqual(70)
      expect(audit.auditStatus).toBe('passed')
    })

    it('Given 综合评分在 50-69 之间 when 审核 then 状态为 pending', async () => {
      const audit = await service.audit(buildInput({
        brand: 'X',
        product: 'X',
        contentDescription: '最',
      }))

      expect(audit.overallScore).toBeGreaterThanOrEqual(50)
      expect(audit.overallScore).toBeLessThan(70)
      expect(audit.auditStatus).toBe('pending')
    })

    it('Given 综合评分 < 50 when 审核 then 状态为 failed', async () => {
      const audit = await service.audit(buildInput({
        brand: 'X',
        product: 'Y',
        contentDescription: '最 第一 国家级 纯天然 短',
      }))

      expect(audit.overallScore).toBeLessThan(50)
      expect(audit.auditStatus).toBe('failed')
    })
  })
})
