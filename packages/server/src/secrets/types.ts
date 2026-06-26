/**
 * 密钥存储抽象
 *
 * 替代 Electron safeStorage，使 API Key 等敏感数据可在不同运行环境加密存储。
 */

export interface SecretsStore {
  /** 加密明文 */
  encrypt(plainText: string): string

  /** 解密密文 */
  decrypt(encrypted: string): string

  /** 是否可用 */
  isAvailable(): boolean
}
