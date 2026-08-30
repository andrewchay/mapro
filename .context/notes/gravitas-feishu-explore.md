# Gravitas 飞书能力 / 达人 / Skill 机制 / LLM 入口 —— 只读探索报告

日期：2026-08-10
范围：`/Users/chaihao/LLM/proma-mit`（gravitas，分支含 marketing）只读探索，未改文件。

## 1. gravitas 飞书能力清单（能否支撑达人审稿链）

文件：`apps/electron/src/main/lib/feishu-bridge.ts`（2123 行）+ `feishu-bridge-manager.ts`（170）+ `feishu-message.ts`（388）+ `feishu-doc-fetcher.ts`（267）+ `feishu-todo-provider.ts`（274）+ `feishu-config.ts`（238）+ `feishu-presence.ts`（73）。

实现方式：`@larksuiteoapi/node-sdk` 的 `createLarkChannel` 长连接（WebSocket），`dmMode:'open'`，`requireMention:false`（群聊仍按 @Bot 过滤）。

| 能力 | 现状 | 结论 |
|---|---|---|
| **发消息** | `sendTextMessage`/`sendCard`（interactive 卡片）/`sendMessage`（群聊自动 thread reply）/`sendCardMessage` | ✅ 够 |
| **收消息** | 长连接 `message` 回调，去重（event_id+message_id），chatId 处理锁，仅处理 text/image/post/file | ✅ 够 |
| **@Bot 检测** | `isBotMentioned` 精确匹配 botOpenId（从 bot/v3/info 拿），群聊仅处理 @Bot 消息 | ✅ 够 |
| **@群成员** | `convertMentionsToAtTags` 把 `@姓名` 转 `<at id=openId>姓名</at>`；`fetchGroupMembers` 拉成员（最多200人，open_id+name 缓存1小时） | ✅ 够（达人群 @执行/Account 可用） |
| **读云文档** | `FeishuDocFetcher`：docx（raw_content）/ sheets（A1最大区域）/ wiki /bitable，解析链接自动识别 | ✅ 够（达人稿件存群文件/文档可读） |
| **卡片交互** | **未接** cardAction（注释明确：cardAction 不通过长连接推送，需额外 HTTP 回调 URL；当前卡片按钮依赖 `/stop` 等文本命令）。卡片仅用于展示、流式回复 | ⚠️ 够但无按钮交互，需文本命令或后续加 HTTP 回调 |
| **群聊消息处理** | `createFeishuChatMcpServer` 注入 `fetch_group_chat_history` 工具（SDK MCP，最多50条，before_timestamp 翻页） | ✅ 够（浏览器/Agent 可读群历史上下文） |
| **流式回复** | `handleAgentPayload`→ 流式卡片 + `sendAgentReply` 分段长文 | ✅ 加分项 |
| **@成员回环防护** | bot 自发改消息去重，避免 bot 回复被当用户消息重入 | ✅ 加分项 |

**结论：能支撑「达人群内发稿→审稿→@成员」全链。** 唯一注意：卡片按钮交互（cardAction）需要通过单独配置 HTTP 回调 URL 启用（飞书卡片 action 不随长连接推送）。当前方案里 Agent 侧用文本指令或纯内容回复即可覆盖审稿场景，无需按钮。

## 2. 达人相关现状（除 marketing/ 外）

