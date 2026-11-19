# 修复 brand-dna 未 follow 工作流（R1+R2+R3）

> 2026-11-19 完成。依据诊断：`.context/note-brand-dna-follow-gap-20261119.md`

## 目标（用户指定：修 1+2）

- [x] **R2 统一模板**：SKILL.md 与 workflow agentPrompt 合并为一份完整字段清单（12 项），不再各缺一半
- [x] **R3 前置校验**：brand_dna 进入完成前校验 market-analysis / competitor-analysis / user-analysis 非空，缺失则阻断并明确提示

## 实施内容

### 新增：单一事实来源
`packages/shared/src/utils/brand-dna-spec.ts`
- `BRAND_DNA_FIELDS`：12 项字段定义（名称/小标题/要求/校验别名）
- `BRAND_DNA_FILE_PLAN`：三个产物文件各负责哪些字段
- `BRAND_DNA_PREREQUISITE_STEPS/DIRS/LABELS`：前置依赖定义
- `buildBrandDnaFieldSpec()` / `buildBrandDnaPrerequisiteDirective()`：prompt 生成函数

两处 workflow service 都从这里取，杜绝再次分叉。

### 12 项统一字段
传承层：品牌传承
需求层：用户需求
事实层：产品/服务、品牌阶段、产品现状
诊断层：核心问题、核心目标
价值层：核心价值、附加价值
人格层：品牌人格、品牌语气
定位层：差异化优势

（原先 SKILL 缺事实层/诊断层，prompt 缺价值层/人格层，现在两边一致）

### 改动文件

| 文件 | 改动 |
|---|---|
| `packages/shared/src/utils/brand-dna-spec.ts` | **新增** 单一事实来源 |
| `packages/shared/src/utils/index.ts` | 导出新模块 |
| `packages/server/src/campaign/campaign-workflow-service.ts` | brand_dna agentPrompt 用统一规范；artifactRequirements 由 `BRAND_DNA_FIELDS` 生成；加 `requiredFiles`；新增 `checkPrerequisites` 并在 `completeStepLocked` 入口调用 |
| `apps/electron/src/main/lib/campaign-workflow-service.ts` | 同上，新增 `checkStepPrerequisites` 并在 `completeStepWithValidation` 入口调用 |
| `apps/electron/default-skills/ma-brand-dna/SKILL.md` | 补齐 12 项字段、三文件落盘规范、JSON schema、规则；version 1.0.3 → 1.0.4 |

### 关键坑（已修）

`checkPrerequisites` 最初写成 `BRAND_DNA_PREREQUISITE_STEPS.includes(stepId)`，
但该常量是「brand_dna 依赖哪些步骤」，不是「哪些步骤有前置依赖」，
导致 market_analysis 也被当前置步骤检查，全链路测试 21 个失败。
正确写法是 `if (stepId !== 'brand_dna') return []`。

## 验收结果

- `bun run typecheck`：7 个包全部 Exited with code 0
- `bun test packages/server/src/campaign apps/electron/src/main/lib/__tests__/ packages/shared/src`：**199 pass / 0 fail**
- 新增测试用例：
  - `Slice 3d: brand_dna 缺少前置产物 → 拒绝完成并给出可读原因`
  - 更新 4 处旧夹具（e2e、server 回归、Slice 3c）以匹配 12 项字段与三文件规格

## 尚未做（用户未要求）

- R4 结构校验升级：语义锚点仍是软校验
- R5 版本对齐：v1.0.2 的独占性来源/情绪价值是否要恢复
- 前端未展示软校验提醒

## 生效前提

需要重新打包 App（main 进程 + shared + default-skills 均有改动）。
老 Campaign 的 `campaign-workflow.json` 里保存的是旧 agentPrompt，需重置或新建才生效。
