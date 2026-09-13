/**
 * dsh-webrelay —— 业务流程编排（选项一 / 选项二 / 捕获落库）。
 * 组件只负责渲染，动作全部收口在这里，便于撤回/重新生成等状态迁移的一致性。
 *
 * 选项二最终发送的消息 = 【对话流背景】+【优化后的提示词】，在预览弹窗中
 * 合并为一条可编辑文本（前缀背景 + 流式追加的优化结果），用户可整体修改。
 */
import {
  apiContext, apiCdpRelay, apiListCaptures, apiOptimize, apiSaveCapture, getState, notify, patchModal, setState, getSetDraft,
  type ModalState,
  type SiteInfo,
} from './state.js'
import { recognizeSite, relaySend } from './relay-run.js'

let optimizeAbort: AbortController | null = null
let relayAborted = false

function recognizedSite(): SiteInfo | null {
  const { sites, recognizedSiteId, activeSiteId } = getState()
  if (recognizedSiteId) return sites.find((s) => s.id === recognizedSiteId) ?? null
  // CDP 联动站点没有 iframe 可识别：面板当前激活的联动站点即目标。
  const active = sites.find((s) => s.id === activeSiteId)
  if (active?.openIn === 'cdp') return active
  return recognizeSite(sites)
}

function contextPrefix(context: string | null, siteName: string): string {
  if (!context || context.trim().length === 0) {
    return `（暂无对话流背景。以下内容将发送给 ${siteName}。）\n\n`
  }
  return `【对话背景】以下是当前 DSH 会话的近期讨论，供你理解上下文：\n${context}\n\n【本次需求】\n`
}

/** 选项一：优化提示词（绝不发送）。 */
export async function startOptimize(draft: string): Promise<void> {
  optimizeAbort?.abort()
  optimizeAbort = new AbortController()
  setState({ modal: { kind: 'optimize', phase: 'streaming', text: '', draft, gen: 0 } })
  await streamInto('optimize', { draft }, '')
}

/** 选项二第一步：整理对话流背景 + 优化提示词，产出可编辑的发送预览。 */
export async function startRelay(draft: string, sessionId: string | undefined): Promise<void> {
  const site = recognizedSite()
  if (!site) {
    notify('未识别到外部 AI 站点：请先打开右侧浏览器面板并加载目标站点')
    setState({ open: true })
    return
  }
  setState({ open: true, modal: { kind: 'relay-preview', phase: 'streaming', text: '整理对话流中…', draft, context: '', prefix: '', gen: 0 } })
  const context = sessionId ? await apiContext(sessionId) : null
  const modal = getState().modal
  if (modal?.kind !== 'relay-preview') return // 用户已撤回
  const prefix = contextPrefix(context, site.name)
  setState({ modal: { ...modal, context: context ?? '', prefix, text: prefix } })
  await streamInto('relay-preview', { draft }, prefix)
}

/** 重新生成：沿用当前弹窗的 draft/context 重新调用优化。 */
export async function regenerate(): Promise<void> {
  const modal = getState().modal
  if (modal?.kind === 'optimize') {
    setState({ modal: { ...modal, phase: 'streaming', text: '', gen: modal.gen + 1, error: undefined } })
    await streamInto('optimize', { draft: modal.draft }, '')
  } else if (modal?.kind === 'relay-preview') {
    setState({ modal: { ...modal, phase: 'streaming', text: modal.prefix, gen: modal.gen + 1, error: undefined } })
    await streamInto('relay-preview', { draft: modal.draft }, modal.prefix)
  }
}

async function streamInto(kind: 'optimize' | 'relay-preview', payload: { draft: string, context?: string }, prefix: string): Promise<void> {
  optimizeAbort?.abort()
  optimizeAbort = new AbortController()
  let accum = ''
  try {
    await apiOptimize(payload, (delta) => {
      accum += delta
      const m = getState().modal
      if (m?.kind === kind) patchModal({ text: prefix + accum })
    }, optimizeAbort.signal)
    if (getState().modal?.kind === kind) patchModal({ phase: 'ready' })
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return
    if (getState().modal?.kind === kind) patchModal({ phase: 'ready', error: String((err as Error)?.message ?? err) })
  }
}

