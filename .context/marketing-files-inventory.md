# MAPro 营销/达人筛选/触达/内容审核 —— 全量文件整理

> 整理时间：2026-09-10（首次整理 + Git 提交历史补充扫描）
> 范围：ma-proma 工作区中所有与营销（Marketing）、达人筛选（KOL Screening）、触达（Outreach）、内容审核（Content Audit）相关的文件与代码
> 注意：本文档同时覆盖 **当前 main 分支** 和 **upstream/main 及 feat/marketing-capabilities 分支** 上的营销资产。upstream 分支包含完整的 plugin 化营销体系，main 分支仅包含核心 Skills + ma-tools + Campaign 服务。

---

## 〇、Git 提交历史补充发现的营销资产（不在四大核心域）

> 以下资产仅在 `upstream/main` 或 `feat/marketing-capabilities` 分支上存在，**当前 main 分支尚未包含**。这些是营销体系的重要基础设施，不属于四大核心域（达人筛选/触达/内容审核/策略），但构成了完整的营销插件化架构。

### 0.1 营销插件体系（Plugin Architecture）—— upstream/main

| 文件路径 | 说明 |
|---------|------|
| `apps/electron/src/main/lib/plugin-manager.ts` | **PluginManager** — 扩展管理器，管理内置插件生命周期（启用/停用/工具注入） |
| `apps/electron/src/main/lib/plugin-manager.test.ts` | PluginManager 测试 |
| `apps/electron/src/main/lib/plugins/marketing-plugin.ts` | **Marketing 插件**（com.gravitas.marketing）— 把 21 个 ma-tools 以 `RuntimeToolDefinition` 方式注入 Agent 运行时，含 `toRuntimeTool` 适配器 + 按订阅过滤逻辑 |
| `apps/electron/src/main/lib/plugins/marketing-plugin.test.ts` | Marketing 插件测试 |
| `apps/electron/src/main/lib/plugins/marketing-workflow-template.test.ts` | 营销工作流模板测试 |
| `apps/electron/src/main/lib/plugins/computer-use-plugin.ts` | Computer Use 插件（参照样板） |
| `apps/electron/src/main/lib/plugins/computer-use-plugin.test.ts` | Computer Use 插件测试 |
| `packages/shared/src/types/plugin.ts` | 插件类型定义（PluginManifest/PluginLifecycleState/PluginSurfaceType 等） |

### 0.2 营销领域数据层（Marketing Domain Store）—— upstream/main

| 文件路径 | 说明 |
|---------|------|
| `apps/electron/src/main/lib/marketing/marketing-service.ts` | **Marketing Service** — 营销领域包服务层，薄封装 marketing-sqlite-store，为 IPC 提供统一入口。含 creative/influencer/paid-media 三子域 CRUD |
| `apps/electron/src/main/lib/marketing/marketing-sqlite-store.ts` | **Marketing SQLite Store** — 营销领域包 SQLite 数据层（sql.js），三子域：creative（共享素材）+ influencer（达人）+ paid-media（广告投放）。表结构预留 tenant_id/user_id |
| `apps/electron/src/main/lib/marketing/ma-tools/` | ma-tools 的 upstream 版本（与 main 分支的 `lib/ma-tools/` 平行存在，含 `ma-tool-prompts.ts`） |
| `apps/electron/src/main/lib/marketing/ma-tools/ma-tool-prompts.ts` | **MA Tool Prompts** — 从各 ma-tool 的 `ChatToolMeta.systemPromptAppend` 抽取的指令集，作为插件贡献 prompts 的注入源 |

### 0.3 营销视频生成体系（Creative Video）—— upstream/main

| 文件路径 | 说明 |
|---------|------|
| `apps/electron/src/main/lib/marketing/creative-video-service.ts` | **Creative Video Service** — 视频生成服务（分镜→多镜生成→拼接成片），凭据优先从模型配置页渠道解析 |
| `apps/electron/src/main/lib/marketing/video/index.ts` | Video 模块导出 |
| `apps/electron/src/main/lib/marketing/video/storyboard-engine.ts` | **分镜引擎** — 纯本地生成，无需凭据 |
| `apps/electron/src/main/lib/marketing/video/frame-generator.ts` | 首帧图生成器（Proma Cloud GPT Image 2） |
| `apps/electron/src/main/lib/marketing/video/video-generation-service.ts` | 视频生成服务（Seedance/MiniMax H3） |
| `apps/electron/src/main/lib/marketing/video/video-generation-service.test.ts` | 视频生成服务测试 |
| `apps/electron/src/main/lib/marketing/video/video-composition-service.ts` | 视频拼接服务 |
| `apps/electron/src/main/lib/marketing/video/video-pipeline-orchestrator.ts` | **视频流水线编排器** |
| `apps/electron/src/main/lib/marketing/video/video-credential-resolver.ts` | **视频凭据解析器** — 渠道（模型配置页）优先，环境变量兜底 |
| `apps/electron/src/main/lib/marketing/video/video-credential-resolver.test.ts` | 凭据解析器测试 |

### 0.4 营销默认工具目录（Default Tools）—— upstream/main

