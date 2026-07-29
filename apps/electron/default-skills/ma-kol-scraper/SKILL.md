---
name: ma-kol-scraper
description: 蒲公英 KOL 采集脚本生成器。基于用户产品定位和筛选需求，通过 CDP 连接 Chrome 先查看蒲公英平台可用筛选选项，再生成定制化 Python 采集脚本并运行输出 CSV。适用于 KOL 数据采集、蒲公英达人筛选、自动化爬虫脚本生成、达人数据批量导出。当用户提到"采集"、"爬虫"、"蒲公英数据"、"KOL采集"、"自动采集"、"达人采集"、"生成脚本"、"采集脚本"、"蒲公英爬虫"、"批量采集达人"、"导出KOL数据"时触发。
version: "1.0.0"
---

# 蒲公英 KOL 采集脚本生成器

## 这个 Skill 做什么

根据用户提供的产品定位和筛选需求，自动完成以下流程：
1. **连接 Chrome** — 通过 Playwright CDP 连接本地 Chrome 浏览器
2. **全参数探索** — 访问蒲公英「博主广场」，提取页面上**所有可用的筛选选项**（类目、地域、标签等），以结构化方式展示给用户
3. **交互式获取需求** — 基于探索到的可用选项，引导用户选择性输入参数（而非自由填写）
4. **生成采集脚本** — 根据参数生成定制化 Python 采集脚本，写入工作区文件目录
5. **执行并输出 CSV** — 自动运行脚本，输出带 BOM 的 CSV 到工作区文件目录

## 何时使用

**合适的场景：**
- 用户需要从蒲公英批量采集/导出达人数据
- 用户有特定的产品/品牌，需要按条件筛选合适的 KOL
- 需要定制化的采集脚本（城市、粉丝量、报价等特定条件）
- 需要可复用的数据采集流程

**不合适的场景：**
- 用户只需要单个 KOL 的详细信息（用 ma-kol-crm 或搜索）
- 用户需要的是投放策略而非数据采集（用 ma-kol-pyramid）
- 没有 Chrome 浏览器或蒲公英无法登录

## 前置条件

- Chrome 已开启远程调试端口：`/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222`
- 已在 Chrome 中登录小红书蒲公英（pgy.xiaohongshu.com）
- Python 环境已安装 playwright：`pip install playwright`

## 路径定义

所有生成的文件（脚本、CSV、截图）统一写入以下路径：

```
WORKSPACE_FILES = "<workspace-files-dir>"
```

用户可通过 `WORKSPACE_FILES` 变量访问这些文件，不受会话工作目录变更影响。

## 工作流

### Step 1 · 连接 Chrome

通过 Playwright CDP 连接到用户正在使用的 Chrome。**关键——不要创建新页面**，先遍历已有页面查找蒲公英页面：

```python
import playwright.sync_api
with playwright.sync_api.sync_playwright() as p:
    browser = p.chromium.connect_over_cdp("http://127.0.0.1:9222")
    context = browser.contexts[0]

    # 优先使用已有页面
    target_page = None
    for pg in context.pages:
        url = pg.url
        if "pgy.xiaohongshu.com" in url:
            target_page = pg
            break

    # 没有蒲公英页面 → 使用第一个非 chrome:// 页面
    if not target_page:
        for pg in context.pages:
            if not pg.url.startswith("chrome://"):
                target_page = pg
                break

    # 还是没有 → 创建新页面
    if not target_page:
        target_page = context.new_page()

    # 导航到蒲公英博主广场
    target_page.goto("https://pgy.xiaohongshu.com/solar/pre-trade/note/kol",
                     wait_until="domcontentloaded", timeout=30000)
    time.sleep(3)
```

> 重要：如果 `connect_over_cdp` 因安全策略被拒，请向用户说明情况，请求用户手动允许页面连接。

### Step 2 · 全参数探索（核心改进）

这是最关键的改进步骤。**不要直接问用户要参数。** 先连接蒲公英页面，通过 `page.evaluate()` 提取页面上**所有可用的筛选选项**，再让用户从中选择。

#### 2a. 提取所有筛选选项

使用 JavaScript 从 DOM 提取筛选面板的所有选项：

