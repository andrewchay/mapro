# 阶段性数据复盘功能设计方案

## 1. 背景与目标

基于现有 Campaign 项目管理体系（`kol_content_tracking` 内容追踪 + `content_benchmarks` 基准数据 + 3 阶段投放计划），新增 **阶段性数据复盘** 能力，覆盖：

1. **按时间维度生成投放数据明细表格** — 支持日/周/阶段粒度汇总
2. **同步分析该阶段数据情况，进行复盘** — AI 驱动的阶段性诊断
3. **AB 对照组数据对比分析与放量建议** — 测试数据 → 正式投放决策链路

---

## 2. 数据模型设计

### 2.1 扩展现有表：`kol_content_tracking`

在现有 `kol_content_tracking` 表中增加以下字段（用于关联阶段和 AB 测试）：

```sql
-- 已有表：kol_content_tracking
-- 新增字段：
ALTER TABLE kol_content_tracking ADD COLUMN phase INTEGER DEFAULT 1;            -- 关联 campaign 阶段 (1/2/3)
ALTER TABLE kol_content_tracking ADD COLUMN test_group TEXT DEFAULT '';          -- AB 测试分组: 'A'/'B'/'control'/'', 空表示非测试
ALTER TABLE kol_content_tracking ADD COLUMN note_type TEXT DEFAULT '';           -- 内容类型: 种草/测评/开箱/教程/对比等
ALTER TABLE kol_content_tracking ADD COLUMN cost REAL DEFAULT 0;               -- 该条内容实际花费(含投流)
ALTER TABLE kol_content_tracking ADD COLUMN is_organic INTEGER DEFAULT 1;      -- 是否纯自然流: 1=自然流, 0=含付费
```

### 2.2 新增表：`campaign_phase_reports`（阶段复盘报告）

每阶段可生成一份复盘报告，支持周复盘和阶段复盘两种类型。

```sql
CREATE TABLE IF NOT EXISTS campaign_phase_reports (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  phase INTEGER NOT NULL,                        -- 阶段序号 (1/2/3)
  report_type TEXT NOT NULL DEFAULT 'phase',      -- 'phase' 阶段复盘 / 'weekly' 周复盘 / 'ab_test' AB测试复盘
  
  -- 时间范围
  start_date TEXT NOT NULL,                       -- 复盘开始日期 (YYYY-MM-DD)
  end_date TEXT NOT NULL,                         -- 复盘结束日期
  
  -- 投放规模
  total_kols INTEGER DEFAULT 0,                   -- 参与 KOL 数量
  total_posts INTEGER DEFAULT 0,                  -- 总发布内容数
  total_cost REAL DEFAULT 0,                      -- 总花费（元）
  organic_cost REAL DEFAULT 0,                    -- 自然流合作成本
  paid_cost REAL DEFAULT 0,                       -- 投流花费
  
  -- 核心数据指标
  total_exposure INTEGER DEFAULT 0,               -- 总曝光量
  total_views INTEGER DEFAULT 0,                  -- 总浏览量
  total_likes INTEGER DEFAULT 0,                  -- 总点赞
  total_saves INTEGER DEFAULT 0,                  -- 总收藏
  total_comments INTEGER DEFAULT 0,               -- 总评论
  total_shares INTEGER DEFAULT 0,                   -- 总转发
  
  -- 计算指标
  avg_cpm REAL DEFAULT 0,                         -- 平均 CPM
  avg_cpe REAL DEFAULT 0,                         -- 平均 CPE
  avg_ctr REAL DEFAULT 0,                         -- 平均 CTR
  avg_engagement_rate REAL DEFAULT 0,             -- 平均互动率
  
  -- 目标达成
  roi_estimate REAL DEFAULT 0,                    -- 预估 ROI
  cpm_target REAL DEFAULT 0,                      -- 目标 CPM
  cpm_target_achieved INTEGER DEFAULT 0,          -- 是否达成 CPM 目标
  engagement_target REAL DEFAULT 0,                 -- 目标互动率
  engagement_target_achieved INTEGER DEFAULT 0,  -- 是否达成互动率目标
  
  -- AI 复盘内容
  ai_summary TEXT,                                -- AI 总结（Markdown）
  ai_findings TEXT,                               -- 核心发现（JSON 数组）
  ai_recommendations TEXT,                          -- 优化建议（JSON 数组）
  ai_scale_advice TEXT,                           -- 放量建议（Markdown）
  
  -- 状态
  status TEXT DEFAULT 'draft',                    -- draft / generated / finalized
  generated_by TEXT DEFAULT 'ai',                   -- ai / manual
  
  -- 时间戳
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_phase_reports_campaign ON campaign_phase_reports(campaign_id);
CREATE INDEX IF NOT EXISTS idx_phase_reports_phase ON campaign_phase_reports(phase);
CREATE INDEX IF NOT EXISTS idx_phase_reports_type ON campaign_phase_reports(report_type);
CREATE INDEX IF NOT EXISTS idx_phase_reports_status ON campaign_phase_reports(status);
```

