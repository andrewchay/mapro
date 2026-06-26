/**
 * PostgreSQL 数据库访问实现（草案）
 *
 * 阶段 B 内部版暂不启用，仅提供接口占位。
 * 多租户升级时实现具体逻辑。
 */

import type { DbProvider, DbQueryResult, DbTransaction } from './types.ts'

export interface PostgresConfig {
  host: string
  port: number
  database: string
  user: string
  password: string
  ssl?: boolean
}

export class PostgresDbProvider implements DbProvider {
  private config: PostgresConfig

  constructor(config: PostgresConfig) {
    this.config = config
  }

  async query<T = Record<string, unknown>>(_sql: string, _params?: unknown[]): Promise<DbQueryResult<T>> {
    throw new Error('PostgreSQL 实现尚未完成')
  }

  async queryOne<T = Record<string, unknown>>(_sql: string, _params?: unknown[]): Promise<T | null> {
    throw new Error('PostgreSQL 实现尚未完成')
  }

  async execute(_sql: string, _params?: unknown[]): Promise<{ changes: number }> {
    throw new Error('PostgreSQL 实现尚未完成')
  }

  async exec(_sql: string): Promise<void> {
    throw new Error('PostgreSQL 实现尚未完成')
  }

  async transaction<T>(_fn: (trx: DbTransaction) => Promise<T>): Promise<T> {
    throw new Error('PostgreSQL 实现尚未完成')
  }

  async close(): Promise<void> {
    // 未实现
  }
}
