import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KOLDatabaseRepository } from './kol-database-repository.ts'
import { SqliteDbProvider } from '../db/sqlite-db-provider.ts'

describe('KOLDatabaseRepository', () => {
  let tempDir: string
  let db: SqliteDbProvider
  let repo: KOLDatabaseRepository

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'kol-repo-test-'))
    db = new SqliteDbProvider(join(tempDir, 'kol.db'))
    repo = new KOLDatabaseRepository(db)
    await repo.initSchema()
  })

  afterEach(async () => {
    await db.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('多关键词搜索', () => {
    test('多个关键词应分别匹配不同名称并返回并集', async () => {
      await db.exec(`
        INSERT INTO kols (id, name, platform, source, overall_score)
        VALUES
          ('kol_001', '上海美妆达人小美', '小红书', 'test', 80),
          ('kol_002', '北京护肤分享师', '小红书', 'test', 75),
          ('kol_003', '深圳数码评测君', '小红书', 'test', 70)
      `)

      const result = await repo.listAvailableKOLs({ keywords: ['美妆', '数码'] })

      expect(result.total).toBe(2)
      expect(result.kols.map((k) => k.id).sort()).toEqual(['kol_001', 'kol_003'])
    })

    test('多关键词大小写不敏感', async () => {
      await db.exec(`
        INSERT INTO kols (id, name, platform, source, overall_score)
        VALUES
          ('kol_004', 'Shanghai Beauty Blogger', '小红书', 'test', 80)
      `)

      const result = await repo.listAvailableKOLs({ keywords: ['BEAUTY', 'shanghai'] })

      expect(result.total).toBe(1)
      expect(result.kols[0]!.id).toBe('kol_004')
    })

    test('关键词与平台过滤组合时占位符仍正确', async () => {
      await db.exec(`
        INSERT INTO kols (id, name, platform, source, overall_score)
        VALUES
          ('kol_005', '杭州生活方式博主', '小红书', 'test', 80),
          ('kol_006', '杭州生活方式博主', '抖音', 'test', 75)
      `)

      const result = await repo.listAvailableKOLs({
        platform: '小红书',
        keywords: ['杭州', '生活方式'],
      })

      expect(result.total).toBe(1)
      expect(result.kols[0]!.id).toBe('kol_005')
    })
  })
})
