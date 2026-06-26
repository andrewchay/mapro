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
    const rows = this.db.query(normalizedSql).all(...(params ?? [])) as T[]
    return { rows, rowCount: rows.length }
  }

  async queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null> {
    const normalizedSql = normalizePlaceholders(sql)
    const row = this.db.query(normalizedSql).get(...(params ?? [])) as T | null
    return row
  }

  async execute(sql: string, params?: unknown[]): Promise<{ changes: number }> {
    const normalizedSql = normalizePlaceholders(sql)
    const result = this.db.run(normalizedSql, ...(params ?? []))
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
}

/** 把 $1, $2... 占位符替换为 ? */
function normalizePlaceholders(sql: string): string {
  return sql.replace(/\$(\d+)/g, '?')
}
