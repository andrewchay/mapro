/**
 * 工作区文件服务
 *
 * 为 Web 端提供按作用域隔离的 Agent / Campaign 工作区文件读写能力。
 * 所有操作限定在 {dataDir}/agent-workspaces/{workspaceSlug} 下，
 * 其中 campaign 作用域自动映射为 campaign-{id}。
 */

import { normalize, join, sep } from 'node:path'
import { writeFile, stat } from 'node:fs/promises'
import { MAX_ATTACHMENT_SIZE } from '@ma-proma/shared'
import type { AppContext } from '../context/types.ts'
import { getAgentWorkspacePath } from '../context/config-paths.ts'
import type { FileProvider } from '../files/types.ts'
import type { WorkspaceFileEntry } from '@ma-proma/shared'

export type WorkspaceScope = 'workspace' | 'campaign'

const ALLOWED_SCOPES: WorkspaceScope[] = ['workspace', 'campaign']
const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/

class WorkspaceFileError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message)
    this.name = 'WorkspaceFileError'
  }
}

function assertAllowedScope(scope: string): asserts scope is WorkspaceScope {
  if (!ALLOWED_SCOPES.includes(scope as WorkspaceScope)) {
    throw new WorkspaceFileError('不支持的工作区作用域', 403)
  }
}

function assertSafeId(id: string): void {
  if (!SAFE_ID_PATTERN.test(id)) {
    throw new WorkspaceFileError('ID 包含非法字符', 400)
  }
}

/**
 * 校验相对路径并返回 path segments。
 *
 * - 拒绝空段、父目录引用 `..`。
 * - 拒绝以 Windows 盘符、根目录 `/` 或反斜杠开头的段。
 * - 允许中文、空格、常见标点等合法文件名字符。
 */
function validateRelativePath(relativePath: string): string[] {
  if (relativePath === '' || relativePath === '/') {
    return []
  }
  const segments = relativePath.split('/')
  for (const segment of segments) {
    if (segment === '' || segment === '..') {
      throw new WorkspaceFileError('非法相对路径', 400)
    }
    if (/^[A-Za-z]:/.test(segment) || segment.startsWith('/') || segment.startsWith('\\')) {
      throw new WorkspaceFileError('非法相对路径', 400)
    }
  }
  return segments
}

function getWorkspaceRoot(context: AppContext, scope: WorkspaceScope, id: string): string {
  const slug = scope === 'campaign' ? `campaign-${id}` : id
  return getAgentWorkspacePath(context, slug)
}

interface ResolvedWorkspacePath {
  root: string
  fullPath: string
  segments: string[]
}

function resolveWorkspacePath(
  context: AppContext,
  scope: WorkspaceScope,
  id: string,
  relativePath: string,
): ResolvedWorkspacePath {
  assertAllowedScope(scope)
  assertSafeId(id)
  const segments = validateRelativePath(relativePath)
  const root = getWorkspaceRoot(context, scope, id)
  const fullPath = segments.length === 0 ? root : normalize(join(root, ...segments))
  const normalizedRoot = normalize(root)
  const normalizedRootWithSep = normalize(root + sep)
  if (fullPath !== normalizedRoot && !fullPath.startsWith(normalizedRootWithSep)) {
    throw new WorkspaceFileError('路径不在工作区安全范围内', 403)
  }
  return { root: normalizedRoot, fullPath, segments }
}

function isProtectedContextPath(segments: string[]): boolean {
  return segments.length > 0 && segments[0] === '.context'
}

function toRelativePath(root: string, absolutePath: string): string {
  const normalizedRoot = normalize(root + sep)
  const normalizedPath = normalize(absolutePath)
  if (normalizedPath === normalize(root)) {
    return ''
  }
  if (!normalizedPath.startsWith(normalizedRoot)) {
    throw new WorkspaceFileError('无法将绝对路径转换为相对路径', 500)
  }
  return normalizedPath.slice(normalizedRoot.length)
}

/**
 * 工作区文件服务
 *
 * 所有可能跨越工作区边界的路径都会在校验阶段被拒绝。
 */
export class WorkspaceFileService {
  constructor(
    private context: AppContext,
    private fileProvider: FileProvider,
  ) {}

