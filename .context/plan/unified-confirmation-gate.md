# 统一确认状态（M0 确认门 + confidence_gate）设计

## 目标
把「M0 对齐卡未确认」与「skill 产出置信不足」统一为一套**持久化的待确认状态**，由工作流引擎判定门控，并在 UI 显示待确认与阻断原因，用户可在 UI 显式确认后放行。

## 现状（已核查）
- `CampaignWorkflowStep` 类型：`packages/shared/src/types/campaign.ts:522`，现有 `status: CampaignWorkflowStepStatus`（pending/in_progress/completed/skipped/failed）、`outputSummary`、`notes`。
- 持久化：`campaign-workflow.json`，原子写 + `.bak`；旧文件按 `steps.length` 不等触发 `migrateWorkflow`（server `:794`，electron `:997`）保留 status/summary。
- 两份实现：Electron `apps/electron/src/main/lib/campaign-workflow-service.ts`（同步函数 + IPC）、Server `packages/server/src/campaign/campaign-workflow-service.ts`（class + Web 路由）。二者提示词已同步，但**状态机逻辑各自独立**。
- 产物校验：`CampaignArtifactValidator`（server）与 electron 内等价逻辑；语义锚点为软校验（`unmetRequirements`），仅提示不阻断。
- UI：`apps/electron/src/renderer/components/agent/CampaignWorkflowSteps.tsx`，STATUS_CONFIG 五态 + 按钮（执行/标记完成/重新执行/调整/跳过/撤销）。Web 侧为 REST 路由。
- agent 事件：`packages/shared/src/types/agent.ts` 已有 `ask_user_request`/`ask_user_resolved`、`permission_request` 机制，可参考但**不复用**（语义不同，避免耦合）。

## 统一模型（shared 类型）
新增于 `campaign.ts`，均为**可选字段**以保证向后兼容：

```ts
/** 确认项：工作流中的待确认/已确认状态单元 */
export interface ConfirmationItem {
  id: string                 // 稳定 ID，如 'm0_alignment' | 'brand_house_confidence'
  label: string              // 人类可读，如 'M0 对齐卡：五类形态假设'
  reason: string             // 待确认原因（缺失/置信不足/冲突）
  status: 'pending' | 'confirmed' | 'rejected'
  source: 'm0' | 'confidence_gate'   // 来源，用于分组展示
  blocking: boolean          // true=阻断下游步骤
  stepId?: CampaignWorkflowStepId    // 归属步骤
  confirmedAt?: number
  confirmedBy?: string
  evidence?: string          // 确认依据（可空）
}

/** confidence_gate 结构化字段：skill 产物声明可被引擎读取 */
export interface ConfidenceGate {
  confidence: 'verified' | 'assumption'   // 对齐现有 [已验证]/[假设] 标注
  gateId: string
  message: string
  blocksStepId?: CampaignWorkflowStepId
}
```

在 `CampaignWorkflowStep` 增加：`confirmations?: ConfirmationItem[]`。
在 `CampaignWorkflow` 增加：`confirmations?: ConfirmationItem[]`（工作流级，用于跨步骤门如 M0）。

## 门控规则
| 门 | 来源 | 触发 | 阻断 |
|---|---|---|---|
| M0 对齐门 | m0 | brief-intake 对齐卡存在 `[假设]`/未决问题，或缺失 | 阻断步骤 1–6（研究到目标设定） |
| confidence_gate | confidence_gate | 产物含 `[假设]` 且该判断被下游引用 | 阻断引用它的下游步骤 |

判定在**服务层**统一实现（新增纯函数模块，两服务共用同一套判定），不在 prompt 里靠自觉。

## 引擎行为（两个服务同步实现）
1. `loadCampaignWorkflow` 时重算 `confirmations`（从产物内容 + 结构化字段），与已存状态合并（已确认的不被覆盖回 pending）。
2. `completeStepWithValidation`/`completeStep` 完成后，若该步骤产生 blocking 确认项，则状态置 `completed` 但写入 confirmations。
3. 进入被阻断步骤时（`updateWorkflowStep` 设为 in_progress / `advanceWorkflow`），若上游存在 blocking 且未 confirmed 的确认项 → 拒绝推进，返回结构化 `{ blocked: true, blockedBy: ConfirmationItem[] }`。
4. 新增 `confirmWorkflowItem(campaignId, itemId, { behavior, note })`：标记 confirmed/rejected，写 `confirmedAt`。
5. 迁移：`migrateWorkflow` 透传 `confirmations`；旧文件无该字段时初始化为 `[]`，不改变既有 status。

## 结构化 confidence_gate 落地
- 让 `ma-brand-house`、`ma-consumer-insight` 等产出在 JSON 末尾附带 `confidence_gate` 块（skill 文本层，版本递增）。
- 引擎从产物文本解析该块 → 生成 ConfirmationItem。解析失败则退化为内容关键词检测（`[假设]`/未确认表述）。
- 该字段是**可选的增强**，缺失时不影响旧流程。

## UI（Electron 为主，Web 复用共享类型）
- `CampaignWorkflowSteps.tsx`：
  - 顶部新增「待确认」区块，列出 `blocking` 的确认项 + 原因 + 「确认」/「驳回」按钮。
  - 被阻断步骤的状态徽标加锁图标 + tooltip 显示 `reason`，执行按钮禁用并提示「需先确认：xxx」。
  - 确认后调用新 IPC，刷新 workflow。
- IPC（electron `ipc.ts` + `campaign-workflow-service.ts`）：新增 `campaign:confirmWorkflowItem`、`campaign:getWorkflowConfirmations`。
- Web 路由（`apps/web/src/routes/campaign.ts`）：新增 `POST /:id/workflow/confirmations/:itemId`。
- 权限模式：确认动作是一般写操作，走既有权限流程，不新增模式。

## 影响面
- shared 类型增量（可选字段，兼容）。
- electron + server 两份 workflow 服务各自改状态机（约各 60–100 行）+ 新增判定纯函数模块（共享）。
- UI 一个组件 + 两个 IPC + 一个路由。
- skill 文本：brand-house / consumer-insight / brief-intake 版本迭代。
- 测试：server 工作流测试、web e2e、electron 工作流测试需新增门控用例。

## 不做
- 不改 ma-draft-review 稿件红卡口径。
- 不重编号步骤、不合并两份服务为一份（留作后续）。
- 不新增数据库表（仍写 campaign-workflow.json）。
- 不动 README/CLAUDE（需另行授权）。

## 分步实施顺序
1. shared 类型 + 判定纯函数模块 + 单测。
2. server 服务：重算/合并/阻断/confirm + 测试。
3. electron 服务 + IPC + 测试。
4. UI 组件 + Web 路由。
5. skill confidence_gate 文本 + 版本递增。
6. 全量测试 + typecheck + diff check；更新 note/todo。

## 风险
- 两份服务逻辑重复，易再次漂移 → 判定逻辑抽公共模块，仅状态机各自实现。
- 阻断可能让历史进行中的 Campaign 卡住 → 迁移时对已 completed 步骤不回溯阻断；仅对未完成步骤生效；提供「强制确认」入口。
- 误判 confidence_gate → 解析失败一律降级为不阻断。
