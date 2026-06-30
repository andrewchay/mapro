/**
 * SQLite 数据库访问实现
 *
 * 包装同步的 SqliteDatabase，提供异步 DbProvider 接口。
 * 占位符统一支持 $1, $2... 风格，内部转换为 SQLite 的 ? 风格。
 */

import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { DbProvider, DbQueryResult, DbTransaction } from './types.ts'
import { SqliteDatabase } from '../context/sqlite-adapter.ts'

export class SqliteDbProvider implements DbProvider {
  private db: SqliteDatabase

  constructor(dbPath: string) {
    const dir = dirname(dbPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    this.db = new SqliteDatabase(dbPath)
  }

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<DbQueryResult<T>> {
    const normalizedSql = normalizePlaceholders(sql)
    const normalizedParams = normalizeParams(params)
    const rows = this.db.query(normalizedSql).all(...normalizedParams) as T[]
    return { rows, rowCount: rows.length }
  }

  async queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null> {
    const normalizedSql = normalizePlaceholders(sql)
    const normalizedParams = normalizeParams(params)
    const row = this.db.query(normalizedSql).get(...normalizedParams) as T | null
    return row
  }

  async execute(sql: string, params?: unknown[]): Promise<{ changes: number }> {
    const normalizedSql = normalizePlaceholders(sql)
    const normalizedParams = normalizeParams(params)
    const result = this.db.run(normalizedSql, ...normalizedParams)
    return { changes: result.changes }
  }

  async exec(sql: string): Promise<void> {
    this.db.run(sql)
  }

  async transaction<T>(fn: (trx: DbTransaction) => Promise<T>): Promise<T> {
    // SQLite 同步模式下使用简单 BEGIN/COMMIT/ROLLBACK
    this.db.run('BEGIN')
    try {
      const result = await fn({
        query: async <R = Record<string, unknown>>(sql: string, params?: unknown[]) => this.query<R>(sql, params),
        queryOne: async <R = Record<string, unknown>>(sql: string, params?: unknown[]) => this.queryOne<R>(sql, params),
        execute: async (sql: string, params?: unknown[]) => this.execute(sql, params),
      })
      this.db.run('COMMIT')
      return result
    } catch (error) {
      this.db.run('ROLLBACK')
      throw error
    }
  }

  async close(): Promise<void> {
    this.db.close()
  }

  async listTableColumns(tableName: string): Promise<string[]> {
    const { rows } = await this.query<{ name: string }>(`PRAGMA table_info(${tableName})`)
    return rows.map((r) => r.name)
  }

  async insertIgnore(tableName: string, columns: string[], values: unknown[]): Promise<{ changes: number }> {
    const cols = columns.map((c) => `"${c}"`).join(', ')
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')
    const sql = `INSERT OR IGNORE INTO "${tableName}" (${cols}) VALUES (${placeholders})`
    return this.execute(sql, values)
  }
}

/** 把 $1, $2... 占位符替换为 ? */
function normalizePlaceholders(sql: string): string {
  return sql.replace(/\$(\d+)/g, '?')
}

/**
 * 参数归一化
 *
 * 当前 Schema 中布尔标志列统一使用 INTEGER DEFAULT 0/1。
 * 若业务层传入 boolean，转换为 0/1 以保持与 INTEGER 列的兼容性。
 */
function normalizeParams(params?: unknown[]): unknown[] {
  if (!params) return []
  return params.map((p) => {
    if (typeof p === 'boolean') return p ? 1 : 0
    return p
  })
}
