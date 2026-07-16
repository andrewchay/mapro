# 4A 方法论 × MAPro Campaign 工作流审视计划

> 目标：基于传统 4A 公司核心方法论，重新审视当前 14 步 Campaign 工作流及 Skills，找出优化与扩展空间。

---

## 一、当前状态快照

### 1.1 14 步 Campaign 工作流

```
1. market_analysis     市场分析
2. competitor_analysis 竞品分析
3. user_analysis       用户分析（TA画像 + 搜索习惯）
4. brand_dna           品牌DNA + 品牌诊断
5. brand_fact_check    品牌信息核实
6. brand_concept       Brand Concept 产出
7. goal_setting        目标设定
8. creative_concept    生成 Big Idea
9. platform_matrix     设计平台矩阵
10. kol_pyramid        设计 KOL 金字塔
11. search_kols        筛选候选达人
12. add_to_pool        加入候选池
13. generate_briefs    生成达人 Brief
14. ab_test            设计 A/B 测试
```

### 1.2 现有 MA 默认 Skills

| Skill | 当前定位 | 对应工作流步骤 |
|-------|---------|---------------|
| ma-brand-dna | 品牌 DNA 提取 | 4 |
| ma-brand-house | 品牌屋 / 品牌概念 | 6 |
| ma-competitor-analyzer | 竞品社媒诊断 | 2 |
| ma-ta-portrait | TA 画像 | 3 |
| ma-creative-concept | Big Idea | 8 |
| ma-platform-role-mapper | 平台矩阵 | 9 |
| ma-kol-pyramid | KOL 金字塔 | 10 |
| ma-content-calendar | 内容日历 | （未进入工作流） |
| ma-tone-manner | 品牌调性 | 6/13 |
| ma-ugc-campaign | UGC 活动 | （未进入工作流） |
| ma-paid-media | 付费媒体 | （未进入工作流） |
| ma-script-studio | 脚本工坊 | 13 |
| ma-content-audit | 内容审核 | （工具化，未进入工作流） |
| ma-kol-history-review | 达人历史审阅 | 11（可选） |
| ma-kol-crm | 达人 CRM | 11-12 |
| ma-kol-portal | 达人端自助 | （外部） |
| ma-campaign-optimizer | 投放优化 | 14 之后（未进入工作流） |
| ma-campaign-tester | 投放测试 | 14 |
| ma-marketing | MA 总控 Skill | 全局 |

### 1.3 已集成的 Chat Tools

`strategy-iq`、`match-ai`、`connect-bot`、`creative-pilot`、`kol-search`、`kol-data-mcp`、`kol-crm`、`campaign-optimizer`、`script-studio`、`content-audit`、`campaign-tester`、`kol-portal`、`campaign-agent`、`budget-forecast`、`content-tracker`、`phase-reviewer`。

---

## 二、4A 核心方法论要点

| 公司/流派 | 核心模型 | 对 MAPro 的启示 |
|-----------|---------|-----------------|
| **奥美 Ogilvy** | 360 品牌管家：Brand Audit（品牌检验）→ Brand Print（品牌写真）→ Brand Check（品牌检核） | 当前 `brand_dna` 已覆盖部分 Audit，但缺少系统性的“品牌写真”产物和后续“品牌检核”环节。 |
| **JWT** | TTB（Thompson Total Branding）: Insight → Brand Vision → Brand Idea → Communications Plan | 当前 `user_analysis` 重画像、轻 Insight 提炼；`brand_concept` 与 `creative_concept` 之间缺少“品牌意念”到“传播意念”的显式桥梁。 |
| **BBDO** | 产品形象 + 用户形象连接；BET（Brand Equity Tracking） | 当前达人匹配偏重数据标签，缺少“品牌形象 × 达人形象”一致性评估；也缺少品牌资产追踪指标。 |
| **李奥贝纳 Leo Burnett** | Inherent Drama（内在戏剧性）、HumanKind | `creative_concept` 可加入“品牌戏剧性”挖掘；Brief 和脚本应体现 HumanKind（以人为本的故事）。 |
| **DDB** | ROI 创意原则：Relevance / Originality / Impact | `creative_concept` 产物缺少 ROI 三维度评分，难以在创意阶段做客观筛选。 |
| **奥格威 Ogilvy** | 品牌形象长期投资、USP、软硬推销 | `brand_concept` 可强化 USP 与品牌主张的衔接；`creative_concept` 可区分“硬信息”与“软情绪”创意。 |