```python
filter_options = target_page.evaluate("""() => {
    const result = {};

    // 1. 提取所有下拉选择框（.d-select）的选项
    const selects = document.querySelectorAll('.d-select');
    selects.forEach((sel, idx) => {
        const label = sel.getAttribute('placeholder') || sel.textContent.trim();
        // 点击展开选项
        sel.click();
    });
    // 需要逐一点击展开后读取选项...

    // 2. 提取所有筛选项（筛选栏中的可点击项）
    const filters = document.querySelectorAll('.filter-item, .common-filter-item, [class*=filter]');
    filters.forEach(f => {
        const label = f.querySelector('.filter-label')?.textContent?.trim() || '';
        const options = Array.from(f.querySelectorAll('.filter-option, .d-select-option, .d-tag'))
            .map(o => o.textContent.trim());
        if (label && options.length) result[label] = options;
    });

    // 3. 提取 Tab 切换选项
    const tabs = document.querySelectorAll('.d-tabs-header-label, .d-tab');
    const tabOptions = Array.from(tabs).map(t => t.textContent.trim()).filter(Boolean);

    // 4. 提取已选筛选条件
    const activeFilters = document.querySelectorAll('.d-select-active, .d-tag-active, .filter-tag-selected');
    const activeValues = Array.from(activeFilters).map(f => f.textContent.trim());

    return {
        tabs: tabOptions,
        filters: result,
        activeFilters: activeValues,
    };
}""")
```

**实际提取策略（应对不同版本的蒲公英页面）：**

由于蒲公英页面结构可能变化，必须使用**多策略兜底**：

| 策略 | 选择器 | 提取内容 |
|------|--------|---------|
| 策略 A：筛选栏 | `.common-filters-wrapper`, `.note-filters-wrapper`, `.filter-bar` | 所有可视化的筛选标签和下拉 |
| 策略 B：下拉框 | `.d-select`, `.ant-select`, `.el-select` | 点击展开后取 `.d-select-option` / `.ant-select-item` |
| 策略 C：Tab 栏 | `.d-tabs`, `.ant-tabs`, `.el-tabs` | Tab 标题文本 |
| 策略 D：标签组 | `.d-tag-group`, `.filter-tags`, `.tag-list` | 可选标签及其选中状态 |

#### 2b. 截图保存

截取蒲公英页面完整截图，保存到工作区文件目录：

```python
target_page.screenshot(path=os.path.join(WORKSPACE_FILES, "pgy_screenshot_explore.png"), full_page=True)
```

告知用户截图位置，让用户确认页面是否正常加载。

#### 2c. 向用户展示可用选项

将提取到的筛选选项以结构化形式展示给用户，例如：

```
📋 检测到以下可用筛选参数：

【博主类目】护肤、美妆、母婴、美食、穿搭、3C数码、家居、旅行 ...
【性别】女、男、不限
【博主地域】北京、上海、广州、深圳、杭州、成都、重庆 ...
【粉丝量】自定义范围输入
【合作报价】自定义范围输入
【粉丝地域】北京、上海、广州、深圳 ...
【内容标签】护肤、彩妆、母婴育儿、美食制作 ...
【擅长内容】图文、视频
【签约状态】已签约、未签约、不限
【粉丝年龄】18-24、25-30、31-35 ...
【粉丝性别】女、男、不限
【粉丝消费水平】高、中、低
```

然后通过 `AskUserQuestion` 分批引导用户选择：

**第一批（核心参数）：**
1. 产品/品牌名称
2. 博主类目（从可用选项中单选）
3. 博主性别
4. 博主地域（多选）

**第二批（量化参数）：**
5. 粉丝量范围
6. 合作报价范围
7. 内容标签（从可用选项中多选）

**第三批（高级参数——非必选）：**
8. 粉丝地域
9. 粉丝年龄/性别
10. 内容关键词
11. 其他特殊筛选

> 如果用户一次性提供了完整需求（如："我的产品是敏感肌面霜，博主地域杭州上海，女，粉丝2000-10000..."），可直接解析参数、与可用选项交叉验证后向用户确认，无需逐条提问。

### Step 3 · 生成采集脚本

这是核心步骤。基于用户的参数，生成完整的 Python 采集脚本。使用 `scripts/scraper_template.py` 作为参考模板，但必须根据用户的具体参数完全定制。

**脚本写入路径：** `os.path.join(WORKSPACE_FILES, "scrape_<product>_<cities>.py")`

**必须生成以下几部分：**

#### A. 配置部分
将用户参数转换为代码配置字典，包含：
```python
cfg = {
    "brand_user_id": "...",
    "keyword": "...",
    "gender": "...",
    "location_cities": [...],
    "fans_location_cities": [...],
    "target_cities": [...],
    "target_tags": [...],
    "fans_number_lower": ...,
    "fans_number_upper": ...,
    "note_price_lower": ...,   # 报价以元为单位（0.1万=1000）
    "note_price_upper": ...,
    "trade_type": "...",
    "workspace_dir": "...",    # WORKSPACE_FILES 路径
    "output_file": "...",      # CSV 文件名（不含路径）
}
```

