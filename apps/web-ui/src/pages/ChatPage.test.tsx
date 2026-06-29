import '../../src/test-setup.ts'

/**
 * ChatPage 单元测试
 *
 * 验证拖拽上传附件行为：
 * 1. 拖拽文件到输入区域时显示上传提示
 * 2. 释放文件后调用 uploadAttachment
 * 3. 支持一次性拖拽多个文件
 */

import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, afterAll, mock } from 'bun:test'
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { ChatPage } from './ChatPage.tsx'
import { mockWebAPI } from '../test-utils/mock-web-api.ts'
import type { FileAttachment } from '@ma-proma/shared'

mock.module('../api/web-api.ts', () => ({
  webAPI: mockWebAPI,
}))

afterAll(() => {
  mock.restore()
})

function createFile(name: string, type: string): File {
  return new File(['hello'], name, { type })
}

function createDataTransfer(files: File[]): DataTransfer {
  const dt = new DataTransfer()
  for (const file of files) {
    dt.items.add(file)
  }
  return dt
}

describe('ChatPage', () => {
  beforeEach(() => {
    mockWebAPI.uploadAttachment = mock(async (_scope: string, _id: string, file: File): Promise<FileAttachment> => ({
      id: `att-${file.name}`,
      filename: file.name,
      mediaType: file.type || 'application/octet-stream',
      localPath: `chat/web-chat/${file.name}`,
      size: file.size,
    }))
  })

  afterEach(() => {
    cleanup()
  })

  it('Given 拖拽单个文件到输入区 when 释放时 then 调用 uploadAttachment 并展示附件', async () => {
    const { getByPlaceholderText, queryByText } = render(<ChatPage />)
    const dropZone = getByPlaceholderText('输入消息...').parentElement!
    const file = createFile('report.pdf', 'application/pdf')

    fireEvent.dragEnter(dropZone, { dataTransfer: createDataTransfer([file]) })
    expect(queryByText('释放文件以上传')).toBeTruthy()

    fireEvent.drop(dropZone, { dataTransfer: createDataTransfer([file]) })

    await waitFor(() => expect(mockWebAPI.uploadAttachment).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(queryByText('report.pdf')).toBeTruthy())
  })

  it('Given 拖拽多个文件到输入区 when 释放时 then 依次上传所有文件', async () => {
    const { getByPlaceholderText, queryByText } = render(<ChatPage />)
    const dropZone = getByPlaceholderText('输入消息...').parentElement!
    const files = [createFile('a.png', 'image/png'), createFile('b.txt', 'text/plain')]

    fireEvent.drop(dropZone, { dataTransfer: createDataTransfer(files) })

    await waitFor(() => expect(mockWebAPI.uploadAttachment).toHaveBeenCalledTimes(2))
    await waitFor(() => {
      expect(queryByText('a.png')).toBeTruthy()
      expect(queryByText('b.txt')).toBeTruthy()
    })
  })
})
