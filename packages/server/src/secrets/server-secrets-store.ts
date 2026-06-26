/**
 * 服务端密钥存储实现
 *
 * 使用 AES-256-GCM + 主密钥（环境变量 MAPRO_MASTER_KEY）加密敏感数据。
 * 阶段 B 内部单用户/小团队版使用；多租户版建议替换为 KMS。
 */

import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto'
import type { SecretsStore } from './types.ts'

const ENCRYPTION_ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16
const SALT_LENGTH = 16

export class ServerSecretsStore implements SecretsStore {
  private masterKey: Buffer

  constructor(masterKey?: string) {
    const key = masterKey ?? process.env.MAPRO_MASTER_KEY
    if (!key) {
      throw new Error('MAPRO_MASTER_KEY 未设置：服务端密钥存储需要主密钥')
    }
    // 使用固定 salt 派生密钥（实际只需 scrypt 稳定输出）
    this.masterKey = scryptSync(key, 'mapro-server-secrets', KEY_LENGTH)
  }

  isAvailable(): boolean {
    return true
  }

  encrypt(plainText: string): string {
    const iv = randomBytes(IV_LENGTH)
    const salt = randomBytes(SALT_LENGTH)
    const cipher = createCipheriv(ENCRYPTION_ALGORITHM, this.masterKey, iv)

    const encrypted = Buffer.concat([cipher.update(plainText, 'utf-8'), cipher.final()])
    const authTag = cipher.getAuthTag()

    // 格式：salt:iv:authTag:ciphertext，全部 base64
    const payload = Buffer.concat([salt, iv, authTag, encrypted])
    return `enc:${payload.toString('base64')}`
  }

  decrypt(encrypted: string): string {
    if (!encrypted.startsWith('enc:')) {
      // 兼容明文回退
      return encrypted
    }

    const payload = Buffer.from(encrypted.slice(4), 'base64')
    if (payload.length < SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH) {
      throw new Error('密文格式错误')
    }

    const salt = payload.subarray(0, SALT_LENGTH)
    const iv = payload.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH)
    const authTag = payload.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH)
    const ciphertext = payload.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH)

    const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, this.masterKey, iv)
    decipher.setAuthTag(authTag)

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8')
  }
}