---

## 三、按步骤映射与差距

### 步骤 1 · market_analysis
- **4A 映射**：奥美品牌检验中的市场/品类审计；JWT 的 Insight 输入。
- **当前产物**：市场规模、品类趋势、品类痛点。
- **差距**：
  - 缺少“品类进入决策”结论（是否值得做、机会窗口）。
  - 缺少“增长机会地图”（需求空白、场景空白、人群空白）。
  - 未与后续品牌诊断形成显性衔接。
- **优化方向**：
  - 增加 `market-opportunity-map.md` 必需产物。
  - agentPrompt 中要求输出“品类进入建议：进攻 / 观望 / 规避”。

### 步骤 2 · competitor_analysis
- **4A 映射**：奥美竞争审计；BBDO 竞争形象分析。
- **当前产物**：竞品清单、市场占比、营销动作、核心卖点、空白机会。
- **差距**：
  - 缺少“竞品品牌资产”评估（认知度、偏好度、品牌联想）。
  - 缺少“差异化定位验证”（我们 vs 竞品在消费者心智中的位置）。
- **优化方向**：
  - 增加 `competitor-brand-equity.md` 产物。
  - 在产物中要求输出“心智定位图”文字描述。

### 步骤 3 · user_analysis
- **4A 映射**：JWT 的 Insight 挖掘；奥美的消费者理解。
- **当前产物**：TA 画像、搜索习惯。
- **差距**：
  - 重“人口统计+行为”，轻“张力 Insight”。
  - 没有显式的“核心洞察 → 传播切入点”推导。
- **优化方向**：
  - 新增子产物 `consumer-insight.md`，要求输出：
    - 观察（Observation）
    - 洞察（Insight）：带张力的人性真相
    - 传播切入点（Entry Point）
  - 在后续 `brand_concept` / `creative_concept` 中强制引用该 Insight。

### 步骤 4 · brand_dna
- **4A 映射**：奥美 Brand Audit / Brand Print。
- **当前产物**：品牌历史、产品服务、品牌阶段、产品现状、核心问题、核心目标、差异化优势。
- **差距**：
  - `heritage` 挖掘深度依赖 Skill，工作流产物要求不够具体。
  - 缺少“品牌写真”式的一句话品牌精髓（Brand Essence）。
- **优化方向**：
  - 产物要求增加 `brand-essence.md`：一句话品牌精髓 + 品牌人格形容词 + RTB。
  - 明确与 `ma-brand-dna` Skill 的字段对齐。

### 步骤 5 · brand_fact_check
- **4A 映射**：奥美 Brand Audit 的信息核实环节。
- **当前产物**：核实结论、搜索来源、差异项、风险提示。
- **评价**：新增步骤合理，符合 4A 的严谨性。
- **优化方向**：
  - 增加“关键信息置信度评分”。
  - 将风险提示分级（高/中/低）。

### 步骤 6 · brand_concept
- **4A 映射**：JWT Brand Vision → Brand Idea；奥美 Brand Print。
- **当前产物**：品牌愿景、价值观、主张、slogan、品牌屋、Tone & Visual。
- **差距**：
  - 品牌愿景（Vision）与使命（Mission）经常混淆。
  - 缺少“品牌意念”（Brand Idea）这一 JWT 核心层。
  - 品牌屋与 Big Idea 之间的逻辑衔接不够显式。
- **优化方向**：
  - 在产物中强制区分 Vision / Mission。
  - 增加 `brand-idea.md`：品牌意念（一句话可传播的品牌核心思想）。
  - 将 `ma-brand-house` Skill 的 version 升级，强化一致性检查。

### 步骤 7 · goal_setting
- **4A 映射**：奥美 360 的目标设定；BBDO 效果追踪指标。
- **当前产物**：总目标、分层目标、量化指标。
- **差距**：
  - 缺少“品牌资产指标”（Awareness / Consideration / Preference）与“生意指标”的区分。
  - 未与后续 A/B 测试和阶段复盘指标对齐。
- **优化方向**：
  - 增加指标分层：Brand Metrics → Performance Metrics → Business Metrics。
  - 在产物中列出后续可用于复盘的对照基准。