> 将 ma-tools 以 `tool.json + execute.ts` 的目录化格式定义，供 `directory-tool-execution` 和 `bundled-marketing-executors` 消费。

| 文件路径 | 说明 |
|---------|------|
| `apps/electron/default-tools/marketing/manifest.json` | 营销工具目录 manifest |
| `apps/electron/default-tools/marketing/system_config.json` | 系统配置 |
| `apps/electron/default-tools/marketing/TOOLS.md` | 工具目录说明 |
| `apps/electron/default-tools/marketing/workflows/marketing-campaign.json` | **营销 Campaign 全流程工作流模板**（15 步 PAA DAG） |

**influencer 子域（8 个工具）：**

| 文件路径 | 说明 |
|---------|------|
| `apps/electron/default-tools/marketing/influencer/connect-bot/tool.json` + `execute.ts` | 智能建联 |
| `apps/electron/default-tools/marketing/influencer/content-audit/tool.json` + `execute.ts` | 内容审核 |
| `apps/electron/default-tools/marketing/influencer/creative-pilot/tool.json` + `execute.ts` | 创意指导 |
| `apps/electron/default-tools/marketing/influencer/kol-crm/tool.json` + `execute.ts` | 达人 CRM |
| `apps/electron/default-tools/marketing/influencer/kol-portal/tool.json` + `execute.ts` | 达人端自助 |
| `apps/electron/default-tools/marketing/influencer/kol-search/tool.json` + `execute.ts` | KOL 搜索 |
| `apps/electron/default-tools/marketing/influencer/match-ai/tool.json` + `execute.ts` | KOL 匹配 |
| `apps/electron/default-tools/marketing/influencer/script-studio/tool.json` + `execute.ts` | 脚本工坊 |

**paid-media 子域（15 个工具）：**

| 文件路径 | 说明 |
|---------|------|
| `apps/electron/default-tools/marketing/paid-media/budget-forecast/tool.json` + `execute.ts` | 预算预估 |
| `apps/electron/default-tools/marketing/paid-media/campaign-agent/tool.json` + `execute.ts` | Campaign 管理 |
| `apps/electron/default-tools/marketing/paid-media/campaign-audit/tool.json` + `execute.ts` | Campaign 审核 |
| `apps/electron/default-tools/marketing/paid-media/campaign-brief-get/tool.json` + `execute.ts` | 获取 Brief |
| `apps/electron/default-tools/marketing/paid-media/campaign-brief-update/tool.json` + `execute.ts` | 更新 Brief |
| `apps/electron/default-tools/marketing/paid-media/campaign-kol-add/tool.json` + `execute.ts` | 添加 KOL |
| `apps/electron/default-tools/marketing/paid-media/campaign-kol-list/tool.json` + `execute.ts` | KOL 列表 |
| `apps/electron/default-tools/marketing/paid-media/campaign-kol-status/tool.json` + `execute.ts` | KOL 状态 |
| `apps/electron/default-tools/marketing/paid-media/campaign-optimizer/tool.json` + `execute.ts` | 投放优化 |
| `apps/electron/default-tools/marketing/paid-media/campaign-tester/tool.json` + `execute.ts` | 投放测试 |
| `apps/electron/default-tools/marketing/paid-media/campaign-update/tool.json` + `execute.ts` | 更新 Campaign |
| `apps/electron/default-tools/marketing/paid-media/content-benchmarks/tool.json` + `execute.ts` | 内容基准 |
| `apps/electron/default-tools/marketing/paid-media/content-performance/tool.json` + `execute.ts` | 内容表现分析 |
| `apps/electron/default-tools/marketing/paid-media/content-tracking/tool.json` + `execute.ts` | 内容追踪 |
| `apps/electron/default-tools/marketing/paid-media/ma-phase-reviewer/tool.json` + `execute.ts` | 阶段复盘 |
| `apps/electron/default-tools/marketing/paid-media/strategy-iq/tool.json` + `execute.ts` | 策略生成 |
| `apps/electron/default-tools/marketing/paid-media/traffic-strategy/tool.json` + `execute.ts` | **流量加热策略**（薯条/评论区/DOU+） |

**shared 子域（1 个工具）：**

| 文件路径 | 说明 |
|---------|------|
| `apps/electron/default-tools/marketing/shared/storyboard/tool.json` + `execute.ts` | **分镜生成**（共享素材能力） |

### 0.5 营销默认代理（Default Agent）—— upstream/main

| 文件路径 | 说明 |
|---------|------|
| `apps/electron/default-agents/marketing-campaign/AGENTS.md` | **营销 Campaign 子代理** — 资深社交营销项目经理人设，含 Phase 1 需求确认工作流 |
| `apps/electron/default-agents/marketing-campaign/system_config.json` | 代理系统配置 |

### 0.6 营销工具评测基准（Benchmark）—— upstream/main

| 文件路径 | 说明 |
|---------|------|
| `apps/electron/src/main/lib/agent-runtime/eval/benchmarks/marketing-toolset/benchmark.json` | 营销工具集评测基准定义 |
| `apps/electron/src/main/lib/agent-runtime/eval/benchmarks/marketing-toolset/cases/CASE-001-tool-selection/` | 工具选择评测用例 |
| `apps/electron/src/main/lib/agent-runtime/eval/benchmarks/marketing-toolset/cases/CASE-002-parameter-usage/` | 参数使用评测用例 |
| `apps/electron/src/main/lib/agent-runtime/eval/benchmarks/marketing-toolset/cases/CASE-003-error-handling/` | 错误处理评测用例 |

