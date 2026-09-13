/**
 * dsh-webrelay —— 捕获存档。
 *
 * 每条捕获一个 Markdown 文件：$DSH_HOME/webrelay/captures/<ISO时间>-<site>.md
 * 文件头为 ```webrelay 围栏内的 JSON 元数据（站点/URL/时间/发送的提示词），
 * 之后是回复全文 —— 人可直接阅读，`webrelay_captures` 工具也可机器解析。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { join, basename, extname } from 'node:path'
import { DSH_HOME } from './config.js'

const MAX_PROMPT_CHARS = 4000
const MAX_REPLY_CHARS = 100_000
const MAX_FILES = 500

export interface CaptureMeta {
  file: string
  site: string
  siteName: string
  url: string
  createdAt: number
  prompt: string
}

export interface CaptureEntry extends CaptureMeta {
  reply: string
}

function capturesDir(configured: string | null): string {
  return configured ?? join(DSH_HOME, 'webrelay', 'captures')
}

function safeName(site: string): string {
  return site.replace(/[^a-z0-9_-]/gi, '') || 'web'
}

function headerJson(meta: Omit<CaptureMeta, 'file'>): string {
  return JSON.stringify({
    site: meta.site,
    siteName: meta.siteName,
    url: meta.url,
    createdAt: meta.createdAt,
    prompt: meta.prompt.slice(0, MAX_PROMPT_CHARS),
  })
}

export function saveCapture(
  dir: string | null,
  input: { site: string, siteName: string, url: string, prompt: string, reply: string },
): CaptureEntry {
  const target = capturesDir(dir)
  mkdirSync(target, { recursive: true })
  const now = Date.now()
  const file = `${new Date(now).toISOString().replace(/[:.]/g, '-')}-${safeName(input.site)}.md`
  const meta: Omit<CaptureMeta, 'file'> = {
    site: input.site,
    siteName: input.siteName,
    url: input.url,
    createdAt: now,
    prompt: input.prompt.slice(0, MAX_PROMPT_CHARS),
  }
  const body = [
    '```webrelay',
    headerJson(meta),
    '```',
    '',
    '# 外部 AI 回复',
    '',
    input.reply.slice(0, MAX_REPLY_CHARS),
    '',
  ].join('\n')
  writeFileSync(join(target, file), body, 'utf8')
  pruneOld(target)
  return { file, ...meta, reply: input.reply.slice(0, MAX_REPLY_CHARS) }
}

/** 只允许纯文件名（防路径穿越），且必须位于捕获目录内。 */
export function readCapture(dir: string | null, file: string): CaptureEntry | null {
  const target = capturesDir(dir)
  const name = basename(file)
  if (name !== file || !name.endsWith('.md')) return null
  const path = join(target, name)
  if (!path.startsWith(target) || !existsSync(path)) return null
  const raw = readFileSync(path, 'utf8')
  const m = /^```webrelay\n(.*)\n```\n/.exec(raw)
  let meta: Partial<Omit<CaptureMeta, 'file'>> = {}
  if (m) {
    try { meta = JSON.parse(m[1]) as Partial<Omit<CaptureMeta, 'file'>> } catch { /* 退化处理 */ }
  }
  const reply = m ? raw.slice(m[0].length) : raw
  return {
    file: name,
    site: meta.site ?? 'unknown',
    siteName: meta.siteName ?? meta.site ?? 'unknown',
    url: meta.url ?? '',
    createdAt: typeof meta.createdAt === 'number' ? meta.createdAt : 0,
    prompt: meta.prompt ?? '',
    reply: reply.replace(/^# 外部 AI 回复\n+/, '').trim(),
  }
}

export function listCaptures(dir: string | null, limit: number): CaptureMeta[] {
  const target = capturesDir(dir)
  if (!existsSync(target)) return []
  const files = readdirSync(target)
    .filter((f) => extname(f) === '.md')
    .sort()
    .reverse()
    .slice(0, Math.max(1, Math.min(limit, 200)))
  const out: CaptureMeta[] = []
  for (const file of files) {
    const entry = readCapture(dir, file)
    if (entry) {
      out.push({
        file: entry.file,
        site: entry.site,
        siteName: entry.siteName,
        url: entry.url,
        createdAt: entry.createdAt,
        prompt: entry.prompt.length > 120 ? entry.prompt.slice(0, 120) + '…' : entry.prompt,
      })
    }
  }
  return out
}

function pruneOld(target: string): void {
  try {
    const files = readdirSync(target).filter((f) => extname(f) === '.md').sort()
    while (files.length > MAX_FILES) {
      const oldest = files.shift()
      if (!oldest) break
      try { unlinkSync(join(target, oldest)) } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}
