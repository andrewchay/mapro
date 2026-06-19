# MAPro 广告营销公司 Agent 体系 — 实施规划

> 基于 MAPro 框架改造，构建垂直领域广告营销公司 Agent 系统

---

## 一、现状盘点：已有实现 vs 架构图

### 1.1 架构图核心模块

```
广告公司 → flow产品
├── 策略总监
│   ├── 品牌定位（用户分析、竞品调研、品牌三定位、品牌concept整合）
│   ├── 创意方案（创意big idea、品牌slogan、品牌视觉风格、品牌调性dos/don'ts、品牌屋）
│   └── 传播方案（三段式传播、分阶段主题及文案内容）
├── 媒介总监
│   ├── 达人筛选（真实互动画像匹配、核心数据指标匹配cpm/cpe、达人内容风格匹配、达人过往历史履约匹配）
│   ├── 达人组合（预算、效果(曝光/互动/转化)、小规模投放测试1/10预算阈值、测试后调优组合）
│   └── 投流助推
├── 商务助理
│   ├── 建联
│   └── 合作商务（内容、费用、返佣）
├── 内容总监
│   ├── 品牌内容结合输出（故事脚本、分镜脚本、指导视频）
│   ├── 达人历史内容审阅
│   └── 达人内容审核
└── 达人端（右侧）
    ├── 用户入会信息（基本信息、注册、赛道(曝光/带货)、标签体系、接单响应度）
    ├── 用户内容指导（辅助剪辑、图文生成）
    ├── 用户效果记录（配合度、执行效果(类目/曝光/互动/转化)）
    └── 用户平台分层（忠诚用户、回流用户、流失用户）
```

### 1.2 已有实现映射

| 架构图模块 | 已有实现 | 完成度 |
|-----------|---------|--------|
| **策略总监-品牌定位** | `ma-brand-dna`, `ma-ta-portrait`, `ma-competitor-analyzer` | ✅ 80% |
| **策略总监-创意方案** | `ma-creative-concept`, `ma-tone-manner` | ✅ 70% |
| **策略总监-传播方案** | `ma-platform-role-mapper`, `ma-content-calendar`, `ma-ugc-campaign`, `strategy-iq` | ✅ 75% |
| **媒介总监-达人筛选** | `match-ai`, `kol-search`, `kol-data-service`, `ma-kol-pyramid` | ✅ 85% |
| **媒介总监-达人组合** | `ma-kol-pyramid`（预算分配+配比） | ⚠️ 50% |
| **媒介总监-投流助推** | `ma-paid-media` | ⚠️ 40% |
| **商务助理-建联** | `connect-bot` | ✅ 80% |
| **商务助理-合作商务** | `connect-bot`（话术+谈判） | ⚠️ 50% |
| **内容总监-品牌内容输出** | `creative-pilot` | ⚠️ 60% |
| **内容总监-达人审阅/审核** | ❌ 无 | 🔴 0% |
| **达人端-入会信息** | ❌ 无 | 🔴 0% |
| **达人端-内容指导** | `creative-pilot`（Brief生成） | ⚠️ 40% |
| **达人端-效果记录** | ❌ 无 | 🔴 0% |
| **达人端-平台分层** | ❌ 无 | 🔴 0% |

### 1.3 核心技术资产

