/**
 * SQLite 运行时适配层
 *
 * 在 Bun 环境使用 bun:sqlite，在 Node.js/Electron 环境使用 better-sqlite3。
 * 与 Electron 的 config-paths 解耦，只负责数据库连接。
 */

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

function loadEngine(): { Database: new (path: string) => any } {
  if (typeof Bun !== 'undefined') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('bun:sqlite')
      if (mod.Database) {
        return { Database: mod.Database }
      }
    } catch {
      // fall through to better-sqlite3
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return { Database: require('better-sqlite3') }
}

const engine = loadEngine()

export class SqliteDatabase {
  private db: any

  constructor(path: string) {
    this.db = new engine.Database(path)
    // WAL + busy_timeout：Web 服务端多请求并发读写时避免 SQLITE_BUSY
    try {
      this.db.exec('PRAGMA journal_mode=WAL')
      this.db.exec('PRAGMA busy_timeout=3000')
    } catch (err) {
      console.warn('[SQLite] 设置 WAL/busy_timeout 失败:', err)
    }
  }

  run(sql: string, ...params: unknown[]): { changes: number } {
    const flat = flattenParams(params)
    if (flat.length === 0) {
      this.db.exec(sql)
      return { changes: 0 }
    }
    return this.db.prepare(sql).run(...flat)
  }

  query(sql: string) {
    const stmt = this.db.prepare(sql)
    return {
      get: (...params: unknown[]) => stmt.get(...flattenParams(params)) ?? null,
      all: (...params: unknown[]) => stmt.all(...flattenParams(params)),
    }
  }

  close(): void {
    this.db.close()
  }
}

function flattenParams(params: unknown[]): any[] {
  if (params.length === 1 && Array.isArray(params[0])) {
    return params[0] as any[]
  }
  return params as any[]
}