### 0.7 营销 UI 组件（upstream 独有）

| 文件路径 | 说明 |
|---------|------|
| `apps/electron/src/renderer/components/marketing/CapabilitiesView.tsx` | **应用中心/领域工作台视图** — 展示已订阅的领域能力包 |
| `apps/electron/src/renderer/components/marketing/CreativeVideoPanel.tsx` | **创意视频面板** — 视频生成交互界面 |
| `apps/electron/src/renderer/components/settings/CapabilityCenterPanel.tsx` | **能力中心/订阅面板** — 订阅/取消订阅 influencer / paid-media |
| `apps/electron/src/renderer/atoms/marketing-atoms.ts` | **营销状态原子** — CapabilityId/CapabilityMeta/订阅状态管理 |

### 0.8 营销内置执行器注册

| 文件路径 | 说明 |
|---------|------|
| `apps/electron/src/main/lib/bundled-marketing-executors.ts` | **内置营销执行器注册表** — 25 个工具的惰性加载 require 映射 |

### 0.9 营销规划与笔记文档（upstream 独有 .context/）

| 文件路径 | 说明 |
|---------|------|
| `.context/plan/marketing-plugin-统一接入.md` | **营销工具统一接入 plugin-manager 方案**（试点 content-audit + creative-video） |
| `.context/plan/ma-marketing-template-install.md` | MA 营销模板安装方案 |
| `.context/plan/computer-use-pluginization.md` | Computer Use 插件化方案（参照样板） |
| `.context/todo-marketing-plugin.md` | 营销插件 todo |
| `.context/todo-marketing-subscription.md` | 营销订阅 todo |
| `.context/notes/ma-marketing-workflow-assets.md` | **MA 营销工作流资产索引** — 14 步流程 + PAA 模板 + 脚本清单 |
| `.context/notes/agent-runtime-capability-matrix.md` | Agent 运行时能力矩阵 |
| `.context/samples/test-plugin.manifest.json` | 测试插件 manifest 示例 |
| `.context/skills/ma-video-creative/SKILL.md` | **MA Video Creative Skill** — 共享素材视频生成 Agent 入口（v1.1.0） |

---

## 一、总览架构

MAPro 的营销能力分为 **四层**：

```
┌─────────────────────────────────────────────────────┐
│  Layer 1: Skills（AI 编排层，SKILL.md 定义工作流）     │
│  26 个 ma-* skill，覆盖策略→筛选→触达→审核→追踪全流程   │
├─────────────────────────────────────────────────────┤
│  Layer 2: Chat Tools（可执行代码，TS）                 │
│  21 个 ma-tools，注册为 Chat 内置工具，直接调 LLM/DB   │
├─────────────────────────────────────────────────────┤
│  Layer 3: Campaign 服务（数据持久化 + 工作流）          │
│  campaign-manager / campaign-workflow-service /      │
│  content-audit-service / kol-database-repository     │
├─────────────────────────────────────────────────────┤
│  Layer 4: UI 组件（React 前端）                       │
│  Campaign 管理界面 / KOL 数据管理 / 内容审核对话框      │
│  / 内容追踪 / 创意评估雷达图等                         │
└─────────────────────────────────────────────────────┘
```

---

## 二、Skills 层（26 个 ma-* skill）

### 2.1 核心编排 Skill

| 文件路径 | 说明 |
|---------|------|
| `apps/electron/default-skills/ma-marketing/SKILL.md` | **Flow 复楼** 总纲，整合策略生成、KOL匹配、智能建联、创意指导四大能力 |

### 2.2 策略与品牌类 Skills（9 个）

| 文件路径 | 说明 |
|---------|------|
| `apps/electron/default-skills/ma-brand-dna/SKILL.md` | 品牌 DNA 提取（核心价值/品牌人格/产品定位） |
| `apps/electron/default-skills/ma-brand-house/SKILL.md` | 品牌屋结构化生成（愿景/使命/价值观/品牌金字塔） |
| `apps/electron/default-skills/ma-market-analysis/SKILL.md` | 市场分析（规模/趋势/痛点） |
| `apps/electron/default-skills/ma-competitor-analyzer/SKILL.md` | 竞品社媒诊断与竞争情报 |
| `apps/electron/default-skills/ma-consumer-insight/SKILL.md` | 消费者洞察提炼（Observation→Insight→Tension→Entry Point） |
| `apps/electron/default-skills/ma-ta-portrait/SKILL.md` | 目标受众（TA）画像构建 |
| `apps/electron/default-skills/ma-creative-concept/SKILL.md` | 创意概念与 Big Idea 生成（含 DDB ROI 评估） |
| `apps/electron/default-skills/ma-creative-roi/SKILL.md` | 创意 ROI 评估（DDB ROI + 李奥贝纳 Inherent Drama） |
| `apps/electron/default-skills/ma-tone-manner/SKILL.md` | 品牌语气调性定义 |

