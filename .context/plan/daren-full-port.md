# ma-proma 达人营销 → gravitas 补齐计划

> 2026-08-10
> 目标：把 ma-proma 达人营销完整工作流（生成文档 + 达人搜索 + 投放）补齐到 gravitas，而非仅有当前的部分骨架。
> 现状：真正验证能跑的仅 video_pipeline + 2 个审核 skill；其余 24 个 skill 与 19 个 ma-tools 缺失或版本落后。

## 分两层推进

**层一：Skill 补齐（低成本，立即做）**
**层二：ma-tools 可执行体迁移（高成本，决策点）**

---

## 层一：Skill 补齐（把 26 个 skill 全部在 gravitas 就位）

现状：26 个 skill，4 个带脚本，22 个纯 SKILL.md。
- 已迁入 gravitas repo `default-skills/`：ma-draft-review, ma-image-audit（2）
- gravitas 工作区已有但版本落后/禁用：ma-creative-concept 等 12 个
- gravitas 缺失：ma-brand-house 等 8 个

### 步骤
1. **同步覆盖**：把 gravitas 工作区 12 个 inactive skill **从 ma-proma 覆盖**（因版本落后，如 ma-creative-concept 1.0.2 vs 1.0.0；ma-script-studio 工作区是空壳）
2. **补齐缺失 8 个**（纯 SKILL.md，直搬）：ma-brand-house, ma-consumer-insight, ma-content-audit, ma-creative-roi, ma-kol-crm, ma-kol-history-review, ma-kol-portal, ma-market-analysis, ma-publish-data-track(带1脚本), ma-script-studio
3. **启用验证**：把属于达人营销工作流的 skill 从 inactive → active（按需，先启用核心链路：文档生成+达人搜索+投放）
4. **带脚本 skill**：ma-kol-scraper(12文件)、ma-marketing(3)、ma-publish-data-track(2)——确保脚本、references、screening_rules.json 一并迁入工作区并验证 Python 依赖（playwright/CDP）

> 成本：低。多为纯 SKILL.md，无代码。主要是文件同步 + 启用 + 环境验证。

---

## 层二：ma-tools 可执行体迁移（关键决策）

19 个 ma-tools 是达人营销智能体的"手"（真正调 LLM/DB/采集/投放），gravitas 一个都没迁。这是拉开"只有 skill" vs "能自动执行"的分水岭。

### 耦合分级（已实测）
| 层级 | 工具 | 依赖 | 迁移策略 |
|---|---|---|---|
| **核心底座** | llm-service(502行) | channel-manager, proxy-fetch, proxy-settings | 🔴 gravitas 有自己的 channel-manager，**适配替换 LLM 调用**，不直搬 llm-service |
| **LLM 依赖型**（相对好迁）| content-audit, creative-pilot, campaign-optimizer, campaign-tester, script-studio, budget-forecast, strategy-iq, match-ai, connect-bot, kol-search | 仅 llm-service + knowledge/*.json | 🟡 重接 gravitas LLM 入口 + 迁 knowledge json |
| **数据/CRM 型** | kol-crm(762), kol-portal(844), kol-data-service(1344) | config-paths + SQLite | 🟡 迁入 gravitas 存储（marketing-sqlite-store 已有表）→ 重写数据层 |
| **campaign 耦合型** | campaign-agent, content-tracker | campaign-manager | 🔴 依赖 ma-proma campaign 体系，需适配/重构 |
| **MCP 型** | kol-data-mcp, kol-data-mcp-tool | chat-tool-config | 🟡 gravitas 有 chat-tool-config，适配 |

### 决策点
- **方案 A（完整自动执行）**：迁移全部 19 个 ma-tools，重接 gravitas LLM/存储。工作量大，但达成"达人营销全自动"。
- **方案 B（Skill 引导 + 人工）**：只做层一 skill，ma-tools 暂缓。工程上先跑通"人用 skill 做文档/搜索/投放"，自动执行后补。
- **建议**：先层一（立刻可用），层二选方案 B 起步，再按需补核心 ma-tools（先 content-audit/creative-pilot 这两个最常用）。

---

## 执行顺序（合并两层）
1. 层一 skill 全集同步/补齐/启用（含脚本环境验证）
2. 层二：迁 knowledge 3 个 json + 适配 gravitas LLM 入口
3. 选 2-3 个最核心 ma-tools（content-audit, creative-pilot, kol-search）重接做通
4. 全仓 typecheck + 冒烟 + 工作区 skill 实际触发验证
