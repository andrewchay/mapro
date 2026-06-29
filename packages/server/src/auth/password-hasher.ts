/**
 * 密码哈希
 *
 * 优先使用 Bun 原生 `Bun.password`，避免额外依赖。
 */

export interface PasswordHasher {
  hash(plainText: string): Promise<string>
  verify(plainText: string, hashed: string): Promise<boolean>
}

function getBunPassword(): typeof Bun.password | undefined {
  if (typeof Bun !== 'undefined' && Bun.password) {
    return Bun.password
  }
  return undefined
}

export const defaultPasswordHasher: PasswordHasher = {
  async hash(plainText: string): Promise<string> {
    const bun = getBunPassword()
    if (bun) {
      return bun.hash(plainText, { algorithm: 'bcrypt', cost: 10 })
    }
    throw new Error('Bun.password 不可用，无法执行密码哈希')
  },

  async verify(plainText: string, hashed: string): Promise<boolean> {
    const bun = getBunPassword()
    if (bun) {
      return bun.verify(plainText, hashed)
    }
    throw new Error('Bun.password 不可用，无法校验密码')
  },
}
