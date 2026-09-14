/**
 * dsh-webrelay —— iframe 页面读写器。
 *
 * 面板 iframe 经 relay 同源加载，父页可直接访问 contentDocument。
 *   - 读：captureFromFrame（抓当前页正文）——只读，随时可用。
 *   - 写：sendToFrame（填入 → 提交 → 等待生成结束 → 取回回复）——**仅在用户
 *     点击闪电按钮后**调用，用于选项二 S3/S4 的外发闭环。
 * 全部选择器来自站点配置，站点改版改配置即可。
 */
import type { SiteInfo } from './state.js'

let frameEl: HTMLIFrameElement | null = null

export function registerFrame(el: HTMLIFrameElement | null): void {
  frameEl = el
}

function frameWindow(): Window | null {
  try {
    const win = frameEl?.contentWindow
    return win && win.location.href.length > 0 ? win : null
  } catch {
    return null
  }
}

/** iframe 当前代理 URL 解析出的真实 target；未加载/跨源时返回 null。 */
export function currentTarget(): URL | null {
  const win = frameWindow()
  if (!win) return null
  try {
    const href = win.location.href
    const u = new URL(href)
    const m = /^\/dsh-webrelay\/proxy\/([0-9a-f]+)\/(.*)$/.exec(u.pathname)
    if (!m) return null
    return new URL(decodeURI(m[2]))
  } catch {
    return null
  }
}

/** 按 match 白名单识别 iframe 当前站点。 */
export function recognizeSite(sites: SiteInfo[]): SiteInfo | null {
  const target = currentTarget()
  if (!target) return null
  const host = target.hostname.toLowerCase()
  const hit = sites.find((s) => s.match.some((m) => host === m || host.endsWith('.' + m)))
  return hit ?? null
}

/**
 * 捕捉 iframe 当前页面的正文文本（选项二第一步，relay 模式）。
 *
 * 抓取策略：优先用站点配置的 replies 选择器（拿到的是「干净」的对话/正文节点）；
 * 未命中则退化为 body.innerText（噪声多，交给后续 LLM 整理阶段清洗）。
 * 全程只读，不注入、不发送。
 */
export function captureFromFrame(site: SiteInfo): { ok: boolean, raw?: string, url?: string, error?: string } {
  const win = frameWindow()
  const doc = frameEl?.contentDocument ?? null
  if (!win || !doc) return { ok: false, error: '浏览器面板尚未加载出目标网页' }

  const url = currentTarget()?.href ?? ''
  // 1) 首选：站点配置的回复/正文节点选择器（多节点用分隔线拼接，保留对话顺序）。
  const parts: string[] = []
  for (const sel of site.adapter.replies) {
    let els: NodeListOf<Element>
    try { els = doc.querySelectorAll(sel) } catch { continue }
    if (els.length === 0) continue
    for (const el of els) {
      const text = (el as HTMLElement).innerText?.trim() ?? ''
      if (text.length > 0) parts.push(text)
    }
    break // 命中第一个可用选择器即可
  }
  if (parts.length > 0) {
    return { ok: true, raw: parts.join('\n\n---\n\n'), url }
  }
  // 2) 兜底：整页 innerText（噪声多，但至少不丢内容）。
  const body = (doc.body as HTMLElement | null)?.innerText?.trim() ?? ''
  if (body.length === 0) return { ok: false, error: '页面正文为空（站点可能仍在加载或已改版）' }
  return { ok: true, raw: body, url }
}

export interface SendOutcome {
  ok: boolean
  /** 抓到的回复正文（超时但抓到部分内容时也带上）。 */
  reply: string
  url?: string
  /** true = 等待超时（可能已抓到部分内容，由调用方决定续等还是采用）。 */
  timedOut?: boolean
  error?: string
}

/**
 * 向 iframe 内的外部站点发送一条消息，并等待其回复完成（选项二 S3+S4）。
 *
 * 只在**已存在**的页面上操作（续接当前对话，不导航、不新建会话）。
 * **本函数会代用户提交内容**，仅应在用户点击闪电按钮后调用。
 */
