# Gravitas 营销能力包 M0 基建 — 实施追踪

目标：在 proma-mit(gravitas) 主干落地「能力中心 + 订阅开关 + 两个业务包(influencer/paid-media)骨架 + 共享素材层」。

## 任务清单
- [x] T1  shared 层：work-module.ts 加 INFLUENCER/PAID_MEDIA/CREATIVE IPC channels + DTO
- [x] T2  renderer：active-view.ts 加 influencer | paid-media
- [x] T3  renderer：work-module-registry.ts 注册两包（core:false）
- [x] T4  renderer：InfluencerModuleView / PaidMediaModuleView 入口组件
- [x] T5  renderer：能力中心订阅面板 CapabilityCenterPanel
- [x] T6  main：creative/influencer/paid-media store 骨架（MarketingStore 接口 + sqlite 实现）
- [x] T7  main：creative-service / influencer-service / paid-media-service 骨架
- [x] T8  main：capability.ts（订阅 manifest + 惰性初始化）
- [x] T9  main：work-module-ipc-handlers.ts 注册三套 IPC
- [x] T10 preload：index.ts 加 marketing bridge（type + impl）
- [x] T11 typecheck 验证 + 冒烟

## 状态标记
- 完成：`- [x]`
- 进行中：`- [w]`（Write 后改）
- 待做：`- [ ]`