### 2.3 新增表：`campaign_ab_tests`（AB 测试定义）

```sql
CREATE TABLE IF NOT EXISTS campaign_ab_tests (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  phase INTEGER DEFAULT 1,                         -- 所属阶段
  test_name TEXT NOT NULL,                          -- 测试名称，如 "内容形式对比测试"
  hypothesis TEXT NOT NULL,                          -- 核心假设，如 "视频种草 vs 图文测评"
  
  -- 测试变量
  variable_type TEXT NOT NULL,                     -- content(内容形式)/kol_tier(达人层级)/platform(平台)/timing(发布时间)/creative(创意方向)
  variable_description TEXT,                       -- 变量描述
  
  -- 分组定义（JSON 存储）
  control_group_definition TEXT,                   -- 对照组定义
  test_group_definition TEXT,                      -- 测试组定义（支持多组，JSON 数组）
  
  -- 时间范围
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  
  -- 结果
  status TEXT DEFAULT 'running',                   -- running / completed / cancelled
  winner_group TEXT DEFAULT '',                     -- 胜出组: 'A'/'B'/'control'/'none'
  winner_reason TEXT,                              -- 胜出原因
  scale_recommendation TEXT,                        -- 放量建议（Markdown）
  
  -- 时间戳
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_ab_tests_campaign ON campaign_ab_tests(campaign_id);
CREATE INDEX IF NOT EXISTS idx_ab_tests_phase ON campaign_ab_tests(phase);
CREATE INDEX IF NOT EXISTS idx_ab_tests_status ON campaign_ab_tests(status);
```

### 2.4 新增表：`ab_test_results`（AB 测试分组结果）

```sql
CREATE TABLE IF NOT EXISTS ab_test_results (
  id TEXT PRIMARY KEY,
  ab_test_id TEXT NOT NULL,
  group_name TEXT NOT NULL,                         -- 'control'/'A'/'B'/'C'
  
  -- 规模
  kol_count INTEGER DEFAULT 0,
  post_count INTEGER DEFAULT 0,
  total_cost REAL DEFAULT 0,
  
  -- 效果数据
  total_exposure INTEGER DEFAULT 0,
  total_views INTEGER DEFAULT 0,
  total_likes INTEGER DEFAULT 0,
  total_saves INTEGER DEFAULT 0,
  total_comments INTEGER DEFAULT 0,
  total_shares INTEGER DEFAULT 0,
  
  -- 计算指标
  avg_cpm REAL DEFAULT 0,
  avg_cpe REAL DEFAULT 0,
  avg_ctr REAL DEFAULT 0,
  avg_engagement_rate REAL DEFAULT 0,
  
  -- 转化数据
  conversion_count INTEGER DEFAULT 0,
  conversion_rate REAL DEFAULT 0,
  
  -- 统计显著性
  significance_score REAL DEFAULT 0,                -- 0-1，越高越显著
  is_significant INTEGER DEFAULT 0,                -- 1=统计显著
  
  -- 时间戳
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_ab_results_test ON ab_test_results(ab_test_id);
CREATE INDEX IF NOT EXISTS idx_ab_results_group ON ab_test_results(group_name);
```

### 2.5 类型定义（`@ma-proma/shared`）

