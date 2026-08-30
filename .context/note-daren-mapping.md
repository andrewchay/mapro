# ma-proma 达人营销完整工作流 vs gravitas 复刻差距表

> 日期：2026-08-10
> 目的：逐项核对 ma-proma 达人营销完整能力在 gravitas(proa-mit) 的复刻情况，供决策补齐范围。
> 结论先行：**未完整复刻**。真正验证通过能跑的仅 3 项；核心生产环节大部分缺失或未同步。

---

## 一、ma-proma 达人营销资产全景（对照源）

| 类别 | 数量 | 说明 |
|---|---|---|
| ma-* skill | 26 | 覆盖 创意/策略/KOL/投放/审核 全流程 |
| ma-tools（主进程工具） | 19 | kol-crm/kol-data-service/content-audit 等独立 Chat Tool |
| 视频生成（video_pipeline） | 1 | storyboard/引擎/合成 完整流水线 |
| 采集脚本（kol_scraper） | 2 | 蒲公英采集 + 圈选校验（Python） |

---

## 二、逐项映射（26 skill + 视频 + 采集）

### A. 三方对齐状态

| # | 资产 | ma-proma | gravitas repo default-skills | gravitas 工作区 skills | 复刻状态 |
|---|---|---|---|---|---|
| 1 | ma-draft-review | ✅ v1.1.27 | ✅ 已迁 | ✅ active | ⚠️ 部分（只迁 skill，UI 骨架在）|
| 2 | ma-image-audit | ✅ v1.0.1 | ✅ 已迁 | ✅ active | ⚠️ 部分 |
| 3 | ma-publish-data-track | ✅ | ❌ 缺失 | ❌ | ❌ 缺失 |
| 4 | 视频生成 video_pipeline | ✅ | ✅ 已迁(marketing/video) | —（主进程代码）| ✅ 完整（冒烟过）|
| 5 | ma-creative-concept | ✅ v1.0.2 | ❌ | ⚠️ v1.0.0 inactive | ❌ 未同步（旧版禁用）|
| 6 | ma-script-studio | ✅ v1.0.0 | ❌ | ⚠️ 空壳(inactive) | ❌ 空壳 |
| 7 | ma-brand-dna | ✅ | ❌ | ⚠️ inactive | ❌ 未启用 |
| 8 | ma-brand-house | ✅ | ❌ | ❌ | ❌ 缺失 |
| 9 | ma-tone-manner | ✅ | ❌ | ⚠️ inactive | ❌ 未启用 |
| 10 | ma-ta-portrait | ✅ | ❌ | ⚠️ inactive | ❌ 未启用 |
| 11 | ma-market-analysis | ✅ | ❌ | ❌ | ❌ 缺失 |
| 12 | ma-consumer-insight | ✅ | ❌ | ❌ | ❌ 缺失 |
| 13 | ma-content-calendar | ✅ | ❌ | ⚠️ inactive | ❌ 未启用 |
| 14 | ma-content-audit | ✅ | ❌ | ❌ | ❌ 缺失 |
| 15 | ma-creative-roi | ✅ | ❌ | ❌ | ❌ 缺失 |
| 16 | ma-campaign-optimizer | ✅ | ❌ | ❌ | ❌ 缺失 |
| 17 | ma-campaign-tester | ✅ | ❌ | ❌ | ❌ 缺失 |
| 18 | ma-kol-pyramid | ✅ | ❌ | ⚠️ inactive | ❌ 未启用 |
| 19 | ma-kol-scraper | ✅ v2.2.0 | ❌ | ⚠️ v2.2.0 inactive | ⚠️ 有但未启用未验证 |
| 20 | ma-kol-crm | ✅ | ❌ | ❌ | ❌ 缺失 |
| 21 | ma-kol-portal | ✅ | ❌ | ❌ | ❌ 缺失 |
| 22 | ma-kol-history-review | ✅ | ❌ | ❌ | ❌ 缺失 |
| 23 | ma-paid-media | ✅ v1.0.0 | ❌ | ⚠️ v1.0.0 inactive | ⚠️ 有但未启用 |
| 24 | ma-platform-role-mapper | ✅ | ❌ | ⚠️ inactive | ❌ 未启用 |
| 25 | ma-ugc-campaign | ✅ | ❌ | ⚠️ inactive | ❌ 未启用 |
| 26 | ma-marketing | ✅ | ❌ | ⚠️ inactive | ❌ 未启用 |

