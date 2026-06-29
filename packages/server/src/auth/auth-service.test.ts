import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDbProvider, MigrationRunner, loadMigrations } from '../db/index.ts'
import { AuthRepository } from './auth-repository.ts'
import { AuthService, AuthError } from './auth-service.ts'
import type { DbProvider } from '../db/types.ts'

function createTestDb(): DbProvider {
  const dir = mkdtempSync(join(tmpdir(), 'mapro-auth-test-'))
  const db = createDbProvider({ engine: 'sqlite', sqlitePath: join(dir, 'auth.sqlite') })
  ;(db as unknown as { __testDir: string }).__testDir = dir
  return db
}

async function cleanupDb(db: DbProvider): Promise<void> {
  await db.close()
  const dir = (db as unknown as { __testDir: string }).__testDir
  rmSync(dir, { recursive: true, force: true })
}

async function createTestService() {
  const db = createTestDb()
  const migrations = await loadMigrations()
  await new MigrationRunner({ db, migrations }).migrate()
  const repository = new AuthRepository({ db, tenantId: 'default' })
  const service = new AuthService({
    repository,
    jwtConfig: { secret: 'test-secret', accessTokenTtlSeconds: 60 },
  })
  return { db, service }
}

describe('AuthService', () => {
  let service: AuthService
  let db: DbProvider

  beforeEach(async () => {
    const created = await createTestService()
    service = created.service
    db = created.db
  })

  afterEach(async () => {
    await cleanupDb(db)
  })

  test('创建初始管理员并登录', async () => {
    await service.createInitialAdmin({ email: 'admin@test.com', password: '123456', name: 'Admin' })

    const result = await service.login({ email: 'admin@test.com', password: '123456' })
    expect(result.accessToken).toBeTruthy()
    expect(result.refreshToken).toBeTruthy()
    expect(result.user.email).toBe('admin@test.com')
  })

  test('重复创建初始管理员失败', async () => {
    await service.createInitialAdmin({ email: 'admin@test.com', password: '123456' })
    await expect(service.createInitialAdmin({ email: 'other@test.com', password: '123456' })).rejects.toBeInstanceOf(
      AuthError,
    )
  })

  test('密码错误登录失败', async () => {
    await service.createInitialAdmin({ email: 'admin@test.com', password: '123456' })
    await expect(service.login({ email: 'admin@test.com', password: 'wrong' })).rejects.toBeInstanceOf(AuthError)
  })

  test('refresh token 轮换', async () => {
    await service.createInitialAdmin({ email: 'admin@test.com', password: '123456' })
    const login = await service.login({ email: 'admin@test.com', password: '123456' })

    const refreshed = await service.refresh({ refreshToken: login.refreshToken })
    expect(refreshed.accessToken).toBeTruthy()
    expect(refreshed.accessToken).not.toBe(login.accessToken)

    // 旧 refresh token 应被吊销
    await expect(service.refresh({ refreshToken: login.refreshToken })).rejects.toBeInstanceOf(AuthError)
  })

  test('登出吊销 refresh token', async () => {
    await service.createInitialAdmin({ email: 'admin@test.com', password: '123456' })
    const login = await service.login({ email: 'admin@test.com', password: '123456' })

    await service.logout(login.refreshToken)
    await expect(service.refresh({ refreshToken: login.refreshToken })).rejects.toBeInstanceOf(AuthError)
  })

  test('验证 access token 返回用户', async () => {
    await service.createInitialAdmin({ email: 'admin@test.com', password: '123456' })
    const login = await service.login({ email: 'admin@test.com', password: '123456' })

    const user = await service.verifyAccessToken(login.accessToken)
    expect(user.email).toBe('admin@test.com')
  })
})
