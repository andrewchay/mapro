# MAPro 决策驱动 Campaign 工作流继续实施计划

## 已完成只读核查
- Electron 桌面工作流已包含 M0/决策任务表改造，改动仍在工作区未提交。
- `packages/server/src/campaign/campaign-workflow-service.ts` 是另一份独立工作流定义，目前有旧版本：目标设定仍调用 ma-campaign-optimizer，未关联决策任务表，达人 Brief/测试仍有旧规则。
- Server 的 `CampaignWorkflowService` 使用 `CampaignArtifactValidator`，完成步骤时会校验必需文件/字数；语义锚点仅软提醒。尚无确认状态或依赖检查，不能仅凭提示词称为硬门。
- Electron 工作流默认 15 步、Server 的注释/架构沿用 13 步历史，定义存在差异；本次不合并/重编号工作流。
- 项目 CLAUDE.md 规定 README/CLAUDE 文档功能变化同步需经过用户允许；此前已明确未获许可，不触碰二者。
- 本计划先聚焦同步，避免未经讨论大幅增加工程门。

## 实施范围
1. 在 Server workflow 定义同步桌面端已实施的 M0 提示、用户决策证据纪律、目标设定任务表、创意/平台/达人/Brief/测试任务ID关联、因果与增量表述边界。
2. 对比 Electron 与 Server 定义，针对本次涉及的 step id、tool、prompt、artifact requirements 做一致性测试；允许原有平台/视频等产品差异存在。
3. 为 Server 工作流补回归测试，确认 goal_setting 改用 ma-marketing、包含决策任务表锚点、下游引用任务 ID；测试不宣称它实现运行时 M0 硬阻断。
4. 运行 server typecheck、server campaign workflow tests、web campaign workflow e2e（如测试命令可用）、Electron 既有测试/typecheck、git diff --check。
5. 更新本任务 note/todo，明确当前依然是提示词+产物软校验；提出下一轮状态机硬门方案但不擅自实现。

## 暂不实施
- 不新增 M0 确认数据库字段、API、IPC、UI 或状态机硬阻断。
- 不实现决策任务 ID 的结构化跨产物追溯/失效联动。
- 不重排步骤、不合并桌面/Server 工作流、不强制品牌曝光项目测试销售增量。
- 不改变 ma-draft-review 的稿件红卡判定。
- 不改 README.md / CLAUDE.md（遵循已记录的用户批准要求）。
- 不提交或推送。

## 风险与验收
- Server 与 Electron workflow 有历史差异，避免机械覆盖整文件；只同步共同步骤的本次变更。
- 语义锚点缺失目前不会阻止完成，测试应验证提示/提醒行为而非宣称强制依赖。
- 旧 Campaign 通过按 step id 迁移保留状态；不增删 step id 即避免迁移风险。
- 验收：相关测试和类型检查通过，差异审查确认仅目标定义同步，所有改动未提交。
