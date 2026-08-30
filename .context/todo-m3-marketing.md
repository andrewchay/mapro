# Gravitas 营销能力包 M3 — 广告投放包真实化

背景：M0(订阅) + M1(视频素材) + M2(达人包) 已完成。M3 落地广告投放 paid-media 包：
投放计划(Campaign) + 调控建议审批流 + 调控规则(红线/业务/软提示)。

## M3 范围（方案 v4，首期无 API 写钱）
- 投放计划 Campaign：CRUD + 数据看板（花费/CPI/ROI 等核心指标展示）
- 调控审批流：Agent 调控建议(换素材/调预算/暂停) → 人工审批 → 执行状态
- 调控规则引擎：红线(redline)/业务(business)/软提示(hint) 三档，可编辑参数
- 命名规范校验（对齐投放文档：游戏-地区-平台-类型-时间戳-AIUser）

## 任务清单
- [x] P1 PaidCampaign 投放计划 UI（列表 + 新增 + 状态）
- [x] P2 调控建议审批流 UI（pending → 批准/驳回 → executed）
- [x] P3 调控规则引擎 UI（三档规则 + 编辑参数）
- [x] P4 命名规范校验（创建 campaign 时校验命名格式）
- [x] P5 数据看板指标展示（metrcs 预留）
- [x] P6 全仓 typecheck + 冒烟

## 状态
- [x] M2 完成
