# MAPro 广告投放能力 — 评估与规划（2026-08-08）

## 背景

- 用户方向：给 MAPro 加「API 对接多媒体的自动投放执行层」（Meta/Google/TikTok 等，让 Agent 能自动建广告/调预算/暂停/换素材）。
- 参考：mihoyo 内部「投放 Agent 系统理解文档」（workspace-1786098384381 工作区 docs 下）。
- MAPro 现状：开源通用本地 Agent 工作台；已有 KOL/Campaign **项目管理**（KOL 候选池、Brief、内容审核、投流分析，SQLite：campaign-database.sqlite / kol-database.sqlite）；已有 Skill：ma-paid-media（策略规划）、ma-marketing、ma-kol-pyramid、ma-ugc-campaign 等。

## 核心推荐（分层）

- 方案整体推荐度：**有条件推荐，但强烈建议走「最小闭环」而非一步到位的全平台自动执行**。
- 复用程度排序（从高到低）：
  1. **调控规则引擎（红线/业务规则/软提示三档）**——移植成本低、价值高。
  2. **命名规范 + 唯一时间戳 + G 序号连续递增**——保证可追溯/可监控。
  3. **审批流（Agent 只读提出操作 → 人工批准后执行）**——安全底线，必须保留。
  4. **调控目标阈值（净 ROI365 ≥ 目标线/盈亏线）与数据窗口回退**。
  5. **策略闭环（洞察→假设→实验）**——可用 Skill 实现，不必全做。

- 不建议在 MVP 阶段照搬：多级归因体系（ROI1~7、净增 ROI365）、LangGraph/CrewAI Runtime、知识反哺闭环、对话沉淀、版本周期/预算计划审批等——对开源通用产品过重，且依赖 mihoyo 内部数据（SG 归因、LTV、MBI DataWind）。

## MVP 建议切面（第 1 期）

1. **单一媒体先打通**（推荐 Google Ads 或 Meta 之一，别一次性多平台）。
2. 能力闭环：拉数据 → 读规则 → Agent 生成调控建议（换素材/调预算/暂停/补素材）→ 人工审批 → 执行 → 记录执行日志。
3. 落地形态建议 = **Skill（ma-paid-media 升级）+ 少量数据模型**，而不是独立重型 Runtime。MAPro 的 Agent 工作台本身就是很好的编排器。
4. 先做「只读分析 + 调控建议 + 审批」，后做「自动执行」。

## 值得注意的坑

### 1. 权限与审批（最高优先级，参考调研系统「红线」）
- 调研系统明确：审批模式=后端代理，Agent 默认只读/写，操作需审批；命名红线（AIUser 后缀）强制保留，Agent 仅监控含该后缀的广告。
- MAPro 必须做：媒体凭证独立安全存储、写操作（建广告/花钱/暂停）一律人审、审计日志齐全、敏感凭据不落 prompt。
- 媒体 API 凭证是金库级资产，泄露=资金风险。MAPro 本地存储优先策略对凭证安全提出了更高要求（建议走系统 keychain 而非 JSON 明文）。

### 2. 归因依赖（极易被低估）
- 调研系统所有 ROI/CTR/CVR/CPI 背后有 SG 归因 + LTV，且「缺数据时回退窗口」「无数据时自动判断关闭」。
- MAPro 个人/中小场景大概率没有归因服务：**必须先定义清楚「成功的口径」**。可能需要接第三方归因（AppsFlyer/Adjust/Branch）或先只用媒体端到端指标（转化数/花费/CPA），别急着算净 ROI365。

### 3. 跨媒体差异
- 四家 API 能力矩阵不一（调研系统：YouTube 缺创建/预算/暂停能力）。
- 每家凭证体系、素材规范、审核周期、出价参数不同。一次做多家=翻倍的坑。
- UAC 优化的多语义（uac1.0 安装 / uac2.5 行为 / uac3.0 价值）要先映射成 MAPro 侧统一的抽象。

