/**
 * DbProvider 工厂
 *
 * 根据环境变量或显式配置创建 SQLite / PostgreSQL 实现。
 * 阶段 B 内部版默认 SQLite；生产/多实例部署可通过 MAPRO_DB_TYPE + MAPRO_DATABASE_URL 切换到 PostgreSQL。
 */

import { SqliteDbProvider } from './sqlite-db-provider.ts'
import { PostgresDbProvider, type PostgresConfig } from './postgres-db-provider.ts'
import type { DbProvider } from './types.ts'

export interface DbFactoryOptions {
  /** 数据库引擎；默认读取 MAPRO_DB_TYPE，未设置则使用 sqlite */
  engine?: 'sqlite' | 'postgres'
  /** SQLite 文件路径；engine=sqlite 时必填 */
  sqlitePath?: string
  /** PostgreSQL 连接 URL；未提供时读取 MAPRO_DATABASE_URL */
  postgresUrl?: string
  /**
   * PostgreSQL 数据库名后缀。
   * 用于把 campaign / kol 等拆到不同库，例如 url 中数据库名为 mapro，
   * suffix='kol' 则实际连接 mapro_kol。
   */
  postgresDbNameSuffix?: string
}

/**
 * 创建 DbProvider 实例
 */
export function createDbProvider(options: DbFactoryOptions): DbProvider {
  const engine = options.engine ?? readEnvDbType()

  if (engine === 'postgres') {
    const url = options.postgresUrl ?? process.env.MAPRO_DATABASE_URL
    if (!url) {
      throw new Error('PostgreSQL 模式需要配置 MAPRO_DATABASE_URL 或传入 postgresUrl')
    }
    const config = parsePostgresUrl(url, options.postgresDbNameSuffix)
    return new PostgresDbProvider(config)
  }

  if (!options.sqlitePath) {
    throw new Error('SQLite 模式需要提供 sqlitePath')
  }
  return new SqliteDbProvider(options.sqlitePath)
}

function readEnvDbType(): 'sqlite' | 'postgres' {
  const value = process.env.MAPRO_DB_TYPE
  if (value === 'postgres') return 'postgres'
  return 'sqlite'
}

function parsePostgresUrl(url: string, suffix?: string): PostgresConfig {
  const parsed = new URL(url)
  const baseName = parsed.pathname.replace(/^\//, '') || 'mapro'
  const database = suffix ? `${baseName}_${suffix}` : baseName

  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 5432,
    database,
    user: decodeURIComponent(parsed.username || ''),
    password: decodeURIComponent(parsed.password || ''),
    ssl: parsed.searchParams.get('ssl') === 'true' || parsed.searchParams.get('sslmode') === 'require',
    maxConnections: Number(parsed.searchParams.get('max')) || 10,
  }
}