### 2.3 平台与内容规划 Skills（4 个）

| 文件路径 | 说明 |
|---------|------|
| `apps/electron/default-skills/ma-platform-role-mapper/SKILL.md` | 平台角色定位与策略分配 |
| `apps/electron/default-skills/ma-content-calendar/SKILL.md` | 跨平台内容日历规划 |
| `apps/electron/default-skills/ma-paid-media/SKILL.md` | 付费媒体投放策略 |
| `apps/electron/default-skills/ma-ugc-campaign/SKILL.md` | UGC 互动营销活动设计 |

### 2.4 达人筛选与数据 Skills（6 个）⭐核心

| 文件路径 | 说明 |
|---------|------|
| `apps/electron/default-skills/ma-kol-scraper/SKILL.md` | **蒲公英 KOL 采集 + 8 阶段筛选流水线 + 互暖排查**（v2.6） |
| `apps/electron/default-skills/ma-kol-scraper/references/pipeline.md` | 完整流水线细节（筛选条件/打分/易错点/38列表头/命令示例） |
| `apps/electron/default-skills/ma-kol-scraper/references/koc_detect_guide.md` | 互暖排查手册（评分逻辑/数据schema/分步命令） |
| `apps/electron/default-skills/ma-kol-scraper/references/payload.md` | 搜索 API payload 参考 |
| `apps/electron/default-skills/ma-kol-scraper/references/collect_maternal_kol.py` | 历史参考脚本（勿再使用） |
| `apps/electron/default-skills/ma-kol-scraper/references/scraper_template.py` | 历史参考脚本（勿再使用） |
| `apps/electron/default-skills/ma-kol-scraper/blacklist.json` | 互暖黑名单·出厂默认基线（17 个已实锤互暖号） |
| `apps/electron/default-skills/ma-kol-scraper/screening_rules.json` | LLM 校验规则配置 |
| `apps/electron/default-skills/ma-kol-pyramid/SKILL.md` | KOL 金字塔投放策略（头部/腰部/KOC 配比） |
| `apps/electron/default-skills/ma-kol-crm/SKILL.md` | 达人 CRM 管理（入会/标签/分层/价值评分） |
| `apps/electron/default-skills/ma-kol-portal/SKILL.md` | 达人端自助服务（资料/内容指导/效果看板） |
| `apps/electron/default-skills/ma-kol-history-review/SKILL.md` | 达人历史内容审阅与履约评估 |

### 2.5 达人触达/建联 Skills（1 个）⭐核心

| 文件路径 | 说明 |
|---------|------|
| `apps/electron/default-skills/ma-pgy-invite/SKILL.md` | **蒲公英博主笔记合作邀约自动化** + 邀约回复跟踪（提取感兴趣博主微信号） |

### 2.6 内容审核与追踪 Skills（5 个）⭐核心

| 文件路径 | 说明 |
|---------|------|
| `apps/electron/default-skills/ma-draft-review/SKILL.md` | **达人稿件三态审核**（红卡/黄卡/绿卡），飞书群机器人自动审稿 |
| `apps/electron/default-skills/ma-content-audit/SKILL.md` | **达人内容三维审核**（合规/品牌契合/质量），输出 severity 分级 |
| `apps/electron/default-skills/ma-image-audit/SKILL.md` | **达人稿件图片审核**（Kimi 视觉模型），三图结构/品牌露出/构图 |
| `apps/electron/default-skills/ma-script-studio/SKILL.md` | 脚本工坊（故事脚本/分镜/视频拍摄指导） |
| `apps/electron/default-skills/ma-publish-data-track/SKILL.md` | **达人发布数据追踪**（发布台账/报数对号/CDP 爬虫查数/异常预警） |

### 2.7 投放优化与测试 Skills（3 个）

| 文件路径 | 说明 |
|---------|------|
| `apps/electron/default-skills/ma-campaign-tester/SKILL.md` | 小规模投放 A/B 测试方案设计 |
| `apps/electron/default-skills/ma-campaign-optimizer/SKILL.md` | 投放优化与正式方案生成 |
| `apps/electron/default-skills/ma-campaign-optimizer/SKILL.md` | （同上） |

### 2.8 营销参考文档

| 文件路径 | 说明 |
|---------|------|
| `apps/electron/default-skills/ma-marketing/references/industry-guide.md` | 行业指南 |
| `apps/electron/default-skills/ma-marketing/references/platform-guide.md` | 平台指南 |

---

## 三、Chat Tools 层（21 个 ma-tools，TypeScript）

### 3.1 核心服务

| 文件路径 | 说明 |
|---------|------|
| `apps/electron/src/main/lib/ma-tools/index.ts` | 统一导出（所有工具的注册入口） |
| `apps/electron/src/main/lib/ma-tools/llm-service.ts` | LLM 调用服务（所有工具的底座） |

### 3.2 策略与创意工具

