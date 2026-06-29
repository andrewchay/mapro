/**
 * 数据库迁移执行器
 *
 * 支持 SQL 脚本与 JavaScript 函数两种迁移形式，依赖 DbProvider 抽象。
 */

import type { DbProvider } from './types.ts'

export interface Migration {
  id: string
  up: string | ((db: DbProvider) => Promise<void>)
}

export interface MigrationRunnerOptions {
  db: DbProvider
  migrations: Migration[]
}

export class MigrationRunner {
  private db: DbProvider
  private migrations: Migration[]

  constructor(options: MigrationRunnerOptions) {
    this.db = options.db
    this.migrations = options.migrations
  }

  /** 执行所有未应用的迁移 */
  async migrate(): Promise<string[]> {
    await this.ensureMigrationsTable()
    const applied = await this.getAppliedMigrationIds()
    const appliedIds: string[] = []

    for (const migration of this.migrations) {
      if (applied.has(migration.id)) continue

      console.log(`[Migration] 应用迁移: ${migration.id}`)
      if (typeof migration.up === 'string') {
        await this.db.exec(migration.up)
      } else {
        await migration.up(this.db)
      }

      await this.db.execute(
        'INSERT INTO schema_migrations (id, applied_at) VALUES ($1, $2)',
        [migration.id, Date.now()],
      )
      appliedIds.push(migration.id)
    }

    return appliedIds
  }

  private async ensureMigrationsTable(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      )
    `)
  }

  private async getAppliedMigrationIds(): Promise<Set<string>> {
    const { rows } = await this.db.query<{ id: string }>('SELECT id FROM schema_migrations')
    return new Set(rows.map((r) => r.id))
  }
}
