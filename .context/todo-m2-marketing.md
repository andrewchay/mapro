# Gravitas 营销能力包 M2 — 达人包真实化

背景：M0(订阅机制) + M1(共享素材视频) 已完成。M2 落地达人 influencer 包：
KOL 库 + brief + 达人稿件三态审核(飞书机器人) + 内容追踪。

## M2 范围（方案 v4）
- 达人库 talent：CRUD + 圈选校验
- brief：创建/关联达人
- 稿件三态审核（红/黄/绿卡）——核心，接飞书
- 内容数据追踪
- 内嵌共享素材（M1 已有 VideoPanel）

## 任务清单
- [x] D1 探索 ma-proma 稿件审核(ma-draft-review) + 飞书桥接 + 内容追踪的真实形态
- [x] D2 gravitas 飞书 bridge 能力现状确认（能否支撑达人群内审核）
- [x] D3 talent 库 UI 接入 InfluencerStore
- [x] D4 brief 创建/管理
- [x] D5 稿件三态审核（红/黄/绿卡）+ 审核详情持久化
- [x] D6 内容追踪
- [x] D7 飞书达人审核机器人桥接（含 ma-draft-review skill 迁移）
- [x] D8 全仓 typecheck + 冒烟

## 状态
- [x] M1 完成


## M2 收尾待办
- [ ] 运行时把 ma-draft-review/ma-image-audit seed 到工作区 skills/（部署）
- [ ] 飞书实环境验证 @Bot 审稿链路