#### B. 搜索 API payload
必须保留完整的 payload 结构（40+ 个字段），只替换用户的筛选条件。payload 模板见 `references/payload.md`。

payload 字段详见 `references/payload.md`。

#### C. 地域城市格式化
```python
def format_location_cities(cities):
    result = []
    for city in (cities or []):
        if city in ("北京", "上海", "天津", "重庆"):
            result.append(f"中国 {city}")
        elif city in ("深圳", "广州"):
            result.append(f"中国 广东 {city}")
        elif city in ("杭州", "宁波"):
            result.append(f"中国 浙江 {city}")
        elif city in ("成都",):
            result.append(f"中国 四川 {city}")
        else:
            result.append(f"中国 {city}")
    return result
```

#### D. 详情页采集
使用新标签页方案（继承 `collect_pgy_v4.py` 和 `collect_v3.py` 的成熟模式）：
1. 主页面保持在博主广场，用于搜索列表
2. 每个 KOL 打开一个临时标签页
3. `page.on("response")` 监听捕获 API 数据（blogger/fans_profile/notes_rate/notes_detail）
4. 采集完后关闭临时标签页，防止标签页堆积被踢下线
5. 采集失败自动重试 2 次

**交互步骤（详情页内）：**
1. 等待 blogger API 响应
2. 关闭弹窗
3. 点击「数据概览」tab → scroll 到数据表现区域
4. 切换流量类型到「仅自然流量」
5. 点击「日常笔记」→「合作笔记」触发 notes_rate API
6. 点击「笔记案例」tab → 筛选「合作笔记」
7. 翻页采集合作笔记数据
8. 点击笔记卡片打开抽屉 → 提取曝光量、阅读量、点赞量等

**API 兜底：** 如果 on_response 未能捕获数据，使用 `page.evaluate(js_fetch_json(...))` 主动调用 API 兜底。

#### E. CSV 输出
- 使用 `utf-8-sig` BOM 编码（Excel 可直接打开）
- **去重**：写入前检查文件已有 KOL 名称，避免重复追加
- 文件以产品+地域命名（如 `敏感肌面霜_深圳广州KOL采集结果.csv`）
- CSV 写入路径为 `os.path.join(WORKSPACE_FILES, output_file)`
- 运行完成后告知用户 CSV 路径（工作区文件目录）

#### F. 失败重试和健壮性
- 详情页采集：try/except 包裹每个操作，失败不中断整体流程
- 整页重试：单个 KOL 采集失败时，外层重试 2 次
- 主页面保活：每 10 个 KOL 执行一次 `page.evaluate("1+1")` 检查连接
- 所有异常捕获并输出日志，不中断主循环

### Step 4 · 运行脚本 + 展示结果

生成的脚本写入工作区文件目录（`WORKSPACE_FILES`），通过 `python3` 运行。

```python
script_path = os.path.join(WORKSPACE_FILES, script_filename)
# 通过 Bash 工具运行
# python3 {script_path}
```

运行中实时输出进度。运行完成后：
1. 显示 CSV 文件路径（工作区文件目录）
2. 显示匹配的 KOL 总数
3. 如果有截图文件也一并告知
4. 展示 CSV 的前几行内容摘要
5. 告知用户脚本路径，方便下次复用

### Step 5 · 数据质量校验

运行完成后，**必须**对输出的 CSV 进行数据完整性校验，识别采集异常和错误。撰写一个分析脚本或直接使用 Python 分析 CSV：

