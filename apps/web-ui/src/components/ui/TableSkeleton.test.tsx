/**
 * TableSkeleton 组件测试
 */

import { describe, it, expect } from 'bun:test'
import { render } from '@testing-library/react'
import { TableSkeleton } from './TableSkeleton.tsx'

describe('TableSkeleton', () => {
  it('Given 默认 props when 渲染 then 渲染 5 行 4 列骨架', () => {
    const { container } = render(<TableSkeleton columns={4} />)
    const rows = container.querySelectorAll('tbody tr')
    expect(rows.length).toBe(5)
    const headCells = container.querySelectorAll('thead th')
    expect(headCells.length).toBe(4)
  })

  it('Given 自定义 rows 与 columns when 渲染 then 渲染指定行数与列数', () => {
    const { container } = render(<TableSkeleton rows={3} columns={6} />)
    const rows = container.querySelectorAll('tbody tr')
    expect(rows.length).toBe(3)
    const headCells = container.querySelectorAll('thead th')
    expect(headCells.length).toBe(6)
  })
})
