# ma-proma vs proma-mit(gravitas) 演进决策文档

> 日期：2026-08-08（最后更新 2026-08-10）
> 状态：**主线未拍板**。此为决策支撑文档，不涉及实施。
> 用途：供主负责人 + 另一位员工（飞书达人模块作者）对齐"营销域落哪、飞书达人落哪"决策。

## 0. 背景与已确认决策

用户已确认的硬约束：
1. 营销数据接入 **Postgres 多租户**（不走本地 SQLite）。
2. **多人协作**（跨角色审批、成员/负责人、AI员工、预算与人审流转）。
3. 迁移方式 **一次性**（端到端，不分步）。
4. 飞书机器人达人管理（另一员工开发中）——在 ma-proma 上开发，**最终归属未定**。
5. 主干（gravitas vs ma-proma）**尚未拍板**。

## 1. 两个项目定位（用户原话归纳）

- **proma-mit = gravitas（@gravitas/*，Proma fork）**：未来**企业 OS 的基石**，通用 Agent + 团队协作。目前还不稳固、快速迭代中（今天 08-08 仍在 PH2 高频提交，1183 commits）。
- **ma-proma（@ma-proma/*）**：**专门 for 营销**存在（KOL/Campaign/投流），126 commits。

## 2. 关键技术事实（实测，2026-08-08）

### proma-mit（更成熟、快速演进）
- work-module 注册表框架：`projects / calendar / automation` 3 核心模块，`atoms/work-module-registry.ts` 统一注册，`ActiveView` 已含 `'projects'|'calendar'|'automation'`。**新增第4个模块路径清晰。**
- apps/server 多租户能力：Postgres store、`billing` `audit` `aws-kms` `jwt-auth` `rate-limit` `recovery` `spans` `signals` `scheduler-store` `isolated-executor` `workspace-tools`。→ 投放『媒体凭证安全 + 审批门 + 费用/成本 + 定时监控』底座已齐。
- 团队协作：`member-directory` `member-store` `member-sync`（真人/AI员工/Bot 统一成员）、Mailbox、Todo 事件流、负责人选择器、Run Center、Context Hub/Work Graph。
- 飞书能力更成熟：feishu-bridge 基础上还有 `card-renderer-v2` `card-stream`。

### ma-proma（营销领域资产深，但架构旧）
- 营销 = `ActiveView: campaigns + kol_data` 两个视图 + `main/lib/ma-tools/` 19 个工具 + renderer `components/agent/Campaign*` 一整套（深耦合 Chat/Agent 视图内）。
- **无 work-module 注册表框架、无 apps/server、无 member/多租户能力。**
- 飞书桥接层与 proma-mit **同源同构**（feishu-bridge/manager/message/presence 一致）→ 迁移飞书侧框架成本低，但达人对话式图文修改的领域逻辑在 ma-proma 内。

### 2026-08-10 更新：飞书达人机器人已合并进 ma-proma
- 另一员工（branch `xxw57`）的达人管理已合入 ma-proma main（merge 825e878a，+4149 行，08-08）。
- 实际形态 = **达人稿件三态审核机器人**（Skill 驱动）：
  - `ma-draft-review`（SKILL v1.1.27）：第三方把稿件发飞书群 → 机器人读飞书文档/文件 → 匹配 brief + 本群审核口径 → 输出 🔴红卡(返工)/🟡黄卡(人工拍板)/🟢绿卡(@Account确认) → @对应成员。不改分。
  - `ma-image-audit`（v1.0.1）：Kimi 视觉模型逐图审核场景/构图/品牌露出/合规，输严重度。
  - `ma-publish-data-track`：迁移原飞书 Risk Bot 上线数据追踪为原生 skill。
  - `feishu-bridge.ts` **+1011 行**：稿件云文档/文件自动入库、读飞书云文档(docx)、群聊三层输出加固。
  - `browser-automation-service.ts` +327（达人采集）、脚本 `kol_collector.py` / `scraper_template.py`(+1211) / `note_data_fetcher.py`。
- **耦合度判断**：以「Skill + feishu-bridge 增强 + 采集脚本」形态深耦合进 ma-proma 的 Agent/飞书体系，**不是独立模块**。但它主要增量在：Skill 定义（提示词/规则，work 内聚可搬）+ feishu-bridge 增量（与 gravitas 同源，可移植）+ 采集脚本（独立文件）。→ 比最初估计的可迁移性高：**业务规则(红黄绿卡/brief/口径)集中在 SKILL.md，易于作为 gravitas 的 skill/marketing 模块资产整体搬移。**
- 这与投放文档的关系：投放文档是【广告投放目标系统】（mihoyo Ad Growth Agent 的模块/规则/命名/审批设计）；ma-draft-review/达人管理是【内容侧 / 达人协同】的现状；两者互补——投放文档提供「媒体投放 + 策略闭环」蓝图，ma-proma 的达人机器人/稿件审核是「素材生产 - 达人执行」侧已落地能力。迁移时两者应作为 marketing 工作模块内的不同子域看待。

## 3. 三条演进路线对比

### 路线A：以 gravitas 为主干，营销域迁为第4工作模块
- 做法：`@gravitas/*` 为主干；把 ma-tools + Campaign 淬炼成 `marketing`/`ad-delivery` work-module；飞书达人并入同一主干；数据走 apps/server Postgres store；多人协作走 member/AI员工/Mailbox。
- 成本：营销从 Chat 耦合中"拔出来"重构（UI 部分工作量大）；命名 `@ma-proma`→`@gravitas` 统一；飞书达人领域逻辑移植。
- 风险：营销重构期可能与 gravitas 高频迭代撞车（地基未稳固，改动会叠）；一次性迁移期间业务中断风险。
- 长期收益：营销坐落在最新 OS 底座上；多租户/多人协作/审批/成本全部原生支持；将来接投放执行层的"薄服务层"成本最低。
- **与你已拍板的 1/2/3 点（Postgres多租户/多人协作/一次性）天然契合。**

### 路线B：ma-proma 独立演进，营销自己做深
- 做法：继续以 ma-proma 为主干发展营销，自建/补齐多租户、协作、审批（绕开 gravitas）。
- 成本：要在 ma-proma 上重造 gravitas 已有的一套（member/多租户server/服务端），重复造轮子；并且 gravitas 地基持续演进，将来营销还得再迁一次（二次成本）。
- 风险：定位分化下，营销被钉在旧地基；多租户/协作自建难度不低。
- 长期收益：短期营销迭代快（不动地基）；但长期被 gravitas 甩开，重复建设。

### 路线C：混合（营销数据层留 ma-proma，gravitas 做 OS，飞书达人另算）
- 做法：奇异构，多套代码并行。
- 成本/风险：**最高**。两套模型、两套成员/审批、数据同步割裂、团队协作成本高。不推荐。

## 4. 关键结论与建议

1. **你拍板的 1/2/3（Postgres多租户 + 多人协作 + 一次性端到端）几乎把路线确定为 A（gravitas 为主干）**。因为这三项全是 gravitas 已建好、而 ma-proma 缺失的能力；选 ma-proma 就意味着在旧地基上重复建设最重的部分。
2. **真正的未决变量只剩两个**：① 主干最后确认；② 飞书达人模块（另一员工在 ma-proma 开发中）落哪。
3. 悬而未决的飞书达人：它桥接层与 proma-mit 同源 → 迁框架成本低；但领域逻辑（达人群内沟通/图文修改的异步状态机）是**前几次估的迁移成本的主要不确定性**，须等另一员工代码到位后细盘（原"第1步"）。
4. **建议先在内部和另一员工对齐主干方向（A/B 二选一），再谈飞书达人归属与一次迁移任务分解。** 当前不产出迁移实施计划。

## 5. 待办
- [ ] 主负责人 + 另一员工对齐：路线 A vs B
- [x] 飞书达人代码已合入 ma-proma main（08-08，xxw57 分支）——已盘：以 Skill 形态收敛，可迁移性较好
- [ ] 确认营销数据在 apps/server 的租户模型
- [ ] 确定营销模块的 ActiveView id 与 work-module 注册（如 `marketing`）
- [ ] 结合「投放Agent系统理解文档」将广告投放设计落成 marketing 模块子域（媒体投放/策略闭环/素材生产-达人执行）
