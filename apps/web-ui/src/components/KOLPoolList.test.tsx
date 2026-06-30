/**
 * KOL 候选池列表测试
 *
 * 验证批量选择、全选、单选、触发 Brief / 审核回调。
 */

import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test'
import { render, fireEvent, cleanup } from '@testing-library/react'
import type { CampaignKOLPoolItem } from '@ma-proma/shared'
import { KOLPoolList } from './KOLPoolList.tsx'

const pool: CampaignKOLPoolItem[] = [
  { campaignId: 'c1', kolId: 'k1', name: '达人 A', platform: 'xhs', followers: '10k', engagement: '5%', category: 'beauty', price: '1000', city: '上海', status: 'candidate', notes: '', addedAt: 0 },
  { campaignId: 'c1', kolId: 'k2', name: '达人 B', platform: 'douyin', followers: '50k', engagement: '8%', category: 'food', price: '3000', city: '北京', status: 'candidate', notes: '', addedAt: 0 },
]

describe('KOLPoolList', () => {
  afterEach(() => {
    cleanup()
  })

  it('Given 未启用选择模式 when 渲染 then 不显示复选框', () => {
    const { queryAllByRole } = render(<KOLPoolList pool={pool} />)

    expect(queryAllByRole('checkbox').length).toBe(0)
  })

  it('Given 启用选择模式 when 点击全选 then 选中所有 KOL', () => {
    const onChange = mock(() => {})
    const { getByLabelText } = render(
      <KOLPoolList pool={pool} selection={{ selected: [], onChange }} />,
    )

    fireEvent.click(getByLabelText('全选'))

    expect(onChange).toHaveBeenCalledWith(['k1', 'k2'])
  })

  it('Given 已全选 when 点击全选 then 取消全选', () => {
    const onChange = mock(() => {})
    const { getByLabelText } = render(
      <KOLPoolList pool={pool} selection={{ selected: ['k1', 'k2'], onChange }} />,
    )

    fireEvent.click(getByLabelText('全选'))

    expect(onChange).toHaveBeenCalledWith([])
  })

  it('Given 启用选择模式 when 点击某个 KOL 复选框 then 仅选中该 KOL', () => {
    const onChange = mock(() => {})
    const { getByLabelText } = render(
      <KOLPoolList pool={pool} selection={{ selected: [], onChange }} />,
    )

    fireEvent.click(getByLabelText('选择 达人 B'))

    expect(onChange).toHaveBeenCalledWith(['k2'])
  })

  it('Given 点击 Brief 按钮 when 回调 then 传出对应 KOL', () => {
    const onBrief = mock(() => {})
    const { getAllByTitle } = render(<KOLPoolList pool={pool} onBrief={onBrief} />)

    const briefButtons = getAllByTitle('Brief')
    expect(briefButtons.length).toBeGreaterThan(0)
    fireEvent.click(briefButtons[0]!)

    expect(onBrief).toHaveBeenCalledWith(pool[0])
  })

  it('Given loading when 渲染 then 展示骨架屏', () => {
    const { container } = render(<KOLPoolList pool={[]} loading />)
    const rows = container.querySelectorAll('tbody tr')
    expect(rows.length).toBe(5)
  })

  it('Given 空列表 when 渲染 then 展示空状态提示', () => {
    const { getByText } = render(<KOLPoolList pool={[]} />)
    expect(getByText('暂无 KOL 候选')).toBeTruthy()
  })
})
