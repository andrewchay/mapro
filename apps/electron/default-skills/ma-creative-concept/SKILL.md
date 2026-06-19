---
name: ma-creative-concept
description: 创意概念与Big Idea生成专家。基于品牌DNA和TA洞察，生成核心创意概念、Big Idea、内容支柱和品牌宣言。适用于 campaign 创意发想、品牌传播主题制定、内容策略顶层设计。当用户提到"Big Idea"、"创意概念"、"传播主题"、"品牌宣言"、"内容支柱"、"campaign idea"时触发。
version: "1.0.0"
---

# 创意概念与 Big Idea 生成

## 这个 Skill 做什么

基于品牌 DNA 和 TA 洞察，生成系统性的创意概念方案：
- **核心创意概念**：可延展的 Big Idea
- **洞察支撑**：支撑创意的核心消费者洞察
- **品牌宣言**：有态度的品牌表达
- **内容支柱**：可落地的内容方向和角度
- **差异化**：与竞品的创意区隔
- **风险评估**：潜在的创意风险

## 何时使用

**合适的场景：**
- Campaign 创意发想阶段
- 品牌年度传播主题制定
- 内容策略的顶层设计
- 品牌焕新后的创意方向探索
- 比稿或提案前的创意概念准备

**不合适的场景：**
- 已有确定 Big Idea 后的执行阶段
- 纯战术层面的单次内容创作
- 没有品牌 DNA 或 TA 洞察基础时（建议先使用 ma-brand-dna 和 ma-ta-portrait）

## 工作流

### Step 1 · 输入确认

确认以下信息是否充足：
| 信息项 | 说明 |
|--------|------|
| 品牌 DNA | 核心价值、品牌人格、调性 |
| TA 洞察 | 痛点、欲望、消费行为 |
| 传播目标 | 本次 campaign 的具体目标 |
| 预算级别 | 影响创意的可执行性 |
| 概念数量 | 需要生成几个备选概念（建议2-3个） |

### Step 2 · 概念生成

生成多个有明显差异的创意概念，每个包含完整的 Big Idea、洞察、宣言和内容支柱。

### Step 3 · 推荐与评估

给出推荐概念及理由，并诚实评估每个概念的风险。

## 输出格式

必须以 JSON 格式返回：

```json
{
  "status": "complete | partial",
  "concepts": [
    {
      "concept_id": "A",
      "big_idea": "一句话核心创意",
      "insight": "支撑创意的核心洞察",
      "hashtag_candidates": ["#话题1", "#话题2", "#话题3"],
      "manifesto": "品牌宣言/态度表达",
      "content_pillars": [
        {
          "pillar_name": "支柱名",
          "pillar_objective": "传播目标",
          "content_angles": ["角度1", "角度2"],
          "suitable_platforms": ["平台1", "平台2"]
        }
      ],
      "differentiation": "与竞品的差异化",
      "emotional_hook": "情绪钩子",
      "risk_assessment": "潜在风险"
    }
  ],
  "recommended_concept": "推荐的概念ID及理由",
  "confidence_score": 85
}
```

## 规则

1. **big_idea 必须一句话能说清**，避免复杂从句，任何人都能复述
2. **insight 要具体**，不是"消费者喜欢美的""年轻人追求个性"这类常识，要有独特的观察
3. **manifesto 要有态度**，能引发共鸣或争议，不是安全的品牌标语
4. **content_pillars 必须匹配 suitable_platforms**，不是全平台通用，每个支柱有明确的主攻平台
5. **risk_assessment 必须诚实**，不回避潜在问题（如"可能引发争议""执行难度高"）
6. 生成的每个概念要有**明显差异**，不是同一个方向的微调
7. 如果没有品牌 DNA 基础，标注需要补充的信息项
