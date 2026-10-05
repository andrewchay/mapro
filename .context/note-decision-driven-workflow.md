# MAPro 决策驱动工作流改造建议

状态：2026-09-29 用户同意第一批实施；已落地 Skill 与桌面 Campaign 提示词层，未做状态机硬门或跨 Web/Server 迁移。

## 现状核查
- apps/electron/src/main/lib/campaign-workflow-service.ts：目标设定在 Brand Concept 之后；goal_setting 仍调用 ma-campaign-optimizer；平台矩阵、KOL、Brief、测试已存在。完成检查以文件、字数、语义锚点为主，不能等同于决策质量验证。
- apps/electron/default-skills/ma-marketing/SKILL.md：完整 Brief 可跳过澄清，仍是策略→选人→建联→创意的旧入口；与 ma-brief-intake 的前置门规则未完全对齐。
- ma-brief-intake 已有五类假设门；上一轮已补情境、反证、身份替换、置信标注、搜索承接和 M0/M1/M2，保留复用。
- ma-campaign-review 已有问题驱动、样本纪律、Keep/Stop/Start；但收藏代表想买等推断需降为待验证代理指标。
- ma-campaign-tester 已有假设和对照设计；不应笼统排除品牌曝光项目，也不能把非随机达人分组自动称为因果实验。

## 推荐改动
1. 统一入口：ma-marketing 完整 brief 只减少提问，不绕过 M0；工程模板同样消费 M0。M0 新增业务主目标、活动类型（事件/常态/混合）、可测数据与承接条件。
2. 两次定义目标：研究前明确业务问题与约束；研究后细化传播任务、指标、验证办法。不要等品牌屋产出后才知道目标。
3. 在现有 goal-setting 产物内增加决策任务表：任务ID、人群×情境、当前判断→目标判断、障碍、主张、证据及来源/置信、行动与承接、验证指标/窗口。
4. 下游消费同一任务表：创意绑定判断与证据；平台绑定职能和触点；达人绑定说服能力；日历及Brief绑定行动与承接。渠道/粉丝层级不预设固定角色。
5. 测量计划前置到目标阶段；测试方案保留在执行前细化。交付、认知、行为、增量分层，不强行要求每项目都证明销售增量。
6. 方案审核补目标—证据—内容—承接一致性，利用已有proposal-review待办，不另造一套流程。
7. 工程分阶段：先同步skill与实际prompt，再结构化关联字段、确认状态及依赖版本；最后做改动失效提示和复盘证据回流。保留旧项目兼容，不重编号全部历史步骤。

## 不改
研究/品牌/创意能力、达人采集尽调建联候选池、审核发布数据回收、M0/M1/M2、Keep/Stop/Start、本地资产和现有状态管理/存储基础。单条创作与局部任务不强制跑全链。稳定品牌资产允许复用并注明适用范围。

## 验证
用同一brief比较改造前后：是否有无对应决策任务的产物；关键判断是否有证据；内容行动是否有承接；不同入口是否绕门；上游变化是否暴露下游受影响项；复盘是否能回答预设问题且不夸大因果。

## 2026-09-29 第一批实施记录
- 修改 9 个 default-skills：ma-marketing、ma-brief-intake、ma-creative-concept、ma-platform-role-mapper、ma-kol-pyramid、ma-content-calendar、ma-proposal-phasing、ma-campaign-tester、ma-campaign-review；各自版本递增。
- 桌面 Campaign `campaign-workflow-service.ts`：M0 提醒、研究记录决策障碍、目标产出任务表，创意/平台/达人/Brief/测试引用任务 ID；`goal_setting` 不再调用复盘后才适用的 ma-campaign-optimizer，改为 ma-marketing。
- 测试：`bun test` 两套工作流测试 46 pass；`bun run --cwd apps/electron typecheck` 通过；`git diff --check` 通过。
- 边界：当前 M0 只是 Skill/prompt 规则，未增加持久确认状态/硬阻断；语义锚点为软校验，测试只能证实提示词与结构不等于实际模型质量。视频不适用时状态机无 skip。Web/Server 工作流及底层 ma-tools 尚未同步，需后续独立梳理。未提交/推送。项目 README/CLAUDE.md 的修改按现有规范需单独获得允许。
