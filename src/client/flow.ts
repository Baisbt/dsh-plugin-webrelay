/**
 * dsh-webrelay —— 业务流程编排（选项一 / 选项二 / 捕获落库）。
 * 组件只负责渲染，动作全部收口在这里，便于撤回/重新生成等状态迁移的一致性。
 *
 * 选项二最终发送的消息 = 【对话流背景】+【优化后的提示词】，在预览弹窗中
 * 合并为一条可编辑文本（前缀背景 + 流式追加的优化结果），用户可整体修改。
 */
import {
  apiContext, apiListCaptures, apiOptimize, apiSaveCapture, getState, notify, patchModal, setState, getSetDraft,
  type SiteInfo,
} from './state.js'
import { recognizeSite, relaySend } from './relay-run.js'

let optimizeAbort: AbortController | null = null
let relayAborted = false

function recognizedSite(): SiteInfo | null {
  const { sites, recognizedSiteId } = getState()
  if (recognizedSiteId) return sites.find((s) => s.id === recognizedSiteId) ?? null
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
  relayAborted = false
  setState({ modal: { kind: 'relay-wait', status: '准备发送…' } })
  try {
    const result = await relaySend(site, message, (status) => {
      const m = getState().modal
      if (m?.kind === 'relay-wait') setState({ modal: { ...m, status } })
    }, () => relayAborted)
    setState({
      modal: {
        kind: 'capture',
        reply: result.reply,
        url: result.url,
        site: site.id,
        siteName: site.name,
        prompt: message,
      },
    })
    void refreshHistory()
  } catch (err) {
    setState({
      modal: {
        kind: 'relay-preview', phase: 'ready', text: message, draft: modal.draft,
        context: modal.context, prefix: modal.prefix, gen: modal.gen,
        error: String((err as Error)?.message ?? err),
      },
    })
  }
}

export function cancelWait(): void {
  relayAborted = true
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