```
apps/electron/
├── default-skills/              # 11个MA Skill（Agent模式）
│   ├── ma-marketing/            # 主Skill — Flow复楼
│   ├── ma-brand-dna/            # 品牌DNA
│   ├── ma-creative-concept/     # 创意概念
│   ├── ma-tone-manner/          # 品牌调性
│   ├── ma-ta-portrait/          # TA画像
│   ├── ma-competitor-analyzer/  # 竞品分析
│   ├── ma-platform-role-mapper/ # 平台矩阵
│   ├── ma-kol-pyramid/          # KOL金字塔
│   ├── ma-content-calendar/     # 内容日历
│   ├── ma-ugc-campaign/         # UGC活动
│   └── ma-paid-media/           # 付费媒体
├── src/main/lib/ma-tools/       # 5个Chat Tool（Chat模式）
│   ├── strategy-iq.ts           # 策略生成
│   ├── match-ai.ts              # KOL匹配
│   ├── connect-bot.ts           # 智能建联
│   ├── creative-pilot.ts        # 创意指导
│   ├── kol-search.ts            # KOL搜索
│   ├── kol-data-service.ts      # SQLite KOL数据库
│   ├── kol-data-mcp.ts          # KOL Data MCP注入
│   ├── llm-service.ts           # LLM调用服务
│   └── knowledge/               # 知识库
│       ├── platform-guidelines.json
│       ├── industry-templates.json
│       └── case-playbooks.json
└── mcp-servers/ma-kol/            # Python MCP Server
    └── mcp_server.py            # KOL数据MCP工具
```

---

## 二、缺失模块识别（Gap Analysis）

### 2.1 高优先级缺失（核心业务流程阻断）

| # | 缺失模块 | 影响 | 建议实现方式 |
|---|---------|------|------------|
| 1 | **达人内容审核** | 内容总监无法完成审核闭环 | Chat Tool + Skill |
| 2 | **达人历史内容审阅** | 无法评估达人过往履约质量 | Chat Tool + 数据库扩展 |
| 3 | **小规模投放测试** | 媒介总监缺少A/B测试能力 | Chat Tool + 数据模型 |
| 4 | **测试后调优组合** | 无法基于数据优化达人组合 | Chat Tool + 算法模块 |
| 5 | **投流助推执行** | 付费媒体缺少执行层工具 | Chat Tool + MCP |
| 6 | **达人端CRM** | 右侧达人管理完全缺失 | 独立数据层 + UI |

### 2.2 中优先级缺失（体验优化）

| # | 缺失模块 | 影响 | 建议实现方式 |
|---|---------|------|------------|
| 7 | **故事脚本/分镜脚本生成** | 内容输出不够细化 | Skill + Chat Tool |
| 8 | **品牌屋可视化** | 品牌定位缺少结构化输出 | Skill + 模板 |
| 9 | **合作商务（费用/返佣管理）** | 商务流程不完整 | 数据模型 + Chat Tool |
| 10 | **达人平台分层（忠诚/回流/流失）** | 缺少用户生命周期管理 | 数据模型 + 分析工具 |

---

## 三、五大实施方向规划

### 方向1：架构设计文档 📐

**目标**：产出完整的系统设计文档，指导后续开发

**交付物**：
1. `docs/architecture/ma-system-design.md` — 系统架构总览
2. `docs/architecture/data-model.md` — 数据模型设计（ER图+字段定义）
3. `docs/architecture/api-contract.md` — 接口契约（Skill↔Tool↔MCP↔DB）
4. `docs/architecture/agent-workflow.md` — Agent协作流程图
5. `docs/architecture/module-roadmap.md` — 模块开发路线图

**关键设计决策**：
- 达人端CRM是否独立SQLite库还是复用KOL数据库？→ **建议：复用KOL数据库，新增`kol_crm`表**
- 投放测试数据存储？→ **建议：新增`campaign_test`表**
- 内容审核工作流？→ **建议：Skill驱动 + Chat Tool执行 + 状态机管理**

---

### 方向2：Skill 开发 🧠

**目标**：补齐缺失的Agent模式Skill模块

**新增Skill清单**：

| Skill名称 | 功能 | 触发关键词 | 优先级 |
|-----------|------|-----------|--------|
| `ma-content-audit` | 达人内容审核（合规/品牌/质量） | 内容审核、达人审核、合规检查 | P0 |
| `ma-kol-history-review` | 达人历史内容审阅与履约评估 | 历史审阅、履约评估、达人档案 | P0 |
| `ma-script-generator` | 故事脚本/分镜脚本/视频指导生成 | 脚本、分镜、视频指导、storyboard | P1 |
| `ma-brand-house` | 品牌屋结构化生成 | 品牌屋、brand house、品牌架构 | P1 |
| `ma-campaign-test` | 小规模投放测试设计 | 投放测试、A/B测试、小规模测试 | P0 |
| `ma-campaign-optimize` | 测试后调优组合 | 调优、优化组合、数据复盘 | P0 |
| `ma-kol-crm` | 达人CRM管理（右侧达人端） | 达人管理、CRM、达人分层 | P1 |

