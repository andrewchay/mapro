---
name: "ma-kol-scraper"
description: "从蒲公英平台按条件批量采集 KOL 数据并输出 CSV。不再生成独立脚本：通过 CDP 连接 Chrome，用通用采集器 kol_collector.py + 一份 config JSON，由 Agent 自动执行并校验。当用户提到采集/爬虫/蒲公英/KOL 数据/批量导出达人或类似表述时触发。"
version: "2.0.2"
---

# 蒲公英 KOL 采集（通用采集器 + config，Agent 自动执行）

## 设计原则（v2 变更）

1. **不生成独立脚本**。采集逻辑已固化在唯一入口 `scripts/kol_collector.py`（通用参数化采集器，基于已验证的母婴采集逻辑改造）。
2. **Agent 自动执行**。Agent 自己写一份很小的 config JSON（只有筛选参数），然后**自己用 Bash 运行**采集器并读取进度，全程不需要用户敲命令。
3. **WebBridge 不可用于蒲公英**。蒲公英是重前端 SPA，筛选项是自定义 div + JS 事件，WebBridge 的 CSS selector 定位不到；必须走 CDP + `page.evaluate(fetch(...))` 模式（浏览器自动附带 x-s/x-t 签名）。
4. **登录检查不阻塞**。采集器检测到未登录时直接失败退出（不等待 input），由 Agent 提示用户登录后重跑。

## 本 Skill 文件位置

> 路径占位符约定：`<skill>` = 本 Skill 目录（即本文件所在目录，Agent 通过读取本文件路径可得）；`<workspace>` = 当前工作区目录（MAPro 会话的 agent-workspaces/{slug}）。

```
<workspace>/skills/ma-kol-scraper/
├── SKILL.md                          ← 本文件
├── scripts/kol_collector.py          ← 通用采集器（唯一入口，约 1180 行）
├── examples/config-shanghai-food-tandian.json  ← 上海美食探店示例
└── references/
    ├── payload.md                    ← 搜索 API payload 参考
    ├── collect_maternal_kol.py       ← 母婴专项旧脚本（历史参考，勿再使用）
    └── scraper_template.py           ← 旧模板（历史参考，勿再使用）
```

产出写入 `<workspace>/workspace-files/`（config JSON、CSV、debug JSON）。

## 何时使用

**✅ 合适**
- 用户需要从蒲公英批量采集/导出达人数据
- 用户有筛选需求（城市/粉丝量/报价/关键词/内容标签）
- 需要输出含报价、阅读/互动中位数、合作笔记表现的 CSV

**❌ 不合适**
- 只需单个 KOL 详情 → 用 `ma-kol-crm`
- 需要投放策略而非数据 → 用 `ma-kol-pyramid`
- Chrome CDP 未启动或蒲公英未登录（需要用户配合前置条件）

## 核心工作流

### Step 0 · 检查 / 启动 Chrome CDP + 登录（前置条件）

1. 先用 Bash 检查 CDP 是否已开启：
   ```bash
   curl -s --max-time 3 http://127.0.0.1:9222/json/version
   ```
2. 未开启时，给用户两条启动路径（Mac）：
   - **A（推荐，隔离配置）**：
     ```bash
     /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
       --remote-debugging-port=9222 --user-data-dir=/tmp/chrome_pgy_debug
     ```
   - **B（复用已登录的主 Chrome）**：先退出所有 Chrome，再执行同样的命令（不带 `--user-data-dir`）。
3. 等用户确认 Chrome 已启动并在 Chrome 中登录 `https://pgy.xiaohongshu.com` 后，运行环境自检：
   ```bash
   python3 <skill>/scripts/kol_collector.py --check --port 9222
   ```
   输出 `[OK] CDP 已开启` + `[OK] 蒲公英登录态正常` 才继续；否则提示用户补齐前置条件。

### Step 1 · 解析筛选参数（用户已给则直接确认，否则从页面提取）

- 用户一次性给了完整需求（如「上海美食探店 1-5 万粉丝」）→ 直接解析成 config 字段，并简要向用户复述确认。
- 用户需求模糊 → 用 `page.evaluate()` 在蒲公英博主广场页做多策略 DOM 提取（`.d-select` / `.ant-select` / `.d-tabs` / `.d-tag-group` 等），把可用类目/地域/标签选项列给用户选择。**不要**用 WebBridgeClick 去点筛选项（定位不到，且会触发筛选改变页面状态）。
- 分批确认：① 产品/品牌、类目、性别、地域 ② 粉丝量、报价、内容标签 ③ 关键词、粉丝画像（可选）。

### Step 2 · 写 config JSON（唯一的新文件）

把筛选参数写成 JSON，放到 `workspace-files/config_{产品}_{城市}.json`。字段表：

| 字段 | 示例 | 说明 |
|------|------|------|
| `keywords` | `["探店"]` | 搜索关键词；空数组=不限 |
| `gender` | `"不限"` | 不限/男/女 |
| `location_cities` | `["上海"]` | 博主地域 |
| `fans_location_cities` | `[]` | 粉丝地域；空=不限 |
| `target_cities` | `["上海"]` | 详情页二次过滤用；空=不过滤 |
| `target_tags` | `["美食"]` | 内容标签（详情页严格过滤）；空=不过滤 |
| `note_price_lower/upper` | `0 / 100000` | 报价范围（元） |
| `fans_number_lower/upper` | `10000 / 50000` | 粉丝量范围 |
| `first_industry/second_industry` | `""` | 行业类目；取值不确定时留空（参考 `references/payload.md`） |
| `max_pages` | `20` | 搜索翻页数 |
| `max_kols` | `0` | 0=不限 |
| `coop_note_months` | `3` | 合作笔记时间范围（月） |
| `coop_note_pages_max` | `10` | 合作笔记翻页数 |
| `output_file` | `workspace-files/xx.csv` | 绝对路径 |

