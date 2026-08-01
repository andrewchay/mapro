#!/usr/bin/env python3
"""小红书蒲公英 KOL 通用采集器（参数化，由 ma-kol-scraper skill 驱动）

版本：v2.0.2（2026-08-01）
  - v2.0.2：末尾合并写入防丢数据；网络中断(net::ERR_*)纳入自动重连；userId 独立列+csv 模块解析断点
  - v2.0.1：location 省市区 token 匹配；搜索阶段同时检查 featureTags；CDP 断线自动重连；断点续采

核心设计（v2）：不再按 campaign 生成独立脚本，所有筛选条件通过 --config JSON 传入，
由 Agent 自动执行；本文件是唯一入口脚本。

原理：
  - 通过 playwright.connect_over_cdp 连接到用户正在使用的真实 Chrome 浏览器
  - 搜索 API 通过 page.evaluate() 在浏览器 JS 上下文中用 fetch() 执行，
    前端代码自动附带正确的 x-s / x-t 签名参数
  - 详情页数据通过导航到 KOL 详情页 + on("response") 监听捕获

用法：
  1. 启动 Chrome 远程调试端口：--remote-debugging-port=9222
  2. 在 Chrome 中登录小红书蒲公英（https://pgy.xiaohongshu.com）
  3. 检查环境：python3 kol_collector.py --check --port 9222
  4. 采集：    python3 kol_collector.py --config <config.json>

config JSON 字段：
  brand_user_id / keywords / gender / location_cities / fans_location_cities
  target_cities / target_tags / trade_type / note_price_lower / note_price_upper
  fans_number_lower / fans_number_upper / first_industry / second_industry
  cdp_port / max_pages / max_kols / coop_note_months / coop_note_pages_max
  output_file / active_within_days

输出：
  CSV（含报价/阅读互动中位数/合作笔记最低数据/CPM/CPE）+ _debug.json
"""

import csv
import datetime
import json
import os
import sys
import time
import uuid
import argparse
import traceback

import playwright.sync_api

WORKDIR = os.path.dirname(os.path.abspath(__file__))

# ========== 接口地址 ==========
SEARCH_API = "https://pgy.xiaohongshu.com/api/solar/cooperator/blogger/v2"
NOTES_RATE_API = "https://pgy.xiaohongshu.com/api/solar/kol/data_v3/notes_rate"
NOTES_DETAIL_API = "https://pgy.xiaohongshu.com/api/solar/kol/data_v2/notes_detail"
FANS_PROFILE_API_TPL = "https://pgy.xiaohongshu.com/api/solar/kol/data/{userId}/fans_profile"
CONTENT_TAGS_API = "https://pgy.xiaohongshu.com/api/solar/kol/data_v2/kol_content_tags"
FEATURE_TAGS_API = "https://pgy.xiaohongshu.com/api/solar/kol/data_v2/kol_feature_tags"
BLOGGER_API_TPL = "https://pgy.xiaohongshu.com/api/solar/cooperator/user/blogger/{userId}"

# ========== CSV 表头 ==========
HEADERS = [
    "达人名称", "小红书号", "内容类目", "地域", "粉丝量",
    "粉丝所在区域（前五城市）", "获赞与收藏",
    "图文报价（万）", "视频报价（万）", "女性粉丝占比",
    "日常笔记发布篇数", "日常笔记曝光中位数", "日常笔记阅读中位数", "日常笔记点赞中位数",
    "合作笔记发布篇数", "合作笔记曝光中位数", "合作笔记阅读中位数", "合作笔记点赞中位数",
    "合作笔记最低曝光", "合作笔记最低曝光阅读", "合作笔记最低曝光点赞",
    "合作笔记最低曝光收藏", "合作笔记最低曝光评论", "合作笔记最低曝光时间",
    "合作笔记最低点赞", "合作笔记最低点赞阅读", "合作笔记最低点赞收藏",
    "合作笔记最低点赞评论", "合作笔记最低点赞时间",
    "内容标签", "擅长标签",
    "预估CPM", "预估CPE", "userId", "数据来源",
]

# ========== 辅助函数 ==========


def safe_get(obj, *keys, default=None):
    for key in keys:
        if not isinstance(obj, dict):
            return default
        obj = obj.get(key, default)
    return obj


def format_content_tags(content_tags):
    if not content_tags:
        return ""
    parts = []
    for tag in content_tags:
        if not isinstance(tag, dict):
            parts.append(str(tag))
            continue
        t1 = tag.get("taxonomy1Tag", "") or tag.get("name", "")
        t2s = tag.get("taxonomy2Tags", []) or []
        if t1 and t2s:
            parts.append(f"{t1}({','.join(str(x) for x in t2s)})")
        elif t1:
            parts.append(t1)
    return ";".join(parts)


def format_location_cities(cities):
    """蒲公英搜索 API 的 location/fansLocation 传纯城市名即可。
    实测："中国 上海" 前缀会削弱过滤（混入外地博主），纯 "上海" 过滤 100% 命中。"""
    return [c for c in (cities or []) if c]


def parse_publish_time(ts):
    if ts is None:
        return None
    if isinstance(ts, (int, float)):
        if ts > 1e12:
            ts /= 1000
        if ts > 1e9:
            return datetime.datetime.fromtimestamp(ts)
    if isinstance(ts, str):
        # 直接对完整字符串 strptime；不要再按 len(fmt) 切片（%Y 占 2 字符会导致截断错误）
        for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%Y/%m/%d", "%Y/%m/%d %H:%M:%S"):
            try:
                return datetime.datetime.strptime(ts, fmt)
            except Exception:
                continue
    return None


def js_fetch_json(url, method="GET", body=None):
    """在浏览器上下文中用 fetch 发送请求，返回 JSON 结果。
    浏览器侧前端代码会自动计算并附上 x-s, x-t 等签名参数。
    """
    if method == "GET":
        return f"""fetch("{url}", {{
    method: "GET",
    credentials: "include",
    headers: {{ "Accept": "application/json" }}
}}).then(r => {{
    if (r.ok) return r.json();
    return r.text().then(t => {{ throw new Error(`HTTP ${{r.status}}: ${{t.slice(0,200)}}`) }});
}})"""
    else:
        body_str = json.dumps(body, ensure_ascii=False)
        return f"""fetch("{url}", {{
    method: "POST",
    credentials: "include",
    headers: {{ "Content-Type": "application/json", "Accept": "application/json" }},
    body: JSON.stringify({body_str})
}}).then(r => {{
    if (r.ok) return r.json();
    return r.text().then(t => {{ throw new Error(`HTTP ${{r.status}}: ${{t.slice(0,200)}}`) }});
}})"""


# ========== 采集器主类 ==========

