/**
 * 权限服务
 *
 * 基于 RBAC 模型：用户 → 角色 → 权限。
 * 提供权限检查、UserContext 构建等能力。
 */

import type { UserContext } from '../context/types.ts'
import type { UserRecord } from './types.ts'
import { AuthRepository } from './auth-repository.ts'
import { BuiltInRoles } from './rbac-constants.ts'

export interface PermissionCheckOptions {
  /** 是否要求资源所有者（用于 own 权限） */
  ownerId?: string
}

export class PermissionService {
  private repository: AuthRepository

  constructor(repository: AuthRepository) {
    this.repository = repository
  }

  /** 判断用户是否拥有某权限 */
  hasPermission(userContext: UserContext, permission: string, options?: PermissionCheckOptions): boolean {
    if (userContext.isSystemAccount) return true
    if (userContext.roles.includes(BuiltInRoles.SUPER_ADMIN)) return true
    if (userContext.permissions.includes('*')) return true

    // 全局权限
    if (userContext.permissions.includes(permission)) return true

    // own 权限检查
    if (options?.ownerId !== undefined) {
      const ownPermission = permission.replace(/:\*$/, ':own')
      if (userContext.permissions.includes(ownPermission) && options.ownerId === userContext.userId) {
        return true
      }
    }

    return false
  }

  /** 判断用户是否拥有任意一个权限 */
  hasAnyPermission(userContext: UserContext, permissions: string[]): boolean {
    return permissions.some((p) => this.hasPermission(userContext, p))
  }

  /** 要求必须拥有权限，否则抛出错误 */
  requirePermission(userContext: UserContext, permission: string, options?: PermissionCheckOptions): void {
    if (!this.hasPermission(userContext, permission, options)) {
      throw new AuthorizationError(`缺少权限: ${permission}`)
    }
  }

  /** 构建 UserContext */
  async buildUserContext(user: UserRecord): Promise<UserContext> {
    const roles = await this.repository.getUserRoles(user.id)
    const permissions = await this.repository.getUserPermissions(user.id)
    return {
      userId: user.id,
      sessionId: '',
      tenantId: user.tenantId,
      roles: roles.map((r) => r.id),
      permissions,
      isSystemAccount: false,
    }
  }

  /** 创建系统账号上下文 */
  createSystemContext(): UserContext {
    return {
      userId: 'system',
      sessionId: '',
      tenantId: 'default',
      roles: [BuiltInRoles.SUPER_ADMIN],
      permissions: ['*'],
      isSystemAccount: true,
    }
  }
}

export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthorizationError'
  }
}
