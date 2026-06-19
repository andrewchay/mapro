#!/usr/bin/env python3
"""MA KOL MCP Server —— 为 ma-proma Agent 提供 KOL 筛选与广告营销能力

通过 stdio 传输与 ma-proma Agent 通信。
运行时复用 ../ma 项目的 agent_core 模块（通过 MA_AGENT_CORE_PATH 环境变量指定）。

用法:
    # 开发环境（直接运行）
    MA_AGENT_CORE_PATH=/Users/chaihao/LLM/ma python3 mcp_server.py

    # 指定 Python 解释器（推荐 Python 3.10+）
    MA_AGENT_CORE_PATH=/Users/chaihao/LLM/ma /opt/homebrew/bin/python3.11 mcp_server.py

环境变量:
    MA_AGENT_CORE_PATH  -- 指向 ../ma 项目的根目录（包含 agent_core/ 的目录）
    OPENAI_API_KEY       -- LLM 分析用的 OpenAI Key（可选）
    ANTHROPIC_API_KEY    -- LLM 分析用的 Anthropic Key（可选）
    DEEPSEEK_API_KEY     -- LLM 分析用的 DeepSeek Key（可选）
"""
from __future__ import annotations

import os
import sys
import time
import json
from datetime import datetime
from pathlib import Path
from typing import Any

# =====================================================================
# 路径设置：通过环境变量找到 ../ma 的 agent_core 模块
# =====================================================================
_MA_PROJECT_ROOT = os.getenv("MA_AGENT_CORE_PATH", "")
if not _MA_PROJECT_ROOT:
    # 尝试基于本脚本位置自动推断
    # 本脚本位于: ma-proma/apps/electron/mcp-servers/ma-kol/mcp_server.py
    # ../ma 应该位于: ma-proma/../../ma
    _script_path = Path(__file__).resolve()
    _inferred = _script_path.parents[3].parent / "ma"
    if (_inferred / "agent_core").exists():
        _MA_PROJECT_ROOT = str(_inferred)
        print(f"[MA KOL MCP] 自动推断 MA_AGENT_CORE_PATH={_MA_PROJECT_ROOT}", file=sys.stderr)

if _MA_PROJECT_ROOT:
    ma_path = Path(_MA_PROJECT_ROOT).resolve()
    if str(ma_path) not in sys.path:
        sys.path.insert(0, str(ma_path))
else:
    print(
        "[MA KOL MCP] 错误: 无法找到 agent_core 模块。"
        "请设置 MA_AGENT_CORE_PATH 环境变量指向 ../ma 项目根目录。",
        file=sys.stderr,
    )
    sys.exit(1)

# =====================================================================
# MCP SDK 导入
# =====================================================================
try:
    from mcp.server.fastmcp import FastMCP
except ImportError as e:
    print(
        f"[MA KOL MCP] 错误: 未安装 mcp SDK。请运行: pip install mcp\n{e}",
        file=sys.stderr,
    )
    sys.exit(1)

# =====================================================================
# 复用 ../ma 核心模块
# =====================================================================
try:
    from agent_core.db import init_database, KOLRepository, get_db
    from agent_core.llm import get_llm_client
    from agent_core.tools.match_ai import (
        analyze_kol_with_llm,
        generate_kol_combo_with_llm,
        parse_followers,
        classify_kol_tier,
    )
    from agent_core.data_sources.collector import collect_kols_from_api
except ImportError as e:
    print(
        f"[MA KOL MCP] 错误: 无法导入 ../ma 的 agent_core 模块。"
        f"请确认 MA_AGENT_CORE_PATH={_MA_PROJECT_ROOT} 正确。\n{e}",
        file=sys.stderr,
    )
    sys.exit(1)

# 初始化数据库
init_database()

# 初始化广告营销扩展表（kol_crm, campaign_tests, content_audits, kol_performance）
_EXTRA_TABLES_SQL = """
CREATE TABLE IF NOT EXISTS kol_crm (
    kol_id TEXT PRIMARY KEY,
    onboarding_status TEXT DEFAULT 'pending',
    track TEXT,
    tags TEXT,
    response_rate REAL DEFAULT 0,
    loyalty_tier TEXT DEFAULT 'new',
    last_contact_date TEXT,
    total_cooperations INTEGER DEFAULT 0,
    total_revenue REAL DEFAULT 0,
    notes TEXT,
    created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
    updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);

CREATE TABLE IF NOT EXISTS campaign_tests (
    test_id TEXT PRIMARY KEY,
    campaign_id TEXT,
    test_name TEXT NOT NULL,
    budget REAL DEFAULT 0,
    kol_combo TEXT,
    start_date TEXT,
    end_date TEXT,
    status TEXT DEFAULT 'planned',
    results TEXT,
    optimization_notes TEXT,
    created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
    updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);

CREATE TABLE IF NOT EXISTS content_audits (
    audit_id TEXT PRIMARY KEY,
    kol_id TEXT NOT NULL,
    content_url TEXT,
    platform TEXT,
    audit_status TEXT DEFAULT 'pending',
    compliance_score REAL,
    brand_alignment_score REAL,
    quality_score REAL,
    audit_report TEXT,
    auditor TEXT DEFAULT 'ai',
    created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
    updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);

CREATE TABLE IF NOT EXISTS kol_performance (
    record_id TEXT PRIMARY KEY,
    kol_id TEXT NOT NULL,
    campaign_id TEXT,
    platform TEXT,
    category TEXT,
    exposure INTEGER DEFAULT 0,
    engagement INTEGER DEFAULT 0,
    conversion INTEGER DEFAULT 0,
    cpm REAL,
    cpe REAL,
    roi REAL,
    cooperation_score REAL,
    record_date TEXT,
    created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_kol_crm_status ON kol_crm(onboarding_status);
CREATE INDEX IF NOT EXISTS idx_kol_crm_loyalty ON kol_crm(loyalty_tier);
CREATE INDEX IF NOT EXISTS idx_campaign_tests_status ON campaign_tests(status);
CREATE INDEX IF NOT EXISTS idx_content_audits_kol ON content_audits(kol_id);
CREATE INDEX IF NOT EXISTS idx_content_audits_status ON content_audits(audit_status);
CREATE INDEX IF NOT EXISTS idx_kol_performance_kol ON kol_performance(kol_id);
CREATE INDEX IF NOT EXISTS idx_kol_performance_campaign ON kol_performance(campaign_id);
"""