**Skill开发规范**（复用已有模式）：
```
default-skills/{skill-name}/
├── SKILL.md              # 主Skill定义（YAML frontmatter + Markdown）
└── references/           # 参考文档（可选）
    └── reference.md
```

---

### 方向3：代码实现 💻

**目标**：新增Chat Tool、扩展数据服务、完善MCP工具

#### 3.1 新增Chat Tool（Chat模式）

| Tool ID | 名称 | 功能 | 依赖 |
|---------|------|------|------|
| `ma-content-audit` | MA内容审核 | 审核达人提交内容（合规/品牌/质量） | llm-service |
| `ma-script-studio` | MA脚本工坊 | 生成故事脚本/分镜/视频指导 | llm-service + knowledge |
| `ma-campaign-tester` | MA投放测试 | 设计小规模A/B测试方案 | llm-service + kol-data-service |
| `ma-campaign-optimizer` | MA投放优化 | 基于测试数据优化达人组合 | llm-service + kol-data-service |
| `ma-kol-crm` | MA达人CRM | 达人入会/分层/效果记录管理 | kol-data-service（扩展） |

#### 3.2 数据服务扩展

**KOL数据库扩展表**：
```sql
-- 达人CRM表
CREATE TABLE kol_crm (
  kol_id TEXT PRIMARY KEY,
  onboarding_status TEXT,      -- 入会状态：pending/active/inactive
  track TEXT,                -- 赛道：exposure/带货
  tags TEXT,                 -- 标签JSON
  response_rate REAL,        -- 接单响应度
  loyalty_tier TEXT,         -- 忠诚分层：loyal/returning/churned
  last_contact_date TEXT,
  total_cooperations INTEGER,
  total_revenue REAL,
  notes TEXT
);

-- 投放测试表
CREATE TABLE campaign_tests (
  test_id TEXT PRIMARY KEY,
  campaign_id TEXT,
  test_name TEXT,
  budget REAL,
  kol_combo TEXT,            -- KOL组合JSON
  start_date TEXT,
  end_date TEXT,
  status TEXT,               -- planned/running/completed
  results TEXT,              -- 测试结果JSON
  optimization_notes TEXT
);

-- 内容审核记录表
CREATE TABLE content_audits (
  audit_id TEXT PRIMARY KEY,
  kol_id TEXT,
  content_url TEXT,
  platform TEXT,
  audit_status TEXT,         -- pending/pass/fail/revise
  compliance_score REAL,
  brand_alignment_score REAL,
  quality_score REAL,
  audit_report TEXT,
  auditor TEXT,              -- AI/human
  created_at TEXT
);

-- 达人效果记录表
CREATE TABLE kol_performance (
  record_id TEXT PRIMARY KEY,
  kol_id TEXT,
  campaign_id TEXT,
  platform TEXT,
  category TEXT,
  exposure INTEGER,
  engagement INTEGER,
  conversion INTEGER,
  cpm REAL,
  cpe REAL,
  roi REAL,
  cooperation_score REAL,    -- 配合度
  record_date TEXT
);
```

#### 3.3 MCP Server扩展

在 `mcp_server.py` 中新增工具：
- `audit_content` — 内容审核
- `record_performance` — 记录达人效果
- `get_kol_crm` — 获取达人CRM信息
- `update_kol_crm` — 更新达人CRM
- `create_campaign_test` — 创建投放测试
- `get_campaign_test_results` — 获取测试结果

---

### 方向4：Agent 工作流设计 🔄

**目标**：设计各角色之间的协作流程和调用链

#### 4.1 核心工作流

