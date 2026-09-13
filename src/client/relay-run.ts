/**
 * dsh-webrelay —— iframe DOM 适配执行器。
 *
 * 面板 iframe 经 relay 同源加载，父页可直接访问 contentDocument。
 * 全部选择器来自站点配置（候选链，按序取第一个命中者），站点改版改配置即可。
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

function queryOne(doc: Document, selectors: string[], visibleOnly = true): Element | null {
  for (const sel of selectors) {
    let els: NodeListOf<Element>
    try {
      els = doc.querySelectorAll(sel)
    } catch {
      continue // 用户配置了非法选择器：跳过该候选
    }
    for (const el of els) {
      if (!visibleOnly || isVisible(el)) return el
    }
  }
  return null
}

function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false
  const style = (frameWindow() as Window & { getComputedStyle?: (el: Element) => CSSStyleDeclaration }).getComputedStyle?.(el)
  return style ? style.visibility !== 'hidden' && style.display !== 'none' : true
}

function nativeSetText(el: HTMLTextAreaElement, text: string): void {
  // 父 window 的原生 value setter 可跨 realm 作用于 iframe 内元素；
  // input 事件冒泡到站点框架（监听器在 iframe 文档内）触发其 onChange。
  const desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
  if (desc?.set) desc.set.call(el, text)
  else el.value = text
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function contentEditableSet(win: Window, el: Element, text: string): void {
  el.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
  ;(el as HTMLElement).focus?.()
  const doc = el.ownerDocument
  const sel = win.getSelection()
  const range = doc.createRange()
  range.selectNodeContents(el)
  sel?.removeAllRanges()
  sel?.addRange(range)
  // execCommand 走浏览器原生编辑管线，对 Lexical/ProseMirror 类编辑器最兼容。
  let ok = false
  try { ok = doc.execCommand('insertText', false, text) } catch { ok = false }
  if (!ok) {
    ;(el as HTMLElement).textContent = text
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }))
  }
}

function pressEnter(win: Window, el: Element): void {
  const init: KeyboardEventInit = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }
  el.dispatchEvent(new KeyboardEvent('keydown', init))
  el.dispatchEvent(new KeyboardEvent('keyup', init))
  void win
}

function clickSend(doc: Document, site: SiteInfo): boolean {
  const btn = queryOne(doc, site.adapter.send)
  if (!btn) return false
  ;(btn as HTMLElement).click()
  return true
}

function replyCount(doc: Document, site: SiteInfo): number {
  let count = 0
  for (const sel of site.adapter.replies) {
    try {
      count = doc.querySelectorAll(sel).length
      if (count > 0) break
    } catch { /* invalid selector */ }
  }
  return count
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
  return queryOne(doc, site.adapter.generating) !== null
}

export interface RelayRunResult {
  reply: string
  url: string
}

/**
 * 执行一次中继发送：填入 → 发送 → 等待生成结束 → 抓取最后回复。
 * onStatus 每步回报；abort 为真时立即停止。
 */
export async function relaySend(site: SiteInfo, message: string, onStatus: (status: string) => void, abort: () => boolean): Promise<RelayRunResult> {
  const win = frameWindow()
  const doc = frameEl?.contentDocument ?? null
  if (!win || !doc) throw new Error('浏览器面板尚未加载出目标网页')

  onStatus('寻找输入框…')
  const input = queryOne(doc, site.adapter.input)
  if (!input) throw new Error('未找到对话框输入框（可在 sites.yml 修正该站点的 adapter.input 选择器）')

  onStatus('填入内容…')
  if (input.tagName === 'TEXTAREA') {
    nativeSetText(input as HTMLTextAreaElement, message)
  } else if (site.adapter.inputContentEditable || (input as HTMLElement).isContentEditable) {
    contentEditableSet(win, input, message)
  } else {
    nativeSetText(input as HTMLTextAreaElement, message)
  }
  await sleep(400)

  onStatus('发送…')
  const mode = site.adapter.sendMode
  if (mode === 'click') {
    if (!clickSend(doc, site)) throw new Error('未找到发送按钮（可修正 adapter.send 或把 sendMode 改为 enter）')
  } else {
    pressEnter(win, input)
    if (mode === 'enter-then-click') {
      await sleep(600)
      clickSend(doc, site) // Enter 无效时兜底点一次；按钮不存在则忽略
    }
  }

  const before = replyCount(doc, site)
  onStatus('等待生成完成…')
  const deadline = Date.now() + 180_000
  let stable = 0
  let lastText = ''
  while (Date.now() < deadline) {
    if (abort()) throw new Error('已取消')
    await sleep(500)
    const busy = generating(doc, site)
    const text = lastReplyText(doc, site)
    if (!busy && text.length > 0) {
      if (text === lastText) stable++
      else stable = 0
      lastText = text
      if (stable >= 3 && (replyCount(doc, site) > before || before === 0)) break
    } else {
      stable = 0
    }
  }
  if (lastText.length === 0) {
    throw new Error('等待超时且未抓取到回复：站点可能已改版（可修正 adapter.replies / adapter.generating），或发送未成功')
  }
  onStatus('抓取完成')
  return { reply: lastText, url: currentTarget()?.href ?? '' }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
