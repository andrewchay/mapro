# 营销 Skills 归位营销 Plugin —— 补齐实施规划

> 制定时间：2026-09-10
> 目标：把 058fe620 从 proma-mit `default-skills` 移除的 ma-* skills，以**营销 plugin 订阅状态**为开关补齐回来——不出现在 skill 集市、不默认带入新建项目、取消订阅即消失。

---

## 一、背景与问题定位

- 058fe620（08-27）从 `apps/electron/default-skills/` 移除 27 个 ma-*（含 ma-media-crawler submodule），提交说明："使新建项目不再默认带入"。
- 移除后的副作用：这些 skill 在 proma-mit main 上**无载体**（只活在 feat/marketing-capabilities 分支），营销订阅开启后 Agent 也拿不到这些工作流编排能力。
- 正确归属：跟随 `com.gravitas.marketing` plugin 的订阅状态（`settings.marketingCapabilities`），订阅哪个域才注入哪个域的 skill。

## 二、现状机制图谱（探索结论，规划的依据）

```
【Skill 分发链现状】
app bundle default-skills/ ──(electron-builder extraResources)──▶ 启动同步 ~/.gravitas/default-skills/
                                                                      │
                                              skill-marketplace-service.scanDirectory() │ 集市候选（builtin）
                                                                      ▼
              新建工作区/upgradeDefaultSkillsInWorkspaces：仅 DEFAULT_WORKSPACE_SKILL_SLUGS
              （find-skills / proma-coach / skill-creator）自动注入 skills/（active）
                                                                      ▼
              会话装配（agent-orchestrator.ts:2582-2588）：
              无 workflow policy → plugins: [{type:'local', path: 工作区根}]
              （SDK 经工作区 .claude-plugin/plugin.json 发现 skills/）
              有 workflow policy → prepareWorkflowSkillPlugin() 隔离目录

【Plugin 贡献面现状】
BuiltinPluginRuntime 仅有 contributeTools / contributePrompts（plugin-manager.ts:43）
PluginSurfaceType 枚举无 skills 类型（packages/shared/src/types/plugin.ts）
marketing-plugin v0.2.0：surfaces=['agent-tools']，按 settings.marketingCapabilities
（DEFAULT_ENABLED_CAPABILITIES=[]）过滤 influencer/paid-media/shared 三域
订阅写入口：renderer marketing-atoms → window.electronAPI.updateSettings({marketingCapabilities})
```

**结论**：放回 default-skills = 回到集市/默认带入的老路。正解是**给 plugin 系统开 `agent-skills` 贡献面**，让营销 skill 作为 plugin 订阅资源存在。

## 三、内容源与版本基线

| 项 | 结论 |
|----|------|
| 内容源 | **以 ma-proma main 为唯一来源（27 个）**，feat/marketing-capabilities 分支仅 26 个且 4 个落后 |
| 版本落后项 | ma-draft-review 1.1.27→**1.1.45**、ma-image-audit 1.0.1→**1.0.4**、ma-kol-scraper 2.2.0→**2.6.0**（含互暖排查 #4） |
| feat 缺失项 | **ma-pgy-invite**（蒲公英邀约，ma-proma #3 新增）——必须从 ma-proma 取 |
| 不补齐 | ma-media-crawler（含 submodule，两侧均已彻底移除，不在本次范围） |
| 其余 22 个 | 两侧版本一致，直接从 ma-proma 取（单一来源原则） |

## 四、Skill 分域映射（建议值，实施前可调）

对齐 marketing-plugin 的工具三域分组（influencer / paid-media / shared）：

**influencer 达人包（11 个）**
ma-kol-scraper、ma-kol-crm、ma-kol-portal、ma-kol-history-review、ma-kol-pyramid、ma-draft-review、ma-image-audit、ma-content-audit、ma-publish-data-track、ma-pgy-invite、ma-script-studio

**paid-media 投放包（5 个）**
ma-paid-media、ma-campaign-optimizer、ma-campaign-tester、ma-content-calendar、ma-platform-role-mapper

