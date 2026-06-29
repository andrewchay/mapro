import { describe, test, expect } from 'bun:test'
import { PermissionService, AuthorizationError } from './permission-service.ts'
import { BuiltInRoles } from './rbac-constants.ts'
import type { UserContext } from '../context/types.ts'

function createUserContext(overrides?: Partial<UserContext>): UserContext {
  return {
    userId: 'u-1',
    sessionId: '',
    tenantId: 'default',
    roles: [],
    permissions: [],
    isSystemAccount: false,
    ...overrides,
  }
}

describe('PermissionService', () => {
  // 权限服务不依赖 repository 的状态，传入 null 仅用于类型兼容
  const service = new PermissionService(null as unknown as ConstructorParameters<typeof PermissionService>[0])

  test('系统账号拥有所有权限', () => {
    const ctx = createUserContext({ isSystemAccount: true, permissions: [] })
    expect(service.hasPermission(ctx, 'campaign:delete')).toBe(true)
  })

  test('super_admin 角色拥有所有权限', () => {
    const ctx = createUserContext({ roles: [BuiltInRoles.SUPER_ADMIN], permissions: [] })
    expect(service.hasPermission(ctx, 'campaign:write')).toBe(true)
  })

  test('通配权限拥有所有权限', () => {
    const ctx = createUserContext({ permissions: ['*'] })
    expect(service.hasPermission(ctx, 'kol:read')).toBe(true)
  })

  test('拥有指定权限返回 true', () => {
    const ctx = createUserContext({ permissions: ['campaign:read', 'kol:read'] })
    expect(service.hasPermission(ctx, 'kol:read')).toBe(true)
  })

  test('缺少权限返回 false', () => {
    const ctx = createUserContext({ permissions: ['campaign:read'] })
    expect(service.hasPermission(ctx, 'campaign:write')).toBe(false)
  })

  test('own 权限仅允许资源所有者', () => {
    const ctx = createUserContext({ userId: 'u-1', permissions: ['campaign:own'] })
    expect(service.hasPermission(ctx, 'campaign:*', { ownerId: 'u-1' })).toBe(true)
    expect(service.hasPermission(ctx, 'campaign:*', { ownerId: 'u-2' })).toBe(false)
  })

  test('hasAnyPermission 至少命中一个即 true', () => {
    const ctx = createUserContext({ permissions: ['campaign:read'] })
    expect(service.hasAnyPermission(ctx, ['campaign:write', 'campaign:read'])).toBe(true)
    expect(service.hasAnyPermission(ctx, ['campaign:write', 'kol:write'])).toBe(false)
  })

  test('requirePermission 缺少权限时抛出 AuthorizationError', () => {
    const ctx = createUserContext({ permissions: [] })
    expect(() => service.requirePermission(ctx, 'campaign:read')).toThrow(AuthorizationError)
  })
})
