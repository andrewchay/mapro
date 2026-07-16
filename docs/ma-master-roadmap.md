# MAPro 主路线图（Master Roadmap）

> 将 `TASKS.md` 与各专项设计文档的待办整合为单一进度来源。  
> 更新规则：完成项移至「已完成」并标注日期；新增规划按优先级归入对应章节。  
> 源文档：`TASKS.md`、以及已归档至 `docs/archive/` 的以下专项文档：  
> `ma-implementation-plan.md`、`phase-review-design.md`、`browser-agent-design.md`、`web-scraper-login-anti-crawl-plan.md`、`kol-platform-capability-research.md`、`ma-cleanup-plan.md`、`ma-4a-workflow-review-plan.md`、`proactive-scheduler-monitor-design.md`、`ma-test-report.md`。

---

## 1. 当前状态速览

| 指标 | 状态 |
|------|------|
| 全量测试 | `bun test --isolate` **610 pass / 0 fail**（Campaign 工作流 E2E 已修复） |
| 类型检查 | `bun run typecheck` 全包通过 |
| 核心已落地 | 14 步 Campaign 工作流、KOL 数据库、Browser Agent 脚本/视觉模式、Computer Use UI、基础 MA Chat Tools / Skills |
| 当前阻塞 | 无 |

---

## 2. 战略方向

基于 `docs/ma-implementation-plan.md`，MAPro 正从通用 AI 工作台演进为**垂直广告营销公司 Agent 系统**，核心围绕五大方向：

1. **架构设计文档**：补齐系统架构、数据模型、接口契约、Agent 协作流程。
2. **Skill 开发**：补齐缺失的 Agent 模式 Skill（内容审核、达人历史审阅、投放测试/优化、达人 CRM 等）。
3. **代码实现**：新增 Chat Tool、扩展 KOL 数据库、完善 MCP Server。
4. **Agent 工作流编排**：把阶段 1–5 串联成可自动化执行的营销工作流。
5. **数据模型完善**：品牌档案、创意资产、达人 CRM、投放测试、效果记录。

---

## 3. 近期待办（Active / P0–P1）

### 3.1 Campaign & 内容核心功能

| # | 任务 | 来源 | 状态 | 关键交付 |
|---|------|------|------|----------|
| 1 | **Web 端 Brief 生成 / 内容审核 / 内容追踪录入** | `TASKS.md` | 🔴 未开始 | Campaign 核心编辑功能 Web 化 |
| 2 | **阶段复盘 & AB 测试** | `phase-review-design.md` | 🔴 未开始 | `campaign_phase_reports` / `campaign_ab_tests` / `PhaseReviewPanel` |
| 3 | **内容审核工具闭环** | `ma-implementation-plan.md` | 🟡 部分完成 | `ma-content-audit` Chat Tool / Skill 已存在，需接入工作流与 UI |
| 4 | **达人历史审阅** | `ma-implementation-plan.md` | 🔴 未开始 | `ma-kol-history-review` Skill + 数据库扩展 |
| 5 | **投放测试与优化** | `ma-implementation-plan.md` | 🟡 部分完成 | `campaign-tester` / `campaign-optimizer` Tool 已存在，需与工作流/复盘衔接 |

### 3.2 数据层与跨平台

| # | 任务 | 来源 | 状态 | 关键交付 |
|---|------|------|------|----------|
| 6 | **PostgreSQL 切主配置开关** | `TASKS.md` | 🔴 未开始 | 仅改环境变量即可切换 SQLite / PG |
| 7 | **SQLite/PostgreSQL 方言差异测试** | `TASKS.md` | 🔴 未开始 | CI 同时跑两套数据库测试 |
| 8 | **数据迁移工具**（`~/.mapro/*.sqlite` 导入导出） | `TASKS.md` | 🔴 未开始 | CLI 工具支持桌面数据迁移到 Web / PG |

### 3.3 Browser Agent 与爬取

| # | 任务 | 来源 | 状态 | 关键交付 |
|---|------|------|------|----------|
| 9 | **3–5 个真实登录态页面手动验证** | `browser-agent-design.md` | 🔴 未开始 | 小红书后台、抖音星图等登录态爬取 |
| 10 | **脚本模式 vs 视觉模式 A/B 测试** | `browser-agent-design.md` / `web-scraper-login-anti-crawl-plan.md` | 🔴 未开始 | 效果与成本对比 |

### 3.4 测试与工程

| # | 任务 | 来源 | 状态 | 关键交付 |
|---|------|------|------|----------|
| 11 | **E2E 接入 CI**（配测试用 Provider key） | `TASKS.md` | 🔴 未开始 | `scripts/smoke-test.ts` 加入 GitHub Actions |
| 12 | **Electron↔Web 双端一致性专项** | `TASKS.md` | 🔴 未开始 | 关键路径对比测试矩阵 |
| 13 | **GET_TASK_OUTPUT IPC 真正实现** | 代码 TODO | 🔴 未开始 | 通过 SDK `TaskOutput` 获取任务输出 |
| 14 | **飞书 Chat 模式** | 代码 TODO | 🔴 未开始 | 当前仅提示切换到 Agent 模式 |