> 类目说明：蒲公英的 `firstIndustry` 取值需要从前端 payload 观察确认；**稳妥做法是 keyword + target_tags 过滤**（示例已按此配置）。`target_tags` 在搜索阶段宽松过滤、详情页阶段严格过滤。

### Step 3 · Agent 自动运行（关键，不要交给用户）

```bash
python3 <skill>/scripts/kol_collector.py \
  --config <workspace>/workspace-files/config_xxx.json
```

- **由 Agent 用 Bash 执行**，实时读取 stdout 进度（搜索命中 → 逐个详情采集 → MATCH/过滤原因）。
- 采集器每匹配一条就增量写入 CSV，中断不丢已采数据。
- 失败时按输出区分：`[FAIL] CDP 未开启` / `[FAIL] 蒲公英未登录` / `code!=0`（API 拒绝）→ 分别提示用户，修正后重跑。
- 注意：采集详情页较慢（每个 KOL 数秒到数十秒），给 Bash 调用设置足够 timeout（建议 600s+，可分批 `max_kols`）。

### Step 4 · 校验 + 汇报

运行完成后对 CSV 逐行校验：

**🔴 硬性条件（需要修复或确认）：**
1. 合作笔记篇数 > 0 但最低曝光缺失 → 抽屉提取失败，需复核或手动复核该达人
2. CPM 异常高（> 10000）→ 最低曝光解析到极小值，检查 `note_exposure` 逻辑
3. 阅读量 > 曝光量 → 字段映射错误
4. 报价与粉丝量同时为空 → blogger API 异常

**🟡 软性提醒：** 女性粉丝占比 < 0.5（若目标人群为女性需注意）等。

汇报内容：CSV 路径、KOL 总数、命中/过滤统计（`_debug.json`）、前几行摘要、异常清单。

## 产出物（全部在 workspace-files/）

| 文件 | 说明 |
|------|------|
| `config_{产品}_{城市}.json` | 本次筛选参数（下次复用直接改值） |
| `{产品}{城市}KOL采集结果.csv` | 最终 CSV |
| `{产品}{城市}KOL采集结果_debug.json` | 过滤/错误日志 |

## CSV 字段清单（采集器已实现，勿重复编写）

达人名称 / 小红书号 / 内容类目 / 地域 / 粉丝量 / 粉丝所在区域（前五城市）/ 获赞与收藏 / 图文报价（万）/ 视频报价（万）/ 女性粉丝占比 / 日常笔记发布篇数·曝光·阅读·点赞中位数 / 合作笔记发布篇数·曝光·阅读·点赞中位数 / 合作笔记最低曝光（含阅读·点赞·收藏·评论·时间）/ 合作笔记最低点赞（含阅读·收藏·评论·时间）/ 内容标签 / 擅长标签 / 预估CPM / 预估CPE / 数据来源。
（日常与合作笔记均取「仅自然流量」`advertiseSwitch=0`，近 30 天。）

## 关键原则

1. CDP 始终使用用户已打开的 Chrome，不要启动新浏览器实例
2. 搜索 payload 必须完整（模板字段全保留），只替换筛选值
3. 详情页临时标签页用完即关；每 KOL 外层重试 2 次，失败不中断整体
4. CSV 增量写入 + 结束去重重写，多次运行不重复
5. **只写 config JSON，不写采集脚本**——采集器就是 `scripts/kol_collector.py`
6. 所有产出在 `<workspace>/workspace-files/`
7. 平台专注：仅小红书蒲公英

## 上海美食探店速查（本次需求）

需求：美食类目 / 上海 / 粉丝 1万-5万 / 关键词「探店」。

直接使用示例 config（`examples/config-shanghai-food-tandian.json`），已配置：
`keywords=["探店"]`、`location_cities=["上海"]`、`target_cities=["上海"]`、`target_tags=["美食"]`、`fans 10000-50000`、报价放宽 0-100000。

```bash
# 1) 环境自检
python3 <skill>/scripts/kol_collector.py --check --port 9222
# 2) 复制示例配置并自动运行
cp <skill>/examples/config-shanghai-food-tandian.json <workspace>/workspace-files/config_上海美食探店.json
python3 <skill>/scripts/kol_collector.py --config <workspace>/workspace-files/config_上海美食探店.json
```

如发现 `firstIndustry` 的真实取值，按 `references/payload.md` 的方法从前端 payload 抓取后填入 config。

## 版本历史

- **v2.0.2**（2026-08-01）：末尾写入改为「合并已有行」，断点重跑不再丢旧数据；`net::ERR_*` 网络中断纳入自动重连判定；CSV 新增独立 `userId` 列，断点续采改用 csv 模块按 userId 去重（兼容旧 CSV 回退小红书号列）。
- **v2.0.1**（2026-08-01）：location 支持省市区 token 匹配（修复杭州被误滤）；搜索阶段同时检查 contentTags/featureTags/personalTags；CDP 断线自动重连并重试一次；断点续采跳过已产出 KOL。
- **v2.0.0**（2026-08-01）：改为通用采集器 `scripts/kol_collector.py` + config JSON，Agent 自动执行；不再生成独立脚本。
