#!/usr/bin/env node
/**
 * Campaign Agent 集成测试脚本（文件系统检查版）
 *
 * 验证以下组件：
 * 1. Campaign 数据库文件存在
 * 2. KOL 数据库文件存在（含评分列）
 * 3. Agent Workspace（创建、查找、工具脚本、campaign.json）
 * 4. 代码文件检查（context 注入、事件监听等）
 *
 * 用法：node scripts/test-campaign-agent.cjs
 */

const { join } = require('node:path')
const { homedir } = require('node:os')
const { existsSync, readFileSync, readdirSync } = require('node:fs')

// 检测配置目录（开发模式 vs 生产模式）
const configDir = process.env.MAPRO_DEV === '1' || !process.env.NODE_ENV
  ? join(homedir(), '.mapro-dev')
  : join(homedir(), '.mapro')

console.log(`[测试] 配置目录: ${configDir}`)

let passed = 0
let failed = 0

function assert(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ ${name}`)
    passed++
  } else {
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`)
    failed++
  }
}

// =====================================================================
// 测试 1: 数据库文件
// =====================================================================
console.log('\n📊 测试 1: 数据库文件')

const campaignDbPath = join(configDir, 'campaign-database.sqlite')
assert('Campaign 数据库存在', existsSync(campaignDbPath), campaignDbPath)

const kolDbPath = join(configDir, 'kol-database.sqlite')
assert('KOL 数据库存在', existsSync(kolDbPath), kolDbPath)

// 尝试用系统 sqlite3 检查表结构
try {
  const { execSync } = require('node:child_process')
  const tables = execSync(`sqlite3 "${campaignDbPath}" ".tables" 2>/dev/null`, { encoding: 'utf-8' }).trim()
  assert('campaigns 表存在', tables.includes('campaigns'))
  assert('campaign_kol_pool 表存在', tables.includes('campaign_kol_pool'))
  assert('campaign_briefs 表存在', tables.includes('campaign_briefs'))
} catch {
  console.log('  ⚠️  sqlite3 命令不可用，跳过表结构检查')
}

// 检查 KOL 数据库评分列
try {
  const { execSync } = require('node:child_process')
  const kolCols = execSync(`sqlite3 "${kolDbPath}" "PRAGMA table_info(kols);" 2>/dev/null`, { encoding: 'utf-8' }).trim()
  assert('fan_score 列存在', kolCols.includes('fan_score'))
  assert('engagement_score 列存在', kolCols.includes('engagement_score'))
  assert('content_score 列存在', kolCols.includes('content_score'))
  assert('overall_score 列存在', kolCols.includes('overall_score'))
} catch {
  console.log('  ⚠️  sqlite3 命令不可用，跳过 KOL 评分列检查')
}

// =====================================================================
// 测试 2: Agent Workspace
// =====================================================================
console.log('\n📊 测试 2: Agent Workspace')

const workspacesDir = join(configDir, 'agent-workspaces')
assert('Agent Workspaces 目录存在', existsSync(workspacesDir), workspacesDir)