| 文件路径 | 说明 |
|---------|------|
| `apps/electron/src/main/lib/ma-tools/strategy-iq.ts` | StrategyIQ — 策略生成（平台矩阵/KOL策略/内容规划/KPI） |
| `apps/electron/src/main/lib/ma-tools/creative-pilot.ts` | CreativePilot — 创意内容指导（Brief/脚本/合规审核） |
| `apps/electron/src/main/lib/ma-tools/script-studio.ts` | ScriptStudio — 脚本工坊 |
| `apps/electron/src/main/lib/ma-tools/campaign-optimizer.ts` | CampaignOptimizer — 投放优化 |
| `apps/electron/src/main/lib/ma-tools/campaign-tester.ts` | CampaignTester — A/B 测试设计 |
| `apps/electron/src/main/lib/ma-tools/budget-forecast.ts` | BudgetForecast — 预算预估（五步法） |

### 3.3 达人筛选与数据工具 ⭐核心

| 文件路径 | 说明 |
|---------|------|
| `apps/electron/src/main/lib/ma-tools/kol-data-service.ts` | **KOL 数据服务**（SQLite 存储 + 外部 API 拉取，1344 行） |
| `apps/electron/src/main/lib/ma-tools/kol-search.ts` | **KOL 搜索工具**（本地搜索/外部采集/Mock 填充） |
| `apps/electron/src/main/lib/ma-tools/match-ai.ts` | **MatchAI — KOL 智能匹配**（多维度筛选+匹配度评分+风险预警） |
| `apps/electron/src/main/lib/ma-tools/kol-crm.ts` | **KOL CRM 管理**（入会/标签/分层/价值评分，762 行） |
| `apps/electron/src/main/lib/ma-tools/kol-portal.ts` | **KOL Portal — 达人端自助服务**（844 行） |
| `apps/electron/src/main/lib/ma-tools/kol-data-mcp.ts` | KOL Data MCP Server 注入 |
| `apps/electron/src/main/lib/ma-tools/kol-data-mcp-tool.ts` | KOL Data MCP 工具元数据注册 |

### 3.4 达人触达/建联工具 ⭐核心

| 文件路径 | 说明 |
|---------|------|
| `apps/electron/src/main/lib/ma-tools/connect-bot.ts` | **ConnectBot — 智能建联**（邀约话术/谈判策略/合同模板） |

### 3.5 内容审核与追踪工具 ⭐核心

| 文件路径 | 说明 |
|---------|------|
| `apps/electron/src/main/lib/ma-tools/content-audit.ts` | **ContentAudit — 内容三维审核**（合规/品牌契合/质量） |
| `apps/electron/src/main/lib/ma-tools/content-tracker.ts` | **ContentTracker — 内容数据追踪**（自然流分析/性能等级/投流建议） |
| `apps/electron/src/main/lib/ma-tools/ma-phase-reviewer.ts` | PhaseReviewer — 阶段复盘报告生成 |

### 3.6 Campaign 管理工具

| 文件路径 | 说明 |
|---------|------|
| `apps/electron/src/main/lib/ma-tools/campaign-agent.ts` | CampaignAgent — Campaign 管理（详情/Brief/KOL池/审核触发） |

### 3.7 知识库数据

| 文件路径 | 说明 |
|---------|------|
| `apps/electron/src/main/lib/ma-tools/knowledge/industry-templates.json` | 行业模板 |
| `apps/electron/src/main/lib/ma-tools/knowledge/case-playbooks.json` | 案例 Playbook |
| `apps/electron/src/main/lib/ma-tools/knowledge/platform-guidelines.json` | 平台规范指南 |

---

## 四、Campaign 服务层（数据持久化 + 工作流）

### 4.1 Electron 主进程服务

| 文件路径 | 说明 |
|---------|------|
| `apps/electron/src/main/lib/campaign-manager.ts` | **Campaign 数据服务**（SQLite，Campaign/KOL池/Brief/内容审核/追踪） |
| `apps/electron/src/main/lib/campaign-workflow-service.ts` | **Campaign 工作流服务**（15 步标准工作流，管理产物目录） |
| `apps/electron/src/main/lib/draft-review-csv-viz.ts` | 审核反馈 CSV 可视化 |

### 4.2 Server 包服务（packages/server）

| 文件路径 | 说明 |
|---------|------|
| `packages/server/src/campaign/campaign-repository.ts` | Campaign 数据访问层 |
| `packages/server/src/campaign/campaign-command-service.ts` | Campaign 写操作服务 |
| `packages/server/src/campaign/campaign-query-service.ts` | Campaign 读操作服务 |
| `packages/server/src/campaign/campaign-workflow-service.ts` | Campaign 工作流（Server 版） |
| `packages/server/src/campaign/campaign-artifact-validator.ts` | Campaign 产物校验器 |
| `packages/server/src/campaign/content-audit-service.ts` | **内容审核服务**（奥格威五维评分框架） |
| `packages/server/src/campaign/index.ts` | Campaign 模块导出 |
| `packages/server/src/kol/kol-database-repository.ts` | **KOL 数据库访问层**（DbProvider 抽象） |
| `packages/server/src/kol/index.ts` | KOL 模块导出 |

### 4.3 共享类型定义

| 文件路径 | 说明 |
|---------|------|
| `packages/shared/src/types/campaign.ts` | Campaign 核心类型（Campaign/CampaignPhasePlan/CampaignCreativePlan/KOLListItem 等） |
| `packages/shared/src/utils/campaign-prompt.ts` | Campaign Prompt 构建工具 |