**shared 策略创意基座（11 个，任一订阅即注入）**
ma-marketing（总纲）、ma-brand-dna、ma-brand-house、ma-market-analysis、ma-competitor-analyzer、ma-consumer-insight、ma-ta-portrait、ma-creative-concept、ma-creative-roi、ma-tone-manner、ma-ugc-campaign

## 五、方案设计

**核心机制**：新增 `agent-skills` surface → plugin 声明 `contributeSkills` → 主进程把启用插件的 skills 增量同步到**工作区级 `.marketing-plugin/` 目录** → 会话装配时作为第二个 local plugin 传给 SDK。

```
apps/electron/marketing-skills/          （bundle 资源，不进 default-skills → 不进集市）
        │ electron-builder extraResources
        ▼
~/.gravitas/marketing-skills/            （用户目录版本基线）
        │ plugin-manager.collectContributingSkills()（按订阅过滤）
        ▼
~/.gravitas/agent-workspaces/{slug}/.marketing-plugin/
  ├── .claude-plugin/plugin.json         （name: proma-marketing-{slug}）
  └── skills/ma-xxx/                     （订阅域命中的 skill，增量同步）
        │ agent-orchestrator 装配
        ▼
plugins: [{type:'local', path: 工作区根}, {type:'local', path: .marketing-plugin}]
```

**备选方案对比**：

| 方案 | 说明 | 结论 |
|------|------|------|
| A. plugin contributeSkills + 工作区 `.marketing-plugin`（本规划） | 订阅驱动、增量同步、与集市完全隔离 | ✅ 采用 |
| B. 会话级临时目录（对齐 prepareWorkflowSkillPlugin） | 每次会话 rm+cp 数 MB，开销大、版本管理重复造轮子 | 备选，若 A 的多 local plugin 验证失败 |
| C. 写回工作区 skills/（active） | 与集市/用户手动管理语义冲突，取消订阅难清理 | ❌ |

## 六、实施批次

### 批次 0：Spike 验证（半天，先决条件）⚠️
- 验证 Proma SDK（agent-orchestrator 装配处）`plugins` 数组传**多个 local plugin** 是否都生效（现网只传过单元素数组）。
- 方法：手工在工作区造 `.marketing-plugin` 骨架 + 改装配处临时拼接，启动会话看 skill 是否出现。
- **失败则切方案 B**（会话级目录由装配处单一传入），后续批次相应调整。

### 批次 1：内容源落地
| 改动 | 文件 |
|------|------|
| 新建 bundled skills 目录（27 个，从 ma-proma main 复制） | `apps/electron/marketing-skills/ma-*/` |
| 打包进 app bundle | `apps/electron/electron-builder.yml` extraResources 增 `marketing-skills` |
| 用户目录路径与启动同步 | `config-paths.ts` 增 `getMarketingSkillsDir()` + 同步函数（对齐 default-skills 的 bundle→用户目录同步模式，config-paths.ts:884 附近） |

验收：打包后 `process.resourcesPath/marketing-skills` 有 27 个 skill；开发模式源码直读。

### 批次 2：plugin 类型与贡献面扩展
| 改动 | 文件 |
|------|------|
| `PluginSurfaceType` + `'agent-skills'`；新增 `PluginSkillContribution { slug; domain; sourcePath; version }` | `packages/shared/src/types/plugin.ts` |
| `BuiltinPluginRuntime` + `contributeSkills?`；新增导出 `collectContributingSkills(): PluginSkillContribution[]`（遍历启用插件、逐个 try/catch，对齐 collectContributingPrompts 模式，plugin-manager.ts:315） | `apps/electron/src/main/lib/plugin-manager.ts` |
| marketing-plugin：manifest surfaces + `'agent-skills'`、version 0.2.0→0.3.0；实现 `contributeSkills()`（SKILL_DOMAIN_MAP 27 项 + 按订阅过滤 + sourcePath 指向 bundle/用户目录） | `apps/electron/src/main/lib/plugins/marketing-plugin.ts` |
| 测试：未订阅返回空、influencer/paid-media/shared 过滤正确、非 electron 环境容错 | `marketing-plugin.test.ts` |

