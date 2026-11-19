# 营销 skills/tools 默认注入每个 Campaign —— 调研结论

> 2026-11-19。任务：把营销相关 skills 和 tools 默认注入每一个 campaign

## 结论：机制上已经默认注入，无需新增代码

### Tools：全局注入，与 campaign 无关

`chat-tool-config.ts` 的 `DEFAULT_CONFIG.toolStates` 中 16 个 ma- 工具全部 `enabled: true`：

| 工具 | 默认 |
|---|---|
| ma-kol-data-mcp | ✅ enabled |
| ma-strategy-iq | ✅ enabled |
| ma-match-ai | ✅ enabled |
| ma-connect-bot | ✅ enabled |
| ma-creative-pilot | ✅ enabled |
| ma-kol-search | ✅ enabled |
| ma-campaign-optimizer | ✅ enabled |
| ma-script-studio | ✅ enabled |
| ma-content-audit | ✅ enabled |
| ma-campaign-tester | ✅ enabled |
| ma-campaign-agent | ✅ enabled |
| ma-kol-crm | ✅ enabled |
| ma-kol-portal | ✅ enabled |
| ma-budget-forecast | ✅ enabled |
| ma-content-tracker | ✅ enabled |
| ma-phase-reviewer | ✅ enabled |

`agent-orchestrator.ts:1893-1895` 每次会话无条件注入 memory / nano-banana /
KOL Data MCP / Browser Fetch。⇒ 所有 Agent 会话都有，不限 campaign。

### Skills：新建 Campaign 自动拿到全部 34 个 ma- skill

`copyDefaultSkills()`（agent-workspace-manager.ts:174）复制 default-skills 全部目录，
仅排除 4 个营销不需要的通用 skill（`EXCLUDED_DEFAULT_SKILLS`）：
find-skills / executing-plans / writing-plans / guizang-ppt-skill

**实测验证**：新建的 `campaign-1795078584766-h9uylkf`（name=测试）
- skills 总数 42 = 34 个 ma- + 8 个通用
- `.claude-plugin/plugin.json` 存在（SDK 能发现）
⇒ 证明新建 Campaign 已自动获得全部营销 skill。

### 实测各 campaign 现状

| Campaign | skills 数 | 说明 |
|---|---|---|
| 大多正常 campaign | 46 | 34 ma- + 12 通用（含被排除项） |
| campaign-1795078584766（新建） | 42 | 34 ma- + 8 通用（正确按排除列表） |
| campaign-1782321696361 | 0 | ❌ 未注册索引 |
| campaign-1788993323169 | 0 | ❌ 未注册索引 |
| campaign-1788993333960 | 0 | ❌ 未注册索引 |
| campaign-1788995182996 | 0 | ❌ 未注册索引 |

## 两个真实缺陷

### 缺陷 1（已在上一轮修复）：4 个 campaign 工作区从未创建
品牌名重名导致 `createAgentWorkspace` 抛异常被静默吞掉，
Campaign 落了库但工作区未注册 ⇒ 0 个 skill。
已通过 `skipNameCheck` + `ensureWorkspaceRegistered` + 启动自愈修复。

### 缺陷 2（本次已修复）：两处 skill 注入逻辑不一致
- `copyDefaultSkills` 排除 4 个通用 skill → 新建 workspace 42 个
- `upgradeDefaultSkillsInWorkspaces` 没有应用排除列表 → 老 workspace 被补成 46 个

**修复**：`upgradeDefaultSkillsInWorkspaces` 收集 defaultSkills 时也过滤
`EXCLUDED_DEFAULT_SKILLS`（agent-workspace-manager.ts:459），
只阻止后续注入，不删用户已有的。

配套脚本新增 `--clean-excluded`，可把老工作区已有的 4 个通用 skill 清掉，
使新老统一为 42。默认不启用（dry-run 可预览）。

## 待用户决策：是否清理老工作区的 4 个通用 skill

被排除的是通用能力，不是营销 skill：
- `find-skills` — 帮用户发现/安装 skill
- `executing-plans` — 执行实现计划（开发向）
- `writing-plans` — 编写实现计划（开发向）
- `guizang-ppt-skill` — 生成网页版 PPT（数报/章节页模板）

营销工作中 PPT 生成可能有用。若不需要，执行：
```bash
bun run scripts/repair-campaign-workspaces.ts --apply --clean-excluded
```
若需要保留，只跑 `--apply`（新工作区 42、老工作区仍 46）。