---

## 五、UI 组件层（React 前端）

### 5.1 Electron Renderer — Campaign/达人相关组件

| 文件路径 | 说明 |
|---------|------|
| `apps/electron/src/renderer/components/agent/CampaignBriefDialog.tsx` | Campaign Brief 对话框 |
| `apps/electron/src/renderer/components/agent/CampaignCreateDialog.tsx` | Campaign 创建对话框 |
| `apps/electron/src/renderer/components/agent/CampaignDetail.tsx` | Campaign 详情页 |
| `apps/electron/src/renderer/components/agent/CampaignKOLImportDialog.tsx` | KOL 导入对话框 |
| `apps/electron/src/renderer/components/agent/CampaignList.tsx` | Campaign 列表 |
| `apps/electron/src/renderer/components/agent/CampaignWorkflowSteps.tsx` | Campaign 工作流步骤 |
| `apps/electron/src/renderer/components/agent/ContentAuditDialog.tsx` | **内容审核对话框** |
| `apps/electron/src/renderer/components/agent/ContentTrackingManager.tsx` | **内容追踪管理器** |
| `apps/electron/src/renderer/components/agent/KOLDataManager.tsx` | **KOL 数据管理器** |
| `apps/electron/src/renderer/components/agent/PhaseReviewPanel.tsx` | 阶段复盘面板 |
| `apps/electron/src/renderer/components/agent/ABTestPanel.tsx` | A/B 测试面板 |
| `apps/electron/src/renderer/components/campaign/AuditScoreRadar.tsx` | **审核评分雷达图** |
| `apps/electron/src/renderer/components/campaign/ContentAuditReportCard.tsx` | **内容审核报告卡片** |
| `apps/electron/src/renderer/components/campaign/index.ts` | Campaign 组件导出 |
| `apps/electron/src/renderer/atoms/campaign-atoms.ts` | Campaign 状态原子（Jotai） |

### 5.2 Web UI — Campaign/达人相关组件

| 文件路径 | 说明 |
|---------|------|
| `apps/web-ui/src/components/CampaignBasicInfo.tsx` | Campaign 基本信息 |
| `apps/web-ui/src/components/CampaignBriefDialog.tsx` | Campaign Brief 对话框 |
| `apps/web-ui/src/components/CampaignCard.tsx` | Campaign 卡片 |
| `apps/web-ui/src/components/CampaignPhasePlans.tsx` | Campaign 阶段计划 |
| `apps/web-ui/src/components/CampaignWorkflowSteps.tsx` | Campaign 工作流步骤 |
| `apps/web-ui/src/components/ContentAuditDialog.tsx` | **内容审核对话框** |
| `apps/web-ui/src/components/ContentAuditList.tsx` | **内容审核列表** |
| `apps/web-ui/src/components/BatchContentAuditDialog.tsx` | **批量内容审核对话框** |
| `apps/web-ui/src/components/ContentTrackingDialogs.tsx` | **内容追踪对话框** |
| `apps/web-ui/src/components/ContentTrackingList.tsx` | **内容追踪列表** |
| `apps/web-ui/src/components/KOLPoolList.tsx` | **KOL 候选池列表** |
| `apps/web-ui/src/components/KOLSelector.tsx` | **KOL 选择器** |
| `apps/web-ui/src/components/CreateCampaignDialog.tsx` | 创建 Campaign 对话框 |
| `apps/web-ui/src/pages/CampaignDetailPage.tsx` | Campaign 详情页 |
| `apps/web-ui/src/pages/CampaignListPage.tsx` | Campaign 列表页 |
| `apps/web-ui/src/hooks/use-campaign-data.ts` | Campaign 数据 Hook |
| `apps/web-ui/src/store/campaign-atoms.ts` | Campaign 状态（Jotai） |
| `apps/web-ui/src/store/campaign-detail-atoms.ts` | Campaign 详情状态 |

### 5.3 Web 路由 — Campaign API

| 文件路径 | 说明 |
|---------|------|
| `apps/web/src/routes/campaign.ts` | Campaign REST API 路由 |
| `apps/web/src/routes/campaign-artifacts.test.ts` | Campaign 产物测试 |
| `apps/web/src/routes/campaign-consistency.test.ts` | Campaign 一致性测试 |
| `apps/web/src/routes/campaign-isolation.test.ts` | Campaign 隔离测试 |
| `apps/web/src/routes/campaign-workflow.e2e.test.ts` | Campaign 工作流 E2E 测试 |

---

## 六、Python 脚本（达人采集/筛选/触达/审核/追踪）

### 6.1 达人采集与筛选脚本（ma-kol-scraper）

