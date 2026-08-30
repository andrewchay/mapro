# ma-proma 达人营销 → gravitas 补齐执行追踪

## 层一：Skill 补齐
- [x] S1 覆盖 gravitas 工作区 12 个 inactive skill（版本落后者用 ma-proma 最新版）
- [x] S2 补齐 gravitas 缺失的 ~10 个 skill（ma-brand-house/ma-kol-crm/ma-kol-portal/ma-market-analysis/ma-publish-data-track/ma-script-studio/ma-consumer-insight/ma-content-audit/ma-creative-roi/ma-kol-history-review）
- [x] S3 启用达人营销核心链路 skill（文档生成+达人搜索+投放）
- [x] S4 验证带脚本 skill（ma-kol-scraper/ma-marketing/ma-publish-data-track 的 Python 脚本 + playwright/CDP 环境）

## 层二：ma-tools 可执行体（关键决策）
- [x] T1 迁 knowledge 3 个 json（case-playbooks/industry-templates/platform-guidelines）
- [x] T2 适配 gravitas LLM 入口（重接 content-audit/creative-pilot 等核心工具到 gravitas channel-manager）
- [x] T3 选核心 ma-tools 重接做通（content-audit/creative-pilot/kol-search）

## 收尾
- [x] V1 全仓 typecheck
- [x] V2 工作区 skill 实际触发冒烟


## 运行时缺口（记录）
- ma-kol-scraper 采集需 python playwright + Chrome CDP + 蒲公英登录态（当前未装/未配置）
- ma-image-audit 需 Kimi 视觉 key 或 gravitas 多模态渠道