try:
    with get_db() as conn:
        conn.executescript(_EXTRA_TABLES_SQL)
except Exception as e:
    print(f"[MA KOL MCP] 警告: 扩展表初始化失败: {e}", file=sys.stderr)

# =====================================================================
# MCP Server 实例
# =====================================================================
mcp = FastMCP(
    name="ma-kol-server",
    instructions="""MA KOL 数据服务 —— 提供 KOL 搜索、详情查看、AI 匹配分析、
组合策略生成、数据同步、内容审核、投放测试管理和效果追踪能力。
适用于社交媒体营销场景下的达人筛选、内容审核、投放策略制定与效果评估。""",
)


# =====================================================================
# 辅助函数
# =====================================================================

def _format_kol_basic(kol: dict[str, Any]) -> str:
    """格式化 KOL 基础信息为可读文本"""
    followers = kol.get("followers", "未知")
    engagement = kol.get("engagement", "未知")
    tier = classify_kol_tier(parse_followers(str(followers)))
    return (
        f"【{kol.get('name', '未知')}】\n"
        f"  ID: {kol.get('id')}\n"
        f"  平台: {kol.get('platform', '未知')} | 层级: {tier}\n"
        f"  粉丝: {followers} | 互动率: {engagement}\n"
        f"  分类: {kol.get('category', '未知')} | 报价: {kol.get('price', '未知')}\n"
        f"  城市: {kol.get('city', '未知')} | 来源: {kol.get('source', '未知')}"
    )


def _format_kol_detail(kol: dict[str, Any]) -> str:
    """格式化 KOL 详情（含原始数据）"""
    lines = [
        f"## {kol.get('name', '未知')}",
        "",
        "| 字段 | 值 |",
        "|------|------|",
        f"| ID | {kol.get('id')} |",
        f"| 平台 | {kol.get('platform', '')} |",
        f"| 粉丝量 | {kol.get('followers', '')} |",
        f"| 互动率 | {kol.get('engagement', '')} |",
        f"| 分类 | {kol.get('category', '')} |",
        f"| 报价 | {kol.get('price', '')} |",
        f"| 城市 | {kol.get('city', '未知')} |",
        f"| 头像 | {kol.get('avatar', '无')} |",
        f"| 数据来源 | {kol.get('source', '')} |",
        f"| 状态 | {kol.get('status', 'active')} |",
        "",
    ]

    # 近期作品
    recent_posts = kol.get("recent_posts", [])
    if recent_posts:
        lines.append("### 近期作品")
        for post in recent_posts[:10]:
            lines.append(f"- {post}")
        lines.append("")

    # 品牌历史
    brand_history = kol.get("brand_history", [])
    if brand_history:
        lines.append("### 合作品牌历史")
        for brand in brand_history[:10]:
            lines.append(f"- {brand}")
        lines.append("")

    # 原始数据摘要
    raw_data = kol.get("raw_data", {})
    if isinstance(raw_data, str):
        try:
            raw_data = json.loads(raw_data)
        except json.JSONDecodeError:
            raw_data = {}
    if raw_data and isinstance(raw_data, dict):
        lines.append("### 原始数据摘要")
        lines.append("```json")
        entries = [(k, v) for k, v in raw_data.items() if v not in (None, "", [], {})]
        for key, value in entries[:15]:
            display = (
                json.dumps(value, ensure_ascii=False)[:80]
                if isinstance(value, (dict, list))
                else str(value)[:80]
            )
            lines.append(f'  "{key}": {display}')
        if len(entries) > 15:
            lines.append(f"  ... 还有 {len(entries) - 15} 个字段")
        lines.append("```")

    return "\n".join(lines)


# =====================================================================
# MCP 工具
# =====================================================================

@mcp.tool(
    name="search_kols",
    description=(
        "搜索本地 KOL 数据库，支持平台、分类、粉丝量范围、互动率、城市等多条件组合筛选。"
        "返回匹配的 KOL 列表（含基础信息：粉丝量、互动率、报价、层级等）。"
        "如果本地数据不足，建议先使用 sync_kol_data 工具同步外部数据。"
    ),
)
def search_kols(
    platform: str = "",
    category: str = "",
    min_followers: int = 0,
    max_followers: int = 0,
    min_engagement: float = 0.0,
    city: str = "",
    keywords: str = "",
    limit: int = 20,
) -> str:
    """搜索本地 KOL 数据库"""
    try:
        kw_list = [w.strip() for w in keywords.split() if w.strip()] if keywords else None

        filters: dict[str, Any] = {"limit": min(max(limit, 1), 100)}
        if platform:
            filters["platform"] = platform
        if category:
            filters["category"] = category
        if min_followers > 0:
            filters["min_followers"] = min_followers
        if max_followers > 0:
            filters["max_followers"] = max_followers
        if min_engagement > 0:
            filters["min_engagement"] = min_engagement / 100.0 if min_engagement > 1 else min_engagement
        if city:
            filters["city"] = city
        if kw_list:
            filters["keywords"] = kw_list

        results = KOLRepository.search(**filters)

        if not results:
            total = KOLRepository.count()
            return (
                f"未找到匹配的 KOL。当前数据库共 {total} 条记录。\n\n"
                "建议:\n"
                "1. 尝试更宽泛的关键词或条件\n"
                "2. 使用 sync_kol_data 工具从外部 API 同步数据\n"
                "3. 使用 seed_mock_data 工具填充示例数据"
            )

        lines = [
            f"找到 {len(results)} 位 KOL：",
            "",
            *[f"{i + 1}. {_format_kol_basic(kol)}" for i, kol in enumerate(results)],
            "",
            "---",
            "提示：使用 get_kol_detail 获取某位 KOL 的完整信息，"
            "使用 analyze_kol 进行深度匹配度分析。",
        ]
        return "\n".join(lines)

    except Exception as e:
        return f"搜索失败: {e}"


