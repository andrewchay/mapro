# 达人圈选逻辑（T2）· 现有 Skill 能力差距评估

> 评估日期：2026-08-01
> 背景：对应《忘本水果店营销复盘-工作项拆解.md》T2 最高优先技术项，含新增的「相关帖子互动数抽查 / CPM / CPE」校验维度。
> **综合达成度：实施前 ~40% → v2.1 ~80% → v2.2 ~88%**（2026-08-02 更新）
>
> ## 实施结果（v2.2，2026-08-02）
> - **评论区画像真正可用**：采集器 `grab_comments=true` 抓评论明细（昵称+文本）；校验引擎聚合地理/性别/消费信号；无明细自动降级标注 degraded
> - Mock 验证：5 个 KOL 评论画像区分度良好（上海/女性/高品质 100 分 vs 便宜/负面 53 分）；评分卡展示评论用户/文本样本可复核
>
> ## 实施结果（2026-08-01 晚，已完成）
> - `ma-kol-scraper` v2.1：相关帖子抽样（标题/正文/POI/团购/互动）+ notes_samples JSON + CSV 新列
> - `kol_screening.py` 校验引擎：四条规则（风格/价格带/评论区/CPM·CPE）→ 评分卡 JSON/MD/CSV + `--db` 落库
> - `screening_rules.json` 规则配置：类目价格带、权重、阈值、LLM 提示词（改配置即生效）
> - Mock 端到端验证通过：5 个 KOL 评分卡输出、配置化验证（咖啡类目切换 70→88 分）
> - 遗留：评论明细抓取（grab_comments）待深化；真实蒲公英采集需用户 CDP+登录态；价格带完整规则待业务提供

## 一、现有资产盘点（已核实）

| 资产 | 位置 | 状态 | 与目标的关联 |
|------|------|------|-------------|
| 蒲公英采集器 `ma-kol-scraper` **v2.1**（2026-08-01 实施后） | `apps/electron/default-skills/ma-kol-scraper/` 与 `~/.mapro/default-skills/`、workspace skills | ✅ 已实现、有真实采集产出（上海美食探店 CSV 34 列）+ 相关帖子抽样 v2.1 | 数据源第一顺位，可直接复用 |
| `scripts/kol_collector.py`（通用采集器，1480 行） | 同上 `scripts/` | ✅ CDP + config JSON 驱动，断点续采，CSV 增量写入；v2.1 新增相关帖子抽样 | 已有 CPM/CPE 预估 + 相关帖子互动聚合 |
| `scripts/kol_screening.py`（校验引擎，608 行，**新增**） | 同上 `scripts/` | ✅ 四条校验规则 → 评分卡 JSON/MD/CSV + `--db` 落库 | **本次实施核心交付** |
| `screening_rules.json`（规则配置，**新增**） | 同上 | ✅ 类目价格带/权重/阈值/LLM 提示词，改配置即生效 | **配置化落地** |
| KOL 数据库 SQLite | `~/.mapro/kol-database.sqlite` | ✅ 14 条 mock 数据，含评分字段 fan/engagement/content/overall/value/ad_quality/risk_score | 评分卡字段载体 |
| `kol_performance` 表 | 同上 | ✅ 已有 cpm/cpe/roi 字段（0 条数据） | 投放后 CPM/CPE 落库 |
| KOL 数据 MCP 工具（search_kols/get_kol_detail/sync/analyze/get_stats/seed） | `apps/electron/src/main/lib/ma-tools/kol-data-mcp.ts` | ✅ | 数据检索入口 |
| MatchAI（ma_match_kols，LLM 排序打分） | `apps/electron/src/main/lib/ma-tools/match-ai.ts` | ✅ match_score + risk_factors + reasoning | 评分卡思路可借鉴，但维度是通用匹配度 |
| 内容审核 `ma-content-audit`（合规/品牌契合度/质量三维 + 调性一致性） | `apps/electron/default-skills/ma-content-audit/` 与 `~/.mapro/default-skills/` | ✅ | **风格校验的 LLM 打分基础** |
| 品牌调性定义 `ma-tone-manner` / 品牌 DNA `ma-brand-dna` | workspace skills | ✅ | 风格校验的「调性基准」来源 |
| 平台能力调研（蒲公英 OpenAPI 门槛 500W/年，第三方数据平台补充） | `docs/archive/kol-platform-capability-research.md` | ✅ 已调研 | 数据源策略依据 |

