/**
 * 迁移定义
 *
 * 001: 创建认证相关表（SQL 脚本）
 * 002: 初始化内置权限点与内置角色（JavaScript 函数）
 */

import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Migration } from '../migration-runner.ts'
import type { DbProvider } from '../types.ts'
import { BUILT_IN_ROLES, PERMISSION_DEFINITIONS } from '../../auth/rbac-constants.ts'

export async function loadMigrations(): Promise<Migration[]> {
  const sql001 = await Bun.file(join(import.meta.dir, '001_create_auth_tables.sql')).text()

  return [
    { id: '001_create_auth_tables', up: sql001 },
    { id: '002_seed_builtin_roles_permissions', up: seedBuiltinRolesAndPermissions },
  ]
}

async function seedBuiltinRolesAndPermissions(db: DbProvider): Promise<void> {
  // 权限点
  for (const perm of PERMISSION_DEFINITIONS) {
    const exists = await db.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM permissions WHERE name = $1',
      [perm.name],
    )
    if (exists && exists.count > 0) continue
    await db.execute(
      'INSERT INTO permissions (id, name, description, resource_type, scope) VALUES ($1, $2, $3, $4, $5)',
      [randomUUID(), perm.name, perm.description ?? null, perm.resourceType ?? null, perm.scope ?? null],
    )
  }

  // 内置角色
  for (const role of BUILT_IN_ROLES) {
    const existing = await db.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM roles WHERE id = $1',
      [role.id],
    )
    if (existing && existing.count > 0) continue

    const now = Date.now()
    await db.execute(
      'INSERT INTO roles (id, name, description, is_builtin, tenant_id, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [role.id, role.name, role.description, 1, 'default', now],
    )

    for (const permName of role.permissions) {
      if (permName === '*') continue
      const perm = await db.queryOne<{ id: string }>('SELECT id FROM permissions WHERE name = $1', [permName])
      if (!perm) continue
      await db.execute(
        'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)',
        [role.id, perm.id],
      )
    }
  }
}