@mcp.tool(
    name="get_kol_detail",
    description="根据 KOL ID 获取完整详情，包括近期作品、品牌合作历史和原始数据摘要。",
)
def get_kol_detail(kol_id: str) -> str:
    """获取单个 KOL 详情"""
    try:
        kol = KOLRepository.get_by_id(kol_id)
        if not kol:
            return f"未找到 KOL: {kol_id}\n\n请使用 search_kols 搜索正确的 ID。"
        return _format_kol_detail(kol)
    except Exception as e:
        return f"获取详情失败: {e}"


@mcp.tool(
    name="analyze_kol",
    description=(
        "使用 AI 深度分析 KOL 与品牌的匹配度。分析维度包括："
        "match_score（匹配评分 0-100）、受众重叠度、内容契合度、"
        "品牌调性匹配、风险因素、预估 ROI、合作建议等。"
        "需要配置 LLM API Key（读取环境变量 OPENAI_API_KEY 或 ANTHROPIC_API_KEY）。"
    ),
)
def analyze_kol(
    kol_id: str = "",
    brand: str = "",
    product: str = "",
    target_audience: str = "",
) -> str:
    """AI 分析 KOL 匹配度"""
    try:
        if not kol_id:
            return "错误: 请提供 kol_id 参数。"

        kol = KOLRepository.get_by_id(kol_id)
        if not kol:
            return f"未找到 KOL: {kol_id}\n\n请先用 search_kols 搜索正确的 ID。"

        analysis = analyze_kol_with_llm(kol, brand, product, target_audience)

        lines = [
            f"# {kol.get('name', '未知')} —— AI 匹配度分析",
            "",
            f"**匹配评分**: {analysis.get('match_score', 'N/A')} / 100",
            "",
            "## 分析结果",
            "",
            f"**匹配理由**: {analysis.get('match_reasoning', 'N/A')}",
            "",
            f"**受众重叠**: {analysis.get('audience_overlap', 'N/A')}",
            "",
            f"**内容契合**: {analysis.get('content_fit', 'N/A')}",
            "",
            f"**品牌调性**: {analysis.get('brand_alignment', 'N/A')}",
            "",
            f"**预估 ROI**: {analysis.get('estimated_roi', 'N/A')}",
            "",
            "## 优势",
            *[f"- {adv}" for adv in analysis.get("advantages", [])],
            "",
            "## 风险因素",
            *[f"- {risk}" for risk in analysis.get("risk_factors", [])],
            "",
            "## 合作建议",
            f"{analysis.get('cooperation_suggestions', 'N/A')}",
        ]
        return "\n".join(lines)
    except Exception as e:
        return f"分析失败: {e}"


@mcp.tool(
    name="generate_kol_combo",
    description=(
        "基于预算和品牌需求，使用 AI 生成最优 KOL 组合方案。"
        "输出包含：金字塔层级策略（头部/腰部/KOC）、预算分配、"
        "平台策略、传播节奏、预估效果等。"
        "需要配置 LLM API Key。"
    ),
)
def generate_kol_combo(
    budget: float = 50.0,
    platforms: str = "小红书,抖音",
    category: str = "通用",
    brand: str = "品牌",
    product: str = "产品",
    goal: str = "种草",
) -> str:
    """生成 KOL 组合策略"""
    try:
        platform_list = [p.strip() for p in platforms.split(",") if p.strip()]
        if not platform_list:
            platform_list = ["小红书"]

        combo = generate_kol_combo_with_llm(
            budget=budget,
            platforms=platform_list,
            category=category,
            brand=brand,
            product=product,
            goal=goal,
        )

        lines = [
            f"# {brand} —— KOL 组合策略方案",
            "",
            f"**预算**: {budget} 万元 | **品类**: {category} | **目标**: {goal}",
            f"**平台**: {', '.join(platform_list)}",
            "",
            "## 策略概述",
            combo.get("strategy_overview", "N/A"),
            "",
        ]

        budget_alloc = combo.get("budget_allocation", {})
        if budget_alloc:
            lines.append("## 预算分配")
            for tier, info in budget_alloc.items():
                if isinstance(info, dict):
                    pct = info.get("percentage", "N/A")
                    amt = info.get("amount", "N/A")
                    reason = info.get("rationale", "")
                    lines.append(f"- **{tier}**: {pct}% ({amt}万) — {reason}")
                else:
                    lines.append(f"- **{tier}**: {info}")
            lines.append("")

        head_kols = combo.get("recommended_head", [])
        if head_kols:
            lines.append("## 推荐头部 KOL")
            for kol in head_kols[:5]:
                lines.append(
                    f"- **{kol.get('name', '未知')}** | "
                    f"粉丝: {kol.get('followers', '未知')} | "
                    f"报价: {kol.get('price', '未知')} | "
                    f"{kol.get('reasoning', '')}"
                )
            lines.append("")

        waist_kols = combo.get("recommended_waist", [])
        if waist_kols:
            lines.append("## 推荐腰部 KOL")
            for kol in waist_kols[:8]:
                lines.append(
                    f"- **{kol.get('name', '未知')}** | "
                    f"粉丝: {kol.get('followers', '未知')} | "
                    f"报价: {kol.get('price', '未知')} | "
                    f"{kol.get('reasoning', '')}"
                )
            lines.append("")

        koc = combo.get("koc_strategy", {})
        if koc:
            lines.append("## KOC 策略")
            if isinstance(koc, dict):
                lines.append(f"- 数量: {koc.get('count', 'N/A')}")
                lines.append(f"- 筛选标准: {koc.get('selection_criteria', 'N/A')}")
                lines.append(f"- 执行方式: {koc.get('execution_approach', 'N/A')}")
            else:
                lines.append(str(koc))
            lines.append("")

        expected = combo.get("expected_results", {})
        if expected:
            lines.append("## 预期效果")
            lines.append(f"- 预计触达: {expected.get('total_reach', 'N/A')}")
            lines.append(f"- 预估互动: {expected.get('estimated_engagement', 'N/A')}")
            lines.append(f"- 预期 ROI: {expected.get('expected_roi', 'N/A')}")
            lines.append("")

        platform_strategy = combo.get("platform_strategy", {})
        if platform_strategy:
            lines.append("## 平台策略")
            for p, info in platform_strategy.items():
                if isinstance(info, dict):
                    lines.append(
                        f"- **{p}**: 优先级 {info.get('priority', 'N/A')} | "
                        f"预算占比 {info.get('budget_share', 'N/A')}%"
                    )
                else:
                    lines.append(f"- **{p}**: {info}")
            lines.append("")

        return "\n".join(lines)
    except Exception as e:
        return f"生成组合策略失败: {e}"


