/**
 * 文件访问抽象
 *
 * 替代 Electron 的 dialog / 本地文件系统操作，使业务逻辑可在 Electron 和 Web 服务端共享。
 */

export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  size: number
  modifiedAt: number
}

export interface FileReadResult {
  data: string
  encoding: 'utf-8' | 'base64'
}

export interface PickedFile {
  name: string
  path: string
  size: number
  data?: string
  mediaType?: string
}

export interface FileProvider {
  /** 选择文件（桌面端用 dialog，Web 端用上传） */
  pickFile(options?: { multiple?: boolean; filters?: FileFilter[] }): Promise<PickedFile[]>

  /** 选择文件夹 */
  pickFolder(): Promise<string | null>

  /** 读取文本文件 */
  readTextFile(path: string): Promise<string>

  /** 读取文件为 base64 */
  readFileAsBase64(path: string): Promise<string>

  /** 写入文本文件 */
  writeTextFile(path: string, content: string): Promise<void>

  /** 列出目录 */
  listDirectory(path: string): Promise<FileEntry[]>

  /** 递归列出目录下所有文件（深度优先） */
  listDirectoryRecursive(path: string): Promise<FileEntry[]>

  /** 检查路径是否存在 */
  exists(path: string): Promise<boolean>

  /** 创建目录 */
  mkdir(path: string): Promise<void>

  /** 删除文件或目录 */
  remove(path: string): Promise<void>

  /** 打开外部链接或文件（桌面端用 shell，Web 端用新标签页） */
  openExternal(path: string): Promise<void>
}

export interface FileFilter {
  name: string
  extensions: string[]
}
