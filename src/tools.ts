/**
 * dsh-webrelay —— 智能体工具 webrelay_captures。
 *
 * 让 DSH 会话中的智能体可以列出 / 读取本插件抓取的外部 AI 回复存档，
 * 从而直接引用现成答案、减少重复推理。工具定义为 hand-built ToolDefinition
 * （不 import @deepseek-ai/dsh-tools，保持零 @deepseek-ai 依赖），
 * args 做防御式解析（hand-built 定义没有 defineTool 的自动校验包装）。
 */
import { listCaptures, readCapture } from './captures.js'
import type { CaptureConfig } from './config.js'

export interface ToolsLike {
  register(definition: {
    name: string
    description: string
    parameters: Record<string, unknown>
    output: {
      schema: Record<string, unknown>
      render(args: unknown, value: unknown): Array<{ type: string, text: string }>
    }
    execute(args: unknown): Promise<unknown>
  }): unknown
}

interface ContextLike {
  /** cordis ctx.get：未注入服务返回 undefined 而非抛错（与 GreaterClarity 的 sessionQuery 同款）。 */
  get(service: string): unknown
}

export function registerCapturesTool(ctx: ContextLike, capture: () => CaptureConfig): void {
  const tools = ctx.get('tools') as ToolsLike | undefined
  if (!tools || typeof tools.register !== 'function') return
  tools.register({
    name: 'webrelay_captures',
    description: [
      '检索 dsh-webrelay 插件从外部 AI 网页（DeepSeek/ChatGPT/豆包/千问/Gemini）抓取并保存的回复存档。',
      'action="list" 返回最近若干条的元信息（时间/站点/提示词摘要）；',
      'action="read" 用 id（list 返回的 file 名）读取一条的完整回复文本。',
      '当用户提到"浏览器里问过的/外部AI回答过的内容"时，先用 list 找相关条目再 read。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'list 或 read', enum: ['list', 'read'] },
        id: { type: 'string', description: 'action=read 时的存档文件名（来自 list）' },
      },
      required: ['action'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute(args) {
      const parsed = (args ?? {}) as { action?: unknown, id?: unknown }
      const action = parsed.action === 'read' ? 'read' : 'list'
      const config = capture()
      if (action === 'list') {
        const items = listCaptures(config.dir, config.recentLimit)
        if (items.length === 0) return '暂无捕获存档。'
        return items
          .map((c) => `${c.file} | ${new Date(c.createdAt).toLocaleString()} | ${c.siteName} | ${c.prompt.replace(/\n+/g, ' ')}`)
          .join('\n')
      }
      const id = typeof parsed.id === 'string' ? parsed.id : ''
      if (id.length === 0) return 'action=read 需要 id 参数（list 返回的文件名）。'
      const entry = readCapture(config.dir, id)
      if (!entry) return `未找到存档：${id}`
      return [
        `站点：${entry.siteName}（${entry.url}）`,
        `时间：${new Date(entry.createdAt).toLocaleString()}`,
        `发送的提示词：${entry.prompt}`,
        '',
        entry.reply,
      ].join('\n')
    },
  })
}
