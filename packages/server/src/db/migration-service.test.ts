import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteMigrationService } from './migration-service.ts'

describe('SqliteMigrationService', () => {
  let tmpDir: string
  let service: SqliteMigrationService

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mapro-migration-'))
    service = new SqliteMigrationService(tmpDir)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test('exportDatabase / importDatabase 往返', () => {
    const dbPath = join(tmpDir, 'campaign-database.sqlite')
    writeFileSync(dbPath, 'sqlite-bytes')

    const exportDir = join(tmpDir, 'export')
    mkdirSync(exportDir)
    const exportPath = join(exportDir, 'campaign.sqlite')
    service.exportDatabase('campaign', exportPath)
    expect(existsSync(exportPath)).toBe(true)

    const newDir = join(tmpDir, 'new-data')
    const newService = new SqliteMigrationService(newDir)
    newService.importDatabase(exportPath, 'campaign')
    expect(existsSync(join(newDir, 'campaign-database.sqlite'))).toBe(true)

    const backupCount = readdirSyncSafe(newDir).filter((n) => n.endsWith('.bak')).length
    expect(backupCount).toBe(0)

    // 再次导入应触发备份
    newService.importDatabase(exportPath, 'campaign')
    const backups = readdirSyncSafe(newDir).filter((n) => n.includes('.bak.'))
    expect(backups.length).toBe(1)
  })

  test('listDatabases 返回存在的文件信息', () => {
    writeFileSync(join(tmpDir, 'campaign-database.sqlite'), 'a')
    const list = service.listDatabases()
    expect(list.map((d) => d.name)).toContain('campaign-database.sqlite')
    expect(list.find((d) => d.name === 'campaign-database.sqlite')?.size).toBe(1)
  })

  test('migrateDataDir 迁移整个目录', () => {
    const nested = join(tmpDir, 'nested')
    mkdirSync(nested)
    writeFileSync(join(nested, 'x.json'), '{}')
    writeFileSync(join(tmpDir, 'settings.json'), '{}')

    const target = join(tmpDir, 'target')
    service.migrateDataDir(target)

    expect(existsSync(join(target, 'settings.json'))).toBe(true)
    expect(existsSync(join(target, 'nested', 'x.json'))).toBe(true)
  })
})

function readdirSyncSafe(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}
