# S0 基线与双端差异清单

> 注：本文档与 `note-video-dual-track-s0-baseline.md` 为两会话独立核对产物，基线决策与凭据结论一致；本文档额外提供 §4 移植边界与 §6 S1 细化待办。

> 任务：S0（双端工作台账 todo-ai-video-dual-track.md）
> 日期：2026-10-05 19:45–20:05 GMT+8
> 结论先行：两仓开发基线已定、隔离工作树已就绪（复用既有）、移植边界已明确；**S1 因无视频引擎凭据而阻塞**。

## 1. 双仓基线记录（2026-10-05 19:45 快照）

| 仓库 | 开发基线 | HEAD | 主工作区状态 | 开发工作树 |
|---|---|---|---|---|
| ma-proma | `feat/video-talent-binding` @ `9ce8df36`（= xxw57 HEAD） | 9ce8df36 "Merge origin/main into xxw57" | 27 项未提交改动（campaign-workflow × 2 + 9 skills + 测试），与视频功能**无文件交集** | `/Users/chaihao/LLM/ma-proma-wt-video`（干净） |
| proma-mit | `feat/video-talent-binding` @ `782db486`（= full-chain 头） | 782db486 "营销订阅门控贯穿 UI 导航与 IPC 服务层" | 主 worktree 有 project-pilot 未提交改动（无关），已隔离 | `/Users/chaihao/LLM/proma-mit-wt-video`（干净） |

两个 worktree 由更早的会话创建且**完全干净**（无任何未提交/未跟踪文件）——本次直接复用，未重建、未产生新提交。

## 2. proma-mit 分支分析与基线决策

```
main ──┬── +7 commits ──→ feat/marketing-campaign-full-chain (782db486) ←─ feat/video-talent-binding（复用）
       └── +364 commits ─→ feat/pi-runtime-1.0.2-trial (5f89dd93) ←─ Proma 主 worktree
```

full-chain 领先 main 的 7 个提交全部是营销内容：Campaign 数据层批次 2（归档/回收站/BuildLog/JTBD Brief/五维评分/15 步工作流）、批次 4（业务 UI+IPC 全量接线）、批次 5（奥格威五维评分+端到端测试）、订阅门控、三分决策复盘。

**决策：视频绑定功能基于 full-chain（782db486）开发**，理由：
1. 订阅门控贯穿 influencer 模块导航——G4（订阅/权限验收）需要该环境
2. Campaign 数据层（marketing-sqlite-store 批次 2 扩展）是 D1 存储改造的基线
3. pi-runtime 领先的 364 提交为 pi-runtime 试用/治理类，与营销功能冲突面小
4. 与更早会话的准备一致（分支+worktree 已按此建立），营销批次合回 main 时本功能同向合流

放弃的替代方案：从 pi-runtime(5f89dd93) 重建——基线虽新 364 提交，但缺营销批次，且需删除既有分支/worktree（破坏性，不做）。

## 3. ma-proma 分支分析与基线决策

- `xxw57` 领先 main 7 提交（此初复盘 skill 迭代 + merge），落后 main 1 提交：`6a8497c2`（PR #8 营销方案级工作流迭代——纯 skills 改动，与视频功能无关，不阻塞）
- 未提交改动（campaign-workflow-service 双份 + 9 skills + 测试）属于"此初复盘"后续工作，**与 packages/server/src/video、VideoAssetPanel、video-asset-service 无文件交集**
- **决策：功能分支从 9ce8df36 拉出（已就位）**，主仓 xxw57 的未提交工作不受影响

## 4. 移植边界（G/M 双线实现的分工约定）

| 层 | 策略 |
|---|---|
| 任务/资产/状态语义（scope、talentRef、briefRef、jobId、providerTaskId、状态机） | **共用定义**（S2 产出），双端字段命名对齐 |
| 存储层 | 宿主适配：proma-mit 用 marketing-sqlite-store（建议新表 `influencer_video`，对齐 brief/draft 模式）；ma-proma 用文件 + sidecar JSON（延续 video-asset-service 纯扫描模式） |
| 凭据 | 宿主适配：proma-mit 走 channel-manager 渠道（video-credential-resolver 已就绪）；ma-proma 暂 env，后续可参照 resolver 移植渠道优先模式 |
| 分镜/生成引擎调用 | 以 proma-mit 版为基准实现（Seedance 2.5 协议 + 凭据解析 + 测试），ma-proma 反向移植适配其 VideoInput 接口 |
| UI/IPC | 各自宿主实现：proma-mit 挂 InfluencerModuleView/CreativeVideoPanel；ma-proma 挂 KOLDataManager/CampaignDetail |
| 达人身份 | S2 定义映射：proma-mit `influencer_talent.id` ↔ ma-proma kol CRM ID，显式映射表，不做隐式等同 |

## 5. 凭据机制与现状（S1 前置检查结果）

- proma-mit 机制：`channel-manager`（`~/.proma/channels.json`，key 加密存储）→ `video-credential-resolver` 按 provider 匹配 doubao/minimax 渠道 → env 回退（`VOLCENGINE_API_KEY`/`MINIMAX_API_KEY`）
- **现状：channels.json 仅有 deepseek / kimi-coding / zhipu / proma / openai-codex 五个渠道；无 doubao、无 minimax；两个 env 均未设置**
- ⇒ **S1 真实调用验证阻塞**，需用户提供火山方舟（doubao）或 MiniMax 任一凭据

## 6. S1 待办细化（解除阻塞后执行）

1. 在 proma-mit 模型配置页添加 doubao 渠道（apiKey + baseUrl），或设置 env（二选一，推荐前者）
2. 验证 Seedance 官方模型 ID 有效性（代码内 `doubao-seedance-2-5-260628` 是否为可用模型，以方舟控制台/官方文档为准），必要时在渠道模型配置中显式指定
3. 最小调用链：CreateVideoGenTask → 轮询 → 下载 → ffprobe 校验可播放（记录脱敏证据：任务 ID、耗时、文件大小）
4. FFmpeg 环境核验（版本、libass 字幕滤镜、含空格路径）
5. 真实结果回填台账，冻结 provider/model 清单供 S2 契约引用

## 7. S2 输入提示（可并行推进，不被凭据阻塞）

契约设计需先读：proma-mit `marketing-sqlite-store.ts`（creative_asset/influencer_* 表 + 迁移函数模式）、`creative-video-service.ts`（RunVideoPipelineInput）；ma-proma `video-asset-service.ts`（VideoAssetEntry）、`video-pipeline-tool.ts`（VideoPipelineInput）、`shared/types/campaign.ts`（CampaignKOLPoolItem）。产出：字段级契约文档 + 两端达人 ID 映射方案。
