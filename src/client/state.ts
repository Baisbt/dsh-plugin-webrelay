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

/** 弹窗状态机：优化 → 中继预览 → 中继等待 → 捕获结果。 */
export type ModalState =
  | { kind: 'sites' }
  | { kind: 'optimize', phase: 'streaming' | 'ready', text: string, draft: string, gen: number, error?: string }
  | { kind: 'relay-preview', phase: 'streaming' | 'ready', text: string, draft: string, context: string, prefix: string, gen: number, error?: string }
  | { kind: 'relay-wait', status: string }
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

export function patchModal(patch: Partial<Extract<ModalState, { kind: 'optimize' | 'relay-preview' }>> | Partial<Extract<ModalState, { kind: 'capture' }>>): void {
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

/** CDP 中继发送：在联动标签页内注入适配器并等待抓取回复（耗时可达分钟级）。 */
export async function apiCdpRelay(siteId: string, message: string): Promise<{ ok: boolean, reply?: string, url?: string, error?: string }> {
  try {
    const res = await fetch('/dsh-webrelay/api/cdp/relay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId, message }),
    })
    return await res.json() as { ok: boolean, reply?: string, url?: string, error?: string }
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

/** 优化请求：text/plain chunked 流，onDelta 逐段回调，返回聚合全文。 */
export async function apiOptimize(payload: { draft: string, context?: string }, onDelta: (delta: string) => void, signal?: AbortSignal): Promise<string> {
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