@mcp.tool(
    name="sync_kol_data",
    description=(
        "从外部 API 同步 KOL 数据到本地数据库。"
        "支持 justone（JustOneAPI）、newrank（新榜）、mock（示例数据）。"
        "justone/newrank 需要提前在环境变量或 .env 中配置 API Key。"
    ),
)
def sync_kol_data(
    source: str = "mock",
    platform: str = "小红书",
    keywords: str = "",
    limit: int = 20,
) -> str:
    """从外部 API 同步 KOL 数据"""
    try:
        if source not in ("justone", "newrank", "mock"):
            return f"错误: 不支持的数据源 '{source}'。可选: justone, newrank, mock"

        category = keywords if keywords else None

        report = collect_kols_from_api(
            source=source if source != "mock" else None,
            platform=platform,
            category=category,
            limit=limit,
        )

        lines = [
            f"# 数据同步报告 —— {source}",
            "",
        ]

        reports = report.get("reports", [report])
        for r in reports:
            src = r.get("source", source)
            success = r.get("success", False)
            if success:
                collected = r.get("collected", 0)
                if collected > 0:
                    lines.append(
                        f"✅ **{src}**: 采集 {collected} 条 "
                        f"(新增 {r.get('new', 0)}, 更新 {r.get('updated', 0)})"
                    )
                else:
                    lines.append(f"⚠️ **{src}**: {r.get('message', '无数据')}")
            else:
                lines.append(f"❌ **{src}**: {r.get('error', '失败')}")

        db_stats = report.get("db_stats", {})
        if db_stats:
            lines.append("")
            lines.append("## 数据库统计")
            lines.append(f"- 活跃 KOL: {db_stats.get('total_active', 0)}")
            by_platform = db_stats.get("by_platform", {})
            if by_platform:
                lines.append("- 按平台分布:")
                for p, c in by_platform.items():
                    lines.append(f"  - {p}: {c} 条")

        return "\n".join(lines)
    except Exception as e:
        return f"同步失败: {e}"


@mcp.tool(
    name="get_kol_stats",
    description="获取本地 KOL 数据库统计概览：总记录数、按平台分布、按数据来源分布。",
)
def get_kol_stats() -> str:
    """获取数据库统计"""
    try:
        stats = KOLRepository.get_stats()
        lines = [
            "# KOL 数据库统计",
            "",
            f"**活跃 KOL**: {stats.get('total_active', 0)}",
            f"**全部 KOL**: {stats.get('total_all', 0)}",
            "",
            "## 按平台分布",
        ]
        by_platform = stats.get("by_platform", {})
        if by_platform:
            for platform, count in sorted(by_platform.items(), key=lambda x: -x[1]):
                lines.append(f"- {platform}: {count} 位")
        else:
            lines.append("（暂无数据）")

        lines.append("")
        lines.append("## 按数据来源")
        by_source = stats.get("by_source", {})
        if by_source:
            for source, count in sorted(by_source.items(), key=lambda x: -x[1]):
                lines.append(f"- {source}: {count} 条")
        else:
            lines.append("（暂无数据）")

        lines.append("")
        lines.append("---")
        lines.append("提示：使用 sync_kol_data 同步更多数据。")

        return "\n".join(lines)
    except Exception as e:
        return f"获取统计失败: {e}"


@mcp.tool(
    name="seed_mock_data",
    description="用内置示例数据填充本地数据库，用于测试和功能体验。无需 API Key。",
)
def seed_mock_data() -> str:
    """填充示例数据"""
    try:
        report = collect_kols_from_api(source=None, platform="小红书", limit=50)
        db_stats = report.get("db_stats", {})
        return (
            f"✅ 示例数据已填充\n\n"
            f"数据库总计: {db_stats.get('total_active', 0)} 条\n"
            f"现在可以使用 search_kols 搜索这些示例数据了。"
        )
    except Exception as e:
        return f"填充示例数据失败: {e}"


# =====================================================================
# 广告营销扩展工具
# =====================================================================

