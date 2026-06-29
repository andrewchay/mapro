/**
 * 认证服务
 *
 * 负责登录、刷新、登出、初始管理员创建。
 */

import { createHash, randomBytes } from 'node:crypto'
import type { AuthRepository } from './auth-repository.ts'
import type { AuthResult, InitialAdminConfig, JWTConfig, RefreshTokenRecord, UserRecord } from './types.ts'
import { createJWTService, type JWTService } from './jwt-service.ts'
import { defaultPasswordHasher } from './password-hasher.ts'
import { BuiltInRoles } from './rbac-constants.ts'

export interface AuthServiceDeps {
  repository: AuthRepository
  jwtConfig: JWTConfig
  passwordHasher?: { hash(plain: string): Promise<string>; verify(plain: string, hashed: string): Promise<boolean> }
}

export interface LoginInput {
  email: string
  password: string
  ipAddress?: string
  userAgent?: string
}

export interface RefreshInput {
  refreshToken: string
  ipAddress?: string
  userAgent?: string
}

const REFRESH_TOKEN_BYTES = 32
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60 // 7 天

export class AuthService {
  private repository: AuthRepository
  private jwtService: JWTService
  private passwordHasher: NonNullable<AuthServiceDeps['passwordHasher']>

  constructor(deps: AuthServiceDeps) {
    this.repository = deps.repository
    this.jwtService = createJWTService(deps.jwtConfig)
    this.passwordHasher = deps.passwordHasher ?? defaultPasswordHasher
  }

  /** 登录 */
  async login(input: LoginInput): Promise<AuthResult> {
    const user = await this.repository.getUserByEmail(input.email)
    if (!user) {
      throw new AuthError('邮箱或密码错误')
    }
    if (user.status !== 'active') {
      throw new AuthError('账号已被禁用')
    }
    if (!user.passwordHash) {
      throw new AuthError('该账号未设置密码')
    }

    const valid = await this.passwordHasher.verify(input.password, user.passwordHash)
    if (!valid) {
      throw new AuthError('邮箱或密码错误')
    }

    return this.issueTokens(user, input.ipAddress, input.userAgent)
  }

  /** 使用 refresh token 换取新令牌 */
  async refresh(input: RefreshInput): Promise<AuthResult> {
    const tokenHash = hashRefreshToken(input.refreshToken)
    const record = await this.repository.getRefreshTokenByHash(tokenHash)
    if (!record) {
      throw new AuthError('Refresh token 无效')
    }
    if (record.revokedAt) {
      throw new AuthError('Refresh token 已被吊销')
    }
    if (record.expiresAt < Date.now()) {
      throw new AuthError('Refresh token 已过期')
    }

    const user = await this.repository.getUserById(record.userId)
    if (!user || user.status !== 'active') {
      throw new AuthError('用户不存在或已被禁用')
    }

    // 轮换：吊销旧 token，发放新 token
    await this.repository.revokeRefreshToken(record.id)
    return this.issueTokens(user, input.ipAddress, input.userAgent)
  }

  /** 登出：吊销 refresh token */
  async logout(refreshToken: string): Promise<void> {
    const tokenHash = hashRefreshToken(refreshToken)
    const record = await this.repository.getRefreshTokenByHash(tokenHash)
    if (record) {
      await this.repository.revokeRefreshToken(record.id)
    }
  }

  /** 创建初始管理员；仅在 users 表为空时允许 */
  async createInitialAdmin(config: InitialAdminConfig): Promise<UserRecord> {
    if (await this.repository.hasAnyUser()) {
      throw new AuthError('初始管理员已存在')
    }

    const passwordHash = await this.passwordHasher.hash(config.password)
    const user = await this.repository.createUser({
      email: config.email,
      passwordHash,
      name: config.name ?? '管理员',
      status: 'active',
      authProvider: 'local',
      providerSubject: null,
      tenantId: 'default',
    })

    await this.repository.assignRoleToUser(user.id, BuiltInRoles.SUPER_ADMIN)
    return this.sanitizeUser(user)
  }

  /** 校验 access token 并返回用户 */
  async verifyAccessToken(token: string): Promise<UserRecord> {
    const payload = this.jwtService.verify(token)
    const user = await this.repository.getUserById(payload.sub)
    if (!user) {
      throw new AuthError('用户不存在')
    }
    if (user.status !== 'active') {
      throw new AuthError('账号已被禁用')
    }
    return user
  }

  /** 生成 access token 与 refresh token */
  private async issueTokens(user: UserRecord, ipAddress?: string, userAgent?: string): Promise<AuthResult> {
    const permissions = await this.repository.getUserPermissions(user.id)
    const roles = await this.repository.getUserRoles(user.id)

    const accessToken = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      tenantId: user.tenantId,
      roles: roles.map((r) => r.id),
      permissions,
    })

    const refreshToken = generateRefreshToken()
    const tokenHash = hashRefreshToken(refreshToken)
    const expiresAt = Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000

    await this.repository.createRefreshToken({
      userId: user.id,
      tokenHash,
      expiresAt,
      revokedAt: null,
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
    })

    return {
      user: this.sanitizeUser(user),
      accessToken,
      refreshToken,
      expiresAt,
    }
  }

  private sanitizeUser(user: UserRecord): UserRecord {
    return { ...user, passwordHash: null }
  }
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

function generateRefreshToken(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('base64url')
}

function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