| 文件路径 | 说明 |
|---------|------|
| `apps/electron/default-skills/ma-kol-scraper/scripts/kol_collector.py` | **通用采集器**（CDP + 蒲公英 API，v2.3） |
| `apps/electron/default-skills/ma-kol-scraper/scripts/kol_screening.py` | LLM 圈选校验引擎 |
| `apps/electron/default-skills/ma-kol-scraper/scripts/screen_v2.py` | 阶段2 初筛（女性占比/篇数/交叉验证/粉丝地域/报价） |
| `apps/electron/default-skills/ma-kol-scraper/scripts/filter_interact.py` | 阶段3 删合作互动中位数<100 |
| `apps/electron/default-skills/ma-kol-scraper/scripts/filter_health.py` | 阶段3 健康筛选（点赞率 1.6%~12%） |
| `apps/electron/default-skills/ma-kol-scraper/scripts/split_coop.py` | 生成合作≥1 子集 |
| `apps/electron/default-skills/ma-kol-scraper/scripts/top8_extractor.py` | 阶段4 top-8 采集（曝光/点赞/标题/正文） |
| `apps/electron/default-skills/ma-kol-scraper/scripts/estimate_cpe_cpm.py` | 阶段5 沪杭复核 + Tweedie 估算 CPM/CPE |
| `apps/electron/default-skills/ma-kol-scraper/scripts/split_zero.py` | 阶段6 拆分合作0/非0 |
| `apps/electron/default-skills/ma-kol-scraper/scripts/add_ratio_cols.py` | 加阅读与点赞占比/赞评比列 |
| `apps/electron/default-skills/ma-kol-scraper/scripts/filter_cpe.py` | 阶段7 CPE 硬性过滤（>50 淘汰） |
| `apps/electron/default-skills/ma-kol-scraper/scripts/score_kols.py` | 阶段8 4 维度打分（CPE/点赞率/赞评比/爆文率） |
| `apps/electron/default-skills/ma-kol-scraper/scripts/clean_final.py` | 阶段8 清洗（删非美食/果切） |

### 6.2 互暖排查脚本（ma-kol-scraper 阶段9）

| 文件路径 | 说明 |
|---------|------|
| `apps/electron/default-skills/ma-kol-scraper/scripts/collect_creator_xhs.py` | 小红书站内采集（CDP 登录态 + xhshow 签名 → JSONL） |
| `apps/electron/default-skills/ma-kol-scraper/scripts/koc_detect.py` | 互暖检测（三层评分 + 红线条） |
| `apps/electron/default-skills/ma-kol-scraper/scripts/mutual_warm_pipeline.py` | 互暖排查编排（读CSV→采集→检测→合并结果） |

### 6.3 达人触达/邀约脚本（ma-pgy-invite）

| 文件路径 | 说明 |
|---------|------|
| `apps/electron/default-skills/ma-pgy-invite/scripts/invite_blogger.py` | **蒲公英博主邀约自动化**（搜索→详情→邀约弹窗→填表→提交） |
| `apps/electron/default-skills/ma-pgy-invite/scripts/extract_invite_wechat.py` | **提取感兴趣博主微信号**（从邀约列表筛选+解密） |

### 6.4 内容审核辅助脚本（ma-draft-review）

| 文件路径 | 说明 |
|---------|------|
| `apps/electron/default-skills/ma-draft-review/scripts/fetch_feishu_fast.py` | **飞书文档快速抓取**（MutationObserver + 双程滚动，5 秒/份） |
| `apps/electron/default-skills/ma-draft-review/scripts/kol_collector.py` | 通用采集器（审核用 CDP 检查 + 图片提取） |

### 6.5 发布数据追踪脚本（ma-publish-data-track）

| 文件路径 | 说明 |
|---------|------|
| `apps/electron/default-skills/ma-publish-data-track/references/note_data_fetcher.py` | 按 noteId 抓取单条笔记数据（曝光/阅读/点赞/收藏/评论） |

---

## 七、MCP Server

| 文件路径 | 说明 |
|---------|------|
| `apps/electron/mcp-servers/ma-kol/mcp_server.py` | **MA KOL MCP Server**（stdio 传输，为 Agent 提供 KOL 筛选与营销能力） |
| `apps/electron/mcp-servers/ma-kol/README.md` | MCP Server 说明文档 |

---

## 八、测试文件

| 文件路径 | 说明 |
|---------|------|
| `apps/electron/src/main/lib/__tests__/campaign-integration.test.ts` | Campaign 集成测试 |
| `apps/electron/src/main/lib/__tests__/campaign-workflow.test.ts` | Campaign 工作流测试 |
| `apps/electron/src/main/lib/__tests__/campaign-workflow-e2e.test.ts` | Campaign 工作流 E2E 测试 |
| `apps/electron/src/main/lib/__tests__/campaign-node-test.js` | Campaign 节点测试 |
| `apps/electron/src/main/lib/__tests__/mocks/kol-data-service-mock.ts` | KOL 数据服务 Mock |
| `apps/electron/src/main/lib/draft-review-csv-viz.test.ts` | 审核 CSV 可视化测试 |
| `packages/server/src/campaign/campaign-workflow-service.test.ts` | Campaign 工作流服务测试 |
| `packages/server/src/campaign/content-audit-service.test.ts` | 内容审核服务测试 |
| `packages/server/src/kol/kol-database-repository.test.ts` | KOL 数据库访问层测试 |
| `apps/web-ui/src/components/ContentAuditDialog.test.tsx` | 内容审核对话框测试 |
| `apps/web-ui/src/components/ContentAuditList.test.tsx` | 内容审核列表测试 |
| `apps/web-ui/src/components/BatchContentAuditDialog.test.tsx` | 批量审核对话框测试 |
| `apps/web-ui/src/components/KOLPoolList.test.tsx` | KOL 池列表测试 |
| `apps/web-ui/src/components/KOLSelector.test.tsx` | KOL 选择器测试 |
| `apps/web-ui/src/components/CampaignWorkflowSteps.test.tsx` | 工作流步骤测试 |
| `apps/web-ui/src/components/CampaignBriefDialog.test.tsx` | Brief 对话框测试 |
| `apps/web-ui/src/components/ContentTrackingDialogs.test.tsx` | 追踪对话框测试 |
| `apps/web-ui/src/components/ContentTrackingList.test.tsx` | 追踪列表测试 |
| `apps/web-ui/src/store/campaign-detail-atoms.test.ts` | Campaign 详情状态测试 |
| `apps/web/src/routes/campaign-artifacts.test.ts` | Campaign 产物路由测试 |
| `apps/web/src/routes/campaign-consistency.test.ts` | Campaign 一致性路由测试 |
| `apps/web/src/routes/campaign-isolation.test.ts` | Campaign 隔离路由测试 |
| `apps/web/src/routes/campaign-workflow.e2e.test.ts` | Campaign 工作流 E2E 路由测试 |
| `scripts/test-campaign-agent.cjs` | Campaign Agent 测试脚本 |
| `scripts/smoke-test.ts` | 冒烟测试（含 Campaign 相关） |

