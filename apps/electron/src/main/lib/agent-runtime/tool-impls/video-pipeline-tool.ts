/**
 * VideoPipeline 工具（Provider-Agnostic Runtime）
 *
 * 允许 Agent 一键触发完整「文本 → 广告视频成片」流水线：
 *   文本/产品信息 → storyboard（分镜）→ 首帧图 → 逐镜生成 → 拼接成片
 *
 * 底层复用 @ma-proma/server/video 的纯逻辑模块：
 *   - generateStoryboard / runVideoPipeline / generateFrames
 *
 * 产物落盘到调用方指定的 assetsRoot/video-assets/{raw,final,frames}。
 */

import type { ToolResult } from '@ma-proma/core'
import type { Storyboard, VideoInput } from '@ma-proma/server/video'
import {
  generateStoryboard,
  runVideoPipeline,
  generateFrames,
} from '@ma-proma/server/video'
import type { ToolContext } from '../types'

export const VIDEO_PIPELINE_TOOL_NAME = 'video_pipeline'

export function createVideoPipelineToolDefinition() {
  return {
    name: VIDEO_PIPELINE_TOOL_NAME,
    description:
      '生成广告视频：给定产品/品牌信息，自动拆解分镜、逐镜生成视频、拼接成片。' +
      '调用前需已有 creative-concept 等前置产物，或在参数中直接提供产品信息与卖点。' +
      '产物写入 assetsRoot/video-assets/ 目录（raw=分镜片段, final=成片, frames=首帧图）。',
    parameters: {
      type: 'object' as const,
      properties: {
        product: {
          type: 'string',
          description: '产品/服务名称',
        },
        category: {
          type: 'string',
          description: '品类（护肤品/彩妆/食品/服装等，影响文案模板）',
        },
        sellingPoints: {
          type: 'array',
          description: '核心卖点列表（3-5 个）',
        },
        targetAudience: {
          type: 'string',
          description: '目标人群描述',
        },
        platform: {
          type: 'string',
          enum: ['xiaohongshu', 'douyin', 'bilibili', 'weibo'],
          description: '投放平台',
        },
        duration: {
          type: 'number',
          description: '目标成片时长（秒），5-30',
        },
        engine: {
          type: 'string',
          enum: ['seedance', 'minimax-h3'],
          description: '视频生成引擎',
        },
        assetsRoot: {
          type: 'string',
          description: '产物根目录（campaign 工作区根，video-assets 会建于其下）',
        },
        generateFrames: {
          type: 'boolean',
          description: '是否先为图生视频镜头生成首帧图（需 Proma Cloud 凭据），默认 true',
        },
        apiKey: {
          type: 'string',
          description: 'Proma Cloud 凭据 apiKey（可选，缺省从环境读取）',
        },
        baseUrl: {
          type: 'string',
          description: 'Proma Cloud 凭据 baseUrl（可选，缺省从环境读取）',
        },
      },
      required: ['product', 'targetAudience', 'platform', 'assetsRoot'],
    },
  }
}

interface VideoPipelineInput {
  product: string
  category?: string
  sellingPoints?: string[]
  targetAudience: string
  platform: 'xiaohongshu' | 'douyin' | 'bilibili' | 'weibo'
  duration?: number
  engine: 'seedance' | 'minimax-h3'
  assetsRoot: string
  generateFrames?: boolean
  apiKey?: string
  baseUrl?: string
}

export async function executeVideoPipelineTool(
  input: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  const p = parseInput(input)
  if (!p) {
    return { toolCallId: '', content: '参数缺失：product / targetAudience / platform / assetsRoot 必填', isError: true }
  }

  const platformAspect: Record<string, '9:16' | '16:9' | '1:1' | '3:4'> = {
    douyin: '9:16',
    xiaohongshu: '3:4',
    bilibili: '16:9',
    weibo: '1:1',
  }
  const outputFormat = {
    douyin: '1080x1920' as const,
    xiaohongshu: '1080x1440' as const,
    bilibili: '1920x1080' as const,
    weibo: '1080x1080' as const,
  }

  const videoInput: VideoInput = {
    product: p.product,
    category: p.category ?? '通用',
    sellingPoints: p.sellingPoints ?? [],
    targetAudience: p.targetAudience,
    platform: p.platform,
    duration: p.duration ?? 15,
    textInput: '',
  }

  try {
    // 1. 生成分镜
    const storyboard: Storyboard = generateStoryboard(videoInput)

    // 2. 可选：为首帧帧图生成（供 image_to_video 镜头）
    const framesDir = p.assetsRoot + '/video-assets/frames'
    if (p.generateFrames !== false && p.apiKey && p.baseUrl) {
      const frameRequests = storyboard.shots
        .filter((s) => s.generationMethod === 'image_to_video')
        .map((s) => ({ shotId: s.shotId, prompt: s.firstFramePrompt }))
      if (frameRequests.length > 0) {
        await generateFrames(frameRequests, framesDir, {
          apiKey: p.apiKey,
          baseUrl: p.baseUrl,
          concurrency: 2,
        })
      }
    }

    // 3. 逐镜生成 + 拼接成片
    const pipelineResult = await runVideoPipeline({
      campaignId: 'campaign-' + Date.now(),
      assetsRoot: p.assetsRoot,
      storyboard,
      aspectRatio: platformAspect[p.platform] ?? '3:4',
      engine: p.engine ?? 'seedance',
      concurrency: 2,
      outputFormat: outputFormat[p.platform],
    })

    if (!pipelineResult.success) {
      return {
        toolCallId: '',
        content: `视频流水线未完全成功：${pipelineResult.error ?? '未知错误'}`,
        isError: true,
      }
    }

    const shotsInfo = pipelineResult.shots
      .map((s) => `#${s.shotId}: ${s.status}${s.outputPath ? ` (${s.outputPath})` : ''}`)
      .join('\n')

    return {
      toolCallId: '',
      content:
        `✅ 视频成片生成完成\n\n` +
        `成片路径：${pipelineResult.finalVideoPath}\n` +
        `分镜片段数：${pipelineResult.rawVideoPaths.length}\n\n` +
        `分镜详情：\n${shotsInfo}`,
      isError: false,
    }
  } catch (e) {
    return {
      toolCallId: '',
      content: `视频生成失败：${e instanceof Error ? e.message : String(e)}`,
      isError: true,
    }
  }
}

function parseInput(input: unknown): VideoPipelineInput | null {
  if (!input || typeof input !== 'object') return null
  const r = input as Record<string, unknown>
  const platform = r.platform as VideoPipelineInput['platform']
  if (
    typeof r.product !== 'string' ||
    typeof r.targetAudience !== 'string' ||
    typeof r.assetsRoot !== 'string' ||
    !['xiaohongshu', 'douyin', 'bilibili', 'weibo'].includes(platform)
  ) {
    return null
  }
  return {
    product: r.product,
    category: typeof r.category === 'string' ? r.category : undefined,
    sellingPoints: Array.isArray(r.sellingPoints) ? (r.sellingPoints as string[]) : undefined,
    targetAudience: r.targetAudience,
    platform,
    duration: typeof r.duration === 'number' ? r.duration : undefined,
    engine: r.engine === 'minimax-h3' ? 'minimax-h3' : 'seedance',
    assetsRoot: r.assetsRoot,
    generateFrames: r.generateFrames === false ? false : true,
    apiKey: typeof r.apiKey === 'string' ? r.apiKey : undefined,
    baseUrl: typeof r.baseUrl === 'string' ? r.baseUrl : undefined,
  }
}
