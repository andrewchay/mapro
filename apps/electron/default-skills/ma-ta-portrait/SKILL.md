---
name: ma-ta-portrait
description: 目标受众（TA）画像构建专家。基于品牌信息和行业背景，构建核心TA与潜质TA的完整画像，包括人口统计、心理特征、消费行为和社交平台习惯。适用于品牌定位、内容策略制定、KOL筛选标准建立。当用户提到"TA画像"、"目标人群"、"消费者洞察"、"受众分析"、"用户画像"时触发。
version: "1.0.0"
---

# 目标受众（TA）画像构建

## 这个 Skill 做什么

基于品牌信息和行业背景，构建完整的 TA 画像：
- **核心 TA**：人口统计、心理特征、消费行为、痛点与欲望
- **潜质 TA**：与核心 TA 的差异和激活策略
- **社交语言**：TA 的真实用语和表达习惯
- **Persona 原话**：模拟 TA 的口吻和情绪

## 何时使用

**合适的场景：**
- 品牌定位前的受众洞察
- 内容策略制定时的受众校准
- KOL 筛选标准的建立
- 创意概念验证时的受众匹配
- 新市场/新品类拓展时的受众探索

**不合适的场景：**
- 已有详细用户研究报告时
- 纯执行层面的单次内容创作
- B2B 企业的决策链分析（需要不同的分析框架）

## 工作流

### Step 1 · 信息收集

收集以下信息：
| 信息项 | 说明 |
|--------|------|
| 品牌/产品 | 核心功能和卖点 |
| 行业背景 | 品类特征和消费习惯 |
| 现有客群 | 已知的用户特征（如有） |
| 价格带 | 影响目标人群的收入层级 |
| 投放区域 | 国内/海外，影响文化背景 |

### Step 2 · 画像构建

基于信息构建核心 TA 和潜质 TA 的完整画像。

### Step 3 · 验证

通过 persona_quotes 验证画像是否真实可信。

## 输出格式

必须以 JSON 格式返回：

```json
{
  "status": "complete | partial",
  "core_ta": {
    "demographic": {
      "age_range": "25-35岁",
      "gender": "女性为主（70%）",
      "city_tier": "一二线城市",
      "income_level": "月收入1-3万"
    },
    "psychographic": {
      "values": ["品质生活", "自我提升"],
      "lifestyle": ["注重仪式感", "愿意为体验付费"],
      "aspirations": ["成为更好的自己", "拥有精致生活"]
    },
    "consumption_behavior": {
      "purchase_drivers": ["口碑推荐", "成分/功效"],
      "purchase_barriers": ["价格敏感", "担心不适用"],
      "media_habits": ["小红书种草", "抖音短视频"],
      "platform_preference": ["小红书", "抖音", "B站"]
    },
    "pain_points": ["痛点1", "痛点2"],
    "desires": ["欲望1", "欲望2"],
    "social_terms": ["社交语言1", "社交语言2"]
  },
  "potential_ta": {
    "demographic": "潜质TA描述",
    "gap_from_core": "与核心TA的差异",
    "activation_strategy": "如何激活这部分人群"
  },
  "persona_quotes": [
    "模拟TA原话1",
    "模拟TA原话2"
  ],
  "confidence_score": 85
}
```

## 规则

1. **pain_points 和 desires 要形成张力**，如"想要专业表现，也在意风格表达""追求效率，但不愿牺牲品质"
2. **social_terms 要用 TA 的真实语言**，不是品牌语言，如"绝了""狠狠爱住"而非"卓越品质"
3. **persona_quotes 要像真实用户说的话**，带情绪和细节，避免"这个产品很好用"这类平淡表达
4. **potential_ta** 必须有明确的 **gap_from_core** 和 **activation_strategy**
5. 如果是海外投放，增加文化背景和当地社交平台习惯
6. consumption_behavior 要具体到平台和行为，如"小红书搜索→收藏→比价→下单"
7. confidence_score 诚实评估，信息不足时降低分数并标注缺失项
