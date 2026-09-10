# 会话任务进度

## 营销 Skills 归位营销 Plugin 补齐（2026-09-10）

- [x] 探索 proma-mit plugin/skill 机制（plugin-manager、marketing-plugin、skill 集市、会话装配）
- [x] 确认内容源：ma-proma main 27 个（feat 分支落后 4 个 + 缺 ma-pgy-invite）
- [x] 产出实施规划 → `.context/plan/marketing-skills-plugin-completion.md`
- [x] 批次 0：Spike 验证 SDK 多 local plugin ✅（sdk.mjs `for(let d$ of G1) push("--plugin-dir", path)`，官方支持）
- [x] 批次 1：内容源落地 ✅（27 skills + electron-builder + getMarketingSkillsDir/seedMarketingSkills + bootstrap）
- [x] 批次 2：贡献面扩展 ✅（agent-skills surface + PluginSkillContribution + contributeSkills + collectContributingSkills）
- [x] 批次 3：同步装配 ✅（marketing-skills-sync 四态 + bootstrap/IPC 双触发 + orchestrator 双 plugin 装配）
- [x] 批次 4：smoke 校验 ✅（打包断言 + 订阅分发/清理烟测）
- [x] 批次 5：测试收口 ✅（三文件 31 pass / 0 fail；tsc 零错误）
- [x] 提交：proma-mit `feat/marketing-skills-plugin` 分支 d4dcfd12（74 文件 +13327）

**遗留（非本任务）**：marketing-plugin.test.ts 的 3 个基线 flaky 测试（Given 已目录化 / contributePrompts / collectContributingPrompts）——目录化工具在 bun 环境加载不全 + 058fe620 语义变更未完全同步测试，基线同样失败，本轮联跑时实际通过。

**待人工验证**：打包烟测（bun run package-smoke）+ 真机端到端（订阅 influencer → 新会话 skill 可见）。