```
┌─────────────────────────────────────────────────────────────────┐
│                     广告营销公司 Agent 工作流                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  阶段1: 策略制定                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐           │
│  │ 品牌定位    │ → │ 创意方案    │ → │ 传播方案    │           │
│  │ ma-brand-dna│    │ ma-creative │    │ ma-platform │           │
│  │ ma-ta-port  │    │ ma-tone     │    │ ma-content  │           │
│  │ ma-competitor│   │ ma-concept  │    │ ma-ugc      │           │
│  └─────────────┘    └─────────────┘    └─────────────┘           │
│         ↓                                                        │
│  阶段2: 达人筛选与匹配                                            │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐           │
│  │ 达人筛选    │ → │ 达人组合    │ → │ 建联        │           │
│  │ match-ai    │    │ ma-kol-pyramid│  │ connect-bot │           │
│  │ kol-search  │    │ campaign-tester│ │             │           │
│  └─────────────┘    └─────────────┘    └─────────────┘           │
│         ↓                                                        │
│  阶段3: 内容生产与审核                                            │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐           │
│  │ 内容指导    │ → │ 内容产出    │ → │ 内容审核    │           │
│  │ creative-pilot│  │ script-studio│  │ content-audit│          │
│  │             │    │             │    │             │           │
│  └─────────────┘    └─────────────┘    └─────────────┘           │
│         ↓                                                        │
│  阶段4: 投放执行与优化                                            │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐           │
│  │ 小规模测试  │ → │ 数据复盘    │ → │ 调优投放    │           │
│  │ campaign-tester│  │ kol-history │    │ campaign-optimizer│     │
│  │             │    │ performance │    │ ma-paid-media │         │
│  └─────────────┘    └─────────────┘    └─────────────┘           │
│         ↓                                                        │
│  阶段5: 达人关系管理                                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐           │
│  │ 效果记录    │ → │ 达人分层    │ → │ 关系维护    │           │
│  │ performance │    │ kol-crm     │    │ connect-bot │           │
│  │             │    │             │    │             │           │
│  └─────────────┘    └─────────────┘    └─────────────┘           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### 4.2 角色协作规则

| 触发条件 | 主角色 | 协作角色 | 动作 |
|---------|--------|---------|------|
| 用户输入Brief | 策略总监 | — | 启动阶段1 |
| 策略生成完成 | 策略总监 | 媒介总监 | 传递目标受众+平台+预算 |
| 达人筛选完成 | 媒介总监 | 商务助理 | 传递达人列表+合作信息 |
| 建联成功 | 商务助理 | 内容总监 | 传递达人信息+品牌Brief |
| 内容产出完成 | 内容总监 | 内容总监(审核) | 启动内容审核 |
| 审核通过 | 内容总监 | 媒介总监 | 启动投放测试 |
| 测试完成 | 媒介总监 | 媒介总监 | 启动调优+正式投放 |
| 投放结束 | 媒介总监 | 达人CRM | 记录效果+更新分层 |

---

### 方向5：数据模型设计 🗄️

**目标**：设计完整的数据模型，支撑全链路业务流程

#### 5.1 核心实体关系

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│   Brand     │◄─────│  Campaign   │◄─────│ CampaignTest│
│   品牌       │ 1:N  │   营销活动   │ 1:N  │  投放测试    │
└─────────────┘       └──────┬──────┘       └─────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │ N:M                │ N:M                │ N:M
        ▼                    ▼                    ▼
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│    KOL      │◄─────│ KOLPerformance│      │ ContentAudit│
│   达人       │ 1:N  │  效果记录     │       │  内容审核   │
└──────┬──────┘       └─────────────┘       └─────────────┘
       │
       │ 1:1
       ▼
┌─────────────┐
│   KOL_CRM   │
│  达人CRM    │
└─────────────┘
```

#### 5.2 关键数据表设计

**已存在**：`kols` 表（KOL基础信息）

**需新增**：
1. `campaigns` — 营销活动主表
2. `campaign_kols` — 活动-KOL关联表
3. `campaign_tests` — 投放测试表
4. `kol_crm` — 达人CRM表
5. `kol_performance` — 达人效果记录表
6. `content_audits` — 内容审核记录表
7. `brand_profiles` — 品牌档案表
8. `creative_assets` — 创意资产表（脚本、Brief等）