@mcp.tool(
    name="audit_content",
    description=(
        "对 KOL 发布的内容进行 AI 审核，评估合规性、品牌契合度和内容质量。"
        "审核结果自动写入 content_audits 表。需要配置 LLM API Key。"
    ),
)
def audit_content(
    kol_id: str = "",
    content_url: str = "",
    platform: str = "",
    content_description: str = "",
    brand: str = "",
    product: str = "",
) -> str:
    """AI 审核 KOL 内容并记录结果"""
    try:
        if not kol_id:
            return "错误: 请提供 kol_id 参数。"

        # 验证 KOL 存在
        kol = KOLRepository.get_by_id(kol_id)
        if not kol:
            return f"未找到 KOL: {kol_id}\n\n请先用 search_kols 搜索正确的 ID。"

        # 构建 LLM 审核 Prompt
        system_prompt = """你是一位资深广告内容审核专家。请基于提供的 KOL 内容和品牌信息，进行全面的内容审核。

请以 JSON 格式返回审核结果：
{
    "compliance_score": 85,
    "compliance_analysis": "合规性分析：是否违反广告法、平台规范、行业自律等",
    "brand_alignment_score": 80,
    "brand_alignment_analysis": "品牌契合度分析：内容调性、价值观、视觉风格是否与品牌一致",
    "quality_score": 75,
    "quality_analysis": "内容质量分析：创意水平、制作质量、信息传达效果",
    "overall_assessment": "总体评估和建议",
    "risk_flags": ["风险点1", "风险点2"],
    "recommendations": ["优化建议1", "优化建议2"]
}"""

        prompt = f"""请审核以下 KOL 内容：

KOL信息:
- 名称: {kol.get('name', '未知')}
- 平台: {kol.get('platform', '未知')}
- 分类: {kol.get('category', '未知')}

内容信息:
- 内容链接: {content_url or '未提供'}
- 平台: {platform or '未指定'}
- 内容描述: {content_description or '未提供'}

品牌信息:
- 品牌: {brand or '未指定'}
- 产品: {product or '未指定'}

请进行全面的内容审核。"""

        # 调用 LLM
        llm = get_llm_client()
        audit_result = {}
        try:
            result = llm.complete(prompt, system_prompt=system_prompt, json_mode=True, max_tokens=2000)
            if isinstance(result, dict) and "error" not in result:
                audit_result = result
        except Exception as llm_err:
            print(f"[audit_content] LLM 调用失败，使用规则模式: {llm_err}", file=sys.stderr)

        # 如果 LLM 失败，使用规则模式
        if not audit_result:
            audit_result = _rule_based_content_audit(kol, content_description, brand, product)

        # 提取分数
        compliance_score = float(audit_result.get("compliance_score", 70))
        brand_alignment_score = float(audit_result.get("brand_alignment_score", 70))
        quality_score = float(audit_result.get("quality_score", 70))
        audit_status = "passed" if compliance_score >= 60 and brand_alignment_score >= 50 else "failed"

        # 生成审核报告 Markdown
        report_lines = [
            f"# 内容审核报告 — {kol.get('name', '未知')}",
            "",
            f"**KOL ID**: {kol_id}",
            f"**平台**: {platform or kol.get('platform', '未知')}",
            f"**内容链接**: {content_url or '未提供'}",
            f"**审核状态**: {'✅ 通过' if audit_status == 'passed' else '❌ 未通过'}",
            "",
            "## 评分概览",
            "",
            f"| 维度 | 分数 | 评估 |",
            f"|------|------|------|",
            f"| 合规性 | {compliance_score:.0f}/100 | {'良好' if compliance_score >= 80 else '一般' if compliance_score >= 60 else '需改进'} |",
            f"| 品牌契合 | {brand_alignment_score:.0f}/100 | {'良好' if brand_alignment_score >= 80 else '一般' if brand_alignment_score >= 60 else '需改进'} |",
            f"| 内容质量 | {quality_score:.0f}/100 | {'良好' if quality_score >= 80 else '一般' if quality_score >= 60 else '需改进'} |",
            "",
            "## 详细分析",
            "",
            f"### 合规性分析\n{audit_result.get('compliance_analysis', '未生成详细分析')}",
            "",
            f"### 品牌契合度分析\n{audit_result.get('brand_alignment_analysis', '未生成详细分析')}",
            "",
            f"### 内容质量分析\n{audit_result.get('quality_analysis', '未生成详细分析')}",
            "",
            f"### 总体评估\n{audit_result.get('overall_assessment', '未生成总体评估')}",
            "",
        ]

        risk_flags = audit_result.get("risk_flags", [])
        if risk_flags:
            report_lines.append("## ⚠️ 风险标记")
            for flag in risk_flags:
                report_lines.append(f"- {flag}")
            report_lines.append("")

        recommendations = audit_result.get("recommendations", [])
        if recommendations:
            report_lines.append("## 💡 优化建议")
            for rec in recommendations:
                report_lines.append(f"- {rec}")
            report_lines.append("")

        # 写入数据库
        audit_id = f"audit_{kol_id}_{int(time.time())}"
        audit_report_md = "\n".join(report_lines)

        with get_db() as conn:
            conn.execute(
                """
                INSERT INTO content_audits (
                    audit_id, kol_id, content_url, platform, audit_status,
                    compliance_score, brand_alignment_score, quality_score,
                    audit_report, auditor, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(audit_id) DO UPDATE SET
                    audit_status = excluded.audit_status,
                    compliance_score = excluded.compliance_score,
                    brand_alignment_score = excluded.brand_alignment_score,
                    quality_score = excluded.quality_score,
                    audit_report = excluded.audit_report,
                    updated_at = excluded.updated_at
                """,
                (
                    audit_id, kol_id, content_url, platform or kol.get("platform", ""), audit_status,
                    compliance_score, brand_alignment_score, quality_score,
                    audit_report_md, "ai", int(time.time() * 1000), int(time.time() * 1000),
                ),
            )

        report_lines.append(f"---")
        report_lines.append(f"✅ 审核记录已保存 | 审核ID: `{audit_id}`")
        return "\n".join(report_lines)

    except Exception as e:
        return f"内容审核失败: {e}"


