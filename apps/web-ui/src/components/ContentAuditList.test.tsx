/**
 * 内容审核列表测试
 */

import { describe, it, expect, afterEach } from 'bun:test'
import { render, cleanup } from '@testing-library/react'
import type { ContentAudit } from '@ma-proma/shared'
import { ContentAuditList } from './ContentAuditList.tsx'

const audit: ContentAudit = {
  auditId: 'a1',
  campaignId: 'c1',
  kolId: 'k1',
  kolName: '达人 A',
  contentUrl: '',
  platform: 'xiaohongshu',
  auditStatus: 'passed',
  complianceScore: 90,
  brandAlignmentScore: 85,
  qualityScore: 88,
  overallScore: 88,
  auditReport: '符合品牌调性',
  auditor: 'ai',
  createdAt: 0,
  updatedAt: 0,
}

describe('ContentAuditList', () => {
  afterEach(() => {
    cleanup()
  })

  it('Given loading when 渲染 then 展示骨架屏', () => {
    const { container } = render(<ContentAuditList audits={[]} loading />)
    const rows = container.querySelectorAll('tbody tr')
    expect(rows.length).toBe(5)
  })

  it('Given 空列表 when 渲染 then 展示空状态提示', () => {
    const { getByText } = render(<ContentAuditList audits={[]} />)
    expect(getByText('暂无内容审核记录')).toBeTruthy()
  })

  it('Given 有数据 when 渲染 then 展示 KOL 名称与审核状态', () => {
    const { getByText } = render(<ContentAuditList audits={[audit]} />)
    expect(getByText('达人 A')).toBeTruthy()
    expect(getByText('通过')).toBeTruthy()
  })
})
