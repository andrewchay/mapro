# Gravitas 营销能力包 —— 落地实施方案（v4）

> 版本：v4.0（2026-08-10）
> 定位：**方案 Y（共享素材能力，两端内嵌）** + 命名改用 **influencer（达人）**
> 前提：以 proma-mit(gravitas, @gravitas/*) 为主干。
> 决策输入（最终）：
> - 数据层：本地 SQLite 先行 + Store 接口预留 Postgres 后切
> - 加载方式：按需订阅式能力包，运行时不常驻（非物理移除）
> - 包结构：**两个业务包 influencer（达人）、paid-media（投放）**；素材生产作为**共享能力层**，两端内嵌引用同一实现
> - 命名：达人用 **influencer**（不用 daren）；KOL/KOL 类词在代码与 skill 中保留（ma-* 既有约定）
> - 资产现状：ma-proma 营销资产已整合好，无外部待交接资产
> 相关文档：`.context/decision-mapping-migration.md`、`.context/explore-server-store-standards.md`、投放Agent系统理解文档.md、ma-proma 仓库（26 个 ma-* skill + 21 个 ma-tools + 广告视频生成服务）。

---

## 0. 执行摘要

把营销能力拆成**两个订阅式业务包**，素材生产作为**共享能力层**被两端复用：

- **达人包 `influencer`**：KOL/influencer 库、brief、达人内容三态审核（飞书机器人）、内容数据追踪 + **内嵌共享素材能力**（图文+视频生成）。
- **广告投放包 `paid-media`**：广告/预算/数据看板、调控建议、审批流（**首期不含真实媒体 API 写钱**）+ **内嵌共享素材能力**。

素材生产**不独立成第三包**，而是作为共享实现（单一 true source）被两头引用——避免重复实现，同时保持达人/投放两个业务域的清晰边界。

> 结构 = 共享素材能力（通用底座）+ 两个业务包（达人 influencer / 投放 paid-media）。达人包管"达人内容协同与审核"，投放包管"把内容高效投出去"，两边共同用素材生产产出图文/视频。

---

## 1. 产品落位

### 1.1 三层产品结构（重定位）

```
gravitas 企业工作台（基座 Core OS）
├─ 核心基座：对话 / Agent / 工作区 / 权限 / Skills / 成员 / MCP
├─ 通用工作模块（core，人人有）：项目 / 日历 / 自动化
└─ 领域能力包（订阅加载，不常驻）
    ├─ 达人 influencer（内嵌共享素材能力）
    └─ 广告投放 paid-media（内嵌共享素材能力）
    （未来）人力 / 财务 / 客服…
```

### 1.2 共享素材能力层

- **不独立成包**，作为两个业务包共用的**共享实现**（`CreativeService` / `CreativeStore`）。
- 单一 true source：达人、投放引用同一套图文/视频生成逻辑，不复制代码。
- 与业务包的关系 = 依赖/内嵌，而非独立订阅。

### 1.3 为什么两个业务包 + 共享素材

| 维度 | 达人 influencer | 广告投放 paid-media | 共享素材能力 |
|---|---|---|---|
| 定位 | 达人线业务 | 投流线业务 | 通用生产力（服务两端） |
| 核心能力 | 达人内容审核/KOL/brief/追踪 | 建广告/预算/数据/规则/审批 | 图文+视频全链路生成 |
| 特有环节 | 达人稿件三态审核 | 投流/审批/资金 | 无（通用） |
| 资金风险 | 无 | **高（直接动钱）** | 无 |
| 依赖 | → 共享素材 | → 共享素材 | 独立 |
| 当前成熟度 | 高（审核三件套已整合） | 低（新建，重投入） | 高（图文/视频生成已整合） |

**敏感边界：达人内容审核（审第三方稿件）属达人包专属，不是共享素材能力的通用能力；共享素材只产出"我们的素材"（图文+视频），不含业务审核。**

---

## 2. 按需加载与订阅机制（最小可订阅，路径 B）

### 2.1 目标

「按需加载」= **运行时惰性初始化，非物理移除**。业务包代码物理常在 repo，运行时订阅了才注册 ActiveView / init DB / 起桥接。

### 2.2 订阅开关设计（第一阶段，复用现有机制）

```
能力中心列出业务包           ← 一个 CapabilityManifest 清单（当前 2 项）
工作区/租户 profile          ← enabledCapabilities: ['influencer']  （订阅状态）
导航动态出现                 ← core:false 走注册表，订阅后才 active-view
惰性 init                    ← 订阅 subscriber 时 initDb()/起 bridge/挂载共享素材
```

**阶段一不建 CapabilityRegistry、不做复杂能力市场面板**——用 `core:false`（现有机制）+ 一个订阅开关清单达成。

### 2.3 阶段二（出现第2个领域包 / 第二个订阅业务上线时）

把"开关列表化"提炼成 `CapabilityRegistry` + 加"能力市场/订阅面板"。届时：
- influencer 作为**首个已跑通的订阅式领域包（含共享素材）**，直接登记进 registry，内部零改动。
- paid-media 照抄 influencer 的订阅模式。
- 从一阶段到二阶段 = 收拢外层（登记/发现），非重构业务代码。

> 化解"后续抽象改动大"：抽象推迟到有真实第二例，且先锁定业务包边界干净、共享素材单一实现。

---

## 3. 数据层（两个业务包 store + 共享 CreativeStore，本地 SQLite 先行）

每个 store 独立接口 + 本地 SQLite 实现；`tenant_id/user_id` 列留作未来 Postgres 蓝本。

### 3.1 共享素材能力 `CreativeStore`
```sql
-- creative_task    生成任务：type(图文/视频)/client(达人或投放)/prompt/大纲/分镜/状态
-- creative_asset   素材成品：media(图/视频)/platform/分辨率/status(管理:删除/重命名)
-- creative_storyboard  分镜：帧/字幕burn-in/BGM/平台版本
-- creative_project 素材项目：版本/用途(influencer|paid|通用)/标签
```
共享，不含审核（审核在各业务包）。

### 3.2 达人包 `InfluencerStore`
```sql
-- influencer_talent  达人/KOL库：platform/handle/region/tags/status
-- influencer_brief   brief：talent_id/version/product/direction/accept
-- influencer_draft   达人稿件：brief_id/talent_id/source/review_card/review_detail/status/reviewer
-- influencer_metrics 达人内容数据追踪
```
达人稿件三态审核卡：🔴红 / 🟡黄 / 🟢绿（ma-draft-review 判定结果持久化）。**审核心属达人包专属，不在共享素材。**

### 3.3 投放包 `PaidMediaStore`
```sql
-- paid_campaign     广告/广告系列：channel/region/platform/ad_type/deliver_target/budget/status/goal_roi
-- paid_campaign_metrics  投放数据（按天×campaign 聚合：花费/曝光/点击/CPI/ROI）
-- paid_control_action   调控建议+审批（Agent 建议→人审→执行状态）
-- paid_budget_alert     预算告警
-- paid_rule            调控规则（红线/业务规则/软提示三档）
```

> store 间无跨包耦合；两个业务包通过 `creative_asset.client` 引用共享素材。未来各需跨端共享时各自实现 Postgres 版本。

---

## 4. 代码落地（两业务包 + 共享素材层，同一主干）

### 4.1 渲染层
| # | 文件 | 改动 |
|---|---|---|
| R1 | `packages/shared/src/types/work-module.ts` | `INFLUENCER_IPC_CHANNELS` + `PAID_MEDIA_IPC_CHANNELS` + `CREATIVE_SHARED_CHANNELS` + DTO |
| R2 | `renderer/atoms/active-view.ts` | 联合类型追加 `'influencer'|'paid-media'`（订阅后才有效） |
| R3 | `renderer/atoms/work-module-registry.ts` | 两个 manifest（`core:false`）+ `WORK_MODULE_VIEWS` |
| R4 | 新建 `renderer/components/influencer/` | InfluencerModuleView + 子页（达人库/审核/素材） |
| R5 | 新建 `renderer/components/paid-media/` | PaidMediaModuleView + 子页（投放/审批/素材） |
| R6 | 新建共享素材组件（两端复用） | CreativePanel（图文/视频生成）内嵌到两包视图 |
| R7 | 新建「能力中心/订阅面板」 | 列两包 + 启停开关 |

### 4.2 主进程
| # | 文件 | 改动 |
|---|---|---|
| M1 | `marketing/creative-service.ts` + `creative-store.ts` | 共享素材能力（含 video_pipeline 编排），单一实现 |
| M2 | `marketing/influencer-store.ts` + `influencer-service.ts` | 达人包数据+编排（引用共享素材） |
| M3 | `marketing/paid-media-store.ts` + `paid-media-service.ts` | 投放包数据+编排（引用共享素材） |
| M4 | `marketing/influencer-bridge.ts` | 飞书达人群审稿 Bot（迁 ma-proma） |
| M5 | `marketing/capability.ts` | 业务包 manifest + 订阅初始化 |
| M6 | `work-module-ipc-handlers.ts` | 注册两包 + 共享素材 IPC |

### 4.3 数据层（本地 SQLite）
- `creative-sqlite-store.ts` + `influencer-sqlite-store.ts` + `paid-media-sqlite-store.ts`（复用 project-sqlite-store 模式），订阅时 `initDb()` 惰性建表。

### 4.4 Skill / 资产（全部来自 ma-proma，已整合，直接迁移）
- **共享素材**：图文生成（ma-creative-concept/script-studio/content-calendar 等）+ 广告视频生成（video_pipeline、成片自动化、多平台渲染）。
- **达人包 influencer**：迁移 `ma-draft-review`/`ma-image-audit`/`ma-publish-data-track` + `ma-kol-*`（KOL库/圈选/CRM，保留 ma-* 约定）+ `kol-data` MCP 或 mock。
- **投放包 paid-media**：新建调控相关 skill（首期无，以投放数据/规则/审批为主）。

---

## 5. 里程碑

| 里程碑 | 内容 | 验收 |
|---|---|---|
| **M0 基建** | 能力中心列两包 + 订阅开关 + 本地 store 接口 + 共享素材层骨架 + preload | 面板可启停，导航动态出现 |
| **M1 共享素材能力层** | CreativeService/Store + 图文/视频生成（迁 video_pipeline）+ 相关 skill | 图文/视频素材生成全链路通（两端可引用） |
| **M2 达人包 influencer** | InfluencerStore/服务/UI + 飞书达人审核机器人 + KOL 库 + 审核三件套 + 内嵌共享素材 | 群内发稿→三态审核→@成员 + 素材生成全链路通 |
| **M3 投放包 paid-media**（靠后） | PaidMediaStore/服务/UI + 数据看板 + 调控建议审批流（**首期无 API 写钱**）+ 内嵌共享素材 | 数据同步 + Agent 出建议 + 审批记录 |

> 达人包做先行者验证"订阅式领域包 + 共享素材"机制；投放包照抄模式，降低单独创新风险。

---

## 6. 风险与对策

| 风险 | 等级 | 对策 |
|---|---|---|
| 投放 API 自动执行涉及资金 | 高 | 首期只读+建议+审批，无 API 写操作；凭证复用 PH2-D 审批门 |
| 共享素材层边界被业务审核污染 | 中 | 明确：审核属 influencer（第三方稿件），共享素材只产出"我们的素材" |
| 共享素材层与业务包耦合过头 | 中 | 素材层单一实现，业务包通过 `client` 字段引用；不复制素材代码 |
| 订阅机制还没抽象到 registry | 中 | 阶段一最小闭环，第2例才提炼（避免过早抽象） |
| 飞的 cardAction 按钮交互未接入 | 中 | 首期文本命令；如需按钮审稿补接 HTTP card 回调 |
| 一次性迁移大量改动 | 高 | 素材层→influencer→paid-media 同主干顺序交付 |

---

## 7. 待办
- [ ] 确认 gravitas 本地能力和"能力中心"入口形态（两包 + 共享素材层）
- [ ] M1 共享素材能力层独立成形（通用底座，先验证订阅 + 复用机制）
- [ ] 投放包首期边界：无 API 写钱，先数据+建议+审批
- [ ] 达人命名统一：influencer；skill/代码中 KOL 词保留（ma-* 约定）

---

*本方案基于 2026-08-10 对 gravitas 代码库只读探索 + ma-proma 现有营销资产盘点 + 投放Agent系统理解文档。v4 要点：方案 Y（共享素材、两端内嵌）+ 达人命名 influencer。*