def _rule_based_content_audit(kol: dict, content_description: str, brand: str, product: str) -> dict:
    """基于规则的内容审核（LLM 失败时回退）"""
    engagement = kol.get("engagement", "0%")
    try:
        if isinstance(engagement, (int, float)):
            engagement_val = float(engagement)
        else:
            engagement_val = float(str(engagement).rstrip("%"))
    except (ValueError, TypeError):
        engagement_val = 0

    base_quality = 60 + min(engagement_val, 20)
    base_compliance = 75
    base_brand = 60 if brand else 50

    if content_description and len(content_description) > 50:
        base_quality += 5

    return {
        "compliance_score": min(100, base_compliance),
        "compliance_analysis": "基于规则的基础合规性评估：未发现明显违规风险。",
        "brand_alignment_score": min(100, base_brand),
        "brand_alignment_analysis": f"基于规则的品牌契合度评估：{'内容描述较完整' if content_description else '缺少内容描述，无法深度评估'}。",
        "quality_score": min(100, base_quality),
        "quality_analysis": f"基于规则的内容质量评估：KOL 互动率 {engagement}，预估内容质量一般。",
        "overall_assessment": "规则模式审核完成。建议配置 LLM API Key 获取更精准的 AI 审核结果。",
        "risk_flags": [],
        "recommendations": ["配置 LLM API Key 以启用 AI 深度审核"],
    }


@mcp.tool(
    name="get_content_audit",
    description="查询内容审核记录。可通过 audit_id 查询单条，或通过 kol_id 查询该 KOL 的所有审核记录。",
)
def get_content_audit(
    audit_id: str = "",
    kol_id: str = "",
) -> str:
    """查询 content_audits 表"""
    try:
        if not audit_id and not kol_id:
            return "错误: 请提供 audit_id 或 kol_id 参数。"

        with get_db() as conn:
            if audit_id:
                row = conn.execute(
                    "SELECT * FROM content_audits WHERE audit_id = ?", (audit_id,)
                ).fetchone()
                if not row:
                    return f"未找到审核记录: {audit_id}"
                return _format_content_audit_row(dict(row))
            else:
                rows = conn.execute(
                    "SELECT * FROM content_audits WHERE kol_id = ? ORDER BY created_at DESC",
                    (kol_id,),
                ).fetchall()
                if not rows:
                    return f"KOL {kol_id} 暂无内容审核记录。"

                lines = [
                    f"# KOL 内容审核记录 — {kol_id}",
                    f"共 {len(rows)} 条记录",
                    "",
                    "| 审核ID | 平台 | 状态 | 合规 | 品牌契合 | 质量 | 审核时间 |",
                    "|--------|------|------|------|----------|------|----------|",
                ]
                for row in rows:
                    r = dict(row)
                    created = _format_ts(r.get("created_at"))
                    lines.append(
                        f"| {r.get('audit_id', '-')} | {r.get('platform', '-')} | "
                        f"{r.get('audit_status', '-')} | {r.get('compliance_score', '-')} | "
                        f"{r.get('brand_alignment_score', '-')} | {r.get('quality_score', '-')} | {created} |"
                    )
                lines.append("")
                lines.append("使用 `audit_content` 工具进行新的内容审核。")
                return "\n".join(lines)

    except Exception as e:
        return f"查询审核记录失败: {e}"


def _format_content_audit_row(row: dict) -> str:
    """格式化单条审核记录为 Markdown"""
    lines = [
        f"# 审核详情 — {row.get('audit_id', '未知')}",
        "",
        f"**KOL ID**: {row.get('kol_id', '-')}",
        f"**内容链接**: {row.get('content_url', '未提供')}",
        f"**平台**: {row.get('platform', '-')}",
        f"**审核状态**: {row.get('audit_status', '-')}",
        f"**审核人**: {row.get('auditor', '-')}",
        f"**审核时间**: {_format_ts(row.get('created_at'))}",
        "",
        "## 评分",
        "",
        f"| 维度 | 分数 |",
        f"|------|------|",
        f"| 合规性 | {row.get('compliance_score', 'N/A')} |",
        f"| 品牌契合 | {row.get('brand_alignment_score', 'N/A')} |",
        f"| 内容质量 | {row.get('quality_score', 'N/A')} |",
        "",
        "## 审核报告",
        "",
        row.get("audit_report", "无报告内容"),
    ]
    return "\n".join(lines)


