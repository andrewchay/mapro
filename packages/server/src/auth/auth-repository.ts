/**
 * 认证数据访问层
 *
 * 使用 DbProvider 抽象，支持 SQLite / PostgreSQL。
 */

import { randomUUID } from 'node:crypto'
import type { DbProvider } from '../db/types.ts'
import type { UserRecord, RoleRecord, RefreshTokenRecord } from './types.ts'
import { BUILT_IN_ROLES, PERMISSION_DEFINITIONS } from './rbac-constants.ts'

export interface AuthRepositoryOptions {
  db: DbProvider
  tenantId?: string
}

function now(): number {
  return Date.now()
}

export class AuthRepository {
  private db: DbProvider
  private tenantId: string

  constructor(options: AuthRepositoryOptions) {
    this.db = options.db
    this.tenantId = options.tenantId ?? 'default'
  }

  /** 初始化认证相关表与内置数据 */
  async ensureSchema(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT,
        name TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        auth_provider TEXT DEFAULT 'local',
        provider_subject TEXT,
        tenant_id TEXT DEFAULT 'default' NOT NULL,
        created_at INTEGER,
        updated_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);

      CREATE TABLE IF NOT EXISTS roles (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        is_builtin INTEGER DEFAULT 0,
        tenant_id TEXT DEFAULT 'default' NOT NULL,
        created_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS permissions (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        resource_type TEXT,
        scope TEXT
      );

      CREATE TABLE IF NOT EXISTS role_permissions (
        role_id TEXT NOT NULL,
        permission_id TEXT NOT NULL,
        PRIMARY KEY (role_id, permission_id)
      );

      CREATE TABLE IF NOT EXISTS user_roles (
        user_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        PRIMARY KEY (user_id, role_id)
      );

      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT UNIQUE NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER,
        created_at INTEGER,
        ip_address TEXT,
        user_agent TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
    `)

    await this.seedPermissions()
    await this.seedBuiltInRoles()
  }

  private async seedPermissions(): Promise<void> {
    for (const perm of PERMISSION_DEFINITIONS) {
      const exists = await this.db.queryOne<{ count: number }>(
        'SELECT COUNT(*) as count FROM permissions WHERE name = $1',
        [perm.name],
      )
      if (exists && exists.count > 0) continue
      await this.db.execute(
        'INSERT INTO permissions (id, name, description, resource_type, scope) VALUES ($1, $2, $3, $4, $5)',
        [randomUUID(), perm.name, perm.description ?? null, perm.resourceType ?? null, perm.scope ?? null],
      )
    }
  }

  private async seedBuiltInRoles(): Promise<void> {
    for (const role of BUILT_IN_ROLES) {
      const existing = await this.getRoleById(role.id)
      if (existing) continue

      const t = now()
      await this.db.execute(
        'INSERT INTO roles (id, name, description, is_builtin, tenant_id, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [role.id, role.name, role.description, 1, this.tenantId, t],
      )

      for (const permName of role.permissions) {
        if (permName === '*') continue
        const perm = await this.db.queryOne<{ id: string }>('SELECT id FROM permissions WHERE name = $1', [permName])
        if (!perm) continue
        await this.db.execute(
          'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)',
          [role.id, perm.id],
        )
      }
    }
  }

  // ==================== Users ====================

  async createUser(input: Omit<UserRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<UserRecord> {
    const id = randomUUID()
    const t = now()
    await this.db.execute(
      `INSERT INTO users (id, email, password_hash, name, status, auth_provider, provider_subject, tenant_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [id, input.email, input.passwordHash, input.name, input.status, input.authProvider, input.providerSubject, this.tenantId, t, t],
    )
    return { ...input, id, createdAt: t, updatedAt: t }
  }

  async getUserById(id: string): Promise<UserRecord | null> {
    const row = await this.db.queryOne<Record<string, unknown>>(
      'SELECT * FROM users WHERE id = $1 AND tenant_id = $2',
      [id, this.tenantId],
    )
    return row ? mapUser(row) : null
  }

  async getUserByEmail(email: string): Promise<UserRecord | null> {
    const row = await this.db.queryOne<Record<string, unknown>>(
      'SELECT * FROM users WHERE email = $1 AND tenant_id = $2',
      [email, this.tenantId],
    )
    return row ? mapUser(row) : null
  }

  async findUserByProviderSubject(provider: string, subject: string): Promise<UserRecord | null> {
    const row = await this.db.queryOne<Record<string, unknown>>(
      'SELECT * FROM users WHERE auth_provider = $1 AND provider_subject = $2 AND tenant_id = $3',
      [provider, subject, this.tenantId],
    )
    return row ? mapUser(row) : null
  }

