import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteDbProvider } from './sqlite-db-provider.ts'
import { PostgresDbProvider } from './postgres-db-provider.ts'
import { createDbProvider } from './db-factory.ts'
import type { DbProvider } from './types.ts'

async function runProviderContract(db: DbProvider): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS dialect_test (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT false,
      score REAL DEFAULT 0
    );
    DELETE FROM dialect_test;
  `)

  const insert = await db.execute(
    'INSERT INTO dialect_test (name, active, score) VALUES ($1, $2, $3)',
    ['foo', true, 1.5],
  )
  expect(insert.changes).toBe(1)

  const one = await db.queryOne<{ id: number; name: string; active: number; score: number }>(
    'SELECT * FROM dialect_test WHERE name = $1',
    ['foo'],
  )
  expect(one?.name).toBe('foo')
  const activeValue = one?.active as number | boolean | undefined
  expect(activeValue === 1 || activeValue === true).toBe(true)
  expect(one?.score).toBe(1.5)

  const all = await db.query<{ id: number }>('SELECT * FROM dialect_test')
  expect(all.rows.length).toBe(1)

  const cols = await db.listTableColumns('dialect_test')
  expect(cols).toContain('id')
  expect(cols).toContain('name')
  expect(cols).toContain('active')

  await db.transaction(async (trx) => {
    await trx.execute('INSERT INTO dialect_test (name, active, score) VALUES ($1, $2, $3)', ['bar', false, 2.0])
    await trx.execute('UPDATE dialect_test SET score = $1 WHERE name = $2', [3.0, 'foo'])
  })

  const afterTrx = await db.queryOne<{ score: number }>('SELECT score FROM dialect_test WHERE name = $1', ['foo'])
  expect(afterTrx?.score).toBe(3.0)

  const del = await db.execute('DELETE FROM dialect_test WHERE name = $1', ['bar'])
  expect(del.changes).toBe(1)

  // insertIgnore / upsert 跨方言一致性
  await db.exec(`
    CREATE TABLE IF NOT EXISTS dialect_upsert_test (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL
    );
    DELETE FROM dialect_upsert_test;
  `)
  const firstIgnore = await db.insertIgnore('dialect_upsert_test', ['k', 'v'], ['a', '1'])
  expect(firstIgnore.changes).toBe(1)
  const secondIgnore = await db.insertIgnore('dialect_upsert_test', ['k', 'v'], ['a', '2'])
  expect(secondIgnore.changes).toBe(0)
  const upsertRow = await db.queryOne<{ v: string }>('SELECT v FROM dialect_upsert_test WHERE k = $1', ['a'])
  expect(upsertRow?.v).toBe('1')
}

describe('DbProvider 方言一致性', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mapro-dialect-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test('SQLite 实现满足统一契约', async () => {
    const db = new SqliteDbProvider(join(tmpDir, 'test.sqlite'))
    await runProviderContract(db)
    await db.close()
  })

  test('createDbProvider SQLite 实现满足统一契约', async () => {
    const db = createDbProvider({ engine: 'sqlite', sqlitePath: join(tmpDir, 'factory.sqlite') })
    await runProviderContract(db)
    await db.close()
  })

  test('PostgreSQL 实现满足统一契约（需要 MAPRO_TEST_DATABASE_URL）', async () => {
    const url = process.env.MAPRO_TEST_DATABASE_URL
    if (!url) {
      console.log('跳过 PostgreSQL 方言测试：未设置 MAPRO_TEST_DATABASE_URL')
      return
    }
    const db = createDbProvider({ engine: 'postgres', postgresUrl: url, postgresDbNameSuffix: 'dialect' })
    await runProviderContract(db)
    await db.close()
  })
})
