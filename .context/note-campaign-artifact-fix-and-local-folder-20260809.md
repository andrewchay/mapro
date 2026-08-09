# ma-proma · Campaign 产物校验修复 + 本地项目文件夹 交接记录

> 日期：2026-08-09
> 会话：Proma Agent
> 范围：本次一次会话内完成两类改动，均已验证。

---

## 一、背景两类问题

1. **Campaign 工作流产物校验失败**：用户报错 `market-analysis` 字数不足+缺锚点、
   `user-analysis` 缺必需文件、`brand-dna` 缺锚点、`brand-fact-check` 缺文件。
2. **产物无自定义存放位置**：需要新建 Campaign 时能指定本地项目文件夹，
   产物落到项目文件夹下，方便查看与交接。

产品决策（用户确认）：
- 语义锚点：**只降级为软校验**（缺失不阻断完成，仅提醒）
- 本地文件夹：产物存 `项目文件夹/campaign-{id}/`，状态文件留内部；**只改 Electron**（server/web 不动）

---

## 二、改动清单

### A. 产物校验四条报错修复（task：市场/用户/品牌DNA/品牌核实）

| 文件 | 改动 |
|------|------|
| `apps/electron/default-skills/ma-market-analysis/SKILL.md` | **新增** skill（此前缺失，导致"市场分析"永远校验挂）。内置市场规模/品类趋势/品类痛点规范 + ≥300字 |
| `apps/electron/default-skills/ma-ta-portrait/SKILL.md` | 新增"工作流落盘规范"：落盘 `ta-portrait.md / search-habits.md / consumer-insight.md` 三文件 + 精确锚点措辞；version 1.0.1→1.0.2 |
| `apps/electron/default-skills/ma-brand-dna/SKILL.md` | 强制"产品/产品力/价格带/SKU"原文措辞；version 1.0.0→1.0.1 |
| `.../campaign-workflow-service.ts`（electron + server） | `user_analysis` agentPrompt 改为【必须】三个指定文件名落盘 |
| 回归测试 | server：market_analysis 缺锚点→soft（valid=true），四步合格产物全过用例 |

### B. 语义锚点降级为软校验

| 文件 | 改动 |
|------|------|
| `packages/server/.../campaign-artifact-validator.ts` | 语义锚点缺失：不再 `missing.push`，仅 `unmetRequirements`（不判死） |
| `apps/electron/.../campaign-workflow-service.ts` | 同理 + `completeStepWithValidation` 通过时把未命中锚点追加到 outputSummary 提醒 |
| `packages/server/.../campaign-workflow-service.ts` | `completeStepLocked` 同样追加软提醒 |
| 测试 | electron `Slice 2d` 断言改为"缺硬性必需文件仍失败、缺锚点仅提醒"；server 加软校验用例 |

### C. 新建 Campaign 指定本地项目文件夹

| 文件 | 改动 |
|------|------|
| `packages/shared/src/types/campaign.ts` | `Campaign` + `CreateCampaignInput` 增加 `projectPath?` |
| `.../campaign-manager.ts` | createCampaign 落库 `project_path`（含老库 ALTER migration）；绑定 workspace rootPath；绑定失败回滚 DB+抛错；campaign.json 带 projectPath |
| `.../campaign-workflow-service.ts` | 新增 `getCampaignArtifactsRoot(campaignId)`：有 rootPath → `<项目>/campaign-{id}/`，否则退回内部；产物路径全部改用它；状态路径保持内部 |
| `.../agent-workspace-manager.ts` | `getAgentWorkspaceCwd`：campaign+rootPath → `<项目>/campaign-{id}/`（保证 agent 写作与校验路径一致）；普通工作区不变 |
| `.../CampaignCreateDialog.tsx` | 弹窗加"本地项目文件夹（可选）"输入+选择按钮，写入 projectPath |
| IPC | 复用已有 `openFolderDialog()`，无新增 |
| 测试 | 新增 `agent-workspace-manager.test.ts`（campaign+rootPath 子目录 / 普通项目返回 rootPath / 失效抛错） |

---

## 三、核心设计约束（易错，务必保留）

- **三条路径必须严格一致**：agent 写作 cwd（`getAgentWorkspaceCwd`）、产物校验根
  （`getCampaignArtifactsRoot`）、产物落盘 都指向同一处，否则"写到 A 查 B"导致校验失败。
- **产物与状态分离**：产物→项目文件夹；状态（campaign-workflow.json、.context/）→内部
  `~/.mapro/agent-workspaces/campaign-{id}/`。
- 语义锚点软校验：硬性条件（目录/文件/必需文件/非空/字数）仍判死；
  只有锚点缺失不判死、仅记 `unmetRequirements`。
- `projectPath` 为空时全部行为与改动前完全一致（向后兼容）。

---

## 四、验证结果

- electron main 全部 **120/120** 通过；server campaign **26/26** 通过
- 新增 agent-workspace-manager 测试 3 用例通过
- shared / server / electron 三个 typecheck 全绿

## 五、生效前提（重要）

1. **重新打包 App** 才生效（主进程 + renderer + DB 列都改了）。
2. 老 Campaign 不迁移；本地文件夹功能只对**新建**的 Campaign 生效。
3. 修复只影响**新 workflow**（agentPrompt 持久化在 campaign-workflow.json）；失败的旧
   Campaign 需重置或重建才会用新规则。

## 六、遗留 / 建议

- 语义锚点"软提醒"目前落在 outputSummary/history，**前端 UI 未专门展示**。若需显眼
  角标，需另改 Renderer + preload + IPC。
- 本次未动 `campaign-artifact-validator.ts` 之外的校验器逻辑；若后续放宽必需文件，
  需在任务上单独确认。