### 批次 3：工作区同步与会话装配
| 改动 | 文件 |
|------|------|
| 新模块 `syncMarketingSkillsForWorkspace(slug)`：目标 `{workspace}/.marketing-plugin/skills/`，增量同步（新增缺失 / parseSkillVersion+compareSemver 版本覆盖 / 删除不再贡献的）、写 plugin.json；订阅为空时整体清理。复用 agent-workspace-manager 的 `safeReplaceSkillDir`/`parseSkillVersion`/`compareSemver`（需 export 或下沉共享模块） | 新建 `apps/electron/src/main/lib/marketing-skills-sync.ts` |
| 触发时机 a：启动时对所有工作区执行（对齐 upgradeDefaultSkillsInWorkspaces 调用点） | `agent-workspace-manager.ts` 或主进程 bootstrap |
| 触发时机 b：ipc.ts 的 updateSettings 处理器检测 key 含 `marketingCapabilities` → 全工作区重同步 | `apps/electron/src/main/ipc.ts` |
| 装配处无 workflow policy 分支：`plugins: [workspace, ...(marketingPluginDir 非空 ? [{type:'local', path}] : [])]` | `agent-orchestrator.ts:2582-2588` |

验收：订阅 influencer → `.marketing-plugin/skills` 出现 11 个达人 skill；取消 → 目录被清理；版本升级 → bundle 更新后自动覆盖。

### 批次 4：体验与防回归
- 验证新建项目（DEFAULT_ENABLED_CAPABILITIES=[]）不生成 `.marketing-plugin`、集市无 ma-* 候选。
- 可选增强：CapabilitiesView 各域展示 skill 数量（读 contributeSkills 元数据）。
- `package-smoke.ts` 增 marketing-skills 完整性校验（27 个目录存在）。

### 批次 5：测试收口
- 单测：collectContributingSkills、syncMarketingSkillsForWorkspace（增/删/升级/清空四态）、装配合并逻辑。
- 手工冒烟：订阅 influencer → 新会话 skill 可见可用；取消订阅 → 下次会话消失（进行中会话不中断）；两个工作区互不影响。
- 端到端：`营销 Campaign 子代理` 会话中验证 skill 与 ma-tools（plugin contributeTools）同时注入、无命名冲突。

## 七、风险与决策点

| # | 风险/决策 | 对策 |
|---|-----------|------|
| 1 | SDK 多 local plugin 支持未验证 | 批次 0 spike 先行，失败切方案 B |
| 2 | skill 与集市同名冲突 | ma-* slug 天然隔离；plugin.json name 不同即可；同步时以 `.marketing-plugin` 为唯一来源 |
| 3 | 订阅变更生效时机 | 下次会话生效（进行中会话不打断）——在 UI 文案中注明 |
| 4 | ma-proma 后续 skill 更新回流 | 规划"从 ma-proma 导出 marketing-skills 的一次性脚本"（scripts/export-marketing-skills.sh），版本 diff 后人工确认再入库 |
| 5 | Python 脚本类 skill 的运行环境（playwright/CDP） | 本规划只管 skill 分发；执行环境验证属 gap analysis 批次 5，不阻塞 |
| 6 | 与 gap analysis 五批次的关系 | 本规划 = gap analysis「批次 1：Skills 补齐」的 proma-mit 侧落地方案，替代其"直搬 default-skills"的原假设 |

## 八、工作量估算

| 批次 | 估算 |
|------|------|
| 0 Spike | 0.5 天 |
| 1 内容源 | 0.5 天（含 ma-pgy-invite 与 3 个版本落后项核对） |
| 2 贡献面 | 1 天 |
| 3 同步与装配 | 1.5 天 |
| 4 体验防回归 | 0.5 天 |
| 5 测试收口 | 1 天 |
| **合计** | **~5 天** |