class KolCollector:
    """小红书蒲公英 KOL 通用采集器（参数全部来自 config JSON）"""

    def __init__(self, cfg):
        self.cfg = cfg
        self.brand_user_id = cfg.get("brand_user_id", "")
        self.keywords = cfg.get("keywords", []) or []
        self.gender = cfg.get("gender", "不限")
        self.location_cities = format_location_cities(cfg.get("location_cities", []))
        self.fans_location_cities = format_location_cities(cfg.get("fans_location_cities", []))
        self.target_cities = set(cfg.get("target_cities", []))
        self.target_tags = set(cfg.get("target_tags", []))  # 空集合=不做内容标签过滤
        self.trade_type = cfg.get("trade_type", "不限")
        self.price_lower = cfg.get("note_price_lower", 0)
        self.price_upper = cfg.get("note_price_upper", 100000)
        self.fans_lower = cfg.get("fans_number_lower", 0)
        self.fans_upper = cfg.get("fans_number_upper", 500000)
        self.first_industry = cfg.get("first_industry", "")
        self.second_industry = cfg.get("second_industry", "")
        self.cdp_port = cfg.get("cdp_port", 9222)
        self.max_pages = cfg.get("max_pages", 20)
        self.max_kols = cfg.get("max_kols", 0)
        self.coop_note_months = cfg.get("coop_note_months", 3)
        self.coop_note_pages_max = cfg.get("coop_note_pages_max", 10)
        self.active_within_days = cfg.get("active_within_days", 15)
        self.output_file = cfg.get("output_file", "")

    # ----- 过滤方法 -----

    def kol_matches_location(self, kol):
        if not self.target_cities:
            return True
        loc = (kol.get("location") or "").strip()
        # location 可能是纯城市名（"上海"）或省市区格式（"浙江 杭州 上城区"），
        # 按空格拆分 token 后任一命中即匹配（v2.0.1 修复：startswith 会把杭州 KOL 误滤掉）
        loc_tokens = [t for t in loc.replace("，", " ").split() if t]
        for city in self.target_cities:
            for tok in loc_tokens:
                if tok == city or tok.startswith(city) or city.startswith(tok):
                    return True
            if loc == city or loc.startswith(city):
                return True
        travel = kol.get("travelAreaList") or []
        if isinstance(travel, list):
            for area in travel:
                if isinstance(area, str):
                    for city in self.target_cities:
                        if city in area:
                            return True
        return False

    def kol_matches_price(self, kol):
        for price in (kol.get("picturePrice"), kol.get("videoPrice")):
            if price is None:
                continue
            if self.price_lower <= price <= self.price_upper:
                return True
        return False

    def kol_matches_fans(self, kol):
        fans = kol.get("fansCount") or kol.get("fansNum") or 0
        return self.fans_lower <= fans <= self.fans_upper

    def _tag_values(self, items):
        """把混合 str / dict 的标签列表扁平化为字符串集合（dict 取 name / tagName / taxonomy1Tag）"""
        out = set()
        for it in (items or []):
            if isinstance(it, str):
                if it:
                    out.add(it)
            elif isinstance(it, dict):
                v = it.get("name") or it.get("tagName") or it.get("taxonomy1Tag") or ""
                if v:
                    out.add(str(v))
                for x in (it.get("taxonomy2Tags") or []):
                    if x:
                        out.add(str(x))
        return out

    def kol_matches_content_tags(self, kol):
        """严格过滤：检查内容标签是否包含 target_tags（详情页阶段用；空集合=不过滤）"""
        if not self.target_tags:
            return True
        tags = self._tag_values(kol.get("contentTags"))
        tags |= self._tag_values(kol.get("featureTags"))
        tags |= self._tag_values(kol.get("personalTags"))

        for tg in self.target_tags:
            if tg in tags:
                return True
        # 兼容部分标签嵌套在 taxonomy1 子串的情况
        for tg in self.target_tags:
            for t in tags:
                if tg and (t.startswith(tg) or tg.startswith(t)):
                    return True
        return False

    def kol_matches_content_tags_search(self, kol):
        """宽松预过滤（搜索列表阶段）：同时检查 contentTags/featureTags/personalTags，
        任一命中即保留；全缺失时不排除，留给详情页严格过滤。
        （v2.0.1 修复：搜索结果里"探店/氛围感"等多在 featureTags，之前只查 contentTags 会提前滤掉大量匹配博主）"""
        if not self.target_tags:
            return True
        tags = self._tag_values(kol.get("contentTags"))
        tags |= self._tag_values(kol.get("featureTags"))
        tags |= self._tag_values(kol.get("personalTags"))
        if not tags:
            return True  # 列表页没有标签数据，保留待详情页严格过滤
        for tg in self.target_tags:
            for t in tags:
                if tg and (t == tg or t.startswith(tg) or tg.startswith(t)):
                    return True
        return False

    def fan_profile_matches(self, fans_profile):
        cities = safe_get(fans_profile, "data", "cities", default=[]) or []
        top5 = [c.get("name", "") for c in cities[:5]]
        if not self.target_cities:
            return True, top5
        for c in top5:
            for tc in self.target_cities:
                if tc in c:
                    return True, top5
        return False, top5

    def is_active_recently(self, notes_rate, blogger=None, days=None):
        days = days or self.active_within_days
        notes = safe_get(notes_rate, "data", "notes", default=[]) or []
        if not notes and blogger:
            last_time = blogger.get("lastNoteTime")
            if last_time:
                dt = parse_publish_time(last_time)
                if dt:
                    return (datetime.datetime.now() - dt).days <= days
        if not notes:
            return True
        cutoff = datetime.datetime.now() - datetime.timedelta(days=days)
        for note in notes:
            dt = parse_publish_time(note.get("publishTime"))
            if dt and dt >= cutoff:
                return True
        return False

    def _coop_notes_within_months(self, all_notes):
        cutoff = datetime.datetime.now() - datetime.timedelta(days=30 * self.coop_note_months)
        coop = []
        for note in all_notes:
            if not note.get("isAdvertise"):
                continue
            dt = parse_publish_time(note.get("date") or note.get("publishTime"))
            if dt and dt >= cutoff:
                coop.append(note)
        return coop

    def get_min_imp_coop_note(self, all_notes):
        coop = self._coop_notes_within_months(all_notes)
        if not coop:
            return None
        valid = [n for n in coop if (n.get("impNum") or n.get("imp") or 0) > 0]
        if valid:
            return min(valid, key=lambda x: x.get("impNum") or x.get("imp") or float("inf"))
        return None

    def get_min_like_coop_note(self, all_notes):
        coop = self._coop_notes_within_months(all_notes)
        if not coop:
            return None
        return min(coop, key=lambda x: x.get("likeNum") or x.get("like") or float("inf"))

    # ----- 搜索 API -----

    def fetch_search_kols(self, page):
        """分页拉取搜索列表"""
        payload = {
            "searchType": 1, "column": "comprehensiverank", "sort": "desc",
            "pageNum": 1, "pageSize": 20,
            "brandUserId": self.brand_user_id,
            "trackId": f"kolMatch_{uuid.uuid4().hex}",
            "keyword": None,
            "gender": "" if (self.gender in ("不限", "", None)) else self.gender,
            "location": self.location_cities if self.location_cities else None,
            "signed": -1, "featureTags": [], "fansAge": 0, "fansGender": 0,
            "fansLocation": self.fans_location_cities if self.fans_location_cities else None,
            "fansMaritalStatus": -1, "fansConsumptionLevel": -1,
            "fansChildAgeInfo": [], "fansDevicePrice": [], "fansDeviceBrand": [],
            "accumCommonImpMedinNum30d": [], "readMidNor30": [], "interMidNor30": [],
            "thousandLikePercent30": [], "noteType": 0,
            "notePriceLower": self.price_lower, "notePriceUpper": self.price_upper,
            "fansNumberLower": self.fans_lower, "fansNumberUpper": self.fans_upper,
            "progressOrderCnt": [], "tradeType": self.trade_type, "tradeReportBrandIdSet": [],
            "excludedTradeReportBrandId": False, "estimateCpuv30d": [], "inStar": 0,
            "firstIndustry": self.first_industry, "secondIndustry": self.second_industry,
            "newHighQuality": 0,
            "filterIntention": False,
            "flagList": [{"flagType": "HAS_BRAND_COOP_BUYER_AUTH", "flagValue": "0"},
                         {"flagType": "IS_HIGH_QUALITY", "flagValue": "0"}],
            "activityCodes": [], "excludeLowActive": False, "fansNumUp": 0,
            "excludedTradeReportBrand": False, "excludedTradeInviteReportBrand": False,
            "filterList": [], "contentSceneLabel": [],
        }

        # 关键词列表；为空时做一次无关键词搜索（仅靠类目/地域/粉丝量/报价等条件）
        search_keywords = self.keywords if self.keywords else [None]
        all_kols_dict = {}  # userId -> kol

        for keyword in search_keywords:
            if keyword is None:
                payload["keyword"] = None
            else:
                payload["keyword"] = keyword
            payload["pageNum"] = 1
            payload["trackId"] = f"kolMatch_{uuid.uuid4().hex}"

            js_code = js_fetch_json(SEARCH_API, method="POST", body=payload)
            data = page.evaluate(js_code)
            if not data:
                print(f"  [搜索] 关键词'{keyword}'无返回")
                continue

            code = data.get("code")
            if code != 0:
                print(f"  [搜索] 关键词'{keyword}'返回 code={code}")
                continue

            total = safe_get(data, "data", "total", default=0) or 0
            kols = safe_get(data, "data", "kols", default=[]) or []
            print(f"  [搜索] 关键词'{keyword}'：total={total} 首页返回={len(kols)}")
            # 预过滤：先按内容标签/报价/粉丝量过滤，减少详情页请求
            kols = [k for k in kols if self.kol_matches_content_tags_search(k)]
            print(f"  [搜索] 标签预过滤后={len(kols)}")

            for kol in kols:
                uid = kol.get("userId")
                if uid:
                    all_kols_dict[uid] = kol

            if self.max_kols > 0 and len(all_kols_dict) >= self.max_kols:
                break

            # 翻页
            page_num = 2
            while page_num <= self.max_pages and len(kols) > 0:
                payload["pageNum"] = page_num
                payload["trackId"] = f"kolMatch_{uuid.uuid4().hex}"
                js_code = js_fetch_json(SEARCH_API, method="POST", body=payload)
                data = page.evaluate(js_code)
                if not data or data.get("code") != 0:
                    break
                kols = safe_get(data, "data", "kols", default=[]) or []
                kols = [k for k in kols if self.kol_matches_content_tags_search(k)]
                for kol in kols:
                    uid = kol.get("userId")
                    if uid:
                        all_kols_dict[uid] = kol
                print(f"    [搜索] 关键词'{keyword}' 第{page_num}页 返回={len(kols)} 累计唯一={len(all_kols_dict)}")
                page_num += 1
                time.sleep(0.5)

                # 检查是否达到最大数量
                if self.max_kols > 0 and len(all_kols_dict) >= self.max_kols:
                    break

            if self.max_kols > 0 and len(all_kols_dict) >= self.max_kols:
                break

        all_kols = list(all_kols_dict.values())
        print(f"  [搜索] 共获取 {len(all_kols)} 个唯一 KOL")
        return all_kols

    # ----- 详情页采集 -----

    def fetch_kol_detail(self, context, user_id):
        """在新标签页中打开 KOL 详情页，通过 on("response") 监听捕获 API 数据"""
        captured = {"notes_detail": []}
        detail_page = context.new_page()

        def on_resp(resp):
            url = resp.url
            try:
                if resp.status != 200:
                    return
                if url.endswith(f"/api/solar/cooperator/user/blogger/{user_id}"):
                    captured["blogger"] = resp.json()
                elif f"/api/solar/kol/data/{user_id}/fans_profile" in url:
                    captured["fans_profile"] = resp.json()
                elif "/api/solar/kol/data_v3/notes_rate" in url and f"userId={user_id}" in url:
                    is_coop = "business=1" in url
                    is_organic = "advertiseSwitch=0" in url
                    key = ("notes_rate_coop_organic" if (is_coop and is_organic)
                           else "notes_rate_coop_all" if is_coop
                           else "notes_rate_daily_organic" if is_organic
                           else "notes_rate_daily_all")
                    captured[key] = resp.json()
                elif "/api/solar/kol/data_v2/notes_detail" in url and f"userId={user_id}" in url:
                    data = resp.json()
                    notes = safe_get(data, "data", "list", default=[]) or []
                    if notes:
                        captured["notes_detail"].append(data)
                elif "/api/solar/kol/data_v2/kol_content_tags" in url and f"userId={user_id}" in url:
                    captured["content_tags"] = resp.json()
                elif "/api/solar/kol/data_v2/kol_feature_tags" in url and f"userId={user_id}" in url:
                    captured["feature_tags"] = resp.json()
            except Exception:
                pass

        detail_page.on("response", on_resp)

        try:
            # 1. 导航至详情页
            detail_url = f"https://pgy.xiaohongshu.com/solar/pre-trade/blogger-detail/{user_id}"
            detail_page.goto(detail_url, wait_until="domcontentloaded", timeout=30000)
            time.sleep(3)

            # 等待 blogger API
            try:
                detail_page.wait_for_response(
                    lambda r: r.url.endswith(f"/api/solar/cooperator/user/blogger/{user_id}") and r.status == 200,
                    timeout=15000
                )
            except Exception:
                pass

            # 关闭弹窗
            try:
                detail_page.evaluate(
                    "() => { const el=document.querySelector('.d-modal-close'); if(el) el.click(); }"
                )
                time.sleep(1)
            except Exception:
                pass

            # ===== 2. 数据概览 tab — 触发 notes_rate =====
            try:
                detail_page.evaluate("""() => {
                    const tabs = document.querySelectorAll('.d-tabs-header-label, [class*=tab]');
                    const t = Array.from(tabs).find(el => el.textContent.trim() === '数据概览');
                    if (t) t.click();
                }""")
                time.sleep(2)
            except Exception:
                pass

            # 滚动到数据表现区域
            try:
                detail_page.evaluate("window.scrollTo(0, 1700)")
                time.sleep(1)
            except Exception:
                pass

            # 切换流量类型到"仅自然流量"
            try:
                # 点击"全流量"下拉框
                detail_page.evaluate("""() => {
                    const spans = document.querySelectorAll('span.d-select-wrapper, .d-select, [class*=select]');
                    for (const s of spans) {
                        const txt = s.textContent.trim();
                        if (txt === '全流量') {
                            const rect = s.getBoundingClientRect();
                            if (rect.top > 1500) {
                                s.click(); return true;
                            }
                        }
                    }
                    return false;
                }""")
                time.sleep(1.5)

                # 选择"仅自然流量"
                detail_page.evaluate("""() => {
                    const items = document.querySelectorAll('.d-dropdown-item, .d-select-option, [class*=dropdown] div');
                    for (const item of items) {
                        if (item.textContent.trim() === '仅自然流量') {
                            item.click(); return true;
                        }
                    }
                    return false;
                }""")
                time.sleep(2)
            except Exception:
                pass

            # 点击数据表现区域的"日常笔记"和"合作笔记"触发 API
            for lbl in ("日常笔记", "合作笔记"):
                try:
                    detail_page.evaluate("""({l}) => {
                        const btns = Array.from(document.querySelectorAll('button'));
                        for (const b of btns) {
                            if (b.textContent.trim() === l) {
                                const rect = b.getBoundingClientRect();
                                if (rect.top > 1500) {
                                    b.click(); return true;
                                }
                            }
                        }
                        return false;
                    }""", {"l": lbl})
                    time.sleep(2)
                except Exception:
                    pass

            # ===== 3. 笔记案例 tab → 触发 notes_detail =====
            try:
                detail_page.evaluate("window.scrollTo(0, 0)")
                time.sleep(0.3)
                detail_page.evaluate("""() => {
                    const tabs = document.querySelectorAll('.d-tabs-header-label, [class*=tab]');
                    const t = Array.from(tabs).find(el => el.textContent.trim() === '笔记案例');
                    if (t) t.click();
                }""")
                time.sleep(3)
            except Exception:
                pass

            try:
                detail_page.wait_for_response(
                    lambda r: "/api/solar/kol/data_v2/notes_detail" in r.url
                              and f"userId={user_id}" in r.url and r.status == 200,
                    timeout=15000
                )
            except Exception:
                pass
            time.sleep(2)

            # ===== 4. 合作笔记 segment 筛选 =====
            try:
                detail_page.evaluate("""() => {
                    const segs = document.querySelectorAll('.d-segment-item, [class*=segment]');
                    const allCoop = Array.from(segs).filter(el => el.textContent.trim() === '合作笔记');
                    const coop = allCoop.length >= 2 ? allCoop[1] : (allCoop[0] || null);
                    if (coop) { coop.click(); return true; }
                    return false;
                }""")
                try:
                    detail_page.wait_for_response(
                        lambda r: "/api/solar/kol/data_v2/notes_detail" in r.url
                                  and f"userId={user_id}" in r.url and r.status == 200,
                        timeout=15000
                    )
                except Exception:
                    pass
                time.sleep(2)
            except Exception:
                pass

            # ===== 5. 翻页 + 抽屉曝光提取 =====
            pull_cutoff = datetime.datetime.now() - datetime.timedelta(days=30 * self.coop_note_months)
            seen_ids = set()
            note_exposure = captured.setdefault("note_exposure", {})

            for pg in range(1, self.coop_note_pages_max + 1):
                all_detail_notes = []
                for item in captured.get("notes_detail") or []:
                    all_detail_notes.extend(safe_get(item, "data", "list", default=[]) or [])

                new_notes = [n for n in all_detail_notes if n.get("noteId") and n["noteId"] not in seen_ids]
                if new_notes:
                    seen_ids.update(n.get("noteId") for n in new_notes)

                if pg > 1:
                    clicked = detail_page.evaluate(
                        """({pnum}) => {
                            const pages = document.querySelectorAll('.d-pagination-page, [class*=pagination]');
                            const found = Array.from(pages).find(el => {
                                const span = el.querySelector('.d-text, span');
                                return (span ? span.textContent.trim() : el.textContent.trim()) === String(pnum);
                            });
                            if (found) { found.scrollIntoView({block: 'center'}); found.click(); return true; }
                            return false;
                        }""",
                        {"pnum": pg},
                    )
                    if not clicked:
                        break
                    time.sleep(3)
                    try:
                        detail_page.wait_for_response(
                            lambda r: "/api/solar/kol/data_v2/notes_detail" in r.url
                                      and f"userId={user_id}" in r.url and r.status == 200,
                            timeout=10000
                        )
                    except Exception:
                        pass
                    time.sleep(2)

                if not new_notes:
                    continue

                # 检查时间范围
                all_old = True
                for note in new_notes:
                    if note.get("isAdvertise"):
                        dt = parse_publish_time(note.get("date") or note.get("publishTime"))
                        if dt and dt >= pull_cutoff:
                            all_old = False
                            break
                if all_old:
                    break

                page_coop = [n for n in new_notes if n.get("isAdvertise")]
                if not page_coop:
                    continue

                # 提取抽屉数据
                for ci in range(len(page_coop)):
                    note = page_coop[ci]
                    nid = note.get("noteId")
                    if nid and nid in note_exposure:
                        continue

                    clicked = detail_page.evaluate(
                        """({idx}) => {
                            const cards = document.querySelectorAll('.note-card-wrapper, [class*=note-card], [class*=noteCard]');
                            if (idx >= cards.length) return false;
                            const card = cards[idx];
                            const mask = card.querySelector('.note-card__mask, [class*=mask]');
                            if (mask) { mask.scrollIntoView({block: 'center'}); mask.click(); return true; }
                            card.scrollIntoView({block: 'center'});
                            card.click();
                            return true;
                        }""",
                        {"idx": ci},
                    )
                    if not clicked:
                        continue
                    time.sleep(2.5)

                    drawer_data = detail_page.evaluate("""() => {
                        let c = document.querySelector('.d-drawer-content, [class*=drawer-content], [class*=drawerContent]');
                        if (!c) {
                            const allDivs = document.querySelectorAll('div[class*=overlay], div[class*=modal], div[class*=drawer]');
                            for (const d of allDivs) {
                                if (d.textContent.includes('曝光量') && d.offsetHeight > 100) {
                                    c = d; break;
                                }
                            }
                        }
                        if (!c) return null;
                        const lines = c.innerText.split('\\n').map(l=>l.trim()).filter(l=>l);
                        const ex = (label) => {
                            for(let i=0;i<lines.length;i++){
                                if(lines[i]===label || lines[i].startsWith(label)){
                                    const next = lines[i+1];
                                    if (next) {
                                        const n = parseInt(next.replace(/,/g,''));
                                        if (!isNaN(n)) return n;
                                    }
                                }
                            }
                            return null;
                        };
                        return {
                            title: lines[0]||'',
                            exposure: ex('曝光量') || ex('曝光'),
                            reads: ex('阅读量') || ex('阅读'),
                            likes: ex('点赞量') || ex('点赞'),
                            favorites: ex('收藏量') || ex('收藏'),
                            comments: ex('评论量') || ex('评论'),
                        };
                    }""")

                    if drawer_data and drawer_data.get("exposure"):
                        note_exposure[nid] = drawer_data["exposure"]
                        for k2, kk in (("reads", "readNum"), ("likes", "likeNum"),
                                       ("favorites", "collectNum"), ("comments", "commentNum")):
                            if drawer_data.get(k2):
                                note_exposure[f"{nid}_{kk}"] = drawer_data[k2]

                    # 关闭抽屉
                    try:
                        detail_page.keyboard.press("Escape")
                        time.sleep(0.8)
                    except Exception:
                        pass
                    still_open = detail_page.evaluate("""() => {
                        const d = document.querySelector('.d-drawer-guard');
                        return d && d.offsetParent != null;
                    }""")
                    if still_open:
                        detail_page.evaluate("""() => {
                            const d = document.querySelector('.d-drawer-guard');
                            if (d) d.click();
                        }""")
                        time.sleep(0.5)

            # ---- 主动 API 兜底 ----
            if not any(k.startswith("notes_rate_") for k in captured):
                print(f"      [兜底] notes_rate 未捕获，主动 fetch API...")
                for business, label in ((0, "daily"), (1, "coop")):
                    for adv_sw, suffix in ((0, "organic"), (1, "all")):
                        key = f"notes_rate_{label}_{suffix}"
                        if key not in captured:
                            try:
                                url = (f"https://pgy.xiaohongshu.com/api/solar/kol/data_v3/notes_rate"
                                       f"?userId={user_id}&business={business}&advertiseSwitch={adv_sw}&pageSize=20&pageNum=1")
                                js = js_fetch_json(url)
                                data = detail_page.evaluate(js)
                                if data and data.get("code") == 0:
                                    captured[key] = data
                            except Exception:
                                pass

            if not captured.get("notes_detail"):
                print(f"      [兜底] notes_detail 未捕获，主动 fetch API...")
                for pn in (1, 2):
                    try:
                        url = (f"https://pgy.xiaohongshu.com/api/solar/kol/data_v2/notes_detail"
                               f"?userId={user_id}&pageNum={pn}&pageSize=20")
                        js = js_fetch_json(url)
                        data = detail_page.evaluate(js)
                        if data and data.get("code") == 0:
                            notes = safe_get(data, "data", "list", default=[]) or []
                            if notes:
                                captured.setdefault("notes_detail", []).append(data)
                    except Exception:
                        pass

        except Exception as e:
            print(f"      [ERROR] 详情页处理异常: {e}")

        finally:
            detail_page.remove_listener("response", on_resp)
            detail_page.close()

        return captured

    # ----- 构建 CSV 行 -----

    def build_row(self, kol, blogger, captured, top5_cities, fans_profile):
        notes_rate_daily = captured.get("notes_rate_daily_organic") or captured.get("notes_rate_daily_all") or {}
        notes_rate_coop = captured.get("notes_rate_coop_organic") or captured.get("notes_rate_coop_all") or {}

        all_detail_notes = []
        for item in captured.get("notes_detail") or []:
            all_detail_notes.extend(safe_get(item, "data", "list", default=[]) or [])

        female_ratio = safe_get(fans_profile, "data", "gender", "female", default=None)
        female_pct = round(female_ratio, 2) if female_ratio is not None else None

        pic_price = blogger.get("picturePrice")
        vid_price = blogger.get("videoPrice")
        pic_price_wan = pic_price / 10000 if pic_price is not None else None
        vid_price_wan = vid_price / 10000 if vid_price is not None else None

        # 有效报价用于 CPM/CPE 计算
        effective_price = None
        if pic_price is not None and self.price_lower <= pic_price <= self.price_upper:
            effective_price = pic_price
        if vid_price is not None and self.price_lower <= vid_price <= self.price_upper:
            if effective_price is None or vid_price < effective_price:
                effective_price = vid_price
        if effective_price is None:
            effective_price = pic_price or vid_price

        # 注入抽屉数据
        note_exposure = captured.get("note_exposure") or {}
        for note in all_detail_notes:
            nid = note.get("noteId")
            if nid and nid in note_exposure:
                note["impNum"] = note_exposure[nid]
                for sfx, key in [("_reads", "readNum"), ("_likes", "likeNum"),
                                 ("_favorites", "collectNum"), ("_comments", "commentNum")]:
                    if f"{nid}{sfx}" in note_exposure:
                        note[key] = note_exposure[f"{nid}{sfx}"]

        min_imp_note = self.get_min_imp_coop_note(all_detail_notes)
        min_like_note = self.get_min_like_coop_note(all_detail_notes)

        # 计算 CPM / CPE
        cpm = None
        cpe = None
        if effective_price:
            if min_imp_note:
                imp = min_imp_note.get("impNum") or min_imp_note.get("imp") or 0
                if imp:
                    cpm = effective_price / imp * 1000
            if cpm is None:
                coop_imp_median = safe_get(notes_rate_coop, "data", "impMedian", default=None)
                if coop_imp_median and coop_imp_median > 0:
                    cpm = effective_price / coop_imp_median * 1000
            if min_like_note:
                like = min_like_note.get("likeNum") or min_like_note.get("like") or 0
                if like:
                    cpe = effective_price / like

        def nr_median(nr, key):
            return safe_get(nr, "data", key, default=None)

        def note_field(note, key, fallback_keys=None):
            if not note:
                return None
            for k in ([key] + (fallback_keys or [])):
                if k in note and note[k] is not None:
                    return note[k]
            return None

        # 获取内容标签和擅长标签
        content_tags = captured.get("content_tags")
        feature_tags = captured.get("feature_tags")
        content_tag_str = format_content_tags(
            safe_get(content_tags, "data", default=[])
        ) if content_tags else format_content_tags(blogger.get("contentTags") or kol.get("contentTags"))

        feature_tag_list = safe_get(feature_tags, "data", default=[]) if feature_tags else (blogger.get("featureTags") or kol.get("featureTags") or [])
        if isinstance(feature_tag_list, list):
            parts = []
            for ft in feature_tag_list:
                if isinstance(ft, str):
                    parts.append(ft)
                elif isinstance(ft, dict):
                    v = ft.get("name") or ft.get("tagName") or ""
                    if v:
                        parts.append(str(v))
            feature_tag_str = ";".join(parts)
        else:
            feature_tag_str = str(feature_tag_list) if feature_tag_list else ""

        return {
            "达人名称": blogger.get("name") or kol.get("name") or "",
            "小红书号": blogger.get("xiaohongshuId") or kol.get("xiaohongshuId") or kol.get("userId") or "",
            "userId": blogger.get("userId") or kol.get("userId") or "",
            "内容类目": content_tag_str,
            "地域": (blogger.get("location") or kol.get("location") or "").strip(),
            "粉丝量": blogger.get("fansCount") or kol.get("fansCount") or kol.get("fansNum") or 0,
            "粉丝所在区域（前五城市）": ";".join(top5_cities),
            "获赞与收藏": blogger.get("likeCollectCountInfo") or 0,
            "图文报价（万）": pic_price_wan,
            "视频报价（万）": vid_price_wan,
            "女性粉丝占比": female_pct,
            "日常笔记发布篇数": nr_median(notes_rate_daily, "noteNumber"),
            "日常笔记曝光中位数": nr_median(notes_rate_daily, "impMedian"),
            "日常笔记阅读中位数": nr_median(notes_rate_daily, "readMedian"),
            "日常笔记点赞中位数": nr_median(notes_rate_daily, "likeMedian"),
            "合作笔记发布篇数": nr_median(notes_rate_coop, "noteNumber"),
            "合作笔记曝光中位数": nr_median(notes_rate_coop, "impMedian"),
            "合作笔记阅读中位数": nr_median(notes_rate_coop, "readMedian"),
            "合作笔记点赞中位数": nr_median(notes_rate_coop, "likeMedian"),
            "合作笔记最低曝光": note_field(min_imp_note, "impNum", ["imp"]),
            "合作笔记最低曝光阅读": note_field(min_imp_note, "readNum", ["read"]),
            "合作笔记最低曝光点赞": note_field(min_imp_note, "likeNum", ["like"]),
            "合作笔记最低曝光收藏": note_field(min_imp_note, "collectNum", ["collect"]),
            "合作笔记最低曝光评论": note_field(min_imp_note, "commentNum", ["comment"]),
            "合作笔记最低曝光时间": min_imp_note.get("date") if min_imp_note else None,
            "合作笔记最低点赞": note_field(min_like_note, "likeNum", ["like"]),
            "合作笔记最低点赞阅读": note_field(min_like_note, "readNum", ["read"]),
            "合作笔记最低点赞收藏": note_field(min_like_note, "collectNum", ["collect"]),
            "合作笔记最低点赞评论": note_field(min_like_note, "commentNum", ["comment"]),
            "合作笔记最低点赞时间": min_like_note.get("date") if min_like_note else None,
            "内容标签": content_tag_str,
            "擅长标签": feature_tag_str,
            "预估CPM": round(cpm, 2) if cpm is not None else None,
            "预估CPE": round(cpe, 2) if cpe is not None else None,
            "数据来源": "蒲公英",
        }

    # ----- 主流程 -----

    def _init_browser(self, p, cdp_url, output_file):
        """连接 CDP、初始化主页面并检查登录态；失败抛异常由调用方处理。
        （v2.0.1 新增：供 run() 初始化与中断自动重连复用）"""
        print(f"正在连接 Chrome CDP: {cdp_url}")
        try:
            browser = p.chromium.connect_over_cdp(cdp_url)
        except Exception as e:
            raise RuntimeError(f"无法连接 Chrome CDP: {e}")
        context = browser.contexts[0]

        main_page = None
        for pg in context.pages:
            url = pg.url
            if "/solar/pre-trade" in url and "blogger-detail" not in url:
                main_page = pg
                print(f"找到蒲公英页面: {url}")
                break
        if not main_page:
            for pg in context.pages:
                url = pg.url
                if not url.startswith("chrome://") and not url.startswith("chrome-extension://"):
                    main_page = pg
                    print(f"使用标签页: {url}")
                    break
        if not main_page:
            main_page = context.new_page()
            print("新建标签页")

        if "/solar/pre-trade/note/kol" not in main_page.url:
            print("导航至蒲公英笔记博主广场...")
            main_page.goto(
                "https://pgy.xiaohongshu.com/solar/pre-trade/note/kol",
                wait_until="domcontentloaded", timeout=60000
            )
            time.sleep(3)

        try:
            body_text = main_page.inner_text("body")
            if "账号登录" in body_text or "立即登录" in body_text:
                raise RuntimeError("未检测到蒲公英登录态")
        except RuntimeError:
            raise
        except Exception:
            print("检查登录态时异常，继续...")
        print("登录态正常")
        return browser, context, main_page

    @staticmethod
    def _is_conn_lost(e):
        """判断异常是否属于浏览器/连接/网络中断（可自动重连恢复；v2.0.2 补入 net:: 网络错误）"""
        msg = str(e)
        closed_markers = ("has been closed", "Target closed", "Connection closed",
                          "browser has been closed", "context has been closed",
                          "Target page, context or browser has been closed",
                          "net::ERR_INTERNET_DISCONNECTED", "net::ERR_NETWORK_CHANGED",
                          "net::ERR_CONNECTION", "net::ERR_NAME_NOT_RESOLVED",
                          "net::ERR_ADDRESS_UNREACHABLE", "net::ERR_TIMED_OUT",
                          "ERR_INTERNET_DISCONNECTED", "ERR_NETWORK_CHANGED")
        return any(m in msg for m in closed_markers)

    @staticmethod
    def _load_done_user_ids(output_file):
        """读取已产出 CSV 的 userId 列（v2.0.2：独立 userId 列 + csv 模块解析；
        旧 CSV 无 userId 列时回退读「小红书号」列，当前数据该列即 userId 格式）"""
        done = set()
        if not output_file or not os.path.exists(output_file):
            return done
        try:
            with open(output_file, "r", encoding="utf-8-sig", newline="") as f:
                for row in csv.DictReader(f):
                    uid = (row.get("userId") or row.get("小红书号") or "").strip()
                    if uid:
                        done.add(uid)
        except Exception:
            pass
        return done

    @staticmethod
    def _load_existing_rows(output_file):
        """读取已有 CSV 的所有数据行（v2.0.2 新增：末尾合并写入用，防止断点重跑整表覆写丢数据）"""
        rows = []
        if not output_file or not os.path.exists(output_file):
            return rows
        try:
            with open(output_file, "r", encoding="utf-8-sig", newline="") as f:
                for row in csv.DictReader(f):
                    if row and any(v not in (None, "") for v in row.values()):
                        rows.append(row)
        except Exception:
            pass
        return rows

    def run(self, output_file, debug_file=None):
        results = []
        debug = {"errors": [], "filtered_in": [], "filtered_out": []}

        cdp_url = f"http://127.0.0.1:{self.cdp_port}"

        with playwright.sync_api.sync_playwright() as p:
            print("请确保：")
            print("  1. Chrome 已打开远程调试端口（--remote-debugging-port=9222）")
            print("  2. 已登录小红书蒲公英（pgy.xiaohongshu.com）")
            print()
            try:
                browser, context, main_page = self._init_browser(p, cdp_url, output_file)
            except Exception as e:
                print(f"\n[FAIL] 浏览器初始化失败: {e}")
                print("请先启动带远程调试端口的 Chrome：")
                print("  /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome \\")
                print("    --remote-debugging-port=9222 --user-data-dir=/tmp/chrome_pgy_debug")
                print("再运行 --check 验证后重试。")
                return results

            # ========== 1. 搜索列表 ==========
            print("\n" + "=" * 60)
            print("Step 1: 搜索 KOL")
            print(f"筛选条件：地域{list(self.target_cities)} / 粉丝{self.fans_lower}-{self.fans_upper} / 报价{self.price_lower}-{self.price_upper}")
            print(f"关键词：{self.keywords}  内容标签：{list(self.target_tags)}  类目：{self.first_industry}/{self.second_industry}")
            print("=" * 60)

            all_kols = self.fetch_search_kols(main_page)
            print(f"\n搜索共返回 {len(all_kols)} 个 KOL")

            # ========== 2. 预过滤 + 逐个采集详情 ==========
            print("\n" + "=" * 60)
            print("Step 2: 逐个评估 KOL")
            print("=" * 60)

            # 先基于列表页数据做预过滤
            candidates = []
            for kol in all_kols:
                name = kol.get("name") or ""
                user_id = kol.get("userId")

                if not self.kol_matches_location(kol):
                    debug["filtered_out"].append({"name": name, "reason": "location", "location": kol.get("location")})
                    continue
                if not self.kol_matches_price(kol):
                    debug["filtered_out"].append({"name": name, "reason": "price"})
                    continue
                if not self.kol_matches_fans(kol):
                    debug["filtered_out"].append({"name": name, "reason": "fans"})
                    continue

                candidates.append(kol)

            print(f"预过滤后剩余 {len(candidates)} 个 KOL 进入详情采集")

            # 断点续采：已出现在输出 CSV 中的 userId 直接跳过（v2.0.1 新增）
            done_ids = self._load_done_user_ids(output_file)
            if done_ids:
                print(f"  检测到已有产出 {len(done_ids)} 条，跳过这些 userId（断点续采）")
            candidates = [k for k in candidates if k.get("userId") not in done_ids]
            print(f"断点去重后待采集 {len(candidates)} 个")

            for idx, kol in enumerate(candidates, start=1):
                user_id = kol.get("userId")
                name = kol.get("name") or ""
                print(f"\n[{idx}/{len(candidates)}] {name} (userId={user_id})")

                # 打开详情页采集（连接中断时自动重连并重试一次）
                try:
                    captured = self.fetch_kol_detail(context, user_id)
                except Exception as e:
                    if self._is_conn_lost(e):
                        print(f"  [WARN] 浏览器连接中断: {str(e)[:120]}")
                        print("  -> 尝试自动重连 Chrome CDP ...")
                        try:
                            browser, context, main_page = self._init_browser(p, cdp_url, output_file)
                            print("  -> 重连成功，重试当前 KOL")
                            captured = self.fetch_kol_detail(context, user_id)
                        except Exception as e2:
                            print(f"  [FAIL] 重连失败: {e2}")
                            print("  -> 请检查 Chrome 是否被关闭 / CDP 端口是否仍开启；后续 KOL 停止采集")
                            debug["errors"].append({"name": name, "error": f"conn_lost_reconnect_failed: {e2}"})
                            break
                    else:
                        print(f"  [ERROR] 详情页采集异常: {e}")
                        traceback.print_exc()
                        debug["errors"].append({"name": name, "error": str(e)[:200]})
                        continue

                blogger = safe_get(captured, "blogger", "data", default={}) or {}
                if not blogger:
                    print(f"  [WARN] 博主详情为空，跳过")
                    debug["errors"].append({"name": name, "stage": "blogger_empty"})
                    continue

                # 二次过滤（基于详情页更精确的数据）
                if not self.kol_matches_location(blogger):
                    print(f"  -> 过滤: 地域不符")
                    debug["filtered_out"].append({"name": name, "reason": "detail_location"})
                    continue
                if not self.kol_matches_price(blogger):
                    print(f"  -> 过滤: 报价不符")
                    debug["filtered_out"].append({"name": name, "reason": "detail_price"})
                    continue
                if not self.kol_matches_fans(blogger):
                    print(f"  -> 过滤: 粉丝量不符")
                    debug["filtered_out"].append({"name": name, "reason": "detail_fans"})
                    continue
                if not self.kol_matches_content_tags(blogger):
                    print(f"  -> 过滤: 内容标签不含 {list(self.target_tags)}")
                    debug["filtered_out"].append({"name": name, "reason": "detail_tags"})
                    continue

                # 活跃度检查
                notes_rate_check = captured.get("notes_rate_daily_organic") or captured.get("notes_rate_daily_all") or {}
                if not self.is_active_recently(notes_rate_check, blogger):
                    print(f"  -> 过滤: 近期未更新")
                    debug["filtered_out"].append({"name": name, "reason": "inactive"})
                    continue

                # 粉丝地域检查
                fans_profile = captured.get("fans_profile") or {}
                ok_city, top5_cities = self.fan_profile_matches(fans_profile)
                if not ok_city:
                    print(f"  -> 过滤: 粉丝地域不含 {list(self.target_cities)} (top5={top5_cities})")
                    debug["filtered_out"].append({"name": name, "reason": "fan_city"})
                    continue

                # 构建数据行（单条失败不中断整体采集）
                try:
                    row = self.build_row(kol, blogger, captured, top5_cities, fans_profile)
                except Exception as e:
                    print(f"  [ERROR] 构建数据行失败: {e}")
                    debug["errors"].append({"name": name, "error": f"build_row: {e}"})
                    continue
                results.append(row)
                debug["filtered_in"].append({"name": row["达人名称"], "userId": user_id})
                print(f"  -> MATCH: {row['达人名称']} (累计 {len(results)} 条)")

                # 每收集到一个匹配 KOL 就写入 CSV，防止长时间采集中断丢数据
                self.save_csv(results, output_file)

                # 每处理 5 个 KOL 保活
                if idx % 5 == 0:
                    try:
                        main_page.evaluate("1+1")
                    except Exception:
                        pass

            # ========== 3. 写入 CSV ==========
            print("\n" + "=" * 60)
            print("Step 3: 写入结果")
            print("=" * 60)

            if not results:
                print("无匹配结果，跳过写入")
                return results

            # 去重（本次结果内，按 userId/小红书号/名称 归一）
            seen = set()
            unique_results = []
            for r in results:
                key = r.get("userId") or r.get("小红书号") or r["达人名称"]
                if key not in seen:
                    seen.add(key)
                    unique_results.append(r)

            # 合并已有文件（v2.0.2：断点续采时本次只采增量，末尾必须合并已有行，避免整表覆写丢数据）
            merged = {}
            for r in self._load_existing_rows(output_file):
                key = r.get("userId") or r.get("小红书号") or r.get("达人名称") or ""
                if key:
                    merged[key] = r
            for r in unique_results:
                key = r.get("userId") or r.get("小红书号") or r["达人名称"]
                if key:
                    merged[key] = r
            merged_rows = list(merged.values())

            print(f"本次新增 {len(unique_results)} 条，合并已有后共 {len(merged_rows)} 条")

            with open(output_file, "w", newline="", encoding="utf-8-sig") as f:
                writer = csv.DictWriter(f, fieldnames=HEADERS)
                writer.writeheader()
                writer.writerows(merged_rows)

            print(f"CSV 已写入: {output_file}")

            if debug_file:
                debug["result_count"] = len(merged_rows)
                debug["output_file"] = output_file
                with open(debug_file, "w", encoding="utf-8") as f:
                    json.dump(debug, f, ensure_ascii=False, indent=2)

            print(f"\n完成！共采集 {len(unique_results)} 个 KOL")
            return results

    # ----- CSV 增量写入 -----

    def save_csv(self, results, output_file):
        """把 results 中尚未写入 output_file 的行追加写入（带 BOM）。
        v2.0.2：去重键与结尾合并统一为 userId/小红书号/达人名称，且改用 csv 模块解析，
        避免旧逻辑按第一列 split(",") 去重在名称含逗号/改昵称时错位。"""
        if not results:
            return
        os.makedirs(os.path.dirname(os.path.abspath(output_file)), exist_ok=True)

        def row_key(r):
            k = r.get("userId") or r.get("小红书号") or r.get("达人名称") or ""
            return str(k).strip() if k else ""

        existing_keys = set()
        if os.path.exists(output_file) and os.path.getsize(output_file) > 0:
            try:
                with open(output_file, "r", encoding="utf-8-sig", newline="") as f:
                    for row in csv.DictReader(f):
                        k = row.get("userId") or row.get("小红书号") or row.get("达人名称") or ""
                        if k:
                            existing_keys.add(str(k).strip())
            except Exception:
                pass

        seen = set(existing_keys)
        new_rows = []
        for r in results:
            k = row_key(r)
            if k and k not in seen:
                seen.add(k)
                new_rows.append(r)
        if not new_rows:
            return
        write_header = not (os.path.exists(output_file) and os.path.getsize(output_file) > 0)
        with open(output_file, "a", newline="", encoding="utf-8-sig") as f:
            writer = csv.DictWriter(f, fieldnames=HEADERS)
            if write_header:
                writer.writeheader()
            writer.writerows(new_rows)
        print(f"    [写入] 追加 {len(new_rows)} 条 -> {output_file}")