```typescript
// ===== 阶段复盘报告 =====

export interface CampaignPhaseReport {
  id: string
  campaignId: string
  phase: number
  reportType: 'phase' | 'weekly' | 'ab_test'
  startDate: string
  endDate: string
  totalKols: number
  totalPosts: number
  totalCost: number
  organicCost: number
  paidCost: number
  totalExposure: number
  totalViews: number
  totalLikes: number
  totalSaves: number
  totalComments: number
  totalShares: number
  avgCpm: number
  avgCpe: number
  avgCtr: number
  avgEngagementRate: number
  roiEstimate: number
  cpmTarget: number
  cpmTargetAchieved: boolean
  engagementTarget: number
  engagementTargetAchieved: boolean
  aiSummary: string
  aiFindings: string[]
  aiRecommendations: string[]
  aiScaleAdvice: string
  status: 'draft' | 'generated' | 'finalized'
  generatedBy: 'ai' | 'manual'
  createdAt: number
  updatedAt: number
}

export interface GeneratePhaseReportInput {
  campaignId: string
  phase: number
  reportType: 'phase' | 'weekly' | 'ab_test'
  startDate: string
  endDate: string
  cpmTarget?: number
  engagementTarget?: number
}

// ===== AB 测试 =====

export interface CampaignABTest {
  id: string
  campaignId: string
  phase: number
  testName: string
  hypothesis: string
  variableType: 'content' | 'kol_tier' | 'platform' | 'timing' | 'creative'
  variableDescription: string
  controlGroupDefinition: string
  testGroupDefinition: string
  startDate: string
  endDate: string
  status: 'running' | 'completed' | 'cancelled'
  winnerGroup: string
  winnerReason: string
  scaleRecommendation: string
  createdAt: number
  updatedAt: number
}

export interface ABTestResult {
  id: string
  abTestId: string
  groupName: string
  kolCount: number
  postCount: number
  totalCost: number
  totalExposure: number
  totalViews: number
  totalLikes: number
  totalSaves: number
  totalComments: number
  totalShares: number
  avgCpm: number
  avgCpe: number
  avgCtr: number
  avgEngagementRate: number
  conversionCount: number
  conversionRate: number
  significanceScore: number
  isSignificant: boolean
  createdAt: number
  updatedAt: number
}

export interface CreateABTestInput {
  campaignId: string
  phase: number
  testName: string
  hypothesis: string
  variableType: 'content' | 'kol_tier' | 'platform' | 'timing' | 'creative'
  variableDescription: string
  controlGroupDefinition: string
  testGroupDefinition: string
  startDate: string
  endDate: string
}

export interface UpdateABTestResultInput {
  abTestId: string
  groupName: string
  kolCount: number
  postCount: number
  totalCost: number
  totalExposure: number
  totalViews: number
  totalLikes: number
  totalSaves: number
  totalComments: number
  totalShares: number
  conversionCount: number
  conversionRate: number
}
```

---

## 3. IPC 通道设计

### 3.1 新增 IPC 通道常量

```typescript
// packages/shared/src/types/campaign.ts

export const PHASE_REPORT_IPC_CHANNELS = {
  LIST: 'phaseReport:list',
  GET: 'phaseReport:get',
  GENERATE: 'phaseReport:generate',
  UPDATE: 'phaseReport:update',
  DELETE: 'phaseReport:delete',
  FINALIZE: 'phaseReport:finalize',
} as const

export const AB_TEST_IPC_CHANNELS = {
  LIST: 'abTest:list',
  GET: 'abTest:get',
  CREATE: 'abTest:create',
  UPDATE: 'abTest:update',
  DELETE: 'abTest:delete',
  COMPLETE: 'abTest:complete',
  GET_RESULTS: 'abTest:getResults',
  UPDATE_RESULT: 'abTest:updateResult',
  ANALYZE: 'abTest:analyze',
} as const
```

### 3.2 主进程服务层方法

在 `campaign-manager.ts` 中新增以下方法：

- `generatePhaseReport(input)` — 生成阶段复盘报告（自动汇总数据 + 调用 AI 分析）
- `listPhaseReports(campaignId)` — 列出 Campaign 的所有复盘报告
- `getPhaseReport(id)` — 获取单份复盘报告
- `updatePhaseReport(id, updates)` — 更新报告（人工编辑）
- `finalizePhaseReport(id)` — 定稿报告
- `deletePhaseReport(id)` — 删除报告

