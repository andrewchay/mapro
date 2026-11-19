/**
 * 品牌 DNA 步骤的单一事实来源（Single Source of Truth）。
 *
 * 背景：此前 `ma-brand-dna/SKILL.md` 与 `campaign-workflow-service.ts` 的 agentPrompt
 * 各自维护一份字段清单，且两份互不覆盖——SKILL 只有 heritage/core_values/added_values/
 * personality_traits/tone_of_voice，prompt 只有品牌阶段/产品现状/核心问题/核心目标。
 * 结果：走工作区对话的产出缺诊断层，走 Campaign 工作流的产出缺情感层，同一 skill
 * 出现两套结构（见 .context/note-brand-dna-follow-gap-20261119.md）。
 *
 * 现在两边都从这里取字段定义，避免再次分叉。
 */

/** 品牌 DNA 的单个字段定义 */
export interface BrandDnaField {
  /** 中文字段名（用于校验锚点与小标题） */
  name: string
  /** 输出文件中的建议小标题 */
  heading: string
  /** 该字段要求说明的内容 */
  requirement: string
  /** 校验时可用于识别的关键词（任一命中即算覆盖） */
  aliases: string[]
}

/**
 * 品牌 DNA 完整字段清单（12 项）。
 *
 * 分层：
 * - 传承层：品牌传承
 * - 需求层：用户需求
 * - 事实层：产品/服务、品牌阶段、产品现状
 * - 诊断层：核心问题、核心目标
 * - 价值层：核心价值、附加价值
 * - 人格层：品牌人格、品牌语气
 * - 定位层：差异化优势
 */
export const BRAND_DNA_FIELDS: BrandDnaField[] = [
  {
    name: '品牌传承',
    heading: '品牌传承',
    requirement: '创立背景、发展历程、里程碑事件，以及可继承的文化资产（不只是成立时间）',
    aliases: ['品牌传承', '传承', '历史', '创立', '发展', '里程碑', 'heritage'],
  },
  {
    name: '用户需求',
    heading: '用户需求',
    requirement:
      '用户真实处境与矛盾（从什么场景开始产生需求），须引用 user-analysis 的洞察，不能只写人群标签',
    aliases: ['用户需求', '需求', '痛点', '处境', '矛盾', '消费者需求', 'insight', '洞察'],
  },
  {
    name: '产品服务',
    heading: '产品/服务',
    requirement: '核心产品线、功能卖点、价格带、SKU 结构，以及过往 campaign / slogan 等现有传播资产',
    aliases: ['产品', '服务', '功能', '卖点', '价格', '价格带', '产品线', 'SKU', '传播'],
  },
  {
    name: '品牌阶段',
    heading: '品牌阶段',
    requirement: '判定处于起步期 / 成长期 / 成熟期 / 焕新期，并给出判定依据',
    aliases: ['品牌阶段', '起步期', '成长期', '成熟期', '焕新期', '阶段'],
  },
  {
    name: '产品现状',
    heading: '产品现状',
    requirement: '产品力、供应链、价格带的现状诊断，指出结构性短板与优势',
    aliases: ['产品现状', '产品力', '供应链', '价格带', 'SKU', '产品诊断'],
  },
  {
    name: '核心问题',
    heading: '核心问题',
    requirement: '明确当前首要问题是认知问题 / 转化问题 / 口碑问题，并说明界定理由',
    aliases: ['核心问题', '认知问题', '转化问题', '口碑问题', '问题'],
  },
  {
    name: '核心目标',
    heading: '核心目标',
    requirement: '基于阶段与问题确定首要目标（曝光 / 破圈拉新 / 转化），并给出目标优先级',
    aliases: ['核心目标', '目标', '优先级', '曝光', '破圈', '拉新', '首要目标'],
  },
  {
    name: '核心价值',
    heading: '核心价值',
    requirement: '消费者能直接感知的产品/功能价值（不是企业价值观），每条要能落到具体感知点',
    aliases: ['核心价值', '核心有形价值', '价值', '功能价值'],
  },
  {
    name: '附加价值',
    heading: '附加价值',
    requirement: '情感、文化、生活方式层面的价值，必须具体到使用场景与心理收益',
    aliases: ['附加价值', '情感价值', '情绪价值', '生活方式'],
  },
  {
    name: '品牌人格',
    heading: '品牌人格',
    requirement: '3-5 个有画面感的形容词，避免"专业""优秀"这类空泛词',
    aliases: ['品牌人格', '人格', '个性', '性格', 'personality'],
  },
  {
    name: '品牌语气',
    heading: '品牌语气',
    requirement: '具体到语言风格的一句话描述，如"像一个懂行但不炫耀的朋友"',
    aliases: ['品牌语气', '语气', '调性', 'tone', '语言风格'],
  },
  {
    name: '差异化优势',
    heading: '差异化优势',
    requirement: '结合市场/竞品/用户分析，总结能戳中洞察的核心差异点，并说明为何竞品难以复制',
    aliases: ['差异化', '优势', '差异', '独特', '核心竞争力', '不同'],
  },
]

