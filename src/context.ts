/**
 * dsh-webrelay —— 对话流背景整理（host 侧）。
 *
 * 通过 sessionQuery.readSession 读全量事件（与 GreaterClarity 导出同款通道），
 * 提取最近 N 条 user/assistant 文本消息压成转写。比在 client 解析
 * ConversationSnapshot 内部结构更稳：事件形状是会话日志的持久契约。
 * 所有字段防御式访问，事件流异常时返回能拿到的部分。
 */
import type { SessionQueryLike } from './types.js'

const MAX_MESSAGE_CHARS = 2000

export interface TranscriptMessage {
  role: 'user' | 'assistant'
  text: string
}

function textOfBlocks(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ''
  const texts: string[] = []
  for (const b of blocks) {
    if (b !== null && typeof b === 'object' && (b as { type?: unknown }).type === 'text'
      && typeof (b as { text?: unknown }).text === 'string') {
      texts.push((b as { text: string }).text)
    }
  }
  return texts.join('\n').slice(0, MAX_MESSAGE_CHARS).trim()
}

export function buildTranscript(events: unknown[], limit: number): TranscriptMessage[] {
  const messages: TranscriptMessage[] = []
  for (const ev of events) {
    if (ev === null || typeof ev !== 'object') continue
    const e = ev as { type?: unknown, data?: Record<string, unknown> }
    if (e.type === 'user/message') {
      const data = e.data ?? {}
      const source = data.source as { kind?: unknown } | undefined
      if (source && source.kind !== 'user' && source.kind !== 'steering') continue
      const text = textOfBlocks(data.content)
      if (text.length > 0) messages.push({ role: 'user', text })
    } else if (e.type === 'assistant/message') {
      const data = e.data ?? {}
      const message = data.message as { content?: unknown } | undefined
      const text = textOfBlocks(message?.content)
      if (text.length > 0) messages.push({ role: 'assistant', text })
    }
  }
  return messages.slice(-Math.max(1, limit))
}

export function transcriptToContext(messages: TranscriptMessage[]): string {
  return messages
    .map((m) => `${m.role === 'user' ? '用户' : '助手'}：${m.text}`)
    .join('\n\n')
}

/** 从 sessionQuery 拉最近对话流；服务缺失/会话不存在时返回 null（调用方退化为仅草稿）。 */
export async function recentContext(sessionQuery: SessionQueryLike | undefined, sessionId: string, limit: number): Promise<string | null> {
  if (!sessionQuery || typeof sessionQuery.readSession !== 'function') return null
  try {
    const snapshot = await sessionQuery.readSession(sessionId)
    const events = Array.isArray(snapshot?.events) ? snapshot.events : []
    const messages = buildTranscript(events, limit)
    if (messages.length === 0) return null
    return transcriptToContext(messages)
  } catch {
    return null
  }
}
