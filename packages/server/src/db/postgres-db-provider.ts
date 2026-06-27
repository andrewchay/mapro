/**
 * PostgreSQL 数据库访问实现
 *
 * 基于 node-postgres（pg）驱动，提供异步 DbProvider 接口。
 * 占位符统一支持 $1, $2... 风格，PostgreSQL 原生兼容。
 */

import { Pool, type PoolClient, type QueryResultRow } from 'pg'
import type { DbProvider, DbQueryResult, DbTransaction } from './types.ts'

export interface PostgresConfig {
  host: string
  port: number
  database: string
  user: string
  password: string
  ssl?: boolean
  maxConnections?: number
}

export class PostgresDbProvider implements DbProvider {
  private pool: Pool

  constructor(config: PostgresConfig) {
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: config.ssl,
      max: config.maxConnections ?? 10,
    })
  }

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<DbQueryResult<T>> {
    const result = await this.pool.query<T & QueryResultRow>(sql, normalizeParams(params))
    return { rows: result.rows as T[], rowCount: result.rowCount ?? result.rows.length }
  }

  async queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null> {
    const result = await this.query<T>(sql, params)
    return result.rows[0] ?? null
  }

  async execute(sql: string, params?: unknown[]): Promise<{ changes: number }> {
    const result = await this.pool.query(sql, normalizeParams(params))
    return { changes: result.rowCount ?? 0 }
  }

  async exec(sql: string): Promise<void> {
    // PostgreSQL 不允许多条语句参数化，但 exec 用于无参数的 Schema DDL，
    // 按语句拆分后逐条执行。
    const statements = splitSqlStatements(sql)
    for (const stmt of statements) {
      const trimmed = stmt.trim()
      if (trimmed) {
        await this.pool.query(trimmed)
      }
    }
  }

  async transaction<T>(fn: (trx: DbTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const trx: DbTransaction = {
        query: async <R = Record<string, unknown>>(sql: string, params?: unknown[]) => {
          const result = await client.query<R & QueryResultRow>(sql, normalizeParams(params))
          return { rows: result.rows as R[], rowCount: result.rowCount ?? result.rows.length }
        },
        queryOne: async <R = Record<string, unknown>>(sql: string, params?: unknown[]) => {
          const result = await client.query<R & QueryResultRow>(sql, normalizeParams(params))
          return (result.rows[0] as R) ?? null
        },
        execute: async (sql: string, params?: unknown[]) => {
          const result = await client.query(sql, normalizeParams(params))
          return { changes: result.rowCount ?? 0 }
        },
      }
      const result = await fn(trx)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }

  async listTableColumns(tableName: string): Promise<string[]> {
    const { rows } = await this.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
      [tableName]
    )
    return rows.map((r) => r.column_name)
  }
}

/**
 * 参数归一化
 *
 * 当前 Schema 中布尔标志列统一使用 INTEGER DEFAULT 0/1，业务层也按 0/1 传入。
 * 若业务层意外传入 boolean，转换为 0/1 以保持与 INTEGER 列的兼容性。
 * 保留 null/undefined/string/number 等其他类型原样。
 */
function normalizeParams(params?: unknown[]): unknown[] {
  if (!params) return []
  return params.map((p) => {
    if (typeof p === 'boolean') return p ? 1 : 0
    return p
  })
}

/**
 * 按语句拆分 SQL 脚本
 *
 * 简单状态机：跳过单引号字符串和双引号标识符中的分号，
 * 按分号切分。exec 输入为可控的 Schema DDL，此实现足够。
 */
function splitSqlStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''
  let inSingleQuote = false
  let inDoubleQuote = false

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i]
    const prev = sql[i - 1]

    if (char === "'" && !inDoubleQuote && prev !== '\\') {
      inSingleQuote = !inSingleQuote
    } else if (char === '"' && !inSingleQuote && prev !== '\\') {
      inDoubleQuote = !inDoubleQuote
    }

    if (char === ';' && !inSingleQuote && !inDoubleQuote) {
      statements.push(current)
      current = ''
    } else {
      current += char
    }
  }

  if (current.trim()) {
    statements.push(current)
  }

  return statements
}
