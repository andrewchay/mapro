# brand-dna 产出未 follow 工作流 · 根因诊断（2026-11-19）

## 问题
两个项目（vonbon 甄果、闪迪 ELE PLUS）的 brand-dna 结构差异明显，vonbon 那份没有按 ma-brand-dna 的完整链路走。

## 证据

| 项 | vonbon 甄果（brand-dna.md） | 闪迪 ELE PLUS（brand-dna(1).md） |
|---|---|---|
| 生成环境 | 工作区模式（`~/.mapro/agent-workspaces/vonbon/<session>/.context/vonbon-marketing-plan.md`，无 brand-dna/ 目录、无 campaign-workflow.json） | Campaign 工作流（顶部写明"方法：品牌传承→消费者需求→产品架构→竞品定位→核心价值→品牌人格→情绪价值"） |
| 使用的 skill 版本 | v1.0.2（含独占性来源、情绪价值定位两项） | 未带 version 信息，结构覆盖用户需求/产品架构/竞品定位 |
| 实际输出结构 | 品牌传承→核心价值→附加价值→人格→语气→产品定位→DNA总结（7章） | 品牌传承→用户需求→产品架构→核心价值→人格与情绪价值→产品定位（6章） |
| 缺失环节 | 用户需求、产品架构、竞品定位、情绪价值独立章节、独占性来源 | — |

## 根因（按影响排序）

### R1 两条完全不同的链路，产出结构天然不同
- vonbon 走的是「工作区自由对话」：agent 只拿到了 SKILL.md，按 SKILL 的 `## 输出格式`（JSON：heritage / core_values / added_values / personality_traits / tone_of_voice）组织，落盘成 Markdown。
- 闪迪走的是「Campaign 工作流 step brand_dna」：agent 拿到的是 `campaign-workflow-service.ts` 里的 `agentPrompt`（7 条分析框架：品牌历史/产品服务/品牌阶段/产品现状/核心问题/核心目标/差异化优势），结构来自 prompt 而非 SKILL。
- 证据：`~/.mapro/agent-workspaces/campaign-1781536535628-fkyikx0/campaign-workflow.json` 中 brand_dna=completed，但 market_analysis/competitor_analysis/user_analysis 全是 pending。

### R2 SKILL 与 workflow agentPrompt 是两套互不一致的模板（核心缺陷）
| SKILL.md 输出格式 | workflow agentPrompt 要求 |
|---|---|
| heritage（品牌传承） | 品牌自身历史 |
| core_values（核心价值） | 产品/服务 + 现有传播 |
| added_values（附加价值） | 品牌阶段诊断 |
| personality_traits（品牌人格） | 产品现状诊断 |
| tone_of_voice（品牌语气） | 核心问题定义 |
| product_positioning（品类利益点/差异化/证据点） | 核心目标 + 差异化优势 |

SKILL 里完全没有「品牌阶段 / 产品现状 / 核心问题 / 核心目标」，workflow 里完全没有「附加价值 / 品牌人格 / 语气」。agent 在两条链路下必然产出两套结构。

### R3 前置步骤没有硬门禁，"前置产物"只是 prompt 里的一句话
- `agentPrompt` 里写「前置产物：market-analysis/、competitor-analysis/、user-analysis/」，但代码层没有任何校验（`campaign-artifact-validator.ts` 只校验当前步骤自己的目录）。
- 结果：agent 可以跳过市场/竞品/用户分析直接产出 brand-dna，缺少洞察支撑，只能靠 brief 自推导 → vonbon 那份本质是"brief 直读版"，不是"分析驱动版"。

### R4 校验只查关键字覆盖，不查结构完整性
- `artifactRequirements` 是软校验（2026-08-09 改动把语义锚点降级为软提醒），只要 300 字 + 命中几个词就算通过。
- 所以即使缺「核心问题」「核心目标」，completeStep 也不会失败，只会追加一条"建议补充语义锚点"到 outputSummary，前端不展示。

### R5 skill 版本在 2026-10-22 被 downgrade 回 1.0.3 基线
- 9/11 commit `46147cb4` 注入《因为独特》→ brand-dna 1.0.2，新增 `uniqueness_assets`（独占性来源）、`uniqueness_to_mass_path`、`emotional_value`（存在感/满足感）。
- 10/22 commit `3fadbaca` revert 恢复 9/10 基线，version 递增到 1.0.3 但**删除了上述三项**。
- 用户工作区 `~/.mapro/agent-workspaces/vonbon/skills/ma-brand-dna/SKILL.md` 仍是 1.0.2（含三项）；仓库 default-skills 现在是 1.0.3（不含）。⇒ 新旧工作区行为不一致，且 vonbon 那份产出并没有用到 1.0.2 的独占性/情绪价值要求。

## 建议修复（按优先级）

1. **统一模板**：让 `agentPrompt` 显式引用 SKILL 的字段，或在 SKILL 中补齐品牌阶段/产品现状/核心问题/核心目标。二者留一套。
2. **加前置门禁**：brand_dna 步骤在进入前校验 market-analysis/competitor-analysis/user-analysis 三个目录非空，否则阻断并提示先完成前置。
3. **结构校验升级**：把 `requiredFiles`（brand-dna.md / brand-diagnosis.md / differentiation.md）从"建议"升为硬性，并按 SKILL 的字段清单做章节级检查。
4. **版本对齐**：确认 1.0.2 的独占性/情绪价值是否要保留——若保留，重新发版 1.0.4 并同步到所有工作区缓存。
5. **区分模式**：工作区自由对话与 Campaign 工作流使用同一份 brand-dna 模板，避免"同一 skill 两种结构"。

## 附：诊断时读到的关键文件
- `apps/electron/default-skills/ma-brand-dna/SKILL.md`（v1.0.3，无独占性/情绪价值）
- `packages/server/src/campaign/campaign-workflow-service.ts` L186-224（brand_dna 步骤 prompt）
- `packages/server/src/campaign/campaign-artifact-validator.ts`（5 层校验，无前置门禁）
- `.context/note-campaign-artifact-fix-and-local-folder-20260809.md`（语义锚点降级为软校验的决策）
- `~/.mapro/agent-workspaces/vonbon/70a0eeba-.../.context/vonbon-marketing-plan.md`（vonbon 真实产出源）
- `~/.mapro/agent-workspaces/campaign-1781536535628-fkyikx0/campaign-workflow.json`（brand_dna completed 但前置全 pending 的证据）
