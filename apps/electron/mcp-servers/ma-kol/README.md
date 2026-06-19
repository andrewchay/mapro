# MA KOL MCP Server

为 ma-proma Agent 提供 `../ma` 项目的 KOL 筛选能力。

## 原理

本 MCP Server 是一个独立的 Python 进程（stdio 传输），运行时通过 `MA_AGENT_CORE_PATH` 环境变量引用 `../ma` 项目的 `agent_core` 模块，复用其数据库访问层和 LLM 分析能力。

## 前置条件

- Python 3.10+（mcp SDK 要求）
- `pip install mcp`
- `../ma` 项目已存在且包含 `agent_core/` 模块

## 提供的工具

### KOL 数据工具

| 工具 | 功能 |
|------|------|
| `search_kols` | 多条件筛选 KOL（平台/分类/粉丝量/互动率/城市/关键词） |
| `get_kol_detail` | 获取单个 KOL 完整详情 |
| `analyze_kol` | AI 深度分析 KOL 匹配度（match_score、ROI 预估等） |
| `generate_kol_combo` | 生成 KOL 组合策略（金字塔策略、预算分配） |
| `sync_kol_data` | 从 justone/newrank/mock 同步数据 |
| `get_kol_stats` | 数据库统计概览 |
| `seed_mock_data` | 填充示例数据 |

### 广告营销扩展工具

| 工具 | 功能 |
|------|------|
| `audit_content` | AI 审核 KOL 内容（合规性/品牌契合度/内容质量），结果写入 `content_audits` 表 |
| `get_content_audit` | 查询内容审核记录（按 audit_id 或 kol_id） |
| `create_campaign_test` | 创建投放测试计划，记录到 `campaign_tests` 表 |
| `update_campaign_test_results` | 更新投放测试的结果和状态 |
| `record_kol_performance` | 记录 KOL 合作效果数据，写入 `kol_performance` 表并同步更新 `kol_crm` |
| `get_kol_performance_summary` | 查询 KOL 效果数据汇总（支持按时间段筛选） |

## ma-proma 配置

### 1. 找到工作区 MCP 配置文件

```
~/.mapro/agent-workspaces/{workspace-slug}/mcp.json
```

### 2. 添加以下配置

```json
{
  "servers": {
    "ma-kol-server": {
      "type": "stdio",
      "command": "/opt/homebrew/bin/python3.11",
      "args": [
        "/Users/chaihao/LLM/ma-proma/apps/electron/mcp-servers/ma-kol/mcp_server.py"
      ],
      "env": {
        "MA_AGENT_CORE_PATH": "/Users/chaihao/LLM/ma",
        "OPENAI_API_KEY": "sk-...",
        "ANTHROPIC_API_KEY": "sk-ant-..."
      },
      "enabled": true,
      "timeout": 30
    }
  }
}
```

### 环境变量说明

| 变量 | 必需 | 说明 |
|------|------|------|
| `MA_AGENT_CORE_PATH` | ✅ | 指向 `../ma` 项目根目录的绝对路径 |
| `OPENAI_API_KEY` | ❌ | LLM 分析用的 OpenAI Key |
| `ANTHROPIC_API_KEY` | ❌ | LLM 分析用的 Anthropic Key |
| `DEEPSEEK_API_KEY` | ❌ | LLM 分析用的 DeepSeek Key |

> 未配置 LLM Key 时，`analyze_kol`、`generate_kol_combo` 和 `audit_content` 会回退到规则模式，不影响其他工具。

### 3. 验证

启动 ma-proma Agent 会话，在对话中提问：

> "帮我搜索几个小红书上粉丝 10-50 万的美妆 KOL"

Agent 会自动调用 `search_kols` 工具并返回结果。

## 手动测试

```bash
cd /Users/chaihao/LLM/ma-proma/apps/electron/mcp-servers/ma-kol
MA_AGENT_CORE_PATH=/Users/chaihao/LLM/ma /opt/homebrew/bin/python3.11 mcp_server.py
```

（stdio 模式会等待输入，可用 MCP Inspector 测试）
