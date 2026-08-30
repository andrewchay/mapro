# Campaign 创意评估五维 Checklist — 奥格威框架落地

> 基于大卫·奥格威「品牌形象 + 广告调查」双框架，为 MA-Proma 设计的 KOL 内容审核评分体系。

## 一、五维评分体系

| 维度 | 权重 | 核心原则（奥格威原话） |
|---|---|---|
| **合规性** | 20% | 广告法与平台规范是底线 |
| **品牌契合度** | 25% | 「承诺，大大的承诺，是广告的灵魂」 |
| **内容质量** | 25% | 「消费者不是低能儿」「好广告是不引公众注意它自己就把产品推销掉的作品」 |
| **品牌形象一致性** | 20% | 「品牌形象是一项长期投资，而非一次性活动」 |
| **数据可验证性** | 10% | 「调查是广告创作的基础，而非创意的敌人」 |

**加权公式：**
```
总分 = 合规性×0.20 + 品牌契合度×0.25 + 内容质量×0.25 + 品牌形象一致性×0.20 + 数据可验证性×0.10
```

## 二、评分标准

| 分数段 | 等级 | 处理建议 |
|---|---|---|
| 90-100 | 优秀 | 可直接发布 |
| 70-89 | 良好 | 需微调后发布 |
| 50-69 | 一般 | 需修改后重新审核 |
| 0-49 | 不合格 | 需大幅修改或拒绝 |

## 三、一票否决项

触发任一即判定为不合格：
- 出现广告法明令禁止的绝对化用语（「最」「第一」「国家级」）
- 涉及虚假宣传（如普通食品宣称治疗功效）
- 品牌名/Logo 错误、变形或负面呈现
- 达人与品牌调性严重冲突
- 内容涉及政治/宗教/种族等敏感话题
- 抄袭或高度相似于竞品/过往内容

## 四、代码落地

### 类型定义
- 文件：`packages/shared/src/types/campaign.ts`
- `ContentAudit` 接口扩展 `brandImageScore` + `dataVerifiabilityScore`
- `CreateContentAuditInput` 接口扩展 7 个奥格威框架上下文字段

### 审核服务
- 文件：`packages/server/src/campaign/content-audit-service.ts`
- `AuditScores` 接口：6 维评分（含新增两维）
- `evaluateWithLLM()`：解析 LLM 返回的 JSON，提取 `brand_image` + `data_verifiability`
- `evaluateWithRules()`：本地规则打分（无 LLM 时回退）
- `buildSystemPrompt()`：奥格威五维 Prompt 模板
- `buildAuditPrompt()`：动态拼接「品牌规范」+「数据支撑」上下文
- `formatAuditReport()` / `buildFallbackReport()`：含 🎨 品牌形象一致性 + 📊 数据可验证性 章节

### 数据层
- 文件：`packages/server/src/campaign/campaign-repository.ts`
- `content_audits` 表新增 `brand_image_score` + `data_verifiability_score` 列
- `createContentAudit()` / `rowToContentAudit()` 同步扩展

### 单元测试
- 文件：`packages/server/src/campaign/content-audit-service.test.ts`
- Mock 返回值与参数类型同步扩展
- 8 个测试用例全部通过

## 五、Prompt 输出 JSON Schema

LLM 必须返回严格 JSON：

```json
{
  "audit_summary": "审核结论：通过/需修改/不通过",
  "compliance_check": { "score": 85, "issues": [], "suggestions": [] },
  "brand_alignment": { "score": 90, "matches": [], "mismatches": [] },
  "quality_assessment": { "score": 88, "strengths": [], "weaknesses": [] },
  "brand_image": {
    "score": 82,
    "tone_match": "调性匹配度说明",
    "visual_compliance": "视觉合规性说明",
    "persona_alignment": "品牌人格匹配度说明"
  },
  "data_verifiability": {
    "score": 75,
    "insight_support": "前置洞察支撑说明",
    "test_ready": "A/B测试就绪度说明",
    "benchmark_comparison": "历史Benchmark对标说明"
  },
  "revision_suggestions": [],
  "overall_score": 85,
  "final_verdict": "通过，建议微调"
}
```

## 六、规则打分启发式逻辑

### 品牌形象一致性（基础分 60）
- `brandPersona` 含「专业」+ 描述含「专家/医生/研发/科学」→ +15
- `brandPersona` 含「潮流」+ 描述含「时尚/种草/必入/yyds」→ +15
- `brandPersona` 含「温暖」+ 描述含「贴心/安心/守护」→ +15
- `brandPersona` 含「高端」+ 描述含「奢华/精致/匠心」→ +15
- 提供 `visualGuidelines` → +5

### 数据可验证性（基础分 50）
- `dataSupport` 长度 > 10 → +25
- `benchmarkData` 长度 > 10 → +15
- 描述中含数据证据（数字、百分比、研究发现等）→ +10

## 七、新增输入字段（Brief → 审核上下文）

| 字段 | 说明 | 示例 |
|---|---|---|
| `brandPersona` | 品牌人格卡片 | 专家朋友 / 潮流引领者 |
| `visualGuidelines` | 视觉规范 | 暖色调 / 场景要求 |
| `keyMessage` | 核心传播信息 | 「每天一杯，肠道更轻松」 |
| `sellingPoints` | 核心卖点（JSON 数组） | `["0添加", "300亿活菌"]` |
| `targetAudience` | 目标受众画像 | 25-35岁都市女性 |
| `dataSupport` | 数据支撑/洞察来源 | 消费者调研报告摘要 |
| `benchmarkData` | 历史 Benchmark | 上期 Campaign CPE/CPM 数据 |

---
*归档时间：2026-08-30 | 关联 PR：奥格威五维 Campaign 创意评估*