---

## 4. 中期待办（P2）

### 4.1 产品清理与入口聚焦

按 `docs/ma-cleanup-plan.md`，清理分为三轮：

| 轮次 | 任务 | 状态 | 备注 |
|------|------|------|------|
| Phase A | UI 入口隐藏（设置面板、BotHub、模式切换、菜单、教程横幅） | 🟡 部分完成 | 低危，可回滚 |
| Phase B | 默认行为调整（默认 Agent 模式、默认启用 MA 工具、营销工作区、Onboarding 改造） | 🟡 部分完成 | 中低风险 |
| Phase C | 代码删除（环境检测器、Git diff、无关 Skills） | 🔴 未开始 | 高风险，建议功能稳定后再执行 |
| 品牌改造 | Logo / 图标 / 关于页 / 教程内容替换 | 🔴 未开始 | 与新增功能可并行 |

### 4.2 4A 方法论升级

按 `docs/ma-4a-workflow-review-plan.md`：

| 优先级 | 任务 | 状态 |
|--------|------|------|
| P0 | 升级 `user_analysis` / `brand_concept` / `creative_concept`（注入 4A 检查点） | 🔴 未开始 |
| P1 | 新增 `ma-consumer-insight`、`ma-creative-roi` Skill | 🔴 未开始 |
| P2 | `kol_pyramid` / `search_kols` / `generate_briefs` 形象匹配与 Tone & Manner 升级 | 🔴 未开始 |
| P3 | 方案 B：新增 `consumer_insight` / `campaign_review` 步骤（16 步工作流） | ⚪ 待决策 |
| P4 | 方案 C：4A 主题式重构（18+ 步骤） | ⚪ 远期 |

### 4.3 Proactive Center（主动协作）

按 `docs/proactive-scheduler-monitor-design.md`：

| 模块 | 状态 | 说明 |
|------|------|------|
| durable Scheduler | 🔴 未开始 | MAPro 自己的本地定时任务核心 |
| Monitor（事件监听） | 🔴 未开始 | CI / Release / 文件变化 / WIP 会话等 |
| Routine 模板 | 🔴 未开始 | 可复用工作流模板 |
| TaskRun 审计 | 🔴 未开始 | 统一运行记录 |
| Proactive Center UI | 🔴 未开始 | 左侧 Sidebar 新入口：Today / Schedules / Monitors / Approvals / Runs / Memory |
| Memory 插件化 | 🔴 未开始 | 整合 `MAPro_Proactive` 外置实验 |

---

## 5. 长期 / 战略（P3+）

| # | 任务 | 来源 |
|---|------|------|
| 1 | 完整 5 阶段工作流自动化（投放执行 → 数据回收 → 复盘 → 放量） | `ma-implementation-plan.md` |
| 2 | 效果数据分析与可视化 | `ma-implementation-plan.md` |
| 3 | 达人端 CRM UI（右侧达人管理面板） | `ma-implementation-plan.md` |
| 4 | 官方平台 API 接入评估（巨量星图 / 蒲公英） | `kol-platform-capability-research.md` |
| 5 | 插件市场 / 第三方 Routine 生态 | `proactive-scheduler-monitor-design.md` |

---

## 6. 已完成（参考归档）

### 6.1 工作流与 Campaign

| 任务 | 来源 | 完成时间 | 说明 |
|------|------|----------|------|
| 14 步 Campaign 工作流（含校验/重置/预览 UI） | `TASKS.md` / `ma-implementation-plan.md` | 2026-06-29 | Electron / Web UI 双端可用 |
| Web 端工作流执行按钮 | `TASKS.md` | 2026-06-29 | `completeCampaignStep` + BDD 测试 |
| 文件预览组件（图片 / PDF / Markdown） | `TASKS.md` | 2026-06-29 | `FilePreviewDialog` |
| Campaign 候选池 / Brief / 内容追踪 | 既有功能 | - | 核心数据模型已就绪 |

### 6.2 Browser Agent

| 任务 | 来源 | 完成时间 | 说明 |
|------|------|----------|------|
| 模式 A：脚本自动化 MVP | `browser-agent-design.md` | - | `BrowserAutomationService` + `web_scraper` Chat Tool |
| 持久 Profile + Cookie 注入 + 反检测参数 | `web-scraper-login-anti-crawl-plan.md` | - | 登录态复用 |
| 模式 A 增强（批量 URL、重试、自定义模板、定时爬取、KOL 导入） | `browser-agent-design.md` | - | `scheduled-scraping-service.ts` |
| 模式 B：Computer Use 视觉循环 | `browser-agent-design.md` | - | 自研视觉循环 + MCP 注入 |
| Computer Use 专用 UI（`ComputerUsePanel`） | `browser-agent-design.md` | - | 实时截图、动作历史、暂停/继续/单步/终止 |
| 人工审批流程（单步模式） | `browser-agent-design.md` | - | 每步执行后暂停等待用户确认 |