/** brand_dna 步骤必须依赖的前置步骤（未完成则不应产出） */
export const BRAND_DNA_PREREQUISITE_STEPS = [
  'market_analysis',
  'competitor_analysis',
  'user_analysis',
] as const

/** 前置步骤 ID → 产物目录名 */
export const BRAND_DNA_PREREQUISITE_DIRS: Record<string, string> = {
  market_analysis: 'market-analysis',
  competitor_analysis: 'competitor-analysis',
  user_analysis: 'user-analysis',
}

/** 前置步骤 ID → 中文名（用于错误提示） */
export const BRAND_DNA_PREREQUISITE_LABELS: Record<string, string> = {
  market_analysis: '市场分析',
  competitor_analysis: '竞品分析',
  user_analysis: '用户分析',
}

/** brand_dna 步骤的三个产物文件与各文件负责的字段 */
export const BRAND_DNA_FILE_PLAN: Array<{ file: string; fields: string[]; summary: string }> = [
  {
    file: 'brand-dna.md',
    fields: ['品牌传承', '用户需求', '产品/服务', '核心价值', '附加价值', '品牌人格', '品牌语气'],
    summary: '品牌自身是谁：传承、用户需求、产品、价值、人格与语气',
  },
  {
    file: 'brand-diagnosis.md',
    fields: ['品牌阶段', '产品现状', '核心问题', '核心目标'],
    summary: '品牌现在在哪：阶段、产品现状、核心问题、核心目标',
  },
  {
    file: 'differentiation.md',
    fields: ['差异化优势'],
    summary: '品牌凭什么是它：差异化优势与不可复制性',
  },
]

/**
 * 生成品牌 DNA 步骤的「统一字段规范」提示词片段。
 *
 * server 与 electron 两处 workflow service 都调用此函数，保证 prompt 永不脱钩。
 */
export function buildBrandDnaFieldSpec(): string {
  const fieldLines = BRAND_DNA_FIELDS.map(
    (f, i) => `${i + 1}. **${f.heading}**：${f.requirement}`,
  ).join('\n')

  const fileLines = BRAND_DNA_FILE_PLAN.map(
    (p) => `- \`${p.file}\`（${p.summary}）：${p.fields.join('、')}`,
  ).join('\n')

  return `## 统一字段规范（12 项，缺一不可）

本步骤的字段清单与 \`ma-brand-dna\` skill 完全一致，必须全量覆盖，不允许只写其中一部分：

${fieldLines}

## 文件划分

${fileLines}

注意：三项诊断字段（品牌阶段/产品现状/核心问题/核心目标）不得省略；情感层字段（附加价值/品牌人格/品牌语气）同样不得省略。只做其一即为未完成。`
}

/**
 * 生成品牌 DNA 步骤的前置依赖声明提示词片段。
 */
export function buildBrandDnaPrerequisiteDirective(): string {
  const items = BRAND_DNA_PREREQUISITE_STEPS.map((s) => {
    const dir = BRAND_DNA_PREREQUISITE_DIRS[s]
    const label = BRAND_DNA_PREREQUISITE_LABELS[s]
    return `- \`${dir}/\`（${label}）`
  }).join('\n')

  return `## 前置依赖（硬性）

本步骤必须基于以下三个目录的分析结论展开，禁止凭 brief 直接推导：

${items}

执行顺序要求：
1. 先读取上述三个目录的内容，在产出中显式引用它们的结论（例如引用 user-analysis 的洞察、competitor-analysis 的差异点、market-analysis 的品类判断）。
2. 若某个目录缺失或为空，先完成对应步骤，不要跳过。
3. 产出中的「用户需求」字段必须来自 user-analysis，「差异化优势」必须来自 competitor-analysis，「品牌阶段/核心问题」必须基于 market-analysis 的品类判断。`
}
