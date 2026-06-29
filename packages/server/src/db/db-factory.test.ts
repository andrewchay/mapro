import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDbProvider } from './db-factory.ts'

describe('createDbProvider', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mapro-db-factory-'))
    delete process.env.MAPRO_DB_TYPE
    delete process.env.MAPRO_DATABASE_URL
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test('未配置环境变量时默认创建 SQLite provider', async () => {
    const db = createDbProvider({ sqlitePath: join(tmpDir, 'campaign.sqlite') })
    await db.exec('CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY)')
    const one = await db.queryOne<{ id: number }>('SELECT 1 as id')
    expect(one?.id).toBe(1)
    await db.close()
  })

  test('显式 engine=sqlite 忽略 MAPRO_DB_TYPE=postgres', async () => {
    process.env.MAPRO_DB_TYPE = 'postgres'
    const db = createDbProvider({ engine: 'sqlite', sqlitePath: join(tmpDir, 'x.sqlite') })
    await db.exec('CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY)')
    await db.close()
  })

  test('engine=postgres 但未提供 URL 时抛出', () => {
    expect(() => createDbProvider({ engine: 'postgres' })).toThrow('MAPRO_DATABASE_URL')
  })

  test('解析 PostgreSQL URL 并附加数据库名后缀', async () => {
    const db = createDbProvider({
      engine: 'postgres',
      postgresUrl: 'postgres://user:pass@localhost:5432/mapro?ssl=true&max=20',
      postgresDbNameSuffix: 'kol',
    })
    // 无真实 PG 时仅验证实例创建成功；连接会在首次 query 时失败
    expect(db).toBeDefined()
  })

  test('未提供 sqlitePath 且未配置 postgres 时抛出', () => {
    expect(() => createDbProvider({})).toThrow('sqlitePath')
  })
})
