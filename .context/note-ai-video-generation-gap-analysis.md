# AI 视频生成 × 达人模块 — Gap 分析与模型接入建议

> 日期：2026-09-29
> 背景：评估「帮客户通过 AI 生成视频，绑定在现有达人模块下」的缺口、模型选型与 ma-proma / gravitas 支持度。

## 一、ma-proma 视频生成现状盘点（已实现，可复用）

| 环节 | 现状 | 关键文件 |
|---|---|---|
| 分镜 storyboard | **模板驱动（纯函数，非 LLM）**，按品类文案模板产出镜头/旁白/字幕/首帧提示词 | `packages/server/src/video/storyboard-engine.ts` |
| 首帧图生成 | Proma Cloud `gpt-image-2` API（图生视频用） | `frame-generator.ts` |
| 视频生成引擎 | **Seedance（火山方舟 ark.volcengine.com，`VOLCENGINE_API_KEY`）+ MiniMax H3**；支持 text_to_video / image_to_video / video_extend，5s/10s，多宽高比 | `video-generation-service.ts` |
| 后期合成 | FFmpeg：拼接/转场/字幕 burn-in/BGM 混入/多平台导出 | `video-composition-service.ts` |
| Agent 工具 | `video_pipeline` 工具（tool-registry 已注册），产物写 campaign 工作区 `video-assets/{raw,final,frames}` | `apps/electron/.../tool-impls/video-pipeline-tool.ts` |
| UI 挂载 | **CampaignDetail 的 video-assets tab**（campaign 级，非达人级） | `VideoAssetPanel.tsx` |
| 引擎抽象 | `VideoGenerationRequest/VideoEngineConfig` 统一接口，新增引擎成本低 | 同上 |

结论：**"文本→分镜→首帧→逐镜生成→FFmpeg 成片"全链路已跑通**，是现成的地基。

## 二、绑定达人模块的 Gap（按优先级）

### P0 — 绑定本身的结构性缺口
1. **数据模型无达人维度**：`VideoAssetEntry` 仅以 `campaignId` 组织，与 KOL 无任何关联字段。需增加 `kolId/talentId` 关联、达人详情页视频资产区、以及"达人×视频"双向查询。
2. **storyboard 无达人画像入参**：`VideoInput` 只有 product/category/sellingPoints/targetAudience/platform，没有达人风格/人设/口吻参数。"按达人生成定制视频"需把达人档案（ma-kol-crm 数据）注入分镜与提示词。
3. **执行体在 gravitas 缺失**：按 2026-08-10 映射文档，video_pipeline 主进程代码已迁 gravitas（marketing/video，冒烟通过），但 19 个 ma-tools 仅重接了 content-audit / creative-pilot / kol-search 三个；kol-crm / kol-data-service 未迁 → 达人画像数据进不了视频流水线。

### P1 — 场景级能力缺口
4. **数字人/口播完全缺失**：达人营销高频场景（口播种草、达人替身演示）。可选：即梦 OmniHuman、DreamActor M1（动作模仿）、HeyGen。注意数字人需达人**肖像/声音授权**。
5. **TTS 配音缺失**：流水线只有字幕 + BGM，旁白是"字幕"，没有配音轨。MiniMax（已有账号体系）/火山 TTS 均可补。
6. **视频审核缺失**：ma-image-audit 只审图。客户交付需视频审核：抽帧走图像审核 or 视觉模型视频理解；叠加 AI 生成内容标识合规（《人工智能生成合成内容标识办法》2025-09-01 生效，显式+隐式标识）。
7. **storyboard 质量天花板低**：模板分镜 ≠ 创意分镜。建议 LLM 分镜（复用 ma-creative-concept / ma-script-studio 的产物作输入）或给 storyboard-engine 加 LLM 后端。

### P2 — 商业化运营缺口
8. **成本/用量管控**：无视频秒数用量统计、预算上限、按客户分账。给客户用必须先补。
9. **发布/分发断点**：生成后无一键发布（此前运营 gap 分析中的 P0 缺口），达人交付闭环断在"最后一公里"。

## 三、模型接入建议

| 用途 | 推荐 | 理由 |
|---|---|---|
| 视频生成主力 | **Seedance 2.0 / 2.0 Mini（火山方舟）** | 现有引擎即 Seedance 1.x 接口，同账号同 API 体系，改 model 参数即可升级；2.0 API 2026-02 全面开放（文/图/音/视频四模态输入）；Mini 成本约一半、速度快一倍，适合客户量产 |
| 备选/比价 | 可灵 3.0（快手）、Vidu、MiniMax H4 | 保持引擎抽象层多供应商，按成本/质量动态路由 |
| 数字人/口播 | 即梦 OmniHuman + DreamActor M1（即梦 API 2025-09 企业开放）；海外 HeyGen | 达人口播场景核心；需授权链路 |
| TTS 配音 | MiniMax 语音 / 火山引擎 TTS | 复用现有账号体系，成本低 |
| 首帧/产品图 | gpt-image-2（已有）；可加即梦文生图 3.1 | 已通 |

## 四、ma-proma vs gravitas 支持度结论

- **ma-proma（electron）**：✅ 流水线完整、agent 工具已注册、UI 在 campaign 下；改造为"达人模块下"主要是数据模型+入参扩展（P0 三项），工作量中等。
- **gravitas**：⚠️ video_pipeline 代码已迁且冒烟过，但 ① ma-tools 执行体只接了 3 个（kol-crm/数据服务缺 → 达人画像进不来）② 需确认 VOLCENGINE_API_KEY / Proma Cloud 凭据在 gravitas 侧的配置 ③ 当前 gravitas 工作区 skills 无营销/视频专用 skill（只有 proma-generate-image / proma-gpt-image-2 图像类）。
- **建议路径**：先在 ma-proma 侧做 P0 三项打通"达人→视频"绑定并跑通一个客户案例；gravitas 侧按需补 kol-crm/数据服务两个 ma-tools + 凭据配置后对齐。