#### 5.3 数据流设计

```
用户输入 → Agent解析 → Skill调用 → Tool执行 → 数据写入 → 结果返回
                ↓
         ┌──────┴──────┐
         ▼             ▼
    SQLite(本地)    JSON文件
    (KOL/CRM/效果)   (配置/缓存)
```

---

## 四、实施优先级与里程碑

### Phase 1：基础补齐（2-3周）
- [ ] 方向1：架构设计文档产出
- [ ] 方向3：新增6个Chat Tool（content-audit, script-studio, campaign-tester, campaign-optimizer, kol-crm, 扩展connect-bot商务功能）
- [ ] 方向3：KOL数据库扩展（新增4张表）
- [ ] 方向2：新增3个P0 Skill（ma-content-audit, ma-kol-history-review, ma-campaign-test）

### Phase 2：流程闭环（2-3周）
- [ ] 方向2：新增4个P1 Skill（ma-script-generator, ma-brand-house, ma-campaign-optimize, ma-kol-crm）
- [ ] 方向3：MCP Server扩展（新增6个工具）
- [ ] 方向4：Agent工作流编排（阶段1-4串联）
- [ ] 方向5：数据模型完善（品牌档案+创意资产表）

### Phase 3：达人端与优化（2-3周）
- [ ] 方向3：达人端CRM UI（右侧达人管理面板）
- [ ] 方向4：完整5阶段工作流自动化
- [ ] 方向5：效果数据分析与可视化
- [ ] 方向1：架构文档迭代更新

---

## 五、技术实现要点

### 5.1 复用模式

所有新增模块遵循已有代码模式：

**Chat Tool模式**（参考 `creative-pilot.ts`）：
```typescript
// 1. 定义 ToolMeta
export const TOOL_META: ChatToolMeta = { ... }

// 2. 定义 ToolDefinitions
export const TOOL_DEFINITIONS: ToolDefinition[] = [ ... ]

// 3. 可用性检查
export function isAvailable(): boolean { return true }

// 4. 执行函数
export async function executeTool(toolCall: ToolCall): Promise<ToolResult> { ... }

// 5. 在 index.ts 导出
// 6. 在 chat-tool-config.ts 注册默认状态
```

**Skill模式**（参考 `ma-creative-concept/SKILL.md`）：
```markdown
---
name: ma-{skill-name}
description: {功能描述}
version: "1.0.0"
---

# {Skill标题}

## 这个Skill做什么
...

## 何时使用
...

## 工作流
...

## 输出格式
...

## 规则
...
```

**MCP工具模式**（参考 `mcp_server.py`）：
```python
@mcp.tool(name="...", description="...")
def tool_name(param: type) -> str:
    """工具实现"""
    ...
```

### 5.2 数据库扩展模式

复用 `kol-data-service.ts` 的SQLite适配层：
- 开发模式（Bun）：`bun:sqlite`
- 生产模式（Electron）：`better-sqlite3`
- 统一Database类封装API差异

### 5.3 LLM调用模式

复用 `llm-service.ts`：
```typescript
import { completePrompt, extractJSON } from './llm-service'

const result = await completePrompt(userPrompt, systemPrompt, {
  jsonMode: true,
  temperature: 0.7,
  maxTokens: 6000,
})
```

---

## 六、风险与注意事项

1. **数据库迁移**：新增表需要兼容已有数据，提供迁移脚本
2. **MCP Server依赖**：Python MCP Server依赖外部`../ma`项目的`agent_core`模块，新增工具需同步更新
3. **Skill加载**：新增Skill需确认工作区自动加载机制
4. **工具注册**：新增Chat Tool需在`chat-tool-config.ts`中注册默认状态
5. **知识库更新**：新增平台/行业知识需同步更新JSON知识库

---

*文档版本: v1.0*
*基于 MAPro v0.9.12 + MA Marketing Agent v1.0.1*
