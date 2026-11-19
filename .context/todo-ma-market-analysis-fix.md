# 修复 ma-market-analysis 缺失

> 2026-11-19。诊断见 `.context/note-ma-market-analysis-missing-20261119.md`

## 根因
4 个 Campaign 因品牌名与已有工作区重名，`createAgentWorkspace` 抛异常被 catch 静默吞掉，
Campaign 照常创建但工作区未注册 → 无 skills 目录 → 找不到 ma-market-analysis。

## 任务

- [x] P1 修代码根因：Campaign 工作区豁免 name 查重（`skipNameCheck` 选项）
- [x] P1 修代码根因：`createAgentWorkspace` 支持 options；新增 `ensureWorkspaceRegistered` 自愈
- [x] P1 启动自愈：新增 `repairUnregisteredCampaignWorkspaces`，接入 main/index.ts
- [x] P2 失败不静默：未指定 projectPath 时建工作区失败写入 build log 告警
- [x] 测试：新增 `campaign-workspace-repair.test.ts`（6 用例）
- [x] 全量验证：205 测试通过，7 包 typecheck 全绿
- [ ] **P0 现场数据修复 —— 待用户执行**（沙箱无法写 `~/.mapro`）
- [ ] 升版本号 + 提交

## P0 待用户执行

```bash
cd /Users/chaihao/LLM/ma-proma
bun run scripts/repair-campaign-workspaces.ts           # 先 dry-run 确认
bun run scripts/repair-campaign-workspaces.ts --apply   # 实际修复
```

dry-run 已确认会修复这 4 个：
- campaign-1788995182996-w6zmd3t (nike)
- campaign-1788993323169-k83xpby (vonbons)
- campaign-1788993333960-2ru9o96 (vonbons)
- campaign-1782321696361-t0ro4m2 (vonbon)

注：装新版 App 后，`repairUnregisteredCampaignWorkspaces` 会在启动时自动做同样的事，
所以升级到新版其实也能修，这个脚本只是让你现在就能修。

## 改动文件
| 文件 | 改动 |
|---|---|
| `agent-workspace-manager.ts` | 新增 `CreateAgentWorkspaceOptions.skipNameCheck`、`ensureWorkspaceRegistered`、`repairUnregisteredCampaignWorkspaces` |
| `campaign-manager.ts` | 两处 createAgentWorkspace 传 skipNameCheck；ensureCampaignWorkspace 自愈；失败写 build log |
| `main/index.ts` | 启动时调用 repairUnregisteredCampaignWorkspaces |
| `__tests__/campaign-workspace-repair.test.ts` | 新增 6 用例 |
| `scripts/repair-campaign-workspaces.ts` | 一次性修复脚本（dry-run 默认） |