### 6.3 系统能力与 Web 策略

| 任务 | 来源 | 完成时间 | 说明 |
|------|------|----------|------|
| 文件附件 API（上传 / 预览） | `TASKS.md` | 2026-06-28 | scope/id 安全隔离 |
| 工作区文件系统 Web 化 | `TASKS.md` | 2026-06-29 | `workspace-file-service` + attachments |
| 设置 / 用户档案 API | `TASKS.md` | 2026-06-28 | 跨平台 AES-256-GCM 加密 |
| 渠道 CRUD（Web） | `TASKS.md` | 2026-06-28 | 模型拉取、连接测试 |
| Agent 设置面板 | `TASKS.md` | 2026-06-29 | 默认渠道 / 模型 / 工作区 / 权限模式 |
| 拖拽上传 | `TASKS.md` | 2026-06-29 | `ChatPage` 多文件拖拽 |

### 6.4 Agent 服务端化安全

| 任务 | 来源 | 完成时间 | 说明 |
|------|------|----------|------|
| 命令审计日志 | `TASKS.md` | 2026-06-28 | JSONL 持久化 |
| 资源限制（Docker / native） | `TASKS.md` | 2026-06-28 | CPU / 内存 / 网络 |
| 危险工具 / 命令禁用清单 | `TASKS.md` | 2026-06-28 | 环境变量可配置 |
| 沙箱隔离专项测试 | `TASKS.md` | 2026-06-28 | Docker 默认挂载策略 |

### 6.5 部署与文档

| 任务 | 来源 | 完成时间 | 说明 |
|------|------|----------|------|
| Docker 实测闭环 | `TASKS.md` | 2026-06-28 | `docker compose up` + health + Campaign CRUD |
| README Web 部署说明 | `TASKS.md` | 2026-06-29 | Docker Compose + 环境变量 + 安全约束 |

---

## 7. 部署与上线检查清单

来自 `docs/kol-platform-capability-research.md`：

- [x] `bun run --filter='*' typecheck` 通过
- [x] `bun test` 通过
- [ ] `bun run scripts/smoke-test.ts` 通过
- [ ] 前端 `apps/web-ui/dist/` 已生成且被服务端正确托管
- [ ] 环境变量已配置（端口、数据目录、API Token / JWT Secret）
- [ ] 数据库目录已持久化，不会被容器重建清空
- [ ] 反向代理已配置 `MAPRO_TRUST_PROXY=1` 或 `NODE_ENV=production`
- [ ] WebSocket 端口已在防火墙/安全组放行

---

## 8. 关键决策与风险

| 决策点 | 选项 | 当前倾向 | 影响 |
|--------|------|----------|------|
| Campaign 工作流 4A 升级方案 | A（轻量）/ B（16 步）/ C（主题重构） | 待决策 | 影响 Skill、UI、迁移、测试范围 |
| 达人端 CRM 数据库 | 独立库 / 复用 KOL 库 | 复用 KOL 库（`kol_crm` 表） | 影响数据迁移与查询 |
| 数据库存储切换 | SQLite 单点 / PG 切主开关 | PG 切主开关待实现 | 影响 Web 端部署与 CI |
| Proactive Center 入口 | Sidebar 新模式 / Settings 子页 | Sidebar 新模式 | 影响左侧导航架构 |
| Computer Use 默认模型 | 绑定 Anthropic / 通用 Vision | 已走通用 Vision 自研循环 | 模型选择更灵活，但需持续维护 prompt |

**风险**：
1. 小红书/抖音官方 API 门槛高，长期依赖 Browser Agent 爬取存在合规与稳定性风险。
2. 视觉模式成本高昂，需严格控制使用场景与最大步数。
3. 新增数据表需要迁移脚本，避免破坏老用户数据。
4. PG 切换涉及方言差异，测试覆盖不足会导致线上问题。

---

## 9. 下一步建议

按「测试已绿、无阻塞」的前提，推荐从以下方向选一个深入：

1. **补齐 Web 端 Campaign 编辑能力**（Brief / 审核 / 追踪录入）—— 直接提升产品可用性。
2. **实现阶段复盘 & AB 测试**—— 与工作流天然衔接，数据价值高。
3. **PostgreSQL 切主开关 + 方言测试**—— 为 Web 端正式部署扫清障碍。
4. **4A 方法论升级（方案 A）**—— 从 `user_analysis` / `brand_concept` / `creative_concept` 开始注入 4A 检查点。
5. **Proactive Center MVP**—— 建立 durable Scheduler + Today 页面，迈向主动协作。

想先推进哪一条？我可以直接展开对应的实施计划。