### 步骤 8 · creative_concept
- **4A 映射**：DDB ROI；李奥贝纳 Inherent Drama；JWT 传播意念。
- **当前产物**：Big Idea、创意方向、推荐方案。
- **差距**：
  - 缺少 DDB ROI 三维度评估。
  - 缺少“品牌戏剧性 / 人性故事”挖掘。
  - 创意与品牌屋/品牌意念的衔接未显性化。
- **优化方向**：
  - 每个创意概念必须输出 ROI 评分（Relevance / Originality / Impact，1-10）。
  - 增加 `creative-brief.md` 产物，包含：
    - Inherent Drama（品牌戏剧性）
    - Hero Message
    - Content Pillars
    - 与 Brand Idea 的对应关系
  - 升级 `ma-creative-concept` Skill。

### 步骤 9 · platform_matrix
- **4A 映射**：JWT Communications Plan；媒介接触点规划。
- **当前产物**：平台角色、KPI、预算分配、内容排期。
- **差距**：
  - 缺少“消费者决策路径”映射（认知 → 兴趣 → 搜索 → 购买 → 分享）。
  - 平台角色与内容支柱的对应关系可更强。
- **优化方向**：
  - 增加 `customer-journey-touchpoints.md` 产物。
  - 将 `ma-platform-role-mapper` 与决策路径结合。

### 步骤 10 · kol_pyramid
- **4A 映射**：BBDO 品牌形象 × 达人形象匹配；媒介组合策略。
- **当前产物**：金字塔配比、阶段动作、平台分配、筛选标准。
- **差距**：
  - 缺少达人“形象角色”与品牌人格的匹配逻辑。
  - 未显式衔接达人历史审阅（`ma-kol-history-review`）。
- **优化方向**：
  - 增加 `kol-role-matrix.md`：头部/腰部/KOC 分别承担的形象角色。
  - 将达人历史审阅作为 `search_kols` 的推荐动作或产物。

### 步骤 11 · search_kols
- **4A 映射**：BBDO 形象匹配；奥美品牌资产借用。
- **当前产物**：搜索条件、KOL 列表、推荐理由。
- **差距**：
  - 推荐理由偏重数据，缺少“品牌调性契合度”评估。
- **优化方向**：
  - 每条 KOL 推荐理由增加：形象契合度、内容风格契合度、风险点。
  - 与 `ma-kol-history-review` 联动，输出历史审阅摘要。

### 步骤 12 · add_to_pool
- **4A 映射**：执行资源池建立。
- **当前产物**：导入记录、KOL ID、导入结果。
- **评价**：工具化步骤，较合理。
- **优化方向**：
  - 导入时记录“入选理由标签”，便于后续复盘分层。

### 步骤 13 · generate_briefs
- **4A 映射**：创意执行指导；李奥贝纳 HumanKind；Tone & Manner。
- **当前产物**：Brief 索引、内容方向、交付物、时间线。
- **差距**：
  - 当前通过 `ma-creative-pilot` 生成，缺少 `ma-script-studio` 的脚本细化。
  - 缺少 Tone & Manner 在 Brief 中的显式校准。
  - 缺少合规预审前置。
- **优化方向**：
  - 要求每个 Brief 包含：Tone & Manner 适配、品牌戏剧性植入点、合规检查清单。
  - 可选调用 `ma-script-studio` 生成故事脚本/分镜。
  - 与 `ma-content-audit` 的预审规则对齐。

### 步骤 14 · ab_test
- **4A 映射**：数据驱动优化；测试-学习-放量闭环。
- **当前产物**：测试变量、分组、指标、样本量。
- **差距**：
  - A/B 测试作为最后一步，容易被跳过；实际上应前置到创意/达人组合验证。
  - 缺少“放量决策”和“复盘”步骤。
- **优化方向**：
  - 将 A/B 测试设计提前到 Big Idea 之后或 KOL 金字塔之后（可选分支）。
  - 在 Brief 生成后增加“测试执行 → 数据回收 → 阶段复盘 → 放量/优化”闭环。

---

## 四、工作流外的关键能力缺口

