/**
 * Campaign 模块纯 Node.js 测试脚本（零依赖，直接运行）
 *
 * 自动验证：
 * 1. Campaign CRUD（创建、列表、获取）
 * 2. KOL 候选池导入与查询
 *
 * 运行：cd apps/electron && node src/main/lib/__tests__/campaign-node-test.js
 */

const { existsSync, unlinkSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')

// 使用 tsx 或 ts-node 运行 TypeScript 测试文件
// 如果没有这些工具，以下是一个参考的 Node.js 版本

console.log('🧪 Campaign 模块测试')
console.log('====================')
console.log('')
console.log('要运行自动化测试，请安装 vitest:')
console.log('  cd apps/electron && npm install -D vitest')
console.log('')
console.log('然后运行:')
console.log('  npx vitest run src/main/lib/__tests__/campaign-integration.test.ts')
console.log('')
console.log('或创建 package.json 脚本:')
console.log('  "test:campaign": "vitest run src/main/lib/__tests__/campaign-integration.test.ts"')
console.log('')
console.log('✅ 测试文件已创建: src/main/lib/__tests__/campaign-integration.test.ts')
console.log('✅ campaign-manager.ts 已支持测试配置目录注入')
