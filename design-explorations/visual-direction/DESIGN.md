# MAPro 视觉方向 C · Intelligent Flow

## 设计哲学

MAPro 是一个面向营销工作流的 AI Agent 桌面应用。Direction C 的视觉核心是 **「温暖的智能在流动」**：

- **温暖**：用琥珀（amber）作为主 accent，替代冰冷的蓝/紫，让 AI 工具不那么机械。
- **智能**：通过 subtle 的光晕、聚焦环、选中态表达系统的响应与思考。
- **流动**：Agent 消息流旁的「脉冲线」是 MAPro 的视觉签名，暗示 Agent 正在连续地读取、推理、执行。

整体气质：**精确但不冷酷，聪明但不压迫，专业但有温度**。

## 色彩系统

### 默认浅色（Light）

| Token | 值 | 用途 |
|-------|-----|------|
| `--background` | `#f8f7f5` | 应用背景、侧边栏 |
| `--foreground` | `#1c1917` | 主文字 |
| `--muted` | `#f5f4f2` | 次要背景、hover 背景 |
| `--muted-foreground` | `#78716c` | 次要文字、描述 |
| `--card` | `#ffffff` | 卡片、弹窗背景 |
| `--border` | `#e7e5e4` | 边框、分隔线 |
| `--primary` | `#d97706` | 主按钮、选中态、聚焦环、脉冲线 |
| `--primary-foreground` | `#ffffff` | 主色上的文字 |
| `--accent` | 极淡琥珀 | 强调背景、Agent 消息底色 |
| `--destructive` | `#dc2626` | 危险操作 |

### 默认深色（Dark）

| Token | 值 | 用途 |
|-------|-----|------|
| `--background` | `#0f1115` | 应用背景 |
| `--foreground` | `#f5f5f4` | 主文字 |
| `--muted` | `#1c1c1e` | 次要背景 |
| `--muted-foreground` | `#a8a29e` | 次要文字 |
| `--card` | `#18181b` | 卡片背景 |
| `--border` | `#252830` | 边框 |
| `--primary` | `#d97706` | 琥珀 accent |
| `--accent` | 深琥珀 | Agent 消息底色、强调表面 |

## 语义 Token

| Token | 用途 |
|-------|------|
| `--selection-bg` | 选中项背景（会话、工作区、Tab） |
| `--selection-fg` | 选中项文字色 |
| `--selection-badge` | 选中项内 badge 文字 |
| `--pulse-line` | Agent 脉冲线主色 |
| `--pulse-glow` | Agent 脉冲线发光色 |
| `--dashed-border` | 新会话按钮、搜索按钮的虚线边框 |
| `--code-bg` | 代码块背景 |

> 规则：所有主题（包括 6 套特殊主题）都必须提供以上语义 token。组件样式统一读取语义 token，不再按主题硬编码。

## 签名元素：脉冲线

脉冲线用于 Agent 会话的消息列表，表达「Agent 正在思考/执行」。

- **位置**：ConversationContent 左侧，与 assistant 头像对齐。
- **样式**：2px 宽垂直渐变线，琥珀色，带微弱呼吸动画。
- **类名**：`.agent-pulse-line`
- **状态**：
  - 默认：慢速呼吸（3s 周期）
  - `.is-streaming`：快速脉冲（1.2s 周期）

实现位置：
- CSS: `apps/electron/src/renderer/styles/globals.css`
- 组件: `apps/electron/src/renderer/components/agent/AgentMessages.tsx`

## 组件样式规则

### 选中态

会话、工作区、Tab 的选中项统一使用 `.session-item-selected` / `.workspace-item-selected` / `.tab-item-selected` 类名，由全局 CSS 统一设置：

```css
.session-item-selected,
.workspace-item-selected,
.tab-item-selected {
  background: hsl(var(--selection-bg)) !important;
  color: hsl(var(--selection-fg)) !important;
}
```

组件内部可以继续加 `bg-primary/10` 等 Tailwind 类作为 fallback，但会被语义 token 覆盖。

### 模式切换器

ModeSwitcher 的滑块使用 `.mode-slider` 类名，由全局 CSS 设置为 `--primary` 背景色。选中文字使用 `--primary-foreground`。

### 设置卡片

默认深色模式下设置卡片使用透明背景 + 细边框，其他模式使用卡片背景。通过 `.settings-card` 统一控制。

## 特殊主题兼容

6 套特殊主题保留，但统一遵循新的语义 token 结构。每套主题只需定义：
1. 基础 token（background/foreground/primary/accent 等）
2. 语义 token（selection-bg/selection-fg/pulse-line 等）

不再为每个主题写大量 `.theme-xxx .component` 覆盖。

## 使用原则

1. **不要硬编码颜色**：优先使用 CSS 变量。
2. **accent 要克制**：琥珀色只用于主按钮、选中态、脉冲线、关键 badge。不要大面积背景。
3. **保持深色模式不发灰**：深色背景 `#0f1115` 略带蓝灰，避免纯黑或纯 zinc-900 的沉闷感。
4. **浅色模式不冷白**：背景 `#f8f7f5` 是暖米白，减少刺眼感。
5. **图标使用线条风格**：继续使用 Lucide 线条图标，不用 emoji 或填充图标作装饰。

## 文件位置

- 设计 token：`apps/electron/src/renderer/styles/globals.css`
- 脉冲线组件：`apps/electron/src/renderer/components/agent/AgentMessages.tsx`
- 方向提案：`design-explorations/visual-direction/`
