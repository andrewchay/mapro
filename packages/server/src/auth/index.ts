/**
 * 认证与授权模块入口
 */

export type {
  UserRecord,
  RoleRecord,
  RefreshTokenRecord,
  JWTPayload,
  AuthResult,
  InitialAdminConfig,
  JWTConfig,
  UserContext,
} from './types.ts'
export { AuthService, AuthError } from './auth-service.ts'
export { AuthRepository } from './auth-repository.ts'
export { PermissionService, AuthorizationError } from './permission-service.ts'
export { createJWTService } from './jwt-service.ts'
export { defaultPasswordHasher } from './password-hasher.ts'
export { Permissions, BuiltInRoles, BUILT_IN_ROLES, PERMISSION_DEFINITIONS } from './rbac-constants.ts'
