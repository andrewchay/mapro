# 回退"加护栏"变更计划

## 目标
回退 9/28 - 10/6 之间的 5 个"加护栏"commit，恢复到 9/21 (46050c91) 之后的状态。

## 背景
同事反馈 9 月中以来营销策略"不那么锐利"。时间线分析表明：
- 9/11 的方法论注入（JTBD/STEPPS/Cialdini/参与感/鸿沟）是"加武器"
- 9/28-10/6 的护栏注入（反证检验/置信标注/M0门/硬阻断）是"加护栏"
- 本次先回退"加护栏"部分，测试是否恢复锐利度

## 回退范围

### A. Skill 文件（13 个）

**删除 3 个新增 skill：**
- `apps/electron/default-skills/ma-brief-intake/SKILL.md`
- `apps/electron/default-skills/ma-search-bridge/SKILL.md`
- `apps/electron/default-skills/ma-proposal-phasing/SKILL.md`

**回退 10 个被修改 skill（恢复到 46050c91 版本）：**
- `ma-brand-house/SKILL.md`（去掉置信等级标注 + confidence_gate）
- `ma-campaign-review/SKILL.md`（去掉 M0 相关引用）
- `ma-campaign-tester/SKILL.md`（去掉 M0 相关引用）
- `ma-consumer-insight/SKILL.md`（去掉反证检验 + 置信标注）
- `ma-content-calendar/SKILL.md`（去掉替换测试）
- `ma-creative-concept/SKILL.md`（去掉身份替换测试 + 产品角色段 + M0 引用）
- `ma-kol-pyramid/SKILL.md`（去掉 M0 相关引用）
- `ma-marketing/SKILL.md`（去掉 M0 对齐卡前置 + 决策任务表）
- `ma-platform-role-mapper/SKILL.md`（去掉 M0 相关引用）
- `ma-ta-portrait/SKILL.md`（去掉情境四要素 + 反证检验 + 功效表述过滤）

### B. 工作流引擎代码

- `apps/electron/src/main/lib/campaign-workflow-service.ts`：回退 M0 门前置 + 决策任务表改造
- `packages/shared/src/types/campaign.ts`：删除 ConfirmationItem/ConfidenceGate 类型
- `packages/shared/src/utils/campaign-confirmation.ts`：整个删除（新增文件）

### C. 保留不动
- draft-review / image-audit 的 9/16 和 9/21 变更
- wechat-auto / kol-outreach / pgy-invite
- 9/11 的方法论注入（JTBD/STEPPS/Cialdini/参与感/鸿沟）
- 9/12 的 ma-business-strategy
- 6/19-7/1 的初始创建和 4A 升级

## 执行方式
用 `git checkout 46050c91 -- <file>` 恢复 skill 文件，用 `git rm` 删除新增 skill，用 `git revert` 或手动恢复引擎代码。

## 验证
- 回退后 `git diff 46050c91..HEAD -- apps/electron/default-skills/` 应该只包含 9/11 和 9/12 的变更
- 确认 ma-brief-intake / ma-search-bridge / ma-proposal-phasing 不再存在
- 确认 campaign-confirmation.ts 已删除

## 备份
- 回退前已创建 tag：`backup/before-guardrail-rollback-20261016`