- `createABTest(input)` — 创建 AB 测试
- `listABTests(campaignId)` — 列出 AB 测试
- `getABTest(id)` — 获取 AB 测试
- `updateABTest(id, updates)` — 更新 AB 测试
- `completeABTest(id, winnerGroup, winnerReason, scaleRecommendation)` — 完成测试并记录结果
- `getABTestResults(abTestId)` — 获取 AB 测试结果
- `updateABTestResult(input)` — 更新分组结果
- `analyzeABTest(abTestId)` — AI 分析 AB 测试数据

---

## 4. Chat Tool 设计（`ma-phase-reviewer`）

新增 Chat Tool：`ma-phase-reviewer`，作为阶段复盘助手。

### 工具能力

1. **生成阶段复盘** (`ma_generate_phase_report`)
   - 自动拉取该阶段所有 `kol_content_tracking` 数据
   - 计算汇总指标（总曝光、总互动、平均 CPM/CPE/CTR）
   - 调用 LLM 分析数据表现，识别亮点与问题
   - 生成复盘报告，存入 `campaign_phase_reports`

2. **AB 测试分析** (`ma_analyze_ab_test`)
   - 拉取 AB 测试分组数据
   - 计算统计显著性
   - 调用 LLM 分析哪组胜出、原因、放量建议

3. **生成放量建议** (`ma_generate_scale_plan`)
   - 基于测试/阶段数据，生成正式投放预算分配方案
   - 调用 `campaign-optimizer` 的优化逻辑

### 系统提示词片段

```
你拥有 **MA阶段复盘** 能力（PhaseReviewer）。

**ma_generate_phase_report — 生成阶段复盘报告：**
当用户需要复盘某阶段投放数据时调用：
- 自动汇总该阶段所有 KOL 内容数据
- 计算核心指标：CPM、CPE、CTR、互动率
- 与基准数据对比，判定性能等级
- 识别表现最佳/最差的内容和 KOL
- 输出结构化复盘报告

**ma_analyze_ab_test — AB 测试分析：**
当用户有 AB 测试数据需要分析时调用：
- 对比各组数据表现
- 计算统计显著性
- 判定胜出组及原因
- 给出放量建议

**ma_generate_scale_plan — 生成放量方案：**
当用户需要根据测试数据规划正式投放时调用：
- 基于测试表现，推荐预算分配
- 给出达人组合建议
- 输出可执行的投放方案
```

---

## 5. 前端 UI 设计

### 5.1 在 `CampaignDetail` 中新增 Tab

现有 Tabs：`kol-pool` | `content-tracking`

新增 Tab：`phase-review`（阶段复盘）

```tsx
<TabsTrigger value="phase-review" className="text-xs gap-1">
  <TrendingUp className="w-3.5 h-3.5" />
  阶段复盘
</TabsTrigger>
```

### 5.2 `PhaseReviewPanel` 组件结构

```tsx
<PhaseReviewPanel campaignId={campaign.id} phase={campaign.currentPhase}>
  {/* 1. 顶部操作栏 */}
  <div className="flex items-center justify-between">
    <Select value={selectedPhase} onChange={setSelectedPhase}>
      <option value={1}>第一阶段 · 美学吸睛期</option>
      <option value={2}>第二阶段 · 场景渗透期</option>
      <option value={3}>第三阶段 · 价值深化期</option>
    </Select>
    <Button onClick={handleGenerateReport}>
      <Sparkles size={14} className="mr-1" />
      生成复盘报告
    </Button>
  </div>

  {/* 2. 数据总览卡片 */}
  <PhaseStatsCards
    totalKols={report.totalKols}
    totalPosts={report.totalPosts}
    totalCost={report.totalCost}
    totalExposure={report.totalExposure}
    avgCpm={report.avgCpm}
    avgCpe={report.avgCpe}
    avgEngagementRate={report.avgEngagementRate}
  />

  {/* 3. 数据明细表格 */}
  <PhaseDataTable
    data={trackingData}
    columns={['日期', 'KOL', '平台', '内容类型', '曝光', '浏览', '互动', 'CPM', 'CPE', '互动率', '等级']}
    onSort={handleSort}
    onFilter={handleFilter}
  />

  {/* 4. AI 复盘分析 */}
  <AIReviewSection
    summary={report.aiSummary}
    findings={report.aiFindings}
    recommendations={report.aiRecommendations}
  />

  {/* 5. AB 测试对比（如果有） */}
  <ABTestComparison
    abTests={abTests}
    results={abResults}
  />

  {/* 6. 放量建议 */}
  <ScaleRecommendation
    advice={report.aiScaleAdvice}
  />
</PhaseReviewPanel>
```

