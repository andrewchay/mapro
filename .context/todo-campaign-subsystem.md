# gravitas Campaign 子系统迁移

目标：把 ma-pro-ma 的 campaign-manager（3004 行 Campaign 项目管理子系统）迁移到 gravitas，
解冻 ma-tools-pending 里隔离的 3 个工具（campaign-agent/content-tracker/ma-phase-reviewer）。

## campaign-manager 依赖（已探明）
- node:fs/path/os
- ./config-paths, ./agent-workspace-manager
- ./ma-tools/kol-data-service, ./ma-tools/content-audit（已迁到 marketing/ma-tools/）
- @ma-pro-ma/shared 的 campaign 类型（Campaign/CampaignCreativePlan/CampaignPhasePlan/CreateCampaignInput/KOLListItem 等）
- 内嵌 Python 字符串（sqlite3/json/os）

## 任务清单
- [x] C1 梳理 campaign-manager 全依赖 + 类型需迁移清单
- [x] C2 迁移 shared campaign 类型到 gravitas（Campaign/CampaignPhasePlan/CreativePlan/CreateCampaignInput 等）
- [x] C3 迁移 campaign-manager 到 gravitas（路径+@gravitas 适配）
- [x] C4 适配 campaign-manager 对 kol-data-service/content-audit 的引用路径
- [x] C5 解冻 3 个 pending 工具（campaign-agent/content-tracker/ma-phase-reviewer）并接入
- [x] C6 移除 tsconfig 排除 + 全仓 typecheck
- [w] C7 冒烟验证（Campaign 创建/阶段推进/循环）

## 状态
- [x] 决策：做 Campaign 子系统
