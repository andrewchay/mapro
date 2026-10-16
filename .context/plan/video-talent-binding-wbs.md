# AI 视频生成 × 达人模块绑定 — 任务拆解与工作量评估（WBS）v2

> 已由 2026-10-05 双端工作台账取代：`/Users/chaihao/.gravitas/agent-workspaces/ma-proma/workspace-files/.context/todo-ai-video-dual-track.md`（本仓快照：`../todo-ai-video-dual-track.md`）。下列原估算存在分项/小计不一致和双端适配遗漏，保留供追溯，不再作为排期依据。代码中的模型 ID、凭据解析器与测试文件存在，不代表官方模型可用、凭据已配置或真实 API 已验证；这些统一纳入新台账 S1 核验。

> 日期：2026-09-29 首版 / 2026-10-05 v2（基于 proma-mit 实地核对修正）
> 前置分析：`note-ai-video-generation-gap-analysis.md`
> 估算口径：1 人日 = 1 名熟悉本仓库的前端/全栈工程师专注开发一天；含自测，不含跨端联调等待

---

## v2 核对结论（2026-10-05，proma-mit 实地验证）

对 gravitas（/Users/chaihao/LLM/proma-mit）侧的核对推翻了 8/10 映射文档的三个判断：

| 8/10 文档判断 | 实地核对结果 |
|---|---|
| "19 个 ma-tools 全缺，仅迁 3 个" | ❌ 过时 — `marketing/ma-tools/` 已有 kol-crm / kol-data-service / kol-search / kol-portal / budget-forecast / campaign-agent / content-audit / creative-pilot / script-studio / strategy-iq / match-ai / llm-service 等，kol-crm 表结构同 ma-proma（kol_crm/kol_performance/kols） |
| "凭据需确认 VOLCENGINE_API_KEY 配置" | ✅ 已解决 — `video-credential-resolver.ts` 走渠道配置（doubao/minimax 渠道 + baseUrl 归一化），env 仅回退；带测试 |
| "video_pipeline 已迁但引擎同 ma-proma" | ✅ 且领先 — Seedance 已是 **2.5**（`doubao-seedance-2-5-260628`）+ MiniMax H3；ma-proma 侧反而是 1.x 接口 |

**gravitas 侧"绑定达人模块"的结构现状：**
- ✅ UI 已挂载：`CreativeVideoPanel` 在 `InfluencerModuleView`（达人模块）下，与 `InfluencerTalentsPanel` 平级
- ✅ 数据层有达人链路表：`influencer_talent`（达人）、`influencer_brief`（talent_id 关联）、`influencer_draft`（brief_id + talent_id 双关联）
- ❌ **核心断点仍在**：`creative_asset` 表只有 `project_id`，**无 talent_id**；`creative-video-service.ts` 无任何 kol/talent 维度 → 面板挂在达人模块下，但视频不归属到具体达人
- ⚠️ 分支基线待定：营销全链路集中在 `feat/marketing-campaign-full-chain`（订阅门控/Campaign 数据层批次 2-5/五维评分），当前工作分支是 `feat/pi-runtime-1.0.2-trial`

---

## 总览（v2 修正）

| 工作流 | 内容 | 优先级 | v1 估算 | **v2 估算** |
|---|---|---|---|---|
| **A** | ma-proma「达人→视频」绑定改造 | P0 | 3.5–4.5 | **3.5–4.5 人日**（不变） |
| **B** | 模型接入升级 | P0/P1 | 4–6.5 | **3–5 人日**（B1 降为参照移植） |
| **C** | 质量与合规 | P1 | 3–4 | 3–4 人日（不变） |
| **D** | gravitas 侧绑定实现 | P0 | 3.5–6 | **2.25–3.25 人日**（D1/D2 已完成） |
| **E** | 商业化运营 | P2 | 1–1.5 | 1–1.5 人日（不变） |

**里程碑组合（v2）：**
- 🚀 最小可用（A + B1）：**4.5–5.5 人日**
- ✅ 完整能力（A + B + C）：**9.5–13 人日**
- 🏢 双端全量（A + B + C + D）：**12–16.5 人日**

---

## 工作流 A：ma-proma「达人→视频」绑定（P0，3.5–4.5 人日）

### A1 数据模型加达人维度 — 0.5–1d
- `packages/shared/src/types/campaign.ts`：新增 `TalentVideoAsset`（含 `kolId`、`talentName`、`styleTags`、`authorizationStatus`）
- **决策点**：资产组织方式二选一
  - 方案①（推荐）：目录约定 `video-assets/talents/{kolId}/` + sidecar JSON — 延续现有纯文件扫描模式
  - 方案②：SQLite 表 — 对齐 gravitas 侧 `creative_asset` 模式（双端一致性好，但 ma-proma 需引入 store）
- 改动文件：shared types、`video-asset-service.ts`（200 行）

### A2 VideoInput 加达人画像参数 — 1–1.5d
- `storyboard-engine.ts`（554 行）：`VideoInput` 加可选 `talentProfile`（风格/人设/口吻/粉丝画像），分镜模板注入达人段落；`firstFramePrompt`/`videoPrompt` 融入达人特征
- `video_pipeline` 工具加 `kolId`/`talentProfile` 参数，自动读 kol-database（kol_crm 表）
- 前置：kol_crm 表若缺「风格/人设」字段 → 加字段 + CRM 更新入口（+0.5d 已含上限）

### A3 UI 挂到达人模块 — 1–1.5d
- `VideoAssetPanel.tsx`（289 行）抽 campaign/talent 双模式
- `KOLDataManager.tsx`（1113 行）加「AI 视频资产」tab：按达人查看/发起生成/播放/删除
- 候选池达人行加「生成视频」快捷入口

