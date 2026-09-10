# ma-proma → upstream/main 营销能力迁移差距分析

> 盘点时间：2026-09-10
> 目标：在 upstream/main（Gravitas）中完整实现 ma-proma 的所有营销能力
> 结论先行：**Skills 层缺口最大（缺 19/27），数据层功能差距次之（三维 vs 五维审核、无归档/JTBD），Server 层和 Web 层整体缺失**

---

## 一、总体差距矩阵

| 能力层 | main (ma-proma) | upstream/main | 差距等级 |
|--------|-----------------|---------------|---------|
| Skills | 27 个 ma-* skill | 8 个 ma-* skill | 🔴 缺 19 个 |
| ma-tools | 21 个（lib/ma-tools/） | 17 个（lib/marketing/ma-tools/） | 🟡 缺 4 个 + 版本落后 |
| Campaign 数据层 | 3288 行 | 2994 行 | 🔴 功能缺口大 |
| Campaign 工作流 | campaign-workflow-service.ts | ❌ 无 | 🔴 整体缺失 |
| Server 层 | packages/server（campaign/kol/video） | ❌ 无 | 🔴 整体缺失 |
| Web 层 | 24 个组件 + REST 路由 | ❌ 无 | 🔴 整体缺失 |
| MCP Server | mcp-servers/ma-kol | ❌ 无 | 🟡 缺失 |
| Plugin 体系 | ❌ 无 | ✅ 完整 | ✅ upstream 领先 |
| 视频生成 | server 版 | ✅ electron 版完整 | ✅ upstream 已迁移 |
| 领域数据层 | ❌ 无 | ✅ marketing-sqlite-store | ✅ upstream 领先 |

---

## 二、Skills 层差距（19 个缺失）

upstream/main 现有 8 个：ma-brand-dna, ma-brand-house, ma-campaign-optimizer, ma-campaign-tester, ma-content-audit, ma-content-calendar, ma-creative-roi, ma-ugc-campaign

### 2.1 缺失的 19 个 skill（按迁移优先级分组）

**P0 核心业务链路（7 个，含脚本资产）：**

| Skill | 关键资产 | 迁移要点 |
|-------|---------|---------|
| `ma-kol-scraper` | 15 个 Python 脚本 + blacklist.json + screening_rules.json + 4 个 references | 采集+8阶段筛选+互暖排查全流水线；需验证 playwright/CDP 环境 |
| `ma-draft-review` | fetch_feishu_fast.py + kol_collector.py | 飞书三态审核链路；upstream 的 InfluencerReviewsPanel 已为其预留 UI |
| `ma-pgy-invite` | invite_blogger.py + extract_invite_wechat.py | 蒲公英邀约自动化 |
| `ma-publish-data-track` | note_data_fetcher.py | 发布数据追踪；upstream 的 InfluencerTrackingPanel 已为其预留 UI |
| `ma-image-audit` | — | Kimi 视觉审核（无脚本） |
| `ma-marketing` | references/industry-guide.md + platform-guide.md | 总纲编排 skill |
| `ma-kol-pyramid` | — | 金字塔投放策略 |

**P1 策略链路（8 个，纯 SKILL.md）：**
ma-brand-house✗（upstream 已有）……实际缺失：ma-competitor-analyzer, ma-consumer-insight, ma-creative-concept, ma-kol-crm, ma-kol-history-review, ma-kol-portal, ma-market-analysis, ma-script-studio

**P2 辅助（4 个，纯 SKILL.md）：**
ma-paid-media, ma-platform-role-mapper, ma-ta-portrait, ma-tone-manner

### 2.2 upstream 已有但需版本核对（8 个）

对照 main 版本逐一 diff SKILL.md 的 version 号与内容，以 main 为准覆盖：
ma-brand-dna(1.0.1), ma-brand-house(1.0.3), ma-campaign-optimizer, ma-campaign-tester, ma-content-audit, ma-content-calendar, ma-creative-roi, ma-ugc-campaign

---

## 三、ma-tools 层差距

upstream 位置：`apps/electron/src/main/lib/marketing/ma-tools/`（main 在 `lib/ma-tools/`）

### 3.1 upstream 缺失的文件（4 个）

| 文件 | 说明 | 迁移要点 |
|------|------|---------|
| `kol-data-mcp.ts` | KOL Data MCP Server 注入 | 需适配 upstream 的 MCP 加载方式 |
| `kol-data-mcp-tool.ts` | KOL Data MCP 工具元数据注册 | 同上 |
| `knowledge/` 目录（3 个 JSON） | industry-templates.json / case-playbooks.json / platform-guidelines.json | 纯数据文件直搬；creative-pilot 等工具依赖它 |
| （llm-service.ts 差异） | main: lib/ma-tools/llm-service.ts 依赖 channel-manager + proxy-fetch + proxy-settings | 🔴 不能直搬——upstream 有自己的 channel-manager，需重接 LLM 入口 |