  async listUsers(): Promise<UserRecord[]> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM users WHERE tenant_id = $1 ORDER BY created_at DESC',
      [this.tenantId],
    )
    return rows.map(mapUser)
  }

  async updateUser(id: string, updates: Partial<Pick<UserRecord, 'name' | 'passwordHash' | 'status'>>): Promise<void> {
    const fields: string[] = []
    const values: unknown[] = []
    if (updates.name !== undefined) {
      fields.push(`name = $${fields.length + 1}`)
      values.push(updates.name)
    }
    if (updates.passwordHash !== undefined) {
      fields.push(`password_hash = $${fields.length + 1}`)
      values.push(updates.passwordHash)
    }
    if (updates.status !== undefined) {
      fields.push(`status = $${fields.length + 1}`)
      values.push(updates.status)
    }
    if (fields.length === 0) return
    values.push(id, this.tenantId)
    await this.db.execute(
      `UPDATE users SET ${fields.join(', ')}, updated_at = $${fields.length + 1} WHERE id = $${fields.length + 2} AND tenant_id = $${fields.length + 3}`,
      [...values, now(), id, this.tenantId],
    )
  }

  async hasAnyUser(): Promise<boolean> {
    const result = await this.db.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM users WHERE tenant_id = $1',
      [this.tenantId],
    )
    return (result?.count ?? 0) > 0
  }

  // ==================== Roles ====================

  async getRoleById(id: string): Promise<RoleRecord | null> {
    const row = await this.db.queryOne<Record<string, unknown>>(
      'SELECT * FROM roles WHERE id = $1 AND tenant_id = $2',
      [id, this.tenantId],
    )
    return row ? mapRole(row) : null
  }

  async listRoles(): Promise<RoleRecord[]> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM roles WHERE tenant_id = $1 ORDER BY created_at DESC',
      [this.tenantId],
    )
    return rows.map(mapRole)
  }

  async assignRoleToUser(userId: string, roleId: string): Promise<void> {
    await this.db.execute(
      'INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES ($1, $2)',
      [userId, roleId],
    )
  }

  async getUserRoles(userId: string): Promise<RoleRecord[]> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT r.* FROM roles r
       JOIN user_roles ur ON r.id = ur.role_id
       WHERE ur.user_id = $1 AND r.tenant_id = $2`,
      [userId, this.tenantId],
    )
    return rows.map(mapRole)
  }

  async getRolePermissions(roleId: string): Promise<string[]> {
    const { rows } = await this.db.query<{ name: string }>(
      `SELECT p.name FROM permissions p
       JOIN role_permissions rp ON p.id = rp.permission_id
       WHERE rp.role_id = $1`,
      [roleId],
    )
    return rows.map((r) => r.name)
  }

  async getUserPermissions(userId: string): Promise<string[]> {
    const { rows } = await this.db.query<{ name: string }>(
      `SELECT DISTINCT p.name FROM permissions p
       JOIN role_permissions rp ON p.id = rp.permission_id
       JOIN user_roles ur ON rp.role_id = ur.role_id
       WHERE ur.user_id = $1`,
      [userId],
    )
    return rows.map((r) => r.name)
  }

  // ==================== Refresh Tokens ====================

  async createRefreshToken(input: Omit<RefreshTokenRecord, 'id' | 'createdAt'>): Promise<RefreshTokenRecord> {
    const id = randomUUID()
    const t = now()
    await this.db.execute(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked_at, created_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, input.userId, input.tokenHash, input.expiresAt, input.revokedAt, t, input.ipAddress, input.userAgent],
    )
    return { ...input, id, createdAt: t }
  }

  async getRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    const row = await this.db.queryOne<Record<string, unknown>>(
      'SELECT * FROM refresh_tokens WHERE token_hash = $1',
      [tokenHash],
    )
    return row ? mapRefreshToken(row) : null
  }

  async revokeRefreshToken(id: string): Promise<void> {
    await this.db.execute(
      'UPDATE refresh_tokens SET revoked_at = $1 WHERE id = $2',
      [now(), id],
    )
  }

  async revokeAllUserRefreshTokens(userId: string): Promise<void> {
    await this.db.execute(
      'UPDATE refresh_tokens SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL',
      [now(), userId],
    )
  }
}

function mapUser(row: Record<string, unknown>): UserRecord {
  return {
    id: String(row.id),
    email: String(row.email),
    passwordHash: row.password_hash ? String(row.password_hash) : null,
    name: String(row.name),
    status: String(row.status) as UserRecord['status'],
    authProvider: String(row.auth_provider) as UserRecord['authProvider'],
    providerSubject: row.provider_subject ? String(row.provider_subject) : null,
    tenantId: String(row.tenant_id),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

function mapRole(row: Record<string, unknown>): RoleRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    description: row.description ? String(row.description) : undefined,
    isBuiltin: Number(row.is_builtin) === 1,
    tenantId: String(row.tenant_id),
    createdAt: Number(row.created_at),
  }
}

function mapRefreshToken(row: Record<string, unknown>): RefreshTokenRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    tokenHash: String(row.token_hash),
    expiresAt: Number(row.expires_at),
    revokedAt: row.revoked_at ? Number(row.revoked_at) : null,
    createdAt: Number(row.created_at),
    ipAddress: row.ip_address ? String(row.ip_address) : null,
    userAgent: row.user_agent ? String(row.user_agent) : null,
  }
}
