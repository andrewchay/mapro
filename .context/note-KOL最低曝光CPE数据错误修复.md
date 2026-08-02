# KOL 最低曝光/最低点赞/CPE 数据错误 · 根因与修复记录

> 日期：2026-08-02
> 关联 Skill：`ma-kol-scraper`（采集器 `kol_collector.py` v2.0.3）
> 背景：用户反馈「之前跑出来的达人，前几个达人的最低曝光和点赞是错的，所以 CPE 也不准」

## 一、问题表现（三个历史 CSV 中的异常行）

| 文件 | 达人 | 最低曝光 | 最低曝光阅读 | 问题 |
|------|------|---------|-------------|------|
| 杭州上海(21行) | 久雨乱蝉鸣 | 863 | 1,475 | 阅读 > 曝光（物理不可能） |
| 杭州上海(21行) | 艾玛芸 | 939 | 8,735 | 阅读 >> 曝光 |
| 杭州上海(21行) | 加勒比海苔 | 559 | 89,830 | 阅读 >> 曝光 |
| 杭州上海(21行) | KissaYou | 1,198 | 17,785 | 阅读 > 曝光 |
| 1w-5w | 爱吃锅巴 | 1,475 | 1,542 | 阅读 > 曝光 |
| 多个文件 | 麦兜小桃/小七/可乐colaer/王要要/佳佳/咕噜噜/Monica/小岛阿诗/是孙公子 | 空 | 空 | 合作篇数 > 0 但最低曝光/最低点赞缺失，CPM 用中位数兜底 |

**受影响达人共 16 个**（userId 列表见重跑配置 `config_强制重采修复.json`）。

## 二、根因（三个叠加）

1. **抽屉 DOM 提取 `ex()` 只支持「标签\n数值」换行式**：
   - 蒲公英抽屉 innerText 布局不稳定，可能是「曝光量\n1,475」也可能「曝光量 1,475」同行式；
   - 同行式时旧代码取 `lines[i+1]`（下一个标签行）→ parseInt 得到 NaN，可能继续匹配页面其他位置含「曝光量」的文字 → 抓错值（阅读 > 曝光即由此产生）。
2. **互动字段完全依赖抽屉 DOM，未利用 notes_detail API**：
   - payload.md 早已注明 `notes_detail` API 自带曝光/阅读/点赞；
   - 但采集器只从抽屉 innerText 提取，API 自带的 `impCount/readCount/likeCount` 等字段被忽略。
3. **`get_min_like_coop_note` 的 0 点赞 bug**：
   - `key=lambda x: x.get("likeNum") or x.get("like") or float("inf")`，0 是 falsy → 0 点赞笔记被当 inf 跳过。

## 三、修复（kol_collector.py v2.0.3）

1. **`ex()` 支持同行/换行两种布局 + 万/千单位换算**：布局 A 从当前行尾部提取数字，布局 B 取下一行；`parseNum` 处理 `1.5万`→15000。
2. **互动字段 API 优先、抽屉兜底**：新增 `_note_metric(note, kind)` 统一提取多命名字段（`impNum/imp/impCount/exposure/exposureNum/viewCount/view` 等）；`build_row` 与 `extract_relevance_samples` 注入逻辑改为「API 有值不覆盖，抽屉只补缺失」。
3. **修复 0 点赞 bug**：`_note_metric` 显式返回 0，`get_min_like_coop_note` 不再跳过 0 点赞笔记。
4. **新增 `force_redownload_ids` 配置**：强制重采指定 userId，不受断点去重影响；搜索未命中时从已有 CSV 补齐（fetch_kol_detail 只依赖 userId）。末尾合并逻辑（`merged[key] = r`）会正确用新行覆盖旧行。
5. SKILL.md 版本历史 + 硬性条件清单同步更新。

## 四、重跑方案（待用户开启 CDP）

1. 启动 Chrome CDP（9222）+ 登录蒲公英
2. 运行：`python3 <skill>/scripts/kol_collector.py --check --port 9222`
3. 运行：`python3 <skill>/scripts/kol_collector.py --config <campaign>/workspace-files/config_强制重采修复.json`
4. 产出 `上海美食探店KOL_修复重采.csv`（16 个受影响达人重采后的正确数据），再校验异常是否消除。

## 五、遗留

- 历史 CSV 错误行无法离线重算（原始笔记级数据未保存），必须重采覆盖。
- `notes_detail` API 字段名尚未用真实响应确认（`_note_metric` 已兼容多命名，重跑时观察输出即可确认实际字段名）。
