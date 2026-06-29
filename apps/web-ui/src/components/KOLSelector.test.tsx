/**
 * KOL 选择器组件测试
 *
 * 验证从候选池中选择 KOL、搜索过滤、清除选择等行为。
 */

import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test'
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react'
import type { CampaignKOLPoolItem } from '@ma-proma/shared'
import { KOLSelector } from './KOLSelector.tsx'

const pool: CampaignKOLPoolItem[] = [
  { campaignId: 'c1', kolId: 'k1', name: '达人 A', platform: 'xhs', followers: '10k', engagement: '5%', category: 'beauty', price: '1000', city: '上海', status: 'candidate', notes: '', addedAt: Date.now() },
  { campaignId: 'c1', kolId: 'k2', name: '达人 B', platform: 'douyin', followers: '50k', engagement: '8%', category: 'food', price: '3000', city: '北京', status: 'candidate', notes: '', addedAt: Date.now() },
]

describe('KOLSelector', () => {
  const onChange = mock(() => {})

  beforeEach(() => {
    onChange.mockClear()
  })

  afterEach(() => {
    cleanup()
  })

  it('Given 未选择 KOL when 渲染 then 显示占位文本', () => {
    const { getByText } = render(<KOLSelector pool={pool} value={null} onChange={onChange} placeholder="请选择 KOL" />)

    expect(getByText('请选择 KOL')).toBeTruthy()
  })

  it('Given 已选择 KOL when 渲染 then 显示 KOL 名称与简介', () => {
    const { getByText } = render(<KOLSelector pool={pool} value="k1" onChange={onChange} />)

    expect(getByText('达人 A')).toBeTruthy()
    expect(getByText(/xhs · 10k 粉丝 · 报价 1000/)).toBeTruthy()
  })

  it('Given 点击选择器 when 展开下拉 then 列出所有候选 KOL', async () => {
    const { getByRole, getAllByRole } = render(<KOLSelector pool={pool} value={null} onChange={onChange} placeholder="请选择 KOL" />)

    fireEvent.click(getByRole('button', { expanded: false }))

    await waitFor(() => {
      expect(getAllByRole('option').length).toBe(2)
    })
  })

  it('Given 输入搜索词 when 过滤 then 只显示匹配的 KOL', async () => {
    const { getByRole, getByPlaceholderText, queryByRole, getByText } = render(
      <KOLSelector pool={pool} value={null} onChange={onChange} placeholder="请选择 KOL" />,
    )

    fireEvent.click(getByRole('button', { expanded: false }))

    const searchInput = getByPlaceholderText('搜索 KOL 名称、ID 或平台')
    fireEvent.change(searchInput, { target: { value: 'B' } })

    await waitFor(() => {
      expect(queryByRole('option', { name: /达人 A/ })).toBeFalsy()
      expect(getByText('达人 B')).toBeTruthy()
    })
  })

  it('Given 点击某个 KOL option when 选择 then 触发 onChange 并关闭下拉', async () => {
    const { getByRole, getByText, queryByRole } = render(
      <KOLSelector pool={pool} value={null} onChange={onChange} placeholder="请选择 KOL" />,
    )

    fireEvent.click(getByRole('button', { expanded: false }))

    const option = await waitFor(() => getByText('达人 B'))
    fireEvent.click(option)

    expect(onChange).toHaveBeenCalledWith('k2', pool[1])
    expect(queryByRole('listbox')).toBeFalsy()
  })

  it('Given 已选 KOL when 点击清除 then 触发 onChange 为 null', () => {
    const { getByLabelText } = render(<KOLSelector pool={pool} value="k1" onChange={onChange} />)

    const clearButton = getByLabelText('清除选择')
    fireEvent.click(clearButton)

    expect(onChange).toHaveBeenCalledWith(null, null)
  })
})