### A4 IPC 扩展 — 0.5d
- ipc.ts 扩展 talent 维度 list/delete + 生成状态查询；preload 同步

### A5 冒烟 + 测试 — 0.5d
- BDD 补达人分支；端到端跑一条「达人定制视频」

---

## 工作流 B：模型接入升级（P0/P1，v2：3–5 人日）

### B1 Seedance 升级至 2.5 — 0.5–1d（v1 为 1–1.5d）⭐
- **v2 降估原因**：proma-mit 的 `video-generation-service.ts` 已有 Seedance 2.5（doubao-seedance-2-5-260628）+ 凭据解析器完整实现，ma-proma 侧可**参照移植**而非从头联调
- ma-proma `video-generation-service.ts`（399 行）：model 参数 + 凭据读取对齐 + 轮询适配
- VOLCENGINE_API_KEY 需确认开通 doubao-seedance-2-5 权限

### B2 TTS 配音 — 1.5–2d（不变）
- 新增 `tts-service.ts`（MiniMax 语音复用账号 / 火山 TTS）
- orchestrator 加配音轨：旁白→TTS→FFmpeg 混流（已有 BGM 混入逻辑可扩展）；时长对齐

### B3 数字人（即梦 OmniHuman / DreamActor M1）— 2–3d（不变，可裁剪）
- 新引擎适配 + 达人肖像/声音授权链路（授权流程的法务/产品设计另计）
- 建议 B2 先行（TTS 产出可作数字人音频输入）

### B4 备选引擎（可灵 3.0 / Vidu）— 各 0.5–1d（按需）

---

## 工作流 C：质量与合规（P1，3–4 人日，不变）

### C1 LLM 分镜升级 — 1–1.5d
- storyboard-engine 加 LLM 后端（模板降级 fallback）；复用 ma-creative-concept / ma-script-studio 提示词资产

### C2 视频审核 — 1–1.5d
- FFmpeg 抽帧 → 复用 ma-image-audit（Kimi 视觉）；不通过标记禁止交付

### C3 AI 生成内容标识 — 0.5–1d
- 显式角标（drawtext）+ 隐式元数据；满足《人工智能生成合成内容标识办法》（2025-09-01 生效）

---

## 工作流 D：gravitas 侧绑定实现（P0，v2 重估：2.25–3.25 人日）

> v1 的 D1（ma-tools 迁移 2–3d）与 D2（凭据 0.5–1d）**已由既有代码完成，删除**。

### D1 creative_asset 加达人维度 — 0.75–1d
- `marketing-sqlite-store.ts`：`creative_asset` 加 `talent_id` 列（SQLite ALTER + 迁移函数）
- 或新建 `influencer_video` 表挂 talent_id（对齐 brief/draft 模式）——二选一，建议后者（不动已有资产语义）
- `creative-video-service.ts` 产物落库带 talent_id

### D2 CreativeVideoPanel 达人联动 — 1–1.5d
- 面板加达人选择器（数据源 `influencer_talent` / ma_kol_crm），生成时注入达人画像到 storyboard
- `InfluencerTalentsPanel` 达人行加「生成视频」入口（带 kolId 跳转预填）

### D3 达人 Brief→视频直通 — 0.5–0.75d ⭐ gravitas 独有优势
- `influencer_brief`（product/direction 字段）直接作为视频生成输入——brief 是 talent_id 关联的，天然打通「达人 Brief → AI 样片 → 达人端确认」链路
- ma-proma 侧无此结构，这是 gravitas 方案的差异化卖点

### D4 凭据渠道配置 + 冒烟 — 0.25d
- 在 doubao/minimax 渠道配置中填入真实 key（credential-resolver 已就绪），全链路冒烟一次

---

## 工作流 E：商业化运营（P2，1–1.5 人日，首单后）

- E1 用量/成本统计：生成任务台账（引擎/秒数/成败/耗时）+ 按客户/达人聚合 — 1–1.5d
- E2 一键发布：另案（内容发布大缺口）

---

## 关键风险与决策点（v2）

| # | 风险/决策 | 影响 | 对策 |
|---|---|---|---|
| 1 | **基线分支待定**：营销全链路在 `feat/marketing-campaign-full-chain`，当前在 `feat/pi-runtime-1.0.2-trial` | D 工作流开工前提 | 先决策：等 pi-runtime 合回 or 在 full-chain 上直接做 |
| 2 | Seedance 2.5 权限/额度需在火山方舟确认 | B1/D4 联调节奏 | 先跑最小调用验证 |
| 3 | 数字人需企业认证 + 肖像/声音授权 | B3 可能被阻塞 | B3 独立可裁剪 |
| 4 | kol_crm 表缺「风格/人设」字段 | A2/D2 +0.5d | 已含估算 |
| 5 | creative_asset 加列 vs 新表的选择 | D1 schema | 建议新表 `influencer_video`，不动既有语义 |
| 6 | 双端（ma-proma / proma-mit）绑定实现重复 | 维护成本 | A2 的 storyboard 引擎改造建议以 proma-mit 版为基准做，ma-proma 侧反向移植 |

## 建议执行顺序（v2）

```
第 1 周   A1→A2→A4→A3→A5（ma-proma 绑定）+ B1（Seedance 2.5 参照移植）
第 2 周   D1→D2→D3→D4（gravitas 侧绑定 + Brief 直通）
第 3 周   C2（审核）→ C3（标识）→ B2（TTS）
第 4 周   B3（数字人，视授权进度）→ E1（用量统计）
```

首个客户案例可在 **第 1 周末** 用「A + B1」最小组合交付；gravitas 侧达人 Brief→AI 样片链路第 2 周末可用。
