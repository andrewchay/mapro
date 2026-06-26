/**
 * SQLite 运行时适配层
 *
 * 在 Bun 环境使用 bun:sqlite，在 Node.js/Electron 环境使用 better-sqlite3。
 * 与 Electron 的 config-paths 解耦，只负责数据库连接。
 */

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

async function loadEngine(): Promise<{ Database: new (path: string) => any }> {
  if (typeof Bun !== 'undefined') {
    try {
      const mod = await import('bun:sqlite')
      return { Database: mod.Database }
    } catch {
      // fall through to better-sqlite3
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return { Database: require('better-sqlite3') }
}

const engine = await loadEngine()

export class SqliteDatabase {
  private db: any

  constructor(path: string) {
    this.db = new engine.Database(path)
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
