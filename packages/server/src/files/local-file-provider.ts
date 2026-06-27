/**
 * 本地文件访问实现
 *
 * 用于 Electron 桌面端和内部单用户 Web 服务端，直接操作本地文件系统。
 */

import { readFile, writeFile, readdir, stat, mkdir, rm, access } from 'node:fs/promises'
import { join } from 'node:path'
import type { FileEntry, FileFilter, FileProvider, PickedFile } from './types.ts'

export class LocalFileProvider implements FileProvider {
  async pickFile(): Promise<PickedFile[]> {
    // Electron 端会提供 dialog 实现；服务端内部版暂不实现文件选择
    throw new Error('服务端内部版不直接支持文件选择，请通过上传 API 提供文件')
  }

  async pickFolder(): Promise<string | null> {
    throw new Error('服务端内部版不直接支持文件夹选择')
  }

  async readTextFile(path: string): Promise<string> {
    return readFile(path, 'utf-8')
  }

  async readFileAsBase64(path: string): Promise<string> {
    const buffer = await readFile(path)
    return buffer.toString('base64')
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    await writeFile(path, content, 'utf-8')
  }

  async listDirectory(path: string): Promise<FileEntry[]> {
    const entries = await readdir(path, { withFileTypes: true })
    const result: FileEntry[] = []
    for (const entry of entries) {
      const entryPath = join(path, entry.name)
      const info = await stat(entryPath)
      result.push({
        name: entry.name,
        path: entryPath,
        isDirectory: entry.isDirectory(),
        size: info.size,
        modifiedAt: info.mtime.getTime(),
      })
    }
    return result
  }

  async listDirectoryRecursive(path: string): Promise<FileEntry[]> {
    const result: FileEntry[] = []
    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const entryPath = join(dir, entry.name)
        const info = await stat(entryPath)
        result.push({
          name: entry.name,
          path: entryPath,
          isDirectory: entry.isDirectory(),
          size: info.size,
          modifiedAt: info.mtime.getTime(),
        })
        if (entry.isDirectory()) {
          await walk(entryPath)
        }
      }
    }
    await walk(path)
    return result
  }

  async exists(path: string): Promise<boolean> {
    try {
      await access(path)
      return true
    } catch {
      return false
    }
  }

  async mkdir(path: string): Promise<void> {
    await mkdir(path, { recursive: true })
  }

  async remove(path: string): Promise<void> {
    await rm(path, { recursive: true, force: true })
  }

  async openExternal(path: string): Promise<void> {
    // Web 端应在新标签页打开；本地实现不处理
    throw new Error('LocalFileProvider 不支持 openExternal，请使用 Web 实现')
  }
}
