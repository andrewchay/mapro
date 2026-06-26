/**
 * 数据库访问抽象
 *
 * 阶段 B 内部版先用 SQLite，同时保留 PostgreSQL 迁移路径。
 * 所有接口为异步，为后续替换为 pg 等异步驱动做准备。
 */

export interface DbQueryResult<T = Record<string, unknown>> {
  rows: T[]
  rowCount: number
}

export interface DbProvider {
  /** 执行查询，返回多行 */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<DbQueryResult<T>>

  /** 执行查询，返回单行 */
  queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>

  /** 执行更新/插入/删除 */
  execute(sql: string, params?: unknown[]): Promise<{ changes: number }>

  /** 执行 Schema 初始化脚本 */
  exec(sql: string): Promise<void>

  /** 事务支持 */
  transaction<T>(fn: (trx: DbTransaction) => Promise<T>): Promise<T>

  /** 关闭连接 */
  close(): Promise<void>
}

export interface DbTransaction {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<DbQueryResult<T>>
  queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>
  execute(sql: string, params?: unknown[]): Promise<{ changes: number }>
}
