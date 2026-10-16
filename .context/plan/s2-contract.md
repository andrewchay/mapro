# S2 契约：达人视频任务与资产（双端统一）

> 台账任务：S2（todo-ai-video-dual-track.md）｜日期：2026-10-05
> 输入：proma-mit `marketing/marketing-sqlite-store.ts`（630 行）、`marketing/creative-video-service.ts`（182 行）、`marketing/ma-tools/kol-crm.ts`；ma-proma `video-asset-service.ts`（200 行）、`video-pipeline-tool.ts`、`storyboard-engine.ts`、`packages/server/src/kol/kol-database-repository.ts`
> 状态：待验收。G1/G3/M1/M3 开发以本文档为依据。

## 1. 核心决策（5 条）

1. **达人主标识统一为 kol-database `kols.id`**。依据：full-chain 分支已删除独立 TalentsPanel，达人 UI 即 KOLDataManager（kol-database 体系）；`influencer_talent`/`influencer_brief` 表全仓无业务读写，是预留 schema，**不作为标识源**。双端 DB 为同构独立副本（`~/.mapro/` vs `~/.proma-mit/`，kol-crm.ts 内 `~/.mapro` 注释是移植残留），kolId 在各自库内自洽；跨端达人数据同步另案，不阻塞本契约。
2. **归属用 ownerRef 而非 scope 枚举**：`{ ownerKind: 'talent' | 'campaign' | 'project', ownerId }`——talent=新功能主线；campaign=ma-proma 存量；project=proma-mit creative_project 存量。避免"scope"一词与现有 campaign 概念混淆。
3. **生成时冻结达人画像（profileSnapshot）**：达人档案可变，视频必须可追溯"当时用了什么画像"，snapshot 随任务持久化，不随 CRM 更新回写。
4. **任务与资产分离**：job（一次生成流水线）→ 1..n asset（每次成功产出的成片版本）。重试产生新 job；同 owner+brief 下多次生成 version 递增。
5. **proma-mit 落新表、ma-proma 落 sidecar**：proma-mit 新建 `influencer_video` 表（对齐 brief/draft 模式，`CREATE TABLE IF NOT EXISTS` 幂等，零迁移框架依赖，不动 creative_asset 语义）；ma-proma 用目录约定 + sidecar JSON（延续 video-asset-service 纯扫描模式，不引入 SQLite）。

## 2. 标识体系

| 字段 | 类型 | 说明 |
|---|---|---|
| `jobId` | `vt_<uuid>` | 一次生成任务；本地生成，重启后可查询续态 |
| `providerTaskId?` | string | 供应商任务 ID；**逐镜生成=每镜一个**，存 `shots[].providerTaskId` |
| `ownerRef` | `{ ownerKind, ownerId }` | talent: ownerId=kolId；campaign: ownerId=campaignId；project: ownerId=projectId |
| `talentRef?` | `{ kolId }` | ownerKind='talent' 时必填，值=kols.id |
| `briefRef?` | string | 预留；proma-mit D3 实装 influencer_brief 后启用（briefId） |
| `version` | int | 同 ownerRef+briefRef 下从 1 递增 |

## 3. 状态机

**任务状态**（映射现有 orchestrator phase）：

```
queued → generating → composing → success
                    ↘ failed      ↘ failed
queued → cancelled（用户取消，含供应商侧终止）
```
- orchestrator phase `storyboard` 并入 `generating`（分镜在 queued→generating 间完成）；`done` → `success`
- 逐镜进度：`shots[]: { shotId, status: pending|generating|success|failed, providerTaskId?, file? }`

**审核状态**（资产级，人工）：`unreviewed → approved | rejected`；rejected 可带 `reviewNote`；M1 人工审核，M2 P3 挂机器预审结果。

## 4. profileSnapshot（随任务冻结）