- **已有 UI 骨架**：`apps/electron/src/renderer/components/influencer/InfluencerModuleView.tsx`，子视图 tabs：`达人库(talents)` / `稿件审核(reviews)` / `内容追踪(tracking)`；`reviews` 选项卡目前是 placeholder，描述「达人稿件三态审核（红/黄/绿）机器人，飞书桥接」——**正是要建的位子**。
- 关联入口：`LeftSidebar`、`work-module-registry`、`work-module-ipc-handlers`、`active-view`、`project-agent-service` 中已引用 influencer。
- **marketing/**：`apps/electron/src/renderer/components/marketing/` + `apps/electron/src/main/lib/marketing/`（creative-video、video-pipeline、storyboard、marketing-sqlite-store、marketing-service）+ `CapabilitiesView`。influencer 模块内嵌了 `CreativeVideoPanel`（共享素材/视频生成）。
- **无**现成的 ma-draft-review / ma-image-audit 审核逻辑、无达人稿件状态机代码（只有 UI 占位 + 共享素材）。

## 3. Skill 目录结构现状 + 加载/触发机制

**目录结构** `apps/electron/default-skills/`：brainstorming、docx、executing-plans、find-skills、guizang-ppt-skill、pdf、pptx、proma-coach、skill-creator、tool-builder、writing-plans、xlsx。
**当前不含** `ma-draft-review` / `ma-image-audit`，也**不含** marketing 相关 skill（这些在 ma-proma repo 的 `apps/electron/default-skills/` 下，需迁移）。

**加载/触发机制**（核心）：
- 运行时配置目录 = `~/.gravitas/`（`APP_CONFIG_DIR_NAME='.gravitas'` in `app-identity.ts`，注释旧写 `.proma-mit` 但实际用 `.gravitas`）。
- **工作区 skills 目录** = `~/.gravitas/agent-workspaces/{ws_slug}/skills/<slug>/SKILL.md`；禁用移往 `skills-inactive/`（SDK 不扫）。
- 新工作区创建时从 `~/.gravitas/default-skills/` 复制。
- **SDK 发现**：`ensurePluginManifest(ws.slug)` 保证工作区含 `.claude-plugin/plugin.json`，SDK 靠 plugin 目录发现 skills。
- **Agent 会话自动挂载**（`agent-orchestrator.ts:2416-2418`）：非 workflow 的常规 agent 会话 `plugins: [{ type:'local', path: getAgentWorkspacePath(workspaceSlug) }]` → 整个工作区（含 `.claude-plugin` + `skills/`）自动进 SDK → **工作区所有 active skills 自动可调用**。
- **Workflow 运行**：`prepareWorkflowSkillPlugin(ws,sessionId,skillSlugs)` 把声明的 skill 拷到 session `.workflow-plugin/` 独立注入。
- **ReadSkill 工具**：`tool-impls/skill-tool.ts` 实现 `ReadSkill`（读工作区指定 skill 的 SKILL.md / 子文件，转 `readSkillFile`，有路径逃逸防护 + 10MB 限制）。Agent 用 `<available_skills>` 清单 + `proma-workspace-{slug}:{skillSlug}` 限定名触发。
- **可调用性已验证**：`ReadSkill` 在 SDK tools 中（skill-tool.ts），非单独 MCP，任何 agent 会话可用。

## 4. LLM 渠道调用入口（对应 ma-proma 的 ChannelManager）

文件：`apps/electron/src/main/lib/channel-manager.ts`（918 行）。
- 加解密：`encryptApiKey`/`decryptKey`/`decryptApiKey(channelId)` 基于 Electron `safeStorage`（系统 keychain 加密）。获取明文 API key 用 `decryptApiKey(channelId)`。
- 结构：`listChannels()` / `getChannelById(id)` / `createChannel` / `updateChannel` / `deleteChannel` / `testChannel` / `fetchModels`。
- 支持 provider：anthropic-compatible / openai-compatible / deepseek / google。
- 渠道列表持久化在 `~/.gravitas/channels.json`。

**Agent 会话如何用渠道**：
- `agent-session-manager.createAgentSession(title, channelId, workspaceId)` 建会话绑 channel。
- `agent-orchestrator.ts:1754` `decryptApiKey(channelId)` 拿明文 → 传给 `@anthropic-ai/claude-agent-sdk` 自定义 endpoint / env。
- `chat-service.ts:268/736` 同样用 `decryptApiKey` + `listChannels`（用于标题生成等）。
- **feishu 会话全走同一链路**：`feishu-bridge.ts` `createNewSession` 用 `botConfig.defaultChannelId ?? appSettings.agentChannelId` 建 `createAgentSession`；`handleUserMessage` 调 `runAgentHeadless({... channelId, workspaceId, ...})` → 走 `agent-orchestrator`（含渠道解密 + 工作区 skills 自动挂载 + 群聊历史 MCP 合并）。**= 完整等价的 ma-proma ChannelManager 解密 LLM 入口，Agent 审核可直接使用。**

## 5. 关键迁移点

- ma-proma 的 `apps/electron/default-skills/ma-draft-review/`（SKILL.md 1.1.27 + scripts）和 `ma-image-audit/`（SKILL.md）**未**在 gravitas 的 ma-proma workspace skills 或在 default-skills 中 → 迁移即把这两个目录拷入目标工作区 `skills/`（或 `~/.gravitas/default-skills/`）。
- 飞书 Bridge 代码 ma-proma 与 gravitas 都已有（同源），但 gravitas 版本更完整（含群历史 MCP、流式卡、@成员 at 标签）。**优先复用 gravitas 版本**。
- `ma-image-audit` 依赖「Kimi 视觉模型」→ 在 gravitas 里通过渠道的视觉能力或 vision-relay-service 落地（需确认 provider 支持 vision），这是迁移时唯一需要额外对接的点。