```python
import csv

errors = []
with open("output.csv", encoding="utf-8-sig") as f:
    reader = csv.DictReader(f)
    for row in reader:
        name = row["达人名称"]
        issues = []

        # 1. 合作笔记篇数>0但最低数据缺失（抽屉提取失败）
        coop_count = int(float(row["合作笔记发布篇数"])) if row["合作笔记发布篇数"] not in ("", "None", "0") else 0
        min_exp = row.get("合作笔记最低曝光", "").strip()
        min_like = row.get("合作笔记最低点赞", "").strip()
        if coop_count > 0 and (not min_exp or min_exp in ("", "None")):
            issues.append(f"有{coop_count}篇合作笔记但最低曝光缺失（抽屉提取失败）")

        # 2. CPM 异常高（提取到错误极小值）
        cpm = row.get("预估CPM", "").strip()
        if cpm and cpm not in ("", "None"):
            cpm_v = float(cpm)
            if cpm_v > 10000:
                issues.append(f"CPM异常高: ¥{cpm_v:,.2f}（疑似最低曝光提取错误）")

        # 3. 阅读量 > 曝光量（数据矛盾）
        for prefix, label in [("日常笔记", "日常"), ("合作笔记", "合作")]:
            imp = row.get(f"{prefix}曝光中位数", "").strip()
            read = row.get(f"{prefix}阅读中位数", "").strip()
            if imp and read and imp not in ("", "None") and read not in ("", "None"):
                if int(float(read)) > int(float(imp)):
                    issues.append(f"{label}阅读({read})>曝光({imp}) 数据矛盾")

        # 4. 女性粉丝占比异常低
        female_pct = row.get("女性粉丝占比", "").strip()
        if female_pct and female_pct not in ("", "None"):
            f_pct = float(female_pct)
            if f_pct < 0.5:
                issues.append(f"女性粉丝占比仅{f_pct*100:.0f}%（若筛选要求女博主则需复核）")

        # 5. 报价为空
        pic_price = row.get("图文报价（万）", "").strip()
        vid_price = row.get("视频报价（万）", "").strip()
        if pic_price in ("", "None") and vid_price in ("", "None"):
            issues.append("图文和视频报价均为空")

        # 6. 粉丝量为0
        fans = row.get("粉丝量", "").strip()
        if fans and fans not in ("", "None") and int(float(fans)) == 0:
            issues.append("粉丝量为0（异常）")

        if issues:
            errors.append((name, issues))
```

**校验结果分类报告：**

| 严重程度 | 类型 | 示例 |
|---------|------|------|
| 🔴 数据错误 | CPM/QE 计算因错误值导致异常 | `最低曝光=3` 但中位数 77,389 → CPM=¥1,000,000 |
| 🟡 数据缺失 | 有合作笔记篇数但抽屉提取失败 | 合作笔记 10 篇但最低曝光/点赞均为空 |
| ⚪ 自然缺失 | 近 3 个月无合作笔记 | 合作笔记篇数=0 → CPM/CPE 为空（正常） |
| ✅ 数据完整 | 所有字段采集成功 | 含最低曝光、最低点赞、CPM、CPE |

**输出方式：**
1. 将异常达人清单以表格形式呈现给用户
2. 对 🔴 级错误标注具体原因（如"疑似抽屉提取到错误字段"）
3. 对 🟡 级缺失给出补救建议（如"建议手动复核"）
4. 最后统计整体数据完整性（如"38 个达人中 24 个数据完整"）

> 数据校验**不能跳过**——采集脚本的输出可能包含提取错误，直接使用会导致后续分析决策出错。即使采集结果看起来正常，也必须执行此步骤。

## 脚本模板参考

完整的参考模板在 `scripts/scraper_template.py`。生成脚本时请参考此模板的结构和模式，尤其是：
- 搜索 API payload 的完整字段
- `on_response` 监听器的 URL 匹配模式
- 详情页 DOM 交互的 JavaScript evaluate 代码
- 抽屉提取曝光量的 evaluate 代码
- CSV 写入和去重逻辑

不要照搬模板的全部代码——必须根据用户的具体参数完全定制。模板是参考结构，不是最终代码。

## 关键注意事项

1. **CDP 始终使用已打开的 Chrome**，不要启动新浏览器实例
2. **优先使用已有页面**——不要创建新页面去导航，用已打开的页面
3. **先探索再提问**——Step 2 必须先连接蒲公英页面提取可用选项，展示给用户后再让其选择（而非让用户自由输入），可用选项不足时再允许用户自由输入
4. **地域匹配要支持多城市**——不硬编码单个城市
5. **报价单位**：API 中的报价单位是**元**，用户说"万"时要转换（0.1万=1000）
6. **搜索 API payload 必须完整**——不要省略任何字段，否则可能触发风控
7. **详情页必须关闭**——每处理完一个 KOL 就关闭详情标签页
8. **CSV 去重是关键**——多次运行不能产生重复行
9. **脚本的可复用性**——为用户说"给脚本添加 --config 参数，支持下次复用"或"将脚本保存下来下次直接运行"；脚本路径在工作区文件目录，不受会话切换影响
10. **截图**——Step 2 探索时截取蒲公英页面截图，存储在 `WORKSPACE_FILES/pgy_screenshot_explore.png`
11. **所有产出在工作区文件目录**——脚本、CSV、截图全部写入 `WORKSPACE_FILES`，不写入会话工作目录
12. **平台专注**——本 Skill 专注于小红书蒲公英（pgy.xiaohongshu.com），使用对应的 API 和 payload