### 3.2 已存在但需内容 diff 的（17 个）

所有工具（strategy-iq, creative-pilot, script-studio, campaign-optimizer, campaign-tester, budget-forecast, connect-bot, content-audit, content-tracker, kol-search, match-ai, kol-crm, kol-portal, kol-data-service, campaign-agent, ma-phase-reviewer, index）需逐一 diff——main 在迁移期持续修 bug（如 CPE 数据修复），upstream 版本可能落后。

---

## 四、Campaign 数据层差距（重点）

`campaign-manager.ts`：main 3288 行 vs upstream 2994 行，逐项验证的缺失功能：

### 4.1 表结构缺失

| 差异 | main | upstream | 影响 |
|------|------|----------|------|
| campaigns 表 | 有 `archived` + `deleted_at` 列 + idx_campaigns_archived 索引 | ❌ 无 | 归档功能缺失 |
| campaign_build_log 表 | ✅ 完整表 + 索引 | ❌ 无 | 构建日志功能缺失 |
| campaign_briefs 表 | 有 `job_spec` + `forces_map` 列（JTBD 结构化） | ❌ 无 | JTBD Brief 缺失 |
| content_audits 表 | 有 `brand_image_score` + `data_verifiability_score` 列（奥格威五维） | ❌ 无（只有三维） | **审核评分体系降级** |

### 4.2 功能缺失

| 功能 | main | upstream |
|------|------|----------|
| Campaign 归档/软删除 | `listCampaigns({ includeArchived })` + archive 相关 | ❌ `listCampaigns()` 无参数 |
| 构建日志（BuildLog） | `addCampaignBuildLog` / `CampaignBuildLog` | ❌ |
| JTBD Brief 模板 | `generateBriefTemplate` 含 JTBD 任务陈述段落；`saveBrief` 用 COALESCE 保留 jobSpec/forcesMap | ❌ 模板无 JTBD；saveBrief 丢失结构化字段 |
| 五维审核评分 | auditResult 写入 brand_image_score / data_verifiability_score | ❌ 只写三维 |

> ⚠️ 注意：upstream 的 campaign-manager.ts 已做了基础架构升级（native-sqlite 抽象、@gravitas/shared 类型、@gravitas/utils），**迁移时应以 upstream 为基底、从 main 移植缺失功能**，而不是反向覆盖。

---

## 五、整体缺失的模块（upstream 完全没有）

### 5.1 Electron 层

| 文件 | 说明 |
|------|------|
| `lib/campaign-workflow-service.ts` | 15 步标准工作流服务（产物目录管理、状态推进、ARTIFACT_DIRS 15 个目录定义） |
| `lib/draft-review-csv-viz.ts` + test | 审核反馈 CSV 可视化 |
| `mcp-servers/ma-kol/mcp_server.py` + README | MA KOL MCP Server（stdio，复用 ../ma 的 agent_core） |

### 5.2 packages/server 层（main 独有，13 个文件）

| 文件 | 说明 |
|------|------|
| `campaign/campaign-repository.ts` | Campaign 数据访问层 |
| `campaign/campaign-command-service.ts` | 写操作服务 |
| `campaign/campaign-query-service.ts` | 读操作服务 |
| `campaign/campaign-workflow-service.ts` + test | Server 版工作流 |
| `campaign/campaign-artifact-validator.ts` | 产物校验器 |
| `campaign/content-audit-service.ts` + test | **奥格威五维评分服务**（合规20%+契合25%+质量25%+形象20%+可验证10%），含无 LLM 时的本地规则兜底 |
| `kol/kol-database-repository.ts` + test | KOL 数据库访问层（kols 表 + 7 个评分列） |
| `video/*`（6 个文件） | Server 版视频服务（upstream 已有 electron 版，需决策是否保留 server 版） |

### 5.3 Web 层（main 独有，~29 个文件）

**web-ui 组件（24 个）：**
- 页面：CampaignListPage, CampaignDetailPage
- 组件：CampaignBasicInfo/Card/PhasePlans/WorkflowSteps/BriefDialog/CreateCampaignDialog
- 审核：ContentAuditDialog/List, BatchContentAuditDialog
- 追踪：ContentTrackingDialogs/List
- KOL：KOLPoolList, KOLSelector
- 状态/钩子：campaign-atoms, campaign-detail-atoms, use-campaign-data
- 测试：10 个 .test.tsx/.ts

