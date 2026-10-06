# MAPro 决策驱动工作流改造建议

状态：第一批已于 2026-10-05 完成并提交（commit `0b44ce88`）。第二批「统一确认状态（M0 门 + confidence_gate）」已完成实现（工作区未提交），见文末「第二批」。第三批（结构化 M0 判定、依赖图细化）见文末「仍未做」。

## 现状核查（2026-09-29 改造前记录，保留作对照）
- apps/electron/src/main/lib/campaign-workflow-service.ts：目标设定在 Brand Concept 之后；goal_setting 仍调用 ma-campaign-optimizer；平台矩阵、KOL、Brief、测试已存在。完成检查以文件、字数、语义锚点为主，不能等同于决策质量验证。
- apps/electron/default-skills/ma-marketing/SKILL.md：完整 Brief 可跳过澄清，仍是策略→选人→建联→创意的旧入口；与 ma-brief-intake 的前置门规则未完全对齐。
- ma-brief-intake 已有五类假设门；上一轮已补情境、反证、身份替换、置信标注、搜索承接和 M0/M1/M2，保留复用。
- ma-campaign-review 已有问题驱动、样本纪律、Keep/Stop/Start；但收藏代表想买等推断需降为待验证代理指标。
- ma-campaign-tester 已有假设和对照设计；不应笼统排除品牌曝光项目，也不能把非随机达人分组自动称为因果实验。

## 推荐改动
1. 统一入口：ma-marketing 完整 brief 只减少提问，不绕过 M0；工程模板同样消费 M0。M0 新增业务主目标、活动类型（事件/常态/混合）、可测数据与承接条件。
2. 两次定义目标：研究前明确业务问题与约束；研究后细化传播任务、指标、验证办法。不要等品牌屋产出后才知道目标。
3. 在现有 goal-setting 产物内增加决策任务表：任务ID、人群×情境、当前判断→目标判断、障碍、主张、证据及来源/置信、行动与承接、验证指标/窗口。
4. 下游消费同一任务表：创意绑定判断与证据；平台绑定职能和触点；达人绑定说服能力；日历及Brief绑定行动与承接。渠道/粉丝层级不预设固定角色。
5. 测量计划前置到目标阶段；测试方案保留在执行前细化。交付、认知、行为、增量分层，不强行要求每项目都证明销售增量。
6. 方案审核补目标—证据—内容—承接一致性，利用已有proposal-review待办，不另造一套流程。
7. 工程分阶段：先同步skill与实际prompt，再结构化关联字段、确认状态及依赖版本；最后做改动失效提示和复盘证据回流。保留旧项目兼容，不重编号全部历史步骤。

## 不改
研究/品牌/创意能力、达人采集尽调建联候选池、审核发布数据回收、M0/M1/M2、Keep/Stop/Start、本地资产和现有状态管理/存储基础。单条创作与局部任务不强制跑全链。稳定品牌资产允许复用并注明适用范围。

## 验证
用同一brief比较改造前后：是否有无对应决策任务的产物；关键判断是否有证据；内容行动是否有承接；不同入口是否绕门；上游变化是否暴露下游受影响项；复盘是否能回答预设问题且不夸大因果。

## 2026-10-05 第一批实施完成（已提交）
- commit `0b44ce88`（feat: 15 步工作流 M0 对齐门前置与决策任务表改造 + 9 个 skill 版本迭代），后续 `37b2ecc2` 追加台账等文档。
- 修改 9 个 default-skills，版本已递增：ma-marketing 1.0.3、ma-brief-intake 1.0.2、ma-creative-concept 1.0.5、ma-platform-role-mapper 1.0.1、ma-kol-pyramid 1.0.4、ma-content-calendar 1.0.2、ma-proposal-phasing 1.0.1、ma-campaign-tester 1.0.1、ma-campaign-review 1.0.2。
- **Electron 与 Server 两份 `campaign-workflow-service.ts` 均已同步**：步骤 1 前置核对 M0 对齐卡；步骤 3 记录人群×情境、当前判断、行动障碍、反证与置信标注；步骤 6 重构为「目标设定与决策任务」，新增决策任务表（ID/人群×情境/判断迁移/证据来源与置信/承接/观察窗口），`goal_setting` 的 `toolName` 两边都从 `ma-campaign-optimizer` 改为 `ma-marketing`；创意/平台/达人/Brief/测试提示词引用任务 ID。
- 测试：`bun test` 两套工作流测试 46 pass；`bun run --cwd apps/electron typecheck` 通过；`git diff --check` 通过。

## 第二批：统一确认状态（M0 门 + confidence_gate）—— 已实现（未提交）

设计见 `.context/plan/unified-confirmation-gate.md`。落地范围：

**共享层**
- `packages/shared/src/types/campaign.ts`：新增 `ConfirmationItem`、`ConfidenceGate`、`ConfirmationStatus`、`ConfirmationSource`、`ConfirmWorkflowItemInput`、`WorkflowBlockedResult`；`CampaignWorkflowStep.confirmations?`、`CampaignWorkflow.confirmations?`（可选，向后兼容）；新增 IPC 通道 `campaign:confirmWorkflowItem`。
- `packages/shared/src/utils/campaign-confirmation.ts`（新增，纯函数）：`parseConfidenceGate`、`hasAssumptionMarkers`、`buildM0Confirmation`、`evaluateStepConfirmations`、`mergeConfirmations`、`collectBlockingConfirmations`、`findBlockersForStep`、`applyConfirmation`。判定逻辑集中于此，Electron/Server 复用。

**服务层（两份同步实现）**
- `loadCampaignWorkflow` / `resetWorkflow` / 迁移后均调用 `recomputeConfirmations`：M0 门为工作流级单一项；confidence 门按步骤产物判定；已 confirmed/rejected 不被覆盖回 pending。
- `advanceWorkflow` 目标步骤存在未确认阻断项时抛错拒绝推进。
- 新增 `confirmWorkflowItem` / `listBlockingConfirmations`。
- 迁移透传 `confirmations`，旧文件初始化为 `[]`，不回溯阻断历史已完成步骤。

**UI / 接口**
- Electron：`ipc.ts` + `preload/index.ts` 新增确认通道；`CampaignWorkflowSteps.tsx` 增加「待确认」区块（原因 + 确认/驳回）与阻断提示。
- Web：`apps/web/src/routes/campaign.ts` 新增 `GET /:id/workflow/confirmations`、`POST /:id/workflow/confirmations/:itemId`。

**Skill 结构化置信门**
- `ma-brief-intake` 1.0.3、`ma-consumer-insight` 1.0.3、`ma-brand-house` 1.0.5：产出附带 `confidence_gate` JSON 块；缺失时引擎退化为关键词检测。

**测试**：shared 15、server 25、electron 51、web+相关 196（22 文件）全绿；shared/server/electron/web 四包 typecheck 通过；`git diff --check` 通过。

## 仍未做（第三批/工程项）
- **M0 判定是启发式**：`isM0Unresolved` 以 brand-dna 产物是否存在 + 是否含 `[假设]`+`M0/对齐卡` 判断，可能误判；未来应改为读取 brief-intake 产出的结构化门。
- confidence 门阻断其「所属步骤下游」目前近似为「所有非归属步骤」，未按真实依赖图细化；上游变更后的下游失效联动未实现。
- `readStepArtifactText` 只读目录一层（非递归）。
- 视频步骤不适用时尚无 skip 机制。
- 底层 ma-tools 未同步梳理。
- `README.md` / `CLAUDE.md` 修改按规范需单独获得允许。