  /**
   * 列出工作区目录下的文件。
   *
   * @param relativeDir 工作区内的相对目录，空字符串表示根目录
   * @param recursive 是否递归列出
   * @returns 相对路径表示的文件元信息列表；目录不存在时返回 []
   */
  async listFiles(
    scope: string,
    id: string,
    relativeDir = '',
    recursive = false,
  ): Promise<WorkspaceFileEntry[]> {
    const { root, fullPath } = resolveWorkspacePath(
      this.context,
      scope as WorkspaceScope,
      id,
      relativeDir,
    )
    const exists = await this.fileProvider.exists(fullPath)
    if (!exists) {
      return []
    }
    const entries = recursive
      ? await this.fileProvider.listDirectoryRecursive(fullPath)
      : await this.fileProvider.listDirectory(fullPath)
    return entries.map((entry) => ({
      name: entry.name,
      path: toRelativePath(root, entry.path),
      isDirectory: entry.isDirectory,
      size: entry.size,
      modifiedAt: entry.modifiedAt,
    }))
  }

  /** 读取文本文件 */
  async readTextFile(scope: string, id: string, relativePath: string): Promise<string> {
    const { fullPath } = resolveWorkspacePath(
      this.context,
      scope as WorkspaceScope,
      id,
      relativePath,
    )
    return this.fileProvider.readTextFile(fullPath)
  }

  /** 读取文件并返回 base64 */
  async readFileAsBase64(scope: string, id: string, relativePath: string): Promise<string> {
    const { fullPath } = resolveWorkspacePath(
      this.context,
      scope as WorkspaceScope,
      id,
      relativePath,
    )
    return this.fileProvider.readFileAsBase64(fullPath)
  }

  /** 写入文本文件；父目录不存在时自动创建 */
  async writeTextFile(
    scope: string,
    id: string,
    relativePath: string,
    content: string,
  ): Promise<void> {
    const { root, fullPath, segments } = resolveWorkspacePath(
      this.context,
      scope as WorkspaceScope,
      id,
      relativePath,
    )
    if (segments.length === 0) {
      throw new WorkspaceFileError('缺少文件路径', 400)
    }
    if (isProtectedContextPath(segments)) {
      throw new WorkspaceFileError('无法写入保留目录 .context', 403)
    }
    await this.ensureParentDirectory(root, fullPath)
    await this.fileProvider.writeTextFile(fullPath, content)
  }

  /** 将 base64 数据写入文件 */
  async writeFileFromBase64(
    scope: string,
    id: string,
    relativePath: string,
    base64Data: string,
  ): Promise<void> {
    const rawSize = Math.ceil(base64Data.length * 0.75)
    if (rawSize > MAX_ATTACHMENT_SIZE) {
      throw new WorkspaceFileError(`文件超过 ${MAX_ATTACHMENT_SIZE} 字节限制`, 413)
    }
    const buffer = Buffer.from(base64Data, 'base64')
    if (buffer.length > MAX_ATTACHMENT_SIZE) {
      throw new WorkspaceFileError(`文件超过 ${MAX_ATTACHMENT_SIZE} 字节限制`, 413)
    }
    const { root, fullPath, segments } = resolveWorkspacePath(
      this.context,
      scope as WorkspaceScope,
      id,
      relativePath,
    )
    if (segments.length === 0) {
      throw new WorkspaceFileError('缺少文件路径', 400)
    }
    if (isProtectedContextPath(segments)) {
      throw new WorkspaceFileError('无法写入保留目录 .context', 403)
    }
    await this.ensureParentDirectory(root, fullPath)
    await writeFile(fullPath, buffer)
  }

  /** 删除文件（禁止删除目录与 .context 保留目录） */
  async deleteFile(scope: string, id: string, relativePath: string): Promise<void> {
    const { fullPath, segments } = resolveWorkspacePath(
      this.context,
      scope as WorkspaceScope,
      id,
      relativePath,
    )
    if (segments.length === 0) {
      throw new WorkspaceFileError('缺少文件路径', 400)
    }
    if (isProtectedContextPath(segments)) {
      throw new WorkspaceFileError('无法删除保留目录 .context', 403)
    }
    const info = await stat(fullPath).catch(() => null)
    if (!info) {
      throw new WorkspaceFileError('文件不存在', 404)
    }
    if (!info.isFile()) {
      throw new WorkspaceFileError('只能删除文件', 400)
    }
    await this.fileProvider.remove(fullPath)
  }

  private async ensureParentDirectory(root: string, fullPath: string): Promise<void> {
    const lastSepIndex = fullPath.lastIndexOf(sep)
    if (lastSepIndex <= 0) {
      return
    }
    const parent = fullPath.slice(0, lastSepIndex)
    if (parent === root) {
      return
    }
    await this.fileProvider.mkdir(parent)
  }
}

export { WorkspaceFileError }