---

## 九、规划与笔记文档（.context/）

| 文件路径 | 说明 |
|---------|------|
| `.context/plan/gravitas-marketing-module.md` | **营销能力包落地实施方案 v4**（达人包 influencer + 投放包 paid-media） |
| `.context/plan/daren-full-port.md` | **达人营销完整迁移计划**（26 skill + 21 ma-tools 分层推进） |
| `.context/todo-m0-marketing.md` | M0 营销里程碑 todo |
| `.context/todo-m1-marketing.md` | M1 营销里程碑 todo |
| `.context/todo-m2-marketing.md` | M2 营销里程碑 todo |
| `.context/todo-m3-marketing.md` | M3 营销里程碑 todo |
| `.context/todo-campaign-subsystem.md` | Campaign 子系统 todo |
| `.context/todo-daren-full-port.md` | 达人完整迁移 todo |
| `.context/note-daren-mapping.md` | 达人映射笔记 |
| `.context/note-达人圈选逻辑-T2-差距评估.md` | 达人圈选逻辑 T2 差距评估 |
| `.context/note-KOL最低曝光CPE数据错误修复.md` | KOL 最低曝光 CPE 数据错误修复 |
| `.context/note-KOL最低曝光CPE数据错误修复-交付.md` | KOL CPE 修复交付文档 |
| `.context/note-ad-delivery-eval.md` | 广告投放评估笔记 |
| `.context/note-campaign-artifact-fix-and-local-folder-20260809.md` | Campaign 产物修复与本地文件夹 |
| `.context/note-campaign-creative-eval-ogilvy-framework.md` | Campaign 创意评估（奥格威框架） |
| `.context/campaign-creative-eval-checklist.md` | Campaign 创意评估检查清单 |
| `.context/decision-maping-migration.md` | 映射迁移决策文档 |
| `.context/explore-server-store-standards.md` | Server 存储标准探索 |
| `.context/t2-test/` | T2 测试数据（scorecard/DB/采集结果 mock） |

---

## 十、文档（docs/）

| 文件路径 | 说明 |
|---------|------|
| `docs/ma-master-roadmap.md` | MA 总体路线图 |
| `docs/web-plan-chapter10-execution.md` | Web 计划第 10 章执行 |
| `docs/archive/kol-platform-capability-research.md` | KOL 平台能力调研（归档） |
| `docs/archive/ma-4a-workflow-review-plan.md` | MA 4A 工作流复盘计划（归档） |
| `docs/archive/ma-implementation-plan.md` | MA 实施方案（归档） |
| `docs/archive/ma-test-report.md` | MA 测试报告（归档） |
| `docs/archive/phase-review-design.md` | 阶段复盘设计（归档） |

---

## 十一、其他相关文件

| 文件路径 | 说明 |
|---------|------|
| `忘本水果店营销复盘-工作项拆解.md` | 营销复盘工作项拆解（实际案例） |
| `MAPro_产品说明书.docx` | 产品说明书（含营销功能） |
| `tutorial/tutorial.md` | 使用教程（含营销工作流） |
| `mapro-thinking/mapro-2026-q1-thinking.md` | 2026 Q1 产品思考 |

---

## 十二、文件数量统计

| 分类 | 文件数 |
|------|--------|
| Skills（SKILL.md + 参考文档 + 配置） | ~50+ |
| Chat Tools（TS 源码） | 21 |
| Campaign 服务（TS 源码） | 8 |
| UI 组件（TSX） | ~30+ |
| Python 脚本 | 22 |
| MCP Server | 2 |
| 测试文件 | ~25+ |
| 规划/笔记文档 | ~20+ |
| **main 分支合计** | **~180+ 文件** |
| **upstream 补充（插件/视频/数据层/UI）** | **~80+ 文件** |
| **全量总计** | **~260+ 文件** |
