/**
 * 数据库迁移 / 备份工具
 *
 * 阶段 B 内部部署时支持：
 * - SQLite ↔ SQLite 的备份与恢复
 * - 数据目录整体迁移（打包 ~/.mapro 到目标目录）
 *
 * 未来切到 PostgreSQL 时，可在此扩展 dump/import（pg_dump / COPY）。
 */

import { existsSync, copyFileSync, mkdirSync, renameSync, statSync, readdirSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

export interface DatabaseFileInfo {
  name: string
  path: string
  size: number
}

export class SqliteMigrationService {
  constructor(private dataDir: string) {}

  private resolveDbPath(name: 'campaign' | 'kol'): string {
    if (name === 'campaign') return join(this.dataDir, 'campaign-database.sqlite')
    return join(this.dataDir, 'kol-database.sqlite')
  }

  /**
   * 导出 SQLite 数据库文件到目标路径（复制）。
   */
  exportDatabase(name: 'campaign' | 'kol', destPath: string): void {
    const src = this.resolveDbPath(name)
    if (!existsSync(src)) {
      throw new Error(`数据库文件不存在：${src}`)
    }
    const absDest = resolve(destPath)
    mkdirSync(dirname(absDest), { recursive: true })
    copyFileSync(src, absDest)
  }

  /**
   * 从源路径导入 SQLite 数据库文件，原文件先备份为 .bak 时间戳。
   */
  importDatabase(sourcePath: string, name: 'campaign' | 'kol'): void {
    const dest = this.resolveDbPath(name)
    const absSource = resolve(sourcePath)
    if (!existsSync(absSource)) {
      throw new Error(`源文件不存在：${absSource}`)
    }
    mkdirSync(dirname(dest), { recursive: true })
    if (existsSync(dest)) {
      const backup = `${dest}.bak.${Date.now()}`
      renameSync(dest, backup)
    }
    copyFileSync(absSource, dest)
  }

  /**
   * 列出数据目录下的数据库文件信息。
   */
  listDatabases(): DatabaseFileInfo[] {
    const names = ['campaign-database.sqlite', 'kol-database.sqlite'] as const
    return names
      .filter((n) => existsSync(join(this.dataDir, n)))
      .map((n) => {
        const p = join(this.dataDir, n)
        return { name: n, path: p, size: statSync(p).size }
      })
  }

  /**
   * 迁移整个数据目录到目标目录（合并覆盖已有的同名单个文件，保留目标目录其他文件）。
   * 用于把 ~/.mapro 整体搬到新机器或新数据盘。
   */
  migrateDataDir(targetDir: string): void {
    const absTarget = resolve(targetDir)
    mkdirSync(absTarget, { recursive: true })
    if (!existsSync(this.dataDir)) {
      throw new Error(`源数据目录不存在：${this.dataDir}`)
    }
    const entries = readdirSync(this.dataDir, { withFileTypes: true })
    for (const entry of entries) {
      const src = join(this.dataDir, entry.name)
      const absSrc = resolve(src)
      // 避免把目标目录本身（若在源目录内）复制进目标，导致无限递归
      if (absSrc === absTarget || absSrc.startsWith(absTarget + sep)) {
        continue
      }
      const dest = join(absTarget, entry.name)
      if (entry.isDirectory()) {
        // 目录通过递归复制处理
        this.copyDirectory(src, dest)
      } else {
        copyFileSync(src, dest)
      }
    }
  }

  private copyDirectory(src: string, dest: string): void {
    mkdirSync(dest, { recursive: true })
    const entries = readdirSync(src, { withFileTypes: true })
    for (const entry of entries) {
      const s = join(src, entry.name)
      const d = join(dest, entry.name)
      if (entry.isDirectory()) {
        this.copyDirectory(s, d)
      } else {
        copyFileSync(s, d)
      }
    }
  }
}
