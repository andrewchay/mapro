/**
 * 工作区文件相关类型
 *
 * 供 @ma-proma/server 与 @ma-proma/web-ui 共享，避免 Web UI 依赖 server 包。
 */

export interface WorkspaceFileEntry {
  /** 文件/目录名 */
  name: string
  /** 相对于工作区根目录的路径 */
  path: string
  /** 是否为目录 */
  isDirectory: boolean
  /** 文件大小（字节） */
  size: number
  /** 最后修改时间戳 */
  modifiedAt: number
}