export async function sendToFrame(site: SiteInfo, message: string, timeoutMs: number): Promise<SendOutcome> {
  const win = frameWindow()
  const doc = frameEl?.contentDocument ?? null
  if (!win || !doc) return { ok: false, reply: '', error: '浏览器面板尚未加载出目标网页' }
  const url = currentTarget()?.href ?? ''
  if (message.trim().length === 0) return { ok: false, reply: '', url, error: '待发送内容为空' }

  const input = queryOne(doc, site.adapter.input)
  if (!input) {
    return { ok: false, reply: '', url, error: '未找到对话框输入框（可在 sites.yml 修正该站点的 adapter.input 选择器）' }
  }

  const baseline = lastReplyText(doc, site)
  const before = replyCount(doc, site)

  if (isTextareaLike(input)) {
    fillTextarea(input as HTMLTextAreaElement, message)
  } else if (site.adapter.inputContentEditable || (input as HTMLElement).isContentEditable) {
    fillEditable(input, message, win)
  } else {
    fillTextarea(input as HTMLTextAreaElement, message)
  }
  await sleep(400)

  const mode = site.adapter.sendMode
  if (mode === 'click') {
    if (!clickSend(doc, site)) {
      return { ok: false, reply: '', url, error: '未找到发送按钮（可修正 adapter.send 或把 sendMode 改为 enter）' }
    }
  } else {
    pressEnter(input)
    if (mode === 'enter-then-click') {
      await sleep(600)
      clickSend(doc, site)
    }
  }

  const deadline = Date.now() + timeoutMs
  let sawGenerating = false
  let stable = 0
  let lastText = ''
  while (Date.now() < deadline) {
    await sleep(500)
    if (generating(doc, site)) {
      sawGenerating = true
      stable = 0
      continue
    }
    const text = lastReplyText(doc, site)
    // 完成判据：内容非空、与发送前基线不同、连续三次稳定（生成已收尾）。
    if (text.length > 0 && text !== baseline) {
      if (text === lastText) stable++
      else { stable = 1; lastText = text }
      if (stable >= 3 && (sawGenerating || replyCount(doc, site) > before)) {
        return { ok: true, reply: text, url, timedOut: false }
      }
    } else {
      stable = 0
    }
  }
  const partial = lastReplyText(doc, site)
  const gotNew = partial.length > 0 && partial !== baseline
  return {
    ok: false,
    reply: gotNew ? partial : '',
    url,
    timedOut: true,
    error: gotNew
      ? '等待外部回复超时（已抓到部分内容，可继续等待或直接采用）'
      : '等待外部回复超时：站点可能已改版（修正 adapter.replies / adapter.generating），或发送未成功',
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false
  const style = globalThis.getComputedStyle(el)
  return style.visibility !== 'hidden' && style.display !== 'none'
}

function queryOne(doc: Document, selectors: string[]): Element | null {
  for (const sel of selectors) {
    let els: NodeListOf<Element>
    try { els = doc.querySelectorAll(sel) } catch { continue }
    for (const el of els) if (isVisible(el)) return el
  }
  return null
}

function isTextareaLike(el: Element): boolean {
  return el.tagName === 'TEXTAREA' || el.tagName === 'INPUT'
}

function fillTextarea(el: HTMLTextAreaElement | HTMLInputElement, text: string): void {
  // React 受控组件必须走原型 setter，否则 value 变更被其内部状态覆盖。
  const proto = el.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
  const desc = Object.getOwnPropertyDescriptor(proto, 'value')
  if (desc?.set) desc.set.call(el, text)
  else el.value = text
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function fillEditable(el: Element, text: string, win: Window): void {
  // 事件构造器须用 iframe 自身的 realm，否则某些站点（React 受控）不认。
  const realm = win as unknown as {
    FocusEvent: new (type: string, init?: FocusEventInit) => FocusEvent
    InputEvent: new (type: string, init?: InputEventInit) => InputEvent
  }
  el.dispatchEvent(new realm.FocusEvent('focus', { bubbles: true }))
  ;(el as HTMLElement).focus()
  const sel = win.getSelection()
  if (!sel) return
  const range = win.document.createRange()
  range.selectNodeContents(el)
  sel.removeAllRanges()
  sel.addRange(range)
  let ok = false
  try { ok = win.document.execCommand('insertText', false, text) } catch { ok = false }
  if (!ok) {
    el.textContent = text
    el.dispatchEvent(new realm.InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }))
  }
}

function pressEnter(el: Element): void {
  const init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }
  el.dispatchEvent(new KeyboardEvent('keydown', init))
  el.dispatchEvent(new KeyboardEvent('keyup', init))
}

function clickSend(doc: Document, site: SiteInfo): boolean {
  const btn = queryOne(doc, site.adapter.send)
  if (!btn) return false
  ;(btn as HTMLElement).click()
  return true
}

function replyCount(doc: Document, site: SiteInfo): number {
  for (const sel of site.adapter.replies) {
    try {
      const n = doc.querySelectorAll(sel).length
      if (n > 0) return n
    } catch { /* 选择器无效，试下一个 */ }
  }
  return 0
}

function lastReplyText(doc: Document, site: SiteInfo): string {
  for (const sel of site.adapter.replies) {
    let els: NodeListOf<Element>
    try { els = doc.querySelectorAll(sel) } catch { continue }
    for (let i = els.length - 1; i >= 0; i--) {
      const text = (els[i] as HTMLElement).innerText?.trim() ?? ''
      if (text.length > 0) return text
    }
  }
  return ''
}

function generating(doc: Document, site: SiteInfo): boolean {
  return site.adapter.generating.length > 0 && queryOne(doc, site.adapter.generating) !== null
}
