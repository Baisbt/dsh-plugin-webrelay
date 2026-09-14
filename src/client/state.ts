/**
 * dsh-webrelay —— Client 状态与宿主 API 封装。
 * 轻量 store（useSyncExternalStore）+ /dsh-webrelay/api/* 的 fetch 封装。
 */
import { useSyncExternalStore } from 'react'

export interface SiteInfo {
  id: string
  name: string
  home: string
  match: string[]
  experimental: boolean
  hidden: boolean
  /** 联动模式绑定的浏览器实例 id（null = 默认实例）。 */
  browser: string | null
  openIn: 'relay' | 'system' | 'cdp'
  source: 'factory' | 'custom'
  adapter: {
    input: string[]
    inputContentEditable: boolean
    send: string[]
    sendMode: 'enter' | 'click' | 'enter-then-click'
    replies: string[]
    generating: string[]
  }
}

export interface CaptureMeta {
  file: string
  site: string
  siteName: string
  url: string
  createdAt: number
  prompt: string
}

/**
 * 弹窗状态机（选项二六阶段闭环）：
 *   compress       S1 上下文压缩（流式，内部步骤，短时展示）
 *   optimize       S2 第一次优化（初稿，待外发）→ 可编辑 → 发送
 *   relay-wait     S3/S4 发送中 / 等待回复中（带倒计时，可取消）
 *   relay-preview  S5 第二次优化（终稿）→ 可编辑 → 插入输入框
 * 另：sites 管理、extract 历史单轮整理、capture 存档读取。
 *
 * `attachHint` 是优化器在正文之外追加的一行「附件提示」：当这条提示词可能
 * 需要用户提供文件（日志、截图、数据表…）时提醒一句。插件**只提示、不采集**——
 * 用户自行用目标页面自带的上传按钮完成上传。
 */
export type ModalState =
  | { kind: 'sites' }
  | { kind: 'optimize', phase: 'streaming' | 'ready', text: string, draft: string, gen: number, attachHint?: string, error?: string }
  | { kind: 'extract', phase: 'streaming' | 'ready', text: string, raw: string, site: string, siteName: string, url: string, intent: string, gen: number, error?: string }
  | {
    kind: 'relay-preview', phase: 'streaming' | 'ready', text: string,
    draft: string, context: string, externalReply: string, prefix: string, gen: number, attachHint?: string, error?: string,
  }
  | {
    kind: 'relay-wait', status: string,
    /** 剩余秒数（client 每秒递减；0 = 不显示倒计时）。 */
    remain?: number,
    /** true = 超时后进入"可续等"态（展示续等/采用按钮）。 */
    timedOut?: boolean,
    /** 超时但已抓到的部分回复。 */
    partial?: string,
  }
  | { kind: 'capture', reply: string, url: string, site: string, siteName: string, prompt: string, savedFile?: string }

export interface WebrelayState {
  open: boolean
  panelWidth: number
  rid: string
  sites: SiteInfo[]
  activeSiteId: string | null
  recognizedSiteId: string | null
  historyOpen: boolean
  captures: CaptureMeta[]
  modal: ModalState | null
  /** 轻量提示（自动消失）。 */
  notice: string | null
  /** 联动浏览器实例表（含默认实例，来自 /api/sites）。 */
  browsers: BrowserInfo[]
}

/** 插入 DSH 输入框的动作句柄（会话槽标准件 inputActions，打开弹窗时捕获）。 */
export type SetDraft = (text: string) => void

let currentSetDraft: SetDraft | undefined
export function captureSetDraft(fn: SetDraft | undefined): void {
  if (fn) currentSetDraft = fn
}
export function getSetDraft(): SetDraft | undefined {
  return currentSetDraft
}

function newRid(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

let state: WebrelayState = {
  open: false,
  panelWidth: 560,
  rid: newRid(),
  sites: [],
  activeSiteId: null,
  recognizedSiteId: null,
  historyOpen: false,
  captures: [],
  modal: null,
  notice: null,
  browsers: [],
}

const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getState(): WebrelayState {
  return state
}

export function setState(patch: Partial<WebrelayState>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

export function patchModal(patch: Partial<Extract<ModalState, { kind: 'optimize' | 'extract' | 'relay-preview' | 'relay-wait' }>> | Partial<Extract<ModalState, { kind: 'capture' }>>): void {
  if (!state.modal) return
  setState({ modal: { ...state.modal, ...patch } as ModalState })
}

export function useStore(): WebrelayState {
  return useSyncExternalStore(subscribe, getState, getState)
}

// ── 宿主 API 封装（全部同源 /dsh-webrelay/api/*） ──

/** 站点管理操作（写回用户 sites.yml），成功后调用 refreshSitesIntoState 同步。 */
export async function apiManage(action: string, payload: Record<string, unknown> = {}): Promise<{ ok: boolean, error?: string }> {
  try {
    const res = await fetch('/dsh-webrelay/api/sites/manage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    })
    return await res.json() as { ok: boolean, error?: string }
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message ?? err) }
  }
}

/** 重新拉取站点列表并写入 store（管理操作后调用）。 */
export async function refreshSitesIntoState(): Promise<{ ok: boolean, error?: string }> {
  try {
    const sites = await fetchSites()
    setState({ sites, activeSiteId: getState().activeSiteId ?? sites.find((x) => !x.hidden)?.id ?? null })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message ?? err) }
  }
}