/** 撤回：关闭弹窗，不写不存。 */
export function withdraw(): void {
  optimizeAbort?.abort()
  setState({ modal: null })
}

/** 发送前的预览快照：取消时据此恢复（用户在等待阶段的编辑不丢失）。 */
let lastPreview: Extract<ModalState, { kind: 'relay-preview' }> | null = null

/** 选项二第二步：确认后写入浏览器并等待抓取。 */
export async function confirmSend(): Promise<void> {
  const modal = getState().modal
  if (modal?.kind !== 'relay-preview') return
  const site = recognizedSite()
  if (!site) {
    patchModal({ error: '站点未识别（面板可能已导航到非配置域名）' })
    return
  }
  const message = modal.text.trim()
  if (message.length === 0) {
    patchModal({ error: '发送内容为空' })
    return
  }
  lastPreview = modal
  relayAborted = false
  setState({ modal: { kind: 'relay-wait', status: '准备发送…' } })
  // 完成守卫：用户已取消/撤回（弹窗不再处于等待态）时丢弃迟到的结果，不覆盖用户界面。
  const stillWaiting = (): boolean => getState().modal?.kind === 'relay-wait'
  const finish = (reply: string, url: string) => {
    if (!stillWaiting()) return
    setState({
      modal: {
        kind: 'capture',
        reply,
        url,
        site: site.id,
        siteName: site.name,
        prompt: message,
      },
    })
    void refreshHistory()
  }
  const fail = (err: unknown) => {
    if (!stillWaiting()) return
    setState({
      modal: {
        kind: 'relay-preview', phase: 'ready', text: message, draft: modal.draft,
        context: modal.context, prefix: modal.prefix, gen: modal.gen,
        error: String((err as Error)?.message ?? err),
      },
    })
  }
  try {
    if (site.openIn === 'cdp') {
      // 联动模式：注入到专用浏览器的真实标签页（无取消通道，等待由 host 侧超时兜底）。
      const m = getState().modal
      if (m?.kind === 'relay-wait') setState({ modal: { ...m, status: '在联动浏览器中发送并等待回复…' } })
      const r = await apiCdpRelay(site.id, message)
      if (!r.ok || typeof r.reply !== 'string') throw new Error(r.error ?? '联动发送失败')
      finish(r.reply, r.url ?? '')
      return
    }
    const result = await relaySend(site, message, (status) => {
      const m = getState().modal
      if (m?.kind === 'relay-wait') setState({ modal: { ...m, status } })
    }, () => relayAborted)
    finish(result.reply, result.url)
  } catch (err) {
    fail(err)
  }
}

export function cancelWait(): void {
  relayAborted = true
  if (getState().modal?.kind !== 'relay-wait') return
  // 立即恢复发送前的预览（编辑内容不丢）；仍在途的请求结果由 confirmSend 的完成守卫丢弃。
  const preview = lastPreview
  if (preview !== null) {
    setState({ modal: { ...preview, error: '已取消：可修改后重新发送，或撤回' } })
    return
  }
  withdraw()
}

/** 捕获弹窗：保存到磁盘（保留弹窗以便继续编辑/复制）。 */
export async function saveCapture(): Promise<void> {
  const modal = getState().modal
  if (modal?.kind !== 'capture' || modal.savedFile) return
  const file = await apiSaveCapture({
    site: modal.site,
    siteName: modal.siteName,
    url: modal.url,
    prompt: modal.prompt,
    reply: modal.reply,
  })
  if (file) patchModal({ savedFile: file })
  void refreshHistory()
}

/** 把文本写入 DSH 输入框（草稿），并关闭弹窗。 */
export function insertIntoInput(text: string): void {
  getSetDraft()?.(text)
  setState({ modal: null })
}

export async function refreshHistory(): Promise<void> {
  setState({ captures: await apiListCaptures() })
}