| 能力 | 当前状态 | 4A 映射 | 建议 |
|------|---------|---------|------|
| 消费者洞察挖掘 | 散落在 user_analysis | JWT Insight | 升级为独立步骤或子产物 |
| 品牌写真 / 品牌检核 | 仅有 brand_dna / brand_fact_check | 奥美 Brand Print / Brand Check | 强化产物要求 |
| 创意 ROI 评估 | 无 | DDB ROI | 加入 creative_concept 产物 |
| 品牌戏剧性挖掘 | 无 | 李奥贝纳 Inherent Drama | 加入 creative_concept / Brief |
| 媒介接触点 / 决策路径 | 弱 | JWT Communications Plan | 加入 platform_matrix |
| 达人形象匹配 | 弱 | BBDO 形象连接 | 加入 kol_pyramid / search_kols |
| 测试-放量-复盘闭环 | 仅有 ab_test + 工具 | 数据驱动营销 | 扩展为工作流尾部阶段 |
| 付费媒体协同 | 仅 Skill / Tool | 媒介整合 | 可作为 platform_matrix 延伸 |
| UGC / 社区共创 | 仅 Skill / Tool | HumanKind | 可作为 campaign 分支 |

---

## 五、候选改进方案

### 方案 A：轻量升级（推荐）
- **不新增工作流步骤**，保持 14 步骨架。
- 升级每步的 `agentPrompt`、`artifactRequirements`、`requiredFiles` 和对应 Skill，注入 4A 检查点。
- 重点升级：
  - `user_analysis`：增加 Insight 子产物。
  - `brand_concept`：增加 Brand Idea 子产物。
  - `creative_concept`：增加 ROI 评分和 Inherent Drama。
  - `platform_matrix`：增加决策路径映射。
  - `kol_pyramid` / `search_kols`：增加形象匹配与历史审阅。
  - `generate_briefs`：增加 Tone & Manner 与合规检查。
  - `ab_test`：产物与阶段复盘/放量建议衔接。
- **新增 Skill**：`ma-consumer-insight`、`ma-creative-roi`。
- **风险**：低；兼容现有工作流；老用户通过迁移自动获得新产物要求。

### 方案 B：中量扩展（16 步）
- 在方案 A 基础上新增 2 个关键步骤：
  1. `consumer_insight`（步骤 3 之后）：独立提炼带张力的消费者洞察。
  2. `campaign_review`（步骤 14 之后）：阶段复盘、放量决策与优化。
- 工作流变为 16 步。
- 将 `ab_test` 调整为“测试设计”，`campaign_review` 作为正式闭环。
- **新增/升级 Skill**：`ma-consumer-insight`、`ma-creative-roi`、`ma-campaign-review`（基于 `phase-reviewer` 扩展）。
- **风险**：中；需要同步 Electron / Server / Web UI / 测试 / Onboarding 文案。

### 方案 C：主题重构（4A 主题式工作流）
- 按 4A 方法论重新组织工作流阶段：
  - 阶段 I：Brand Audit（市场/竞品/用户/品牌诊断/信息核实）
  - 阶段 II：Brand Strategy（品牌概念 / 目标 / Insight）
  - 阶段 III：Creative（Big Idea / ROI 评估 / 内容策略）
  - 阶段 IV：Channel & Execution（平台矩阵 / KOL / Brief / 脚本）
  - 阶段 V：Test & Optimize（A/B 测试 / 投放 / 复盘 / 放量）
- 扩展为 18+ 步骤，并新增多个 Skill。
- **风险**：高；涉及大量 UI、Onboarding、测试、迁移逻辑改动。

---

## 六、实施优先级（建议）

1. **P0**：方案 A 中的 `user_analysis` / `brand_concept` / `creative_concept` 升级（4A 核心注入）。
2. **P1**：新增 `ma-consumer-insight`、`ma-creative-roi` Skill，并接入对应步骤。
3. **P2**：`kol_pyramid` / `search_kols` / `generate_briefs` 的形象匹配与 Tone & Manner 升级。
4. **P3**：方案 B 的 2 个新增步骤（`consumer_insight`、`campaign_review`）。
5. **P4**：方案 C 的主题式重构（视产品战略决定）。

---

## 七、需要用户决策的问题

1. 优先采用哪种方案？（A / B / C / 混合）
2. 第一步想深入升级哪个步骤？（推荐从 `user_analysis` 或 `creative_concept` 开始）
3. 是否接受新增工作流步骤？（影响迁移与 UI 文案）
4. 是否需要新增独立 Skill，还是优先升级现有 Skill？
5. 付费媒体（`ma-paid-media`）、UGC（`ma-ugc-campaign`）、内容日历（`ma-content-calendar`）是否要纳入主工作流？