/** CDP 专用联动浏览器 API。 */
export interface BrowserInfo {
  id: string
  label: string
  type: 'chrome' | 'edge' | 'custom'
  port: number
}

export interface CdpInstanceStatus {
  id: string
  label: string
  type: string
  port: number
  running: boolean
  targets: Array<{ id: string, title: string, url: string }>
}

export interface CdpStatus {
  ok: boolean
  profileRoot: string
  headless: boolean
  instances: CdpInstanceStatus[]
}

export async function apiCdpStatus(): Promise<CdpStatus | null> {
  try {
    const res = await fetch('/dsh-webrelay/api/cdp/status')
    return await res.json() as CdpStatus
  } catch {
    return null
  }
}

export async function apiCdpLaunch(siteId: string): Promise<{ ok: boolean, error?: string }> {
  try {
    const res = await fetch('/dsh-webrelay/api/cdp/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId }),
    })
    return await res.json() as { ok: boolean, error?: string }
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message ?? err) }
  }
}

export async function apiCdpOpen(siteId: string): Promise<{ ok: boolean, error?: string }> {
  try {
    const res = await fetch('/dsh-webrelay/api/cdp/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId }),
    })
    return await res.json() as { ok: boolean, error?: string }
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message ?? err) }
  }
}

/** CDP 捕捉：读取联动标签页当前正文（不发送、不注入）。 */
export async function apiCdpCapture(siteId: string): Promise<{ ok: boolean, raw?: string, url?: string, error?: string }> {
  try {
    const res = await fetch('/dsh-webrelay/api/cdp/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId }),
    })
    return await res.json() as { ok: boolean, raw?: string, url?: string, error?: string }
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message ?? err) }
  }
}

/** 关闭站点的联动标签页。 */
export async function apiCdpClose(siteId: string): Promise<{ ok: boolean, error?: string }> {
  try {
    const res = await fetch('/dsh-webrelay/api/cdp/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId }),
    })
    return await res.json() as { ok: boolean, error?: string }
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message ?? err) }
  }
}

export async function fetchSites(): Promise<SiteInfo[]> {
  const res = await fetch('/dsh-webrelay/api/sites')
  const body = await res.json() as { ok: boolean, sites?: SiteInfo[], browsers?: BrowserInfo[] }
  if (!body.ok || !Array.isArray(body.sites)) return []
  if (Array.isArray(body.browsers)) setState({ browsers: body.browsers })
  return body.sites
}

/**
 * 优化请求：text/plain chunked 流，onDelta 逐段回调，返回聚合全文。
 * phase='outbound' 为选项二第一次优化，'final' 为第二次（须带 externalReply）。
 */
export async function apiOptimize(
  payload: { draft: string, context?: string, externalReply?: string, phase?: 'single' | 'outbound' | 'final' },
  onDelta: (delta: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch('/dsh-webrelay/api/optimize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  })
  if (!res.ok || !res.body) {
    let message = `HTTP ${res.status}`
    try {
      const err = await res.json() as { error?: string }
      if (err.error) message = err.error
    } catch { /* ignore */ }
    throw new Error(message)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let full = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    const delta = decoder.decode(value, { stream: true })
    if (delta.length > 0) {
      full += delta
      onDelta(delta)
    }
  }
  return full.trim()
}

/**
 * 上下文压缩请求（选项二 S1）：流式。返回压缩后的背景，null 表示无可用历史。
 * 末尾可能附带 `[dsh-webrelay:fallback] …`（降级/无历史提示），在此剥离。
 */
export async function apiCompress(
  payload: { sessionId?: string, transcript?: string, draft?: string, limit?: number },
  onDelta?: (delta: string) => void,
  signal?: AbortSignal,
): Promise<{ context: string | null, note?: string }> {
  const res = await fetch('/dsh-webrelay/api/compress', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  })
  if (!res.ok || !res.body) {
    let message = `HTTP ${res.status}`
    try {
      const err = await res.json() as { error?: string }
      if (err.error) message = err.error
    } catch { /* ignore */ }
    throw new Error(message)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let full = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    const delta = decoder.decode(value, { stream: true })
    if (delta.length > 0) {
      const before = visibleText(full).length
      full += delta
      const after = visibleText(full)
      if (onDelta && after.length > before) onDelta(after.slice(before))
    }
  }
  const { visible, reason } = splitFallback(full)
  const context = visible.trim()
  return { context: context.length > 0 ? context : null, note: reason }
}

/** 外发结果（选项二 S3+S4）。timedOut=true 表示超时（reply 可能已有部分内容）。 */
export interface RelaySendResult {
  ok: boolean
  reply: string
  url?: string
  timedOut?: boolean
  error?: string
}

/** CDP 联动模式外发：填入 → 提交 → 等待回复（仅用户点击后调用）。 */
export async function apiCdpSend(siteId: string, message: string, timeoutMs: number): Promise<RelaySendResult> {
  try {
    const res = await fetch('/dsh-webrelay/api/cdp/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId, message, timeoutMs }),
    })
    const body = await res.json() as RelaySendResult
    return body
  } catch (err) {
    return { ok: false, reply: '', error: String((err as Error)?.message ?? err) }
  }
}

