/**
 * EmptyState 组件测试
 */

import { describe, it, expect, mock } from 'bun:test'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { Inbox } from 'lucide-react'
import { EmptyState } from './EmptyState.tsx'

describe('EmptyState', () => {
  it('Given 标题与描述 when 渲染 then 展示图标、标题和描述', () => {
    const { getByText } = render(
      <EmptyState icon={Inbox} title="暂无数据" description="请添加一条记录" />,
    )

    expect(getByText('暂无数据')).toBeTruthy()
    expect(getByText('请添加一条记录')).toBeTruthy()
  })

  it('Given 操作按钮 when 点击 then 触发 onClick', () => {
    const onClick = mock(() => {})
    const { getByText } = render(
      <EmptyState icon={Inbox} title="暂无数据" action={{ label: '去添加', onClick }} />,
    )

    fireEvent.click(getByText('去添加'))
    expect(onClick).toHaveBeenCalled()
  })
})