### 4. AI 审核与素材合规（被调研文档略过但致命）
- 自动建广告的素材必须过平台审核；内容违规会被拒或被封号、烧钱无产出。
- MAPro 已有「AI 内容审核」能力（Campaign 侧）——这是 MAPro 相对该内部系统的差异化亮点，可直接复用到广告素材审核。

### 5. 规模化与资金
- 自动投放=自动花钱。必须有：预算上限熔断、每日消耗封顶、异常（CPA 飙升/零转化）告警、紧急止损动作。
- mihoyo 有「忘本水果店营销复盘」类小客户场景——MVP 建议用真实但小额预算的渠道验证，而不是测试数据。

## 结论一句话

「API 自动投放执行」方向有价值但重，**不要照搬 mihoyo 的重型系统**；推荐拿它当『方法论/规则/命名/审批』的参考蓝本，在 MAPro 上以「Skill + 审批流 + 单媒体 + 只读优先」的最小闭环切入，跑通后再横向扩展平台与能力。

---

## 追加评估：ma-proma vs proma-mit（2026-08-08 追加）

### 用户澄清后的真实意图
- ma-proma **未停摆**（只是这几天跑业务未提交）；不能以活跃度判断。
- 两个项目是有意分化：
  - **proma-mit（gravitas，@gravitas/*）** = 未来**企业 OS 的基石**，通用 Agent + 团队协作，现在还不稳固、快速迭代中。
  - **ma-proma（@ma-proma/*，Proma 上游 fork）** = **专门 for 营销存在**（KOL/Campaign/投流领域）。

### 关键技术事实（影响迁移难度）
- **proma-mit**（1183 提交）：已有 work-module 注册表框架（项目/日程/自动化 3 核心模块）+ apps/executor + apps/server（多租户服务端）+ 凭据 KMS 治理 + 审批门 + Context Hub/Work Graph + Run Center/自动化运行中心 + 费用/成本记账。**今天(08-08)仍在 PH2 高频迭代。**
- **ma-proma**（126 提交）：营销体系 =
  - `ActiveView`：`campaigns`(Campaign 管理) + `kol_data`(KOL 数据) 两个独立视图；
  - `main/lib/ma-tools/` 19 个领域工具（KOL-CRM、campaign-agent/optimizer/tester、content-audit、creative-pilot、strategy-iq、script-studio、ma-phase-reviewer、match-ai 等）；
  - renderer `components/agent/` 深度耦合一组 Campaign 对话框（CampaignDetail/Brief/ABTestPanel/ContentAudit/PhaseReview/Create 等）+ agent/Chat 视图内嵌营销工作流；
  - **无 work-module 注册表框架、无 apps/server/executor**。

### 迁移难度判断
- **两个仓库是独立分叉，不是同一 repo → 不要 git merge**，会冲突爆炸。
- 正确做法：以 proma-mit 为主干，把 ma-proma 的营销域**当作『工作模块』重新落地**。
- 营销域重构工作量大，因为它在 ma-proma 里**不是独立模块而是深度耦合在 Chat/Agent 工作流内**：
  - 19 个 ma-tools 工具 → 可作为 `ma-marketing` 数据/逻辑层搬移（相对内聚，难度中）；
  - Campaign 一整套 UI 组件 + 两个 ActiveView → 需重构成 proma-mit 的第 4 个核心 work-module（`ad-delivery` 或 `marketing`），接注册表，难度高；
  - 数据：ma-proma 用本地 SQLite；proma-mit 有 Postgres 服务端 store。个人/中小场景建议先保 SQLite。
- **明显红利**：proma-mit 的凭据KMS治理 + 审批门正是广告投放『媒体凭证 + 人审』所需底座，投放薄服务层成本比在 ma-proma 上做低得多。

### 最终建议
- **以 proma-mit（gravitas）为主干**，将营销域作为 work-module 迁入，是正解。
- 前提是：营销作为差异化业务域，从 Chat 视图里淬炼成**独立模块**（对齐 proma-mit 项目/日程/自动化的模块范式），而非继续嵌在对话里。
- 决策点待用户拍板：营销数据放本地 SQLite 还是 proma-mit Postgres store；是否团队多租户。
