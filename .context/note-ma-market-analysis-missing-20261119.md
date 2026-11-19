# ma-market-analysis 缺失根因诊断（2026-11-19）

## 现象
用户使用 app 时提示没有 `ma-market-analysis` skill。

## 排查结论：不是打包问题，是 Campaign 工作区未注册

### 证据链

1. **打包正常**：`/Applications/MAPro.app`（0.1.68）的 `Contents/Resources/default-skills/ma-market-analysis` **存在**。
   仓库 `apps/electron/default-skills/ma-market-analysis/SKILL.md`（v1.0.0）存在且被 git 跟踪。

2. **部分工作区缺 skills 目录**：
   - `campaign-1788995182996-w6zmd3t`（nike）→ 无 `skills/`
   - `campaign-1788993323169-k83xpby`（vonbons）→ 无 `skills/`
   - `campaign-1788993333960-2ru9o96`（vonbons）→ 无 `skills/`
   - `campaign-1782321696361-t0ro4m2`（vonbon）→ 无 `skills/`
   - 其余 11 个正常（有 46 个 skill）

3. **这 4 个都不在 `~/.mapro/agent-workspaces.json` 索引中**：
   磁盘 14 个 campaign 目录，索引只有 11 个工作区。

4. **名称冲突是直接原因**：

   | 缺失工作区 | campaign.name | 索引中已占用该 name 的工作区 |
   |---|---|---|
   | campaign-1788993323169 | vonbons | `vonbons` @ campaign-1788993316779 |
   | campaign-1788993333960 | vonbons | 同上 |
   | campaign-1788995182996 | nike | `nike` @ campaign-1782918142876 |
   | campaign-1782321696361 | vonbon | `vonbon` @ campaign-1781536535628 |

### 代码路径

`createAgentWorkspace()`（`agent-workspace-manager.ts:200`）有两道查重：

```ts
const duplicate = index.workspaces.find((w) => w.name === name)
if (duplicate) throw new Error(`工作区名称「${name}」已存在`)
```

Campaign 创建时传的 name 是 `campaign.name`（品牌名，用户可重复填写）。

`createCampaign()`（`campaign-manager.ts:1266`）用 try/catch 包住：

```ts
} catch (err) {
  console.error('[Campaign] 创建 Agent Workspace 失败:', err)
  if (campaign.projectPath) { /* 回滚 DB 并抛出 */ }
  // 未指定 projectPath 时：仅记录日志，不阻断创建 ← 问题所在
}
```

**结果**：Campaign 照常落库、目录照常生成，但工作区从未注册，`copyDefaultSkills()` 从未执行，`skills/` 目录不存在。

### 为什么启动时没自动修复

`upgradeDefaultSkillsInWorkspaces()` 只遍历 `index.workspaces`。未注册的工作区不在遍历范围，永远补不上 skills。

`ensureCampaignWorkspace()`（打开 Campaign 时调用）只在 `!existsSync(workspacePath)` 时创建。这 4 个目录已存在，所以被跳过，也不会补建。

## 修复方案

### P0 立即恢复（用户当前可用）
手工把这 4 个工作区注册进索引并复制 skills。或者删掉这 4 个 Campaign 重建（会重新触发创建逻辑，但若 name 仍重复则同样失败）。

### P1 代码修复（推荐）

1. **Campaign 工作区的 name 查重应豁免**
   Campaign 工作区的 slug 是 `campaign-{id}`（UUID 保证唯一），name 重名无害。应在 `createAgentWorkspace` 增加参数或在 `createCampaign` 里直接构造 workspace 记录，跳过 name 查重。

2. **创建失败不应静默**
   未指定 `projectPath` 时也应让 Campaign 创建失败，或至少在 UI 上明确提示"工作区创建失败，skill 不可用"。

3. **`ensureCampaignWorkspace` 要能自愈**
   目录存在但未注册索引时，应补注册 + 补 skills，而不是只判断目录是否存在。

## 相关文件
- `apps/electron/src/main/lib/agent-workspace-manager.ts:200`（createAgentWorkspace）
- `apps/electron/src/main/lib/agent-workspace-manager.ts:171`（copyDefaultSkills）
- `apps/electron/src/main/lib/agent-workspace-manager.ts:362`（upgradeDefaultSkillsInWorkspaces）
- `apps/electron/src/main/lib/campaign-manager.ts:1067`（ensureCampaignWorkspace）
- `apps/electron/src/main/lib/campaign-manager.ts:1266`（createCampaign 建工作区）