### 5.3 数据明细表格设计

按时间维度支持多种粒度切换：
- **日维度**：每行 = 一天的所有内容汇总
- **内容维度**：每行 = 一条 `kol_content_tracking` 记录
- **KOL 维度**：每行 = 一位 KOL 的汇总数据
- **周维度**：每行 = 一周的汇总数据

表格列：
| 日期 | KOL | 平台 | 内容类型 | 分组 | 曝光 | 浏览 | 点赞 | 收藏 | 评论 | 转发 | 完播率 | CPM | CPE | 互动率 | 等级 |

### 5.4 AB 测试对比面板

当存在 `ab_test_results` 数据时展示：

```
┌─────────────────────────────────────────────────────────┐
│  AB 测试：视频种草 vs 图文测评                            │
│  假设：视频形式的种草内容比图文测评获得更高互动率          │
├─────────────────────────────────────────────────────────┤
│  对照组(图文) │ 测试组A(视频) │ 测试组B(混合)            │
│  ────────────┼───────────────┼──────────────            │
│  3 位 KOL    │  3 位 KOL     │  3 位 KOL                │
│  5 篇内容    │  5 篇内容     │  5 篇内容                │
│  ────────────┼───────────────┼──────────────            │
│  曝光: 12万  │  曝光: 18万   │  曝光: 15万              │
│  互动率: 3.2%│  互动率: 6.8% │  互动率: 5.1%            │
│  CPE: 15元   │  CPE: 7元     │  CPE: 9元                │
│  ────────────┼───────────────┼──────────────            │
│             🏆 胜出：测试组 A                              │
│  显著性：92%  │ 原因：视频完播率更高，收藏转化更好         │
│  ───────────────────────────────────────────             │
│  放量建议：下阶段 70% 预算投入视频种草，30% 保留图文测试     │
└─────────────────────────────────────────────────────────┘
```

---

## 6. 实现阶段（垂直切片）

按 **用户行为切片** 垂直开发，每个 slice 端到端可验证：

### Slice 1: 生成阶段数据明细表格
**范围**：DB Schema 扩展 → IPC → Preload → 前端表格展示

- [ ] 在 `kol_content_tracking` 表添加 `phase` / `test_group` / `note_type` 字段
- [ ] 新增 `campaign_phase_reports` 表
- [ ] 新增 `PHASE_REPORT_IPC_CHANNELS` 常量
- [ ] 在 `campaign-manager.ts` 中添加 `generatePhaseReport` / `listPhaseReports` 方法
- [ ] 在 `main/ipc.ts` 中注册 handler
- [ ] 在 `preload/index.ts` 中暴露 API
- [ ] 创建 `PhaseReviewPanel` 组件（基础数据表格展示）
- [ ] 在 `CampaignDetail` 中接入新 Tab
- [ ] 验证：能在前端看到阶段数据明细表格

### Slice 2: AI 阶段复盘分析
**范围**：数据汇总 → LLM 分析 → 报告存储 → 前端展示

- [ ] 实现 `generatePhaseReport` 中的 AI 分析逻辑（调用 `llm-service`）
- [ ] 新增 `ma-phase-reviewer` Chat Tool
- [ ] 在 `PhaseReviewPanel` 中展示 AI 复盘结论（亮点、问题、建议）
- [ ] 验证：点击"生成复盘报告"后能看到 AI 分析结果

### Slice 3: AB 测试数据管理与对比
**范围**：AB 测试表 → 分组结果录入 → 对比面板 → 放量建议