/**
 * 抓取内容二次提取请求：text/plain chunked 流，onDelta 逐段回调。
 * 末尾可能附带 `[dsh-webrelay:fallback] …` 注释行（host 降级提示），在此剥离并回报。
 */
export async function apiExtract(
  payload: { raw: string, siteName?: string, url?: string },
  onDelta: (delta: string) => void,
  signal?: AbortSignal,
): Promise<{ text: string, fallbackReason?: string }> {
  const res = await fetch('/dsh-webrelay/api/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  })
  if (!res.ok || !res.body) {
    let message = `HTTP ${res.status}`
    try {
      const err = await res.json() as { error?: string }
      if (err.error) message = err.error
    } catch { /* ignore */ }
    throw new Error(message)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let full = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    const delta = decoder.decode(value, { stream: true })
    if (delta.length > 0) {
      // 降级标记可能跨 chunk 到达：先累积，再只把标记之前的正文增量交给 onDelta。
      const before = visibleText(full).length
      full += delta
      const after = visibleText(full)
      if (after.length > before) onDelta(after.slice(before))
    }
  }
  const { visible, reason } = splitFallback(full)
  return { text: visible.trim(), fallbackReason: reason }
}

const FALLBACK_MARK = '[dsh-webrelay:fallback]'

/** 标记之前的部分（即正文）。 */
function visibleText(text: string): string {
  const idx = text.indexOf(FALLBACK_MARK)
  return idx < 0 ? text : text.slice(0, idx)
}

function splitFallback(text: string): { visible: string, reason?: string } {
  const idx = text.indexOf(FALLBACK_MARK)
  if (idx < 0) return { visible: text }
  return { visible: text.slice(0, idx).trim(), reason: text.slice(idx + FALLBACK_MARK.length).trim() || undefined }
}

export async function apiContext(sessionId: string): Promise<string | null> {
  try {
    const res = await fetch('/dsh-webrelay/api/context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
    const body = await res.json() as { ok: boolean, context?: string | null }
    return body.ok ? (body.context ?? null) : null
  } catch {
    return null
  }
}

export async function apiSaveCapture(payload: { site: string, siteName: string, url: string, prompt: string, reply: string }): Promise<string | undefined> {
  try {
    const res = await fetch('/dsh-webrelay/api/captures', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = await res.json() as { ok: boolean, capture?: { file: string } }
    return body.ok ? body.capture?.file : undefined
  } catch {
    return undefined
  }
}

export async function apiListCaptures(): Promise<CaptureMeta[]> {
  try {
    const res = await fetch('/dsh-webrelay/api/captures')
    const body = await res.json() as { ok: boolean, captures?: CaptureMeta[] }
    return body.ok && Array.isArray(body.captures) ? body.captures : []
  } catch {
    return []
  }
}

export interface CaptureEntry extends CaptureMeta {
  reply: string
}

export async function apiReadCapture(file: string): Promise<CaptureEntry | null> {
  try {
    const res = await fetch(`/dsh-webrelay/api/captures/read?file=${encodeURIComponent(file)}`)
    const body = await res.json() as { ok: boolean, capture?: CaptureEntry }
    return body.ok && body.capture ? body.capture : null
  } catch {
    return null
  }
}

/** 显示一条轻量提示（3.5s 自动消失）。 */
export function notify(text: string): void {
  setState({ notice: text })
  setTimeout(() => {
    if (getState().notice === text) setState({ notice: null })
  }, 3500)
}