**web 路由（5 个）：**
- `routes/campaign.ts`（REST API）
- campaign-artifacts / campaign-consistency / campaign-isolation / campaign-workflow.e2e 测试

### 5.4 shared 类型差异

- main: `@ma-proma/shared` 的 campaign.ts 含 `CampaignBuildLog`, `AddCampaignBuildLogInput`, KOLContentTracking 等类型
- upstream: `@gravitas/shared` 已有大部分类型，缺 BuildLog、JTBD brief 字段、五维评分字段

---

## 六、upstream 已领先的部分（迁移时保留，勿覆盖）

| 资产 | 说明 |
|------|------|
| Plugin 体系 | plugin-manager + marketing-plugin + 订阅驱动工具注入 |
| marketing-sqlite-store | influencer/paid-media/creative 三子域数据层（预留多租户） |
| creative-video-service + video/ | 视频生成完整管线（含凭据解析器、测试） |
| Influencer/PaidMedia UI 面板 | 骨架级但架构就位（InfluencerModuleView 等 4 个面板） |
| workflow 引擎 | workflow-*.ts 一整套（scheduler/executor/template/event） |
| marketing-campaign 工作流模板 | default-tools/marketing/workflows/ JSON（15 步 DAG） |
| marketing-campaign 子代理 | default-agents/marketing-campaign/AGENTS.md |
| marketing-toolset benchmark | 3 个评测用例 |
| 能力中心 UI | CapabilitiesView + CapabilityCenterPanel + marketing-atoms |
| ma-tool-prompts.ts | 工具提示词集中管理 |

---

## 七、迁移策略建议（分五批）

**批次 1：Skills 补齐（低成本，先做）**
- 直搬 19 个缺失 skill（含 22 个 Python 脚本 + blacklist.json + screening_rules.json + knowledge JSON）
- 8 个已有 skill 用 main 覆盖（版本对齐）
- 验证点：Python 依赖（playwright/CDP）、脚本可执行

**批次 2：Campaign 数据层功能移植（以 upstream 为基底）**
- upstream 的 campaign-manager.ts 基础上加：archived/deleted_at 列 + 归档逻辑、campaign_build_log 表、JTBD brief 字段（job_spec/forces_map）、五维评分列（brand_image_score/data_verifiability_score）
- 同步补 @gravitas/shared 类型（BuildLog、JTBD、五维）
- 迁移 campaign-workflow-service.ts（改造 import 路径 @ma-proma/shared → @gravitas/shared）

**批次 3：ma-tools 差量移植**
- 17 个已有工具逐一 diff main vs upstream，以 main 内容为准重接 `@gravitas/core`/`@gravitas/shared` 和 upstream 的 llm 入口
- 补齐 knowledge/ 3 个 JSON、kol-data-mcp 两文件
- llm-service.ts 不直搬——适配 upstream channel-manager

**批次 4：Server 层 + Web 层**
- 决策点 ①：packages/server 的 campaign/kol 服务是否仍需要（upstream 用的是 electron 直连 SQLite + marketing-sqlite-store，架构不同）——建议先移植 content-audit-service（五维评分逻辑）到 electron 层，其余按需
- 决策点 ②：web-ui 的 24 个 Campaign 组件移植（upstream 的 web-ui 结构兼容）+ web 路由层
- 决策点 ③：server 版 video/ 已被 electron 版覆盖，确认后可弃

**批次 5：MCP Server + 收尾**
- mcp-servers/ma-kol 迁移（外部依赖 ../ma 项目，需确认 MA_AGENT_CORE_PATH 策略）
- ma-kol-scraper 等带 CDP 的脚本在 upstream 环境验证
- 端到端：Campaign 创建 → KOL 导入 → Brief 生成 → 审核（五维）→ 追踪 → 复盘

---

## 八、关键决策点（需确认）

1. **Server 层去留**：main 的 packages/server 架构（REST + repository）在 upstream 是否保留，还是统一走 electron IPC + marketing-sqlite-store？
2. **五维评分落位**：content-audit-service（server 版，含本地规则兜底）的奥格威五维逻辑，是并入 upstream electron 层的 runContentAudit，还是保留独立服务？
3. **LLM 调用层**：ma-tools 的 llm-service 依赖 main 的 channel-manager/proxy 体系，upstream 重接时用什么入口（channel-manager 同名能力 or agent-runtime）？
4. **video 双版本**：server 版 video（main）与 electron 版 video（upstream）功能基本重叠，确认以 electron 版为准、server 版仅作 diff 补漏？
5. **MCP Server 外部依赖**：ma-kol MCP 依赖 ../ma 项目的 agent_core，upstream 环境是否可用？