### B. ma-tools（主进程 Chat Tool）——gravitas 全部缺失

ma-proma 的 19 个 ma-tools（kol-crm.ts, kol-data-service.ts, content-audit.ts, llm-service.ts, campaign-agent.ts 等）**gravitas 一个都没迁**。它们是达人营销智能体的**可执行后端**（Skill 只是提示词，真正调 LLM/DB/采集靠这些），缺失意味着达人营销的自动化执行体不在 gravitas。

---

## 三、按"营销工作流阶段"归类的复刻缺口

| 阶段 | 典型资产 | gravitas 复刻 |
|---|---|---|
| ① 品牌/策略建库 | ma-brand-dna, brand-house, tone-manner, ta-portrait, market-analysis, consumer-insight | ❌ 基本缺失 |
| ② 内容/创意生产（生成文档）| ma-creative-concept, script-studio, content-calendar, content-audit, creative-roi | ❌ 旧版/缺失 |
| ③ 达人搜索/圈选（达人搜索）| ma-kol-scraper（采集+圈选）, ma-kol-pyramid, ma-kol-crm, ma-kol-portal | ❌ 采集脚本有但未验证，CRM/Portal 缺失 |
| ④ 稿件审核 | ma-draft-review, ma-image-audit, ma-publish-data-track | ⚠️ 审核 skill 已迁(active)，数据追踪缺 |
| ⑤ 素材生产（视频）| video_pipeline | ✅ 完整 |
| ⑥ 投放执行 | ma-paid-media, campaign-optimizer, campaign-tester | ⚠️ skill 未启用；UI 骨架在(M3) |
| ⑦ 达人 UI/数据 | InfluencerTalentsPanel/Reviews/Tracking; PaidCampaigns/Control/Rules | ⚠️ M2/M3 骨架在，但无 skill/工具支撑 |

---

## 四、核心结论

1. **真正验证通过能跑**：仅 video_pipeline(视频生成) + ma-draft-review/ma-image-audit(审核 skill)。
2. **"生成文档"未复刻**：创意/脚本/Brief 相关 skill（creative-concept、script-studio、brand-dna 等）在 gravitas 工作区是**旧版禁用或空壳**，与 ma-proma 不同步。
3. **"达人搜索"未复刻**：ma-kol-scraper 采集脚本在但未启停未验证（依赖 Python+CDP+蒲公英登录态）；ma-kol-crm/portal 缺失。
4. **"投放执行"未复刻**：ma-paid-media skill 未启用；ma-tools 可执行体（campaign-agent 等）全缺。
5. **最严重**：19 个 ma-tools **一个没迁**——这些是 AI 智能体的"手"，没有它们 skill 无法真正执行达人搜索/投放。

---

## 五、补齐路径（供决策）

- **短期优先**：把那 12 个 gravitas 工作区 inactive 但 ma-proma repo 有更新版的 skill 同步并启用（creative-concept 1.0.2 等）——纯 SKILL.md，成本低。
- **中期**：迁移缺失的纯 SKILL.md skill（ma-kol-crm/portal/market-analysis 等 8 个，均单文件）。
- **关键决策**：19 个 ma-tools 是否迁——这是工作量最大、且深度耦合 ma-proma 的 llm-service/channel-manager。若要做"达人营销自动执行"，必须解决；若只要"Skill 引导 + 人工操作"，可暂不做。