```jsonc
{
  "kolId": "…",              // = talentRef
  "name": "达人昵称",
  "platform": "xiaohongshu",
  "styleTags": ["…"],         // 来自 kol_crm.tags / 标签体系
  "persona": "…",             // 人设一句话（kol_crm 现无此字段 → G/M 开发时补列或进 snapshot 手填）
  "tone": "…",                // 口吻
  "audienceNote": "…",        // 粉丝画像备注
  "capturedAt": 0,            // 冻结时间戳
  "sourceHash": "sha1(tags|persona|tone)"  // 档案变更检测
}
```

## 5. 资产模型与双端落地映射

```jsonc
// VideoAsset（契约层，双端同构）
{
  "assetId": "va_<uuid>",
  "jobId": "vt_…",
  "ownerRef": { "ownerKind": "talent", "ownerId": "kol_xxx" },
  "talentRef": { "kolId": "kol_xxx" },
  "briefRef": null,
  "version": 1,
  "file": "final/v1.mp4",            // 相对 assetsRoot
  "durationSec": 15, "resolution": "1080x1920",
  "engine": "seedance", "model": "doubao-seedance-2-5-260628", "channelId?": "…",
  "aspectRatio": "9:16",
  "profileSnapshot": { … },
  "review": { "status": "unreviewed", "note": null },
  "aigcLabeled": false,              // C3 标识状态位（M1 记录，M2 P3 实装）
  "createdAt": 0
}
```

| 契约要素 | ma-proma 落地 | proma-mit 落地 |
|---|---|---|
| 任务持久化 | `video-assets/talents/{kolId}/jobs/{jobId}.json`（含 shots/进度/快照） | `influencer_video_job` 表（CREATE TABLE IF NOT EXISTS，列：job_id PK、kol_id、brief_id?、version、status、engine、model、channel_id?、profile_snapshot JSON、shots JSON、error?、created_at/updated_at） |
| 资产记录 | sidecar `asset.json` 与视频同目录 | `influencer_video` 表（asset_id PK、job_id FK、kol_id、version、file、duration_sec、resolution、review_status、review_note?、aigc_labeled、created_at） |
| 目录/文件 | `video-assets/talents/{kolId}/v{n}/{raw,final,frames}` | 沿用 `{assetsRoot}/video-assets/{raw,final,frames}`，DB 行记录相对路径 |
| 查询入口 | video-asset-service 扫描（按 kolId 过滤） | marketing-sqlite-store 查询（按 kol_id） |

## 6. 旧资产兼容

- **ma-proma 存量** `video-assets/{raw,final,frames}`（无 sidecar）：扫描时视为 `{ ownerKind:'campaign', ownerId:<campaignId>, version:0, review:'unreviewed' }`，不迁移文件、不回写 sidecar（惰性兼容）
- **proma-mit 存量** creative_asset：保持原语义（ownerKind='project' 由 project_id 隐含），`influencer_video` 为独立新表，不碰 creative_asset

## 7. 凭据/引擎字段约定（S1 解阻后冻结）

- `engine` 枚举固定 `seedance | minimax-h3`；`model` 显式存每次任务实际值（当前基准：`doubao-seedance-2-5-260628`，S1 验证后冻结）
- proma-mit：`channelId` 记录所用渠道（resolver 的 channel 源）；ma-proma：M3 阶段移植渠道优先模式，现阶段 env
- 首帧图：双端 `PROMA_CLOUD_API_KEY`（未配置 → image_to_video 镜头自动降级文生视频，记录降级事件到 job）

## 8. 开发引用 checklist

- G1（proma-mit 存储）：建 `influencer_video_job` + `influencer_video` 两表 → 本文档 §5
- G3/M3（任务接线）：状态机 → §3；防重复提交 = 同 ownerRef+briefRef 存在 queued/generating 任务时拒绝或提示
- M1（ma-proma sidecar）：目录与 JSON schema → §5；兼容 → §6
- G2/M2（画像注入）：storyboard 入参 = profileSnapshot（§4）+ VideoInput 现有字段
- D3（Brief 直通）：briefRef 启用时机 = influencer_brief 表实装写入方之后
