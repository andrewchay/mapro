# Gravitas 营销能力包 M1 — 共享素材能力层（视频生成）实施追踪

背景：M0 已完成订阅机制 + influencer/paid-media 骨架 + creative store。M1 落地共享素材的视频生成能力。
ma-proma 的 `packages/server/src/video/` 是纯 node 内置依赖的可搬移层（2563 行，零 @ma-proma 耦合）。
gravitas 无 server 包，ffmpeg 可用。

## 迁移策略
- 把 ma-proma `packages/server/src/video/*.ts`（纯逻辑）拷到 gravitas `apps/electron/src/main/lib/marketing/video/`
- gravitas 侧建 `creative-video-service.ts` 封装（storyboard→生成→合成）
- 接入 marketing creative IPC
- 生成任务/产物落盘 marketing/video-assets/

## 任务清单
- [x] V1  ma-proma video 纯逻辑层拷贝到 gravitas marketing/video/（去掉 bun:test，留纯逻辑）
- [x] V2  校验 import 无残留（node 内置 only）
- [x] V3  gravitas 建 creative-video-service.ts 封装
- [x] V4  建 marketing/video-assets 落盘目录 + ffmpeg 检测
- [x] V5  (可选) marketing-sqlite-store 加 creative_task 建表 + CRUD
- [x] V6  接 creative IPC：生成视频任务
- [x] V7  bun typecheck 全绿 + 冒烟

## 状态
- [x] 探索完成：video 模块可直搬，零耦合
