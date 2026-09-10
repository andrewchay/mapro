# 会话笔记

## 2026-09-10 营销 Skills 归位营销 plugin 已实施（proma-mit）

- 分支：proma-mit `feat/marketing-skills-plugin`，commit d4dcfd12（74 文件 +13327）。测试 31 pass/0 fail，tsc 零错误。
- 架构：`agent-skills` surface → contributeSkills → marketing-skills-sync 增量同步到工作区 `.marketing-plugin/` → 会话装配双 local plugin（SDK `--plugin-dir` 多传已 spike 验证）。
- 内容源定版：ma-proma main 27 个（含 ma-pgy-invite；feat 分支的 kol-scraper 2.2.0/draft-review/image-audit 已被 2.6.0/1.1.45/1.0.4 覆盖）。
- 分域定版：influencer 11 / paid-media 5 / shared 11（映射表在 marketing-plugin.ts `MARKETING_SKILL_DOMAINS`）。
- 语义边界（实施中发现并遵守）：storyboard（shared 基础能力）**未订阅也恒在**（既有测试"纯本地恒在"）；ma-* skills 是订阅内容，未订阅不分发。
- 遗留：marketing-plugin.test.ts 3 个 flaky（目录化工具 bun 加载不全，基线即失败）；打包烟测与真机端到端待人工验证。
- ma-proma skill 后续更新回流：人工 diff 后复制到 proma-mit `apps/electron/marketing-skills/`（版本号须递增才会被同步链升级）。


## 2026-09-10 仓库关系澄清：proma-mit = 文档中的 "upstream"

**三方角色：**
- `~/LLM/proma-mit`（origin: andrewchay/proma-mit）= 营销迁移文档中的 **upstream / Gravitas 基座**。ma-proma 的 upstream remote 直接指向 `../proma-mit`。
- proma-mit 的 `feat/marketing-capabilities` 分支 = proma-mit 上的营销集成分支（26 个 ma-* skill 全量、plugin 体系）。
- `~/LLM/ma-proma`（origin: andrewchay/mapro）= 独立营销产品仓库（Skills 27 + ma-tools 21 + Campaign/Server/Web 全套）。

**关键事实：**
1. 两仓库 **git 历史不相关**（merge-base 为空）：ma-proma 根提交 2026-05-22 "Initial commit: fork from Proma"（代码复制后重新 init）；proma-mit 根提交 2026-01-26 "init"。⇒ 不能 git merge/rebase 同步，只能文件级移植。
2. 树级 diff（ma-proma main vs proma-mit main）：1745 文件，+488,364 / -130,653 行（含双方全部演进，非纯营销差异）。
3. proma-mit main 历史曲折：ec7577e1 曾同步 26 个 skill 到 main，058fe620（08-27）又从 default-skills 移除 27 个 ma-*（"使新建项目不再默认带入"）。⇒ main 现存 8 个 skill，与 feat 分支 26 个并存；plugin 体系 / campaign-manager(2994行) / marketing/ma-tools(21文件) / marketing-sqlite-store 仍在 main。
4. gap analysis（.context/marketing-migration-gap-analysis.md）基于 5f63bb17（09-09 fetch）分析；proma-mit 之后新增 15 个提交（至 67021b10，09-10 15:16）全部是 span 瀑布图/治理类，**零营销文件改动** ⇒ 该文档结论当日仍有效。
5. ma-proma 侧同样活跃：9be921c5/f5dc97a3（09-10 07:01）campaign getDb 迁移修复。迁移 diff 时须取两边最新。

**已实测校验（09-10）：** proma-mit main = 8 个 ma-* skill ✅；campaign-manager.ts 2994 行 ✅；campaign-workflow-service.ts 缺失 ✅；marketing/ma-tools 21 个 ts（17 工具 + index/llm-service/ma-tool-prompts）✅。

**迁移含义：** 按 gap analysis 五批次策略执行（Skills 补齐 → Campaign 数据层以 upstream 为基底移植 → ma-tools 差量 → Server/Web 层 → MCP 收尾）；llm-service 需重接 upstream channel-manager，勿直搬。