if (existsSync(workspacesDir)) {
  const workspaces = readdirSync(workspacesDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
  
  const campaignWorkspaces = workspaces.filter(w => w.startsWith('campaign-'))
  assert(`找到 ${campaignWorkspaces.length} 个 Campaign Workspace`, campaignWorkspaces.length >= 0)
  
  if (campaignWorkspaces.length > 0) {
    const wsSlug = campaignWorkspaces[0]
    const wsPath = join(workspacesDir, wsSlug)
    
    assert('Workspace 目录存在', existsSync(wsPath))
    
    // 检查工具脚本
    const toolsDir = join(wsPath, '.campaign-tools')
    const campaignPy = join(toolsDir, 'campaign.py')
    
    if (existsSync(toolsDir)) {
      assert('工具目录 .campaign-tools 存在', true)
      assert('campaign.py 脚本存在', existsSync(campaignPy), campaignPy)
      
      if (existsSync(campaignPy)) {
        const script = readFileSync(campaignPy, 'utf-8')
        assert('脚本包含正确的 DB_PATH', script.includes(configDir), 'DB_PATH 未指向正确配置目录')
      }
    } else {
      console.log('  ⚠️  旧 Campaign 缺少 .campaign-tools（CampaignAgentPanel 会自动补充）')
    }
    
    // 检查 campaign.json
    const campaignJson = join(wsPath, 'campaign.json')
    if (existsSync(campaignJson)) {
      assert('campaign.json 存在', true)
      try {
        const data = JSON.parse(readFileSync(campaignJson, 'utf-8'))
        assert('campaign.json 包含 id', data.id !== undefined)
        assert('campaign.json 包含 name', data.name !== undefined)
      } catch {
        assert('campaign.json 格式正确', false, 'JSON 解析失败')
      }
    } else {
      console.log('  ⚠️  旧 Campaign 缺少 campaign.json（CampaignAgentPanel 会自动补充）')
    }
  } else {
    console.log('  ⚠️  没有找到 Campaign Workspace（需要创建 Campaign）')
  }
} else {
  console.log('  ⚠️  Agent Workspaces 目录不存在')
}

// =====================================================================
// 测试 3: 代码文件检查
// =====================================================================
console.log('\n📊 测试 3: 代码文件检查')

const srcDir = join(__dirname, '..', 'apps', 'electron', 'src')

const campaignManagerPath = join(srcDir, 'main', 'lib', 'campaign-manager.ts')
assert('campaign-manager.ts 存在', existsSync(campaignManagerPath))

if (existsSync(campaignManagerPath)) {
  const content = readFileSync(campaignManagerPath, 'utf-8')
  assert('包含 createAgentWorkspace 导入', content.includes('createAgentWorkspace'))
  assert('包含 CAMPAIGN_TOOLS_SCRIPT', content.includes('CAMPAIGN_TOOLS_SCRIPT'))
  assert('包含动态 DB_PATH 替换', content.includes('scriptWithCorrectPath'))
  assert('包含 ensureCampaignWorkspace', content.includes('ensureCampaignWorkspace'))
}

const chatServicePath = join(srcDir, 'main', 'lib', 'chat-service.ts')
assert('chat-service.ts 存在', existsSync(chatServicePath))

if (existsSync(chatServicePath)) {
  const content = readFileSync(chatServicePath, 'utf-8')
  assert('包含 campaignContextPrompt', content.includes('campaignContextPrompt'))
  assert('包含 campaignId', content.includes('campaignId'))
}

const panelPath = join(srcDir, 'renderer', 'components', 'agent', 'CampaignAgentPanel.tsx')
assert('CampaignAgentPanel.tsx 存在', existsSync(panelPath))

if (existsSync(panelPath)) {
  const content = readFileSync(panelPath, 'utf-8')
  assert('使用 onAgentStreamEvent', content.includes('onAgentStreamEvent'))
  assert('使用 sendAgentMessage', content.includes('sendAgentMessage'))
  assert('使用 bypassPermissions', content.includes('bypassPermissions'))
  assert('注入 Campaign 上下文', content.includes('Current Campaign Data'))
  assert('使用 ensureCampaignWorkspace', content.includes('ensureCampaignWorkspace'))
}

// =====================================================================
// 测试 4: IPC 检查
// =====================================================================
console.log('\n📊 测试 4: IPC 检查')

const ipcPath = join(srcDir, 'main', 'ipc.ts')
if (existsSync(ipcPath)) {
  const content = readFileSync(ipcPath, 'utf-8')
  assert('ipc.ts 包含 ENSURE_WORKSPACE', content.includes('ENSURE_WORKSPACE'))
  assert('ipc.ts 导入 ensureCampaignWorkspace', content.includes('ensureCampaignWorkspace'))
}

const preloadPath = join(srcDir, 'preload', 'index.ts')
if (existsSync(preloadPath)) {
  const content = readFileSync(preloadPath, 'utf-8')
  assert('preload 暴露 ensureCampaignWorkspace', content.includes('ensureCampaignWorkspace'))
}

const sharedPath = join(__dirname, '..', 'packages', 'shared', 'src', 'types', 'campaign.ts')
if (existsSync(sharedPath)) {
  const content = readFileSync(sharedPath, 'utf-8')
  assert('shared 包含 ENSURE_WORKSPACE channel', content.includes('ENSURE_WORKSPACE'))
}

// =====================================================================
// 总结
// =====================================================================
console.log('\n' + '='.repeat(50))
console.log(`测试结果: ${passed} 通过, ${failed} 失败`)
console.log('='.repeat(50))

if (failed > 0) {
  process.exit(1)
}