## 二、目标逐项差距矩阵（实施前 → 实施后达成度）

### 0. 数据源确认（蒲公英达人数据获取）
- 实施前：✅ 已有完整可复用工作流（CDP 采集、config JSON 驱动）；⚠️ 未挂载到 workspace skills、缺笔记正文/POI/评论抓取。达成度 ≈ 90%。
- 实施后：✅ 已挂载到 workspace skills + 运行时；v2.1 新增相关帖子抽样（标题/正文/POI/团购信号/互动数）。达成度 ≈ 95%。
- 遗留：真实采集验证需用户 CDP+登录态；蒲公英 OpenAPI 门槛极高（500W/年）不变，CDP 仍是主路径。

### ① 风格校验（过往内容抽样 + LLM 调性打分）
- 实施前：✅ 有 content-audit 调性打分内核 + 品牌调性基准；❌ 无笔记正文文本、无批量抽样管道。达成度 ≈ 40%。
- 实施后：✅ 采集器抽样笔记文本 → `validate_style`：LLM 调性打分（可配）+ 关键词启发式兜底；批量管道已打通。达成度 ≈ 80%。
- 遗留：真实 LLM 接入需 `SCREENING_LLM_URL/KEY` + `--llm`；可串联 ma-brand-dna 细化调性画像。

### ② 价格带校验（识别线下门店客单价，与价格带规则匹配）
- 实施前：❌ 无 POI/团购抓取、无客单价抽取、无规则匹配。达成度 ≈ 5-10%。
- 实施后：✅ 抽样笔记 → `extract_unit_price`（LLM/正则多模式抽取客单价）→ `match_price_band` 与 `screening_rules.json` 类目规则匹配；配置化验证通过（咖啡 40 元：美食规则 70 分待复核 → 咖啡规则 88 分通过）。达成度 ≈ 80%。
- 遗留：业务提供各类目完整价格带规则后回填配置；真实笔记文本验证。

### ③ 评论区画像校验（评论用户地理/性别/消费信号聚合）
- 实施前：❌ 完全空白，只抓粉丝画像。达成度 ≈ 0%。
- v2.1：✅ `validate_comment_profile` 用粉丝地域/性别/评论数代理打分；❌ 评论明细未抓。达成度 ≈ 40%。
- **v2.2（当前）**：✅ 采集器 `grab_comments=true` 抓评论明细（昵称+文本）→ 校验引擎聚合地理/性别/消费/负面信号；无明细自动降级标注 degraded；评分卡展示评论用户/文本样本可复核。Mock 验证区分度良好。达成度 ≈ 85%。
- 遗留：真实评论 DOM 结构需真实验证微调；LLM 画像一致性打分需 `--llm`。

### ④ 抽查相关帖子真实互动数，估算 CPM / CPE（以水果为例看食品/饮料帖子）
- 实施前：✅ 有基于最低曝光/最低点赞的预估 CPM/CPE；❌ 非相关帖子维度、用点赞当 engagement。达成度 ≈ 50%。
- 实施后：✅ `validate_engagement` 用相关帖子曝光/点赞合计 + 达人报价估算 CPM/CPE，与基准对比打分；`relevance_keywords`（水果→食品/饮料）按类目过滤。达成度 ≈ 85%。
- 遗留：真实互动数验证；可聚合评论/收藏丰富 engagement 信号。

