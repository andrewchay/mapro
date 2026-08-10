import { writeFile, rm, readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * FFmpeg 视频合成管道
 * 用于多镜拼接、字幕叠加、BGM 添加
 */

// ============================================================
// 类型定义
// ============================================================

export interface VideoCompositionConfig {
  /** 输入视频片段路径列表 */
  inputVideos: string[];
  /** 输出路径 */
  outputPath: string;
  /** 字幕文件路径（可选） */
  subtitlePath?: string;
  /** BGM 路径（可选） */
  bgmPath?: string;
  /** 转场效果 */
  transitions?: TransitionConfig[];
  /** 输出格式 */
  outputFormat?: OutputFormat;
}

export interface TransitionConfig {
  /** 转场位置（第几个片段后） */
  position: number;
  /** 转场类型 */
  type: "fade" | "slide" | "zoom" | "wipe";
  /** 转场时长（秒） */
  duration: number;
}

export interface OutputFormat {
  /** 分辨率 */
  resolution: "1080x1920" | "1080x1440" | "1920x1080" | "1080x1080";
  /** 帧率 */
  fps?: number;
  /** 视频码率 */
  videoBitrate?: string;
  /** 音频码率 */
  audioBitrate?: string;
}

export interface CompositionResult {
  /** 是否成功 */
  success: boolean;
  /** 输出路径 */
  outputPath?: string;
  /** 视频信息 */
  videoInfo?: VideoInfo;
  /** 错误信息 */
  error?: string;
}

export interface VideoInfo {
  /** 时长（秒） */
  duration: number;
  /** 分辨率 */
  resolution: string;
  /** 文件大小 */
  fileSize: string;
  /** 码率 */
  bitrate: string;
}

// ============================================================
// 默认配置
// ============================================================

const DEFAULT_OUTPUT_FORMAT: OutputFormat = {
  resolution: "1080x1920",
  fps: 30,
  videoBitrate: "5000k",
  audioBitrate: "128k",
};

// ============================================================
// 核心合成函数
// ============================================================

/**
 * 合成视频（基础拼接）
 */
export async function composeVideo(
  config: VideoCompositionConfig
): Promise<CompositionResult> {
  try {
    // 1. 验证输入
    const validationError = validateInputs(config);
    if (validationError) {
      return { success: false, error: validationError };
    }

    // 2. 检查 FFmpeg 是否可用
    const ffmpegAvailable = await checkFFmpeg();
    if (!ffmpegAvailable) {
      return {
        success: false,
        error: "FFmpeg 未安装，请先安装 FFmpeg: https://ffmpeg.org/download.html",
      };
    }

    // 3. 生成 concat 文件
    const concatFile = await generateConcatFile(config.inputVideos);

    // 4. 构建 FFmpeg 命令
    const ffmpegCmd = buildFFmpegCommand(config, concatFile);

    // 5. 执行合成
    const ffmpegResult = await execFileAsync('ffmpeg', ffmpegCmd.split(' ').filter(Boolean))

    // 6. 获取视频信息
    const videoInfo = await getVideoInfo(config.outputPath);

    // 7. 清理临时文件
    await cleanup(concatFile);

    return {
      success: true,
      outputPath: config.outputPath,
      videoInfo,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================
// FFmpeg 命令构建
// ============================================================

/**
 * 构建 FFmpeg 命令
 */
function buildFFmpegCommand(
  config: VideoCompositionConfig,
  concatFile: string
): string {
  const format = config.outputFormat || DEFAULT_OUTPUT_FORMAT;
  const [width, height] = format.resolution.split("x");

  let cmd = `ffmpeg -y -f concat -safe 0 -i "${concatFile}"`;

  // 添加字幕
  if (config.subtitlePath) {
    cmd += ` -vf "subtitles=${config.subtitlePath}:force_style='FontSize=24,PrimaryColour=&HFFFFFF&,OutlineColour=&H000000&,Outline=2'"`;
  }

  // 添加 BGM
  if (config.bgmPath) {
    cmd += ` -i "${config.bgmPath}" -shortest`;
    cmd += ` -c:a aac -b:a ${format.audioBitrate}`;
  } else {
    cmd += " -c:a copy";
  }

  // 视频编码参数
  cmd += ` -c:v libx264 -preset fast -crf 23`;
  cmd += ` -r ${format.fps}`;
  cmd += ` -b:v ${format.videoBitrate}`;
  cmd += ` -s ${format.resolution}`;

  // 输出格式优化（平台适配）
  if (config.outputFormat?.resolution === "1080x1920") {
    // 抖音 9:16 优化
    cmd += " -pix_fmt yuv420p -tag:v hvc1";
  }

  // 输出路径
  cmd += ` "${config.outputPath}"`;

  return cmd;
}

/**
 * 生成 concat 文件（用于无转场拼接）
 */
async function generateConcatFile(videoPaths: string[]): Promise<string> {
  const concatContent = videoPaths
    .map(path => `file '${path}'`)
    .join("\n");

  const concatFile = `/tmp/video_concat_${Date.now()}.txt`;
  await writeFile(concatFile, concatContent);
  return concatFile;
}

// ============================================================
// 带转场的复杂合成
// ============================================================

/**
 * 合成视频（带转场效果）
 * 使用 FFmpeg filter_complex 实现
 */
export async function composeVideoWithTransitions(
  config: VideoCompositionConfig
): Promise<CompositionResult> {
  try {
    const validationError = validateInputs(config);
    if (validationError) {
      return { success: false, error: validationError };
    }

    const ffmpegAvailable = await checkFFmpeg();
    if (!ffmpegAvailable) {
      return {
        success: false,
        error: "FFmpeg 未安装",
      };
    }

    // 构建复杂的 filter_complex 命令
    const filterComplex = buildFilterComplex(config);
    const cmd = `ffmpeg -y ${filterComplex.inputs} -filter_complex "${filterComplex.filter}" -map "[outv]" -map "[outa]" -c:v libx264 -preset fast -crf 23 "${config.outputPath}"`;

    // 对含引号的参数，去掉首尾引号（execFile 不经 shell）
    const filteredCmd = cmd.replace(/\"/g, '')
    await execFileAsync('ffmpeg', filteredCmd.trim().split(/\s+/).filter(Boolean))


    const videoInfo = await getVideoInfo(config.outputPath);

    return {
      success: true,
      outputPath: config.outputPath,
      videoInfo,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 构建 filter_complex 滤镜图
 */
function buildFilterComplex(config: VideoCompositionConfig): {
  inputs: string;
  filter: string;
} {
  const videos = config.inputVideos;
  const transitions = config.transitions || [];

  // 输入声明
  let inputs = "";
  videos.forEach((video, i) => {
    inputs += `-i "${video}" `;
  });

  // 构建滤镜链
  let filter = "";
  const streamLabels: string[] = [];

  // 为每个视频添加 scale 滤镜
  videos.forEach((_, i) => {
    const [width, height] = (config.outputFormat?.resolution || "1080x1920").split("x");
    filter += `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2[v${i}]; `;
    streamLabels.push(`[v${i}]`);
  });

  // 添加转场（简化版：使用 xfade 滤镜）
  if (transitions.length > 0 && videos.length > 1) {
    let current = "[v0]";
    for (let i = 1; i < videos.length; i++) {
      const transition = transitions.find(t => t.position === i - 1);
      if (transition) {
        const transitionType = getFFmpegTransitionType(transition.type);
        filter += `${current}[v${i}]xfade=transition=${transitionType}:duration=${transition.duration}:offset=${i * 5 - transition.duration}[vtmp${i}]; `;
        current = `[vtmp${i}]`;
      } else {
        filter += `${current}[v${i}]concat=n=2:v=1:a=0[vtmp${i}]; `;
        current = `[vtmp${i}]`;
      }
    }
    filter += `${current}[outv]; `;
  } else {
    // 无转场，直接拼接
    filter += `${streamLabels.join("")}concat=n=${videos.length}:v=1:a=0[outv]; `;
  }

  // 音频处理
  filter += `${videos.map((_, i) => `[${i}:a]`).join("")}amix=inputs=${videos.length}:duration=longest[outa]`;

  return { inputs, filter };
}

/**
 * 转场类型映射
 */
function getFFmpegTransitionType(type: string): string {
  const mapping: Record<string, string> = {
    fade: "fade",
    slide: "slideleft",
    zoom: "zoomin",
    wipe: "wipeleft",
  };
  return mapping[type] || "fade";
}

// ============================================================
// 字幕生成
// ============================================================

export interface SubtitleEntry {
  /** 序号 */
  index: number;
  /** 开始时间（秒） */
  startTime: number;
  /** 结束时间（秒） */
  endTime: number;
  /** 字幕文本 */
  text: string;
}

/**
 * 生成 SRT 字幕文件
 */
export async function generateSRT(
  entries: SubtitleEntry[],
  outputPath: string
): Promise<string> {
  const srtContent = entries
    .map(entry => {
      const start = formatTime(entry.startTime);
      const end = formatTime(entry.endTime);
      return `${entry.index}\n${start} --> ${end}\n${entry.text}\n`;
    })
    .join("\n");

  await writeFile(outputPath, srtContent);
  return outputPath;
}

/**
 * 从分镜脚本生成字幕
 */
export async function generateSubtitlesFromStoryboard(
  shots: Array<{
    shotId: string;
    timeRange: string;
    subtitle: string;
  }>,
  outputPath: string
): Promise<string> {
  const entries: SubtitleEntry[] = shots.map((shot, index) => {
    // timeRange 形如 "0-5s" / "5-10s"，容错解析起止秒
    const split = shot.timeRange.replace(/s$/i, '').split('-')
    const s0 = split[0] !== undefined ? Number(split[0]) : NaN
    const s1 = split[1] !== undefined ? Number(split[1]) : NaN
    const startTime = Number.isFinite(s0) ? s0 : 0
    const endTime = Number.isFinite(s1) ? s1 : startTime + 5
    return {
      index: index + 1,
      startTime,
      endTime,
      text: shot.subtitle,
    };
  });

  return generateSRT(entries, outputPath);
}

/**
 * 格式化时间为 SRT 格式
 */
function formatTime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);

  return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

// ============================================================
// 视频信息获取
// ============================================================

/**
 * 获取视频信息
 */
export async function getVideoInfo(videoPath: string): Promise<VideoInfo> {
  try {
    const result = await execFileAsync('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', videoPath])
    const info = JSON.parse(result.stdout)
    const videoStream = info.streams.find((s: any) => s.codec_type === "video");
    const format = info.format;

    return {
      duration: parseFloat(format.duration),
      resolution: `${videoStream.width}x${videoStream.height}`,
      fileSize: formatSize(parseInt(format.size)),
      bitrate: format.bit_rate,
    };
  } catch {
    return {
      duration: 0,
      resolution: "unknown",
      fileSize: "unknown",
      bitrate: "unknown",
    };
  }
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 检查 FFmpeg 是否可用
 */
async function checkFFmpeg(): Promise<boolean> {
  try {
    await execFileAsync('ffmpeg', ['-version'], { timeout: 10000 })
    return true
  } catch {
    return false
  }
}

/**
 * 验证输入
 */
function validateInputs(config: VideoCompositionConfig): string | null {
  if (!config.inputVideos || config.inputVideos.length === 0) {
    return "至少需要一段输入视频";
  }

  if (!config.outputPath) {
    return "需要指定输出路径";
  }

  return null;
}

/**
 * 清理临时文件
 */
async function cleanup(filePath: string): Promise<void> {
  try {
    await rm(filePath, { force: true })
  } catch {
    // 忽略清理错误
  }
}

/**
 * 格式化文件大小
 */
function formatSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

// ============================================================
// 平台适配输出
// ============================================================

export const PLATFORM_OUTPUT_FORMATS: Record<string, OutputFormat> = {
  douyin: {
    resolution: "1080x1920",
    fps: 30,
    videoBitrate: "8000k",
    audioBitrate: "128k",
  },
  xiaohongshu: {
    resolution: "1080x1440",
    fps: 30,
    videoBitrate: "6000k",
    audioBitrate: "128k",
  },
  bilibili: {
    resolution: "1920x1080",
    fps: 30,
    videoBitrate: "8000k",
    audioBitrate: "192k",
  },
  weibo: {
    resolution: "1080x1080",
    fps: 30,
    videoBitrate: "6000k",
    audioBitrate: "128k",
  },
};

/**
 * 获取平台适配的输出格式
 */
export function getPlatformOutputFormat(platform: string): OutputFormat {
  return PLATFORM_OUTPUT_FORMATS[platform] || DEFAULT_OUTPUT_FORMAT;
}