- [ ] 新增 `campaign_ab_tests` 和 `ab_test_results` 表
- [ ] 新增 `AB_TEST_IPC_CHANNELS` 和对应服务方法
- [ ] 在 `PhaseReviewPanel` 中添加 AB 测试对比面板
- [ ] 实现 `analyzeABTest` AI 分析方法
- [ ] 实现放量建议展示
- [ ] 验证：能创建 AB 测试、录入数据、看到对比分析和放量建议

---

## 7. 关键设计决策

### 7.1 数据粒度
- 单条内容（`kol_content_tracking`）是最细粒度
- 阶段复盘报告是汇总粒度，由系统聚合生成
- 支持按日/周/内容/KOL 多维度查看

### 7.2 AB 测试设计
- 测试变量类型：`content`(内容形式) / `kol_tier`(达人层级) / `platform`(平台) / `timing`(发布时间) / `creative`(创意方向)
- 每组支持多个 KOL，每个 KOL 可有多条内容
- 统计显著性：使用简化版（组间差异 / 标准差），不引入复杂统计库

### 7.3 AI 复盘触发方式
- **手动触发**：用户在 UI 上点击"生成复盘报告"
- **Chat Tool 触发**：在 Chat 模式中调用 `ma_generate_phase_report`
- **Agent 触发**：在 Agent 模式中让 Agent 自动生成

### 7.4 与现有系统的兼容性
- 现有 `kol_content_tracking` 数据不受影响，新增字段有默认值
- 现有 `content_benchmarks` 继续用于性能等级判定
- 复用 `llm-service.ts` 中的 `completePrompt` 进行 AI 分析
- 复用 `campaign-workflow-service.ts` 的 workspace 文件管理

---

## 8. 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `packages/shared/src/types/campaign.ts` | 修改 | 新增类型定义 + IPC 通道常量 |
| `apps/electron/src/main/lib/campaign-manager.ts` | 修改 | 新增表初始化 + 复盘/AB测试服务方法 |
| `apps/electron/src/main/ipc.ts` | 修改 | 注册新 IPC handler |
| `apps/electron/src/preload/index.ts` | 修改 | 暴露新 IPC API |
| `apps/electron/src/main/lib/ma-tools/ma-phase-reviewer.ts` | 新增 | Chat Tool：阶段复盘 |
| `apps/electron/src/main/lib/ma-tools/index.ts` | 修改 | 导出新工具 |
| `apps/electron/src/main/lib/chat-tool-config.ts` | 修改 | 默认启用新工具 |
| `apps/electron/src/main/lib/chat-tool-registry.ts` | 修改 | 注册新工具 |
| `apps/electron/src/main/lib/chat-tool-executor.ts` | 修改 | 添加执行分支 |
| `apps/electron/src/renderer/components/agent/PhaseReviewPanel.tsx` | 新增 | 阶段复盘面板 |
| `apps/electron/src/renderer/components/agent/CampaignDetail.tsx` | 修改 | 新增"阶段复盘"Tab |
| `apps/electron/src/renderer/components/agent/PhaseStatsCards.tsx` | 新增 | 数据总览卡片 |
| `apps/electron/src/renderer/components/agent/PhaseDataTable.tsx` | 新增 | 数据明细表格 |
| `apps/electron/src/renderer/components/agent/ABTestComparison.tsx` | 新增 | AB 测试对比面板 |
| `apps/electron/src/renderer/components/agent/AIReviewSection.tsx` | 新增 | AI 复盘展示 |
| `apps/electron/src/renderer/components/agent/ScaleRecommendation.tsx` | 新增 | 放量建议展示 |

---

## 9. 技术约束

- 所有新增表使用 SQLite，遵循现有 `campaign-manager.ts` 的 `Database` 包装层模式
- 所有 IPC 遵循"四点 checklist"（shared → main → preload → renderer）
- 前端使用 Jotai 状态管理，UI 使用 Shadcn/Radix 组件
- 组件采用懒加载（`React.lazy`）
- 注释和日志使用中文
- 类型安全：不使用 `any`，使用 `import type`

---

*设计完成，待确认后按 Slice 实施。*