### 3. 输出达人评分卡（scorecard），可解释可复核
- 实施前：✅ KOL 表有 7 评分字段、MatchAI 输出 match_score；❌ 无统一四维评分卡、未落库。达成度 ≈ 25%。
- 实施后：✅ `build_scorecard` 四维得分+权重+总分+结论（通过/待复核/拒绝）+证据；输出 JSON/MD/CSV；`--db` 写入 `kol_performance` 可复核。达成度 ≈ 90%。
- 遗留：与 MatchAI 输出打通（可选）；真实数据复核。

### 4. 价格带规则配置化（规则做成可维护配置，不写死）
- 实施前：⚠️ 有 config JSON 先例，但无校验规则配置。达成度 ≈ 20%。
- 实施后：✅ `screening_rules.json` 集中管理类目价格带、权重、阈值、LLM 提示词，改配置即生效。达成度 ≈ 90%。
- 遗留：业务回填完整规则。

## 三、总体达成度评估（实施前 → 实施后）

| 模块 | 实施前 | v2.1 | **v2.2（当前）** | 变化说明 |
|------|:------:|:----:|:------:|---------|
| 数据源（蒲公英采集） | ~90% | ~95% | **~95%** | 已挂载 workspace + 相关帖子抽样 + 评论明细抓取 |
| ① 风格校验 | ~40% | ~80% | **~80%** | 抽样文本 + LLM/启发式打分管道打通 |
| ② 价格带校验 | ~10% | ~80% | **~80%** | 客单价抽取 + 规则匹配 + 配置化，验证通过 |
| ③ 评论区画像校验 | ~0% | ~40% | **~85%** | v2.2 评论明细抓取 + 聚合分析，Mock 验证区分度好 |
| ④ CPM/CPE 抽查 | ~50% | ~85% | **~85%** | 相关帖子级互动聚合，按类目过滤 |
| 评分卡 scorecard | ~25% | ~90% | **~90%** | JSON/MD/CSV + DB 落库 + 可解释证据 + 评论样本展示 |
| 规则配置化 | ~20% | ~90% | **~90%** | screening_rules.json 改配置即生效 |
| **综合** | **~40%** | **~80%** | **~88%** | 四条规则全部闭环，待真实数据/业务规则收口 |

> 说明：v2.2 后四条校验规则已全部有可运行实现。剩余 ~12% 主要是：真实蒲公英数据验证（评论 DOM 结构微调）、业务价格带规则回填、真实 LLM 接入调优。

## 四、建议落地顺序（增量、每步可验证）— 2026-08-01 已全部执行 ✅

1. ✅ **先打通「数据原料」**：采集器 v2.1 抓取抽样笔记**标题+正文+POI+评论数**（v2.1 已实现，notes_samples JSON）。
2. ✅ **复用已有内核做 ① 风格校验**：`validate_style` LLM 调性打分 + 关键词启发式兜底。
3. ✅ **④ CPM/CPE 改造**：`validate_engagement` 按 `relevance_keywords` 过滤相关帖子，聚合互动数重算 CPM/CPE，`--db` 落 kol_performance。
4. ✅ **② 价格带校验**：`extract_unit_price` 从笔记文本/POI 抽取客单价 → `match_price_band` 匹配配置化规则。
5. ✅ **③ 评论区画像校验**：已闭环（v2.2）——`grab_comments=true` 抓评论明细 + 地理/性别/消费信号聚合，无明细自动降级。剩余为真实 DOM 微调与 LLM 增强。
6. ✅ **评分卡 + 配置化收口**：scorecard schema（四维分/权重/结论/证据）+ screening_rules.json，落库可复核。

## 五、风险提示
- 蒲公英 OpenAPI 门槛极高（500W/年消耗），CDP 采集受登录态与反爬影响，需用户配合；采集需控制频率。
- 评论明细抓取成本较高（grab_comments=true 每篇笔记多 1-2 秒 DOM 提取），建议只对重点达人开启。
- 评论抽屉 DOM 结构依赖蒲公英前端，真实环境可能需按 selector 微调（已做多级兜底）。
- 价格带规则依赖业务输入（目前只有美食类参考线），技术侧先把「客单价抽取」做出来，规则留配置位。