@mcp.tool(
    name="create_campaign_test",
    description="创建一个新的投放测试计划，记录到 campaign_tests 表中。",
)
def create_campaign_test(
    test_name: str = "",
    campaign_id: str = "",
    budget: float = 0.0,
    platforms: str = "",
    kol_combo: str = "",
    start_date: str = "",
    end_date: str = "",
) -> str:
    """在 campaign_tests 表中创建测试记录"""
    try:
        if not test_name:
            return "错误: 请提供 test_name 参数。"

        test_id = f"test_{int(time.time())}_{hash(test_name) % 10000:04d}"
        now = int(time.time() * 1000)

        with get_db() as conn:
            conn.execute(
                """
                INSERT INTO campaign_tests (
                    test_id, campaign_id, test_name, budget, kol_combo,
                    start_date, end_date, status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    test_id, campaign_id, test_name, budget, kol_combo,
                    start_date, end_date, "planned", now, now,
                ),
            )

        lines = [
            f"✅ 投放测试已创建",
            "",
            f"| 字段 | 值 |",
            f"|------|------|",
            f"| 测试ID | `{test_id}` |",
            f"| 测试名称 | {test_name} |",
            f"| 活动ID | {campaign_id or '-'} |",
            f"| 预算 | ¥{budget:,.2f} |",
            f"| 平台 | {platforms or '-'} |",
            f"| KOL组合 | {kol_combo or '-'} |",
            f"| 开始日期 | {start_date or '-'} |",
            f"| 结束日期 | {end_date or '-'} |",
            f"| 状态 | planned |",
            "",
            "使用 `update_campaign_test_results` 工具更新测试结果。",
        ]
        return "\n".join(lines)

    except Exception as e:
        return f"创建测试失败: {e}"


@mcp.tool(
    name="update_campaign_test_results",
    description="更新投放测试的结果和状态。results 参数为 JSON 字符串。",
)
def update_campaign_test_results(
    test_id: str = "",
    results: str = "",
    status: str = "",
    optimization_notes: str = "",
) -> str:
    """更新 campaign_tests 的 results 和 status"""
    try:
        if not test_id:
            return "错误: 请提供 test_id 参数。"

        # 验证 JSON
        results_dict = {}
        if results:
            try:
                results_dict = json.loads(results)
            except json.JSONDecodeError:
                return "错误: results 参数不是有效的 JSON 字符串。"

        with get_db() as conn:
            # 检查记录存在
            row = conn.execute(
                "SELECT * FROM campaign_tests WHERE test_id = ?", (test_id,)
            ).fetchone()
            if not row:
                return f"未找到测试记录: {test_id}"

            updates = []
            params = []
            if results:
                updates.append("results = ?")
                params.append(results)
            if status:
                updates.append("status = ?")
                params.append(status)
            if optimization_notes:
                updates.append("optimization_notes = ?")
                params.append(optimization_notes)

            if not updates:
                return "⚠️ 没有提供需要更新的字段。"

            updates.append("updated_at = ?")
            params.append(int(time.time() * 1000))
            params.append(test_id)

            conn.execute(
                f"UPDATE campaign_tests SET {', '.join(updates)} WHERE test_id = ?",
                params,
            )

            # 重新查询
            updated = conn.execute(
                "SELECT * FROM campaign_tests WHERE test_id = ?", (test_id,)
            ).fetchone()

        r = dict(updated) if updated else {}
        lines = [
            f"✅ 测试记录已更新",
            "",
            f"| 字段 | 值 |",
            f"|------|------|",
            f"| 测试ID | {r.get('test_id', test_id)} |",
            f"| 测试名称 | {r.get('test_name', '-')} |",
            f"| 状态 | {r.get('status', '-')} |",
            f"| 预算 | ¥{r.get('budget', 0):,.2f} |",
            "",
        ]

        if r.get("results"):
            lines.append("## 测试结果")
            lines.append("```json")
            try:
                parsed = json.loads(r["results"])
                lines.append(json.dumps(parsed, ensure_ascii=False, indent=2))
            except json.JSONDecodeError:
                lines.append(r["results"])
            lines.append("```")
            lines.append("")

        if r.get("optimization_notes"):
            lines.append("## 优化笔记")
            lines.append(r["optimization_notes"])
            lines.append("")

        return "\n".join(lines)

    except Exception as e:
        return f"更新测试结果失败: {e}"


@mcp.tool(
    name="record_kol_performance",
    description=(
        "记录一次 KOL 合作的效果数据，写入 kol_performance 表。"
        "同时自动更新 kol_crm 的 total_cooperations 和 total_revenue。"
    ),
)
def record_kol_performance(
    kol_id: str = "",
    campaign_id: str = "",
    platform: str = "",
    exposure: int = 0,
    engagement: int = 0,
    conversion: int = 0,
    cpm: float = 0.0,
    cpe: float = 0.0,
    roi: float = 0.0,
    cooperation_score: float = 0.0,
    record_date: str = "",
) -> str:
    """在 kol_performance 表中插入记录并更新 CRM"""
    try:
        if not kol_id:
            return "错误: 请提供 kol_id 参数。"

        # 验证 KOL 存在
        kol = KOLRepository.get_by_id(kol_id)
        if not kol:
            return f"未找到 KOL: {kol_id}\n\n请先用 search_kols 搜索正确的 ID。"

        record_id = f"perf_{kol_id}_{int(time.time())}"
        now = int(time.time() * 1000)
        date_str = record_date or datetime.now().strftime("%Y-%m-%d")

        # 计算营收（简化：用 CPM 估算）
        estimated_revenue = 0.0
        if cpm > 0 and exposure > 0:
            estimated_revenue = (exposure / 1000) * cpm

        with get_db() as conn:
            # 插入效果记录
            conn.execute(
                """
                INSERT INTO kol_performance (
                    record_id, kol_id, campaign_id, platform, category,
                    exposure, engagement, conversion, cpm, cpe, roi,
                    cooperation_score, record_date, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    record_id, kol_id, campaign_id, platform, kol.get("category", ""),
                    exposure, engagement, conversion, cpm if cpm > 0 else None,
                    cpe if cpe > 0 else None, roi if roi > 0 else None,
                    cooperation_score if cooperation_score > 0 else None,
                    date_str, now,
                ),
            )

            # 更新 CRM 统计
            crm = conn.execute(
                "SELECT * FROM kol_crm WHERE kol_id = ?", (kol_id,)
            ).fetchone()

            if crm:
                conn.execute(
                    """
                    UPDATE kol_crm SET
                        total_cooperations = total_cooperations + 1,
                        total_revenue = total_revenue + ?,
                        updated_at = ?
                    WHERE kol_id = ?
                    """,
                    (estimated_revenue, now, kol_id),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO kol_crm (
                        kol_id, total_cooperations, total_revenue,
                        onboarding_status, loyalty_tier, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (kol_id, 1, estimated_revenue, "active", "new", now, now),
                )

        lines = [
            f"✅ 效果数据已记录",
            "",
            f"| 字段 | 值 |",
            f"|------|------|",
            f"| 记录ID | `{record_id}` |",
            f"| KOL | {kol.get('name', kol_id)} |",
            f"| 活动ID | {campaign_id or '-'} |",
            f"| 平台 | {platform or '-'} |",
            f"| 曝光 | {exposure:,} |",
            f"| 互动 | {engagement:,} |",
            f"| 转化 | {conversion:,} |",
        ]
        if cpm > 0:
            lines.append(f"| CPM | ¥{cpm:.2f} |")
        if cpe > 0:
            lines.append(f"| CPE | ¥{cpe:.2f} |")
        if roi > 0:
            lines.append(f"| ROI | {roi:.2f} |")
        if cooperation_score > 0:
            lines.append(f"| 合作评分 | {cooperation_score:.1f} |")
        lines.append(f"| 记录日期 | {date_str} |")
        if estimated_revenue > 0:
            lines.append(f"| 预估营收 | ¥{estimated_revenue:.2f} |")
        lines.append("")
        lines.append(f"CRM 已更新: 合作次数 +1, 总营收 +¥{estimated_revenue:.2f}")

        return "\n".join(lines)

    except Exception as e:
        return f"记录效果数据失败: {e}"


@mcp.tool(
    name="get_kol_performance_summary",
    description=(
        "查询 KOL 的效果数据汇总。支持按时间段筛选，返回 Markdown 表格和统计摘要。"
        "campaign_id 为可选参数。"
    ),
)
def get_kol_performance_summary(
    kol_id: str = "",
    campaign_id: str = "",
    start_date: str = "",
    end_date: str = "",
) -> str:
    """查询 kol_performance 表并汇总统计"""
    try:
        if not kol_id:
            return "错误: 请提供 kol_id 参数。"

        # 验证 KOL 存在
        kol = KOLRepository.get_by_id(kol_id)
        kol_name = kol.get("name", kol_id) if kol else kol_id

        conditions = ["kol_id = ?"]
        params = [kol_id]

        if campaign_id:
            conditions.append("campaign_id = ?")
            params.append(campaign_id)
        if start_date:
            conditions.append("record_date >= ?")
            params.append(start_date)
        if end_date:
            conditions.append("record_date <= ?")
            params.append(end_date)

        where_sql = " AND ".join(conditions)

        with get_db() as conn:
            rows = conn.execute(
                f"SELECT * FROM kol_performance WHERE {where_sql} ORDER BY record_date DESC",
                params,
            ).fetchall()

            if not rows:
                return f"📭 {kol_name} 在指定条件下暂无效果记录。"

            records = [dict(r) for r in rows]

        # 汇总统计
        total_exposure = sum(r.get("exposure", 0) or 0 for r in records)
        total_engagement = sum(r.get("engagement", 0) or 0 for r in records)
        total_conversion = sum(r.get("conversion", 0) or 0 for r in records)

        cpm_values = [r.get("cpm") for r in records if r.get("cpm") is not None]
        avg_cpm = sum(cpm_values) / len(cpm_values) if cpm_values else 0

        cpe_values = [r.get("cpe") for r in records if r.get("cpe") is not None]
        avg_cpe = sum(cpe_values) / len(cpe_values) if cpe_values else 0

        roi_values = [r.get("roi") for r in records if r.get("roi") is not None]
        avg_roi = sum(roi_values) / len(roi_values) if roi_values else 0

        score_values = [r.get("cooperation_score") for r in records if r.get("cooperation_score") is not None]
        avg_score = sum(score_values) / len(score_values) if score_values else 0

        engagement_rate = (total_engagement / total_exposure * 100) if total_exposure > 0 else 0
        conversion_rate = (total_conversion / total_engagement * 100) if total_engagement > 0 else 0

        lines = [
            f"# 📊 KOL 效果汇总 — {kol_name}",
            "",
            f"**查询条件**: KOL={kol_id}{f', 活动={campaign_id}' if campaign_id else ''}{f', 日期={start_date}~{end_date}' if start_date or end_date else ''}",
            f"**记录数**: {len(records)} 条",
            "",
            "## 汇总统计",
            "",
            f"| 指标 | 数值 |",
            f"|------|------|",
            f"| 总曝光 | {total_exposure:,} |",
            f"| 总互动 | {total_engagement:,} |",
            f"| 总转化 | {total_conversion:,} |",
            f"| 互动率 | {engagement_rate:.2f}% |",
            f"| 转化率 | {conversion_rate:.2f}% |",
            f"| 平均 CPM | {f'¥{avg_cpm:.2f}' if avg_cpm > 0 else '-'} |",
            f"| 平均 CPE | {f'¥{avg_cpe:.2f}' if avg_cpe > 0 else '-'} |",
            f"| 平均 ROI | {f'{avg_roi:.2f}' if avg_roi > 0 else '-'} |",
            f"| 平均合作评分 | {f'{avg_score:.1f}' if avg_score > 0 else '-'} |",
            "",
            "## 明细记录",
            "",
            "| 日期 | 活动 | 平台 | 曝光 | 互动 | 转化 | CPM | CPE | ROI | 评分 |",
            "|------|------|------|------|------|------|-----|-----|-----|------|",
        ]

        for r in records:
            lines.append(
                f"| {r.get('record_date', '-')} | {r.get('campaign_id', '-')} | "
                f"{r.get('platform', '-')} | {r.get('exposure', 0):,} | "
                f"{r.get('engagement', 0):,} | {r.get('conversion', 0):,} | "
                f"{r.get('cpm', '-') or '-'} | {r.get('cpe', '-') or '-'} | "
                f"{r.get('roi', '-') or '-'} | {r.get('cooperation_score', '-') or '-'} |"
            )

        lines.append("")
        return "\n".join(lines)

    except Exception as e:
        return f"查询效果汇总失败: {e}"


def _format_ts(ts: Any) -> str:
    """格式化时间戳为可读字符串"""
    if not ts:
        return "-"
    try:
        num = int(ts)
        if num > 1e12:
            num = num / 1000
        return datetime.fromtimestamp(num).strftime("%Y-%m-%d %H:%M")
    except (ValueError, TypeError, OSError):
        return str(ts)


# =====================================================================
# 入口
# =====================================================================

if __name__ == "__main__":
    # 检查 LLM 环境变量
    has_llm_key = bool(
        os.getenv("OPENAI_API_KEY")
        or os.getenv("ANTHROPIC_API_KEY")
        or os.getenv("DEEPSEEK_API_KEY")
    )
    if not has_llm_key:
        print(
            "[MA KOL MCP] 警告: 未检测到 LLM API Key。"
            "analyze_kol、generate_kol_combo 和 audit_content 将回退到规则模式。",
            file=sys.stderr,
        )

    # 启动 stdio 传输
    mcp.run(transport="stdio")