def check_environment(cdp_port=9222, check_login=True):
    """快速检查 Chrome CDP 是否开启、蒲公英是否已登录。供 Agent --check 使用。"""
    import urllib.request
    print(f"检查 Chrome CDP 端口 {cdp_port} ...")
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{cdp_port}/json/version", timeout=4) as r:
            ver = json.loads(r.read().decode("utf-8"))
        print(f"  [OK] CDP 已开启: {ver.get('Browser', '')}")
    except Exception as e:
        print(f"  [FAIL] CDP 未开启: {e}")
        print("  请先用以下命令启动带远程调试端口的 Chrome：")
        print("    /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome \\")
        print("      --remote-debugging-port=9222 --user-data-dir=/tmp/chrome_pgy_debug")
        print("  然后在 Chrome 中登录 https://pgy.xiaohongshu.com")
        return False
    if not check_login:
        return True
    try:
        with playwright.sync_api.sync_playwright() as p:
            browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{cdp_port}")
            context = browser.contexts[0]
            main_page = None
            for pg in context.pages:
                if "pgy.xiaohongshu.com" in pg.url:
                    main_page = pg
                    break
            if main_page is None:
                main_page = context.new_page()
                main_page.goto("https://pgy.xiaohongshu.com/solar/pre-trade/note/kol",
                               wait_until="domcontentloaded", timeout=60000)
                time.sleep(3)
            body_text = main_page.inner_text("body")
            if "账号登录" in body_text or "立即登录" in body_text:
                print("  [FAIL] 蒲公英未登录，请在 Chrome 中登录 pgy.xiaohongshu.com")
                return False
            print("  [OK] 蒲公英登录态正常")
            return True
    except Exception as e:
        print(f"  [FAIL] 连接 Chrome 检查失败: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="小红书蒲公英 KOL 通用采集器")
    parser.add_argument("--config", default="", help="config JSON 路径（筛选参数+输出路径）")
    parser.add_argument("--port", type=int, default=9222, help="Chrome CDP 端口")
    parser.add_argument("--check", action="store_true", help="仅检查 CDP 与登录态，不采集")
    parser.add_argument("--output", type=str, default="", help="输出 CSV 路径（覆盖 config 中的 output_file）")
    args = parser.parse_args()

    if args.check:
        sys.exit(0 if check_environment(args.port, check_login=True) else 1)

    if not args.config:
        print("缺少 --config 参数。示例：")
        print("  python3 kol_collector.py --config examples/config-shanghai-food-tandian.json")
        print("或先运行 --check 验证环境。")
        sys.exit(2)

    # WORKSPACE_FILES = <campaign workspace>/workspace-files（skill 目录的上两级是 workspace 根）
    skill_scripts_dir = os.path.dirname(os.path.abspath(__file__))
    workspace_root = os.path.dirname(os.path.dirname(os.path.dirname(skill_scripts_dir)))
    WORKSPACE_FILES = os.path.join(workspace_root, "workspace-files")
    os.makedirs(WORKSPACE_FILES, exist_ok=True)

    with open(args.config, encoding="utf-8") as f:
        cfg = json.load(f)

    output_file = args.output or cfg.get("output_file", "")
    if not output_file:
        ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        output_file = os.path.join(WORKSPACE_FILES, f"KOL采集结果_{ts}.csv")
    if not os.path.isabs(output_file):
        output_file = os.path.join(WORKSPACE_FILES, output_file)
    os.makedirs(os.path.dirname(output_file), exist_ok=True)
    cfg["output_file"] = output_file
    cfg["cdp_port"] = args.port

    debug_file = output_file.replace(".csv", "_debug.json")

    print("=" * 60)
    print("小红书蒲公英 KOL 通用采集器")
    print("=" * 60)
    print(f"  输出文件: {output_file}")
    print(f"  关键词:   {cfg.get('keywords')}")
    print(f"  地域:     {cfg.get('location_cities')} / 粉丝地域 {cfg.get('fans_location_cities')}")
    print(f"  粉丝量:   {cfg.get('fans_number_lower')}-{cfg.get('fans_number_upper')}")
    print(f"  报价:     {cfg.get('note_price_lower')}-{cfg.get('note_price_upper')} 元")
    print(f"  内容标签: {cfg.get('target_tags')}  类目: {cfg.get('first_industry')}/{cfg.get('second_industry')}")
    print(f"  CDP 端口: {args.port}")
    print("=" * 60)
    print()

    collector = KolCollector(cfg)
    collector.run(output_file, debug_file)


if __name__ == "__main__":
    main()
