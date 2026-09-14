/**
 * dsh-webrelay —— 业务流程编排（选项一 / 选项二双轮闭环）。
 * 组件只负责渲染，动作全部收口在这里，便于撤回/重新生成等状态迁移的一致性。
 *
 * 选项一（优化提示词，不发送）：
 *   输入框草稿 → 优化 → 弹窗展示（可编辑 / 重新生成 / 插入输入框）。
 *
 * 选项二（压缩 → 初优化 → 外发 → 收回 → 终优化 → 填入）：
 *   S1 上下文压缩：把当前 DSH 会话压成一段背景（内部步骤，静默进行）
 *   S2 第一次优化：背景 + 用户草稿 → 待外发的提示词 A（弹窗可编辑）
 *   S3 发送：把 A 填入外部浏览器（内置 iframe 或 CDP 联动）并提交
 *   S4 等待捕捉：等外部 AI 回复完成，读回正文 B（120s 超时可续等）
 *   S5 第二次优化：背景 + 原草稿 + 回复 B → 终稿 C（弹窗可编辑）
 *   S6 写入 DSH 输入框：写入 C，**不自动发送**
 *
 * 安全边界：S3 是整条链路里**唯一**一次对外写入，且必须在用户点击闪电按钮后才会发生；
 * S4 之后对页面的全部操作均为只读。任一步都可撤回；无 LLM 时 S1/S2/S5 均有降级路径。
 */
import {
  apiCompress, apiExtract, apiListCaptures, apiOptimize, apiSaveCapture, apiCdpCapture, apiCdpSend,
  getState, notify, patchModal, setState, getSetDraft,
  type SiteInfo,
} from './state.js'
import { captureFromFrame, recognizeSite, sendToFrame } from './relay-run.js'
import { attachHintApplies, splitAttachHint } from '../optimize.js'

/** 等待外部回复的默认上限（毫秒）；超时后进入"可续等"态。 */
export const RELAY_TIMEOUT_MS = 120_000

let optimizeAbort: AbortController | null = null
let countdownTimer: ReturnType<typeof setInterval> | null = null

/**
 * 解析当前可协作的目标站点。三条来源按优先级：
 *   1. relay iframe 已识别到的站点（`recognizedSiteId`）；
 *   2. 面板当前激活的联动（CDP）站点——联动模式没有 iframe，只能靠面板选择；
 *   3. iframe 当前 URL 现算一次（面板未回填识别结果时的兜底）。
 * 闪电菜单与编排链路共用同一份逻辑，避免两处判断不一致。
 */
export function resolveTargetSite(): SiteInfo | null {
  const { sites, recognizedSiteId, activeSiteId } = getState()
  if (recognizedSiteId) {
    const hit = sites.find((s) => s.id === recognizedSiteId)
    if (hit) return hit
  }
  const active = sites.find((s) => s.id === activeSiteId)
  if (active?.openIn === 'cdp') return active
  return recognizeSite(sites)
}

/** 该站点是否具备自动外发条件（联动模式无 iframe 也可发；system 模式不可）。 */
export function canCollaborate(site: SiteInfo | null): boolean {
  return site !== null && site.openIn !== 'system'
}

// ── 选项一：优化提示词（绝不发送） ──

/** 选项一：优化提示词（绝不发送）。 */
export async function startOptimize(draft: string): Promise<void> {
  rememberDraft(draft)
  optimizeAbort?.abort()
  optimizeAbort = new AbortController()
  setState({ modal: { kind: 'optimize', phase: 'streaming', text: '', draft, gen: 0 } })
  await streamOptimizeInto('optimize', { draft, phase: 'single' }, '')
}

// ── 选项二：六阶段闭环 ──

/**
 * 选项二入口：压缩上下文 → 第一次优化 → 弹窗等待用户确认外发。
 * draft 既作为"本次想做什么"的意图，也作为第一次优化的原稿。
 */
export async function startCapture(sessionId: string | undefined, draft: string): Promise<void> {
  const site = resolveTargetSite()
  if (!site) {
    notify('未识别到外部 AI 站点：请先打开右侧浏览器面板并加载目标站点')
    setState({ open: true })
    return
  }
  if (site.openIn === 'system') {
    notify('该站点设置为「在当前浏览器打开」：无法自动外发，请改用「内置」或「联动」模式')
    setState({ open: true })
    return
  }
  rememberDraft(draft)
  sessionRef = sessionId
  optimizeAbort?.abort()
  optimizeAbort = new AbortController()
  contextCache = undefined
  setState({ open: true, modal: { kind: 'relay-wait', status: '正在压缩对话上下文…' } })
  try {
    const context = await compressSession(sessionId, draft)
    contextCache = context
    // 进入第一次优化（视角 = 外发给另一个模型）。
    setState({ modal: { kind: 'optimize', phase: 'streaming', text: '', draft, gen: 0 } })
    await streamOptimizeInto('optimize', { draft, context, phase: 'outbound' }, '')
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return
    setState({ modal: null })
    notify(`准备失败：${String((err as Error)?.message ?? err)}`)
  }
}

/** S1：压缩当前会话上下文。成功返回摘要文本，无可用历史返回 undefined。 */
async function compressSession(sessionId: string | undefined, draft: string): Promise<string | undefined> {
  if (!sessionId) return undefined
  try {
    const result = await apiCompress(
      { sessionId, draft, limit: 40 },
      undefined,
      optimizeAbort?.signal,
    )
    return result.context ?? undefined
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err
    // 压缩失败只提示、不中断：外发链路宁可少背景也不要卡住。
    notify(`上下文压缩失败，将以无背景方式继续：${String((err as Error)?.message ?? err)}`)
    return undefined
  }
}

/**
 * S3+S4：把第一次优化的结果外发给外部浏览器，并等待其回复。
 * 由「发送到浏览器」按钮触发——这是整条链路唯一一次对外写入。
 */
export async function sendToBrowser(): Promise<void> {
  const modal = getState().modal
  if (modal?.kind !== 'optimize') return
  const message = modal.text.trim()
  if (message.length === 0) {
    patchModal({ error: '内容为空：无法发送' })
    return
  }
  const site = resolveTargetSite()
  if (!site) {
    patchModal({ error: '未识别到目标站点：请确认右侧面板已加载站点页面' })
    return
  }
  const draft = modal.draft
  optimizeAbort?.abort()
  optimizeAbort = new AbortController()

  const payload = message
  setState({
    modal: {
      kind: 'relay-wait',
      status: `正在发送到 ${site.name} ，等待回复…`,
      remain: Math.ceil(RELAY_TIMEOUT_MS / 1000),
    },
  })
  if (site.openIn !== 'cdp') startCountdown(RELAY_TIMEOUT_MS)

  let outcome: { ok: boolean, reply?: string, raw?: string, url?: string, timedOut?: boolean, error?: string }
  try {
    outcome = site.openIn === 'cdp'
      ? await apiCdpSend(site.id, payload, RELAY_TIMEOUT_MS)
      : await sendToFrame(site, payload, RELAY_TIMEOUT_MS)
  } catch (err) {
    stopCountdown()
    setState({
      modal: { kind: 'optimize', phase: 'ready', text: modal.text, draft, gen: modal.gen, error: `发送失败：${String((err as Error)?.message ?? err)}` },
    })
    return
  }
  stopCountdown()

  const reply = (outcome.reply ?? outcome.raw ?? '').trim()
  if (outcome.ok && reply.length > 0) {
    await startFinalOptimize({ draft, context: contextCache, externalReply: reply, siteName: site.name })
    return
  }
  if (outcome.timedOut) {
    // 超时：不判死，进入"可续等 / 采用已抓内容"二选一。
    setState({
      modal: {
        kind: 'relay-wait',
        status: reply.length > 0
          ? `等待 ${site.name} 回复超时，已抓到部分内容（${reply.length} 字符）`
          : `等待 ${site.name} 回复超时，尚未捕获到内容`,
        timedOut: true,
        partial: reply.length > 0 ? reply : undefined,
        remain: 0,
      },
    })
    return
  }
  setState({
    modal: {
      kind: 'optimize', phase: 'ready', text: modal.text, draft, gen: modal.gen,
      error: `发送或捕获失败：${outcome.error ?? '未捕获到回复'}`,
    },
  })
}

/**
 * 超时后「继续等待」：只读重读一次页面，抓到就走终稿优化。
 * 用只读捕捉而非重发——重发会在外部站点留下重复消息。
 */
export async function continueWaiting(): Promise<void> {
  const modal = getState().modal
  if (modal?.kind !== 'relay-wait') return
  const site = resolveTargetSite()
  if (!site) return void notify('未识别到目标站点')
  patchModal({ status: `正在读取 ${site.name} 的回复…`, remain: 0 })
  const captured = site.openIn === 'cdp'
    ? await apiCdpCapture(site.id)
    : captureFromFrame(site)
  const reply = (captured.raw ?? '').trim()
  if (!captured.ok || reply.length === 0) {
    patchModal({ status: `仍未读到回复：${captured.error ?? '页面内容为空'}（可稍后再试）`, timedOut: true })
    return
  }
  await startFinalOptimize({ draft: lastDraft(), context: contextCache, externalReply: reply, siteName: site.name })
}

/** 超时后「采用已抓到的内容」：直接用它走终稿优化。 */
export async function adoptPartial(): Promise<void> {
  const modal = getState().modal
  if (modal?.kind !== 'relay-wait' || !modal.partial) return
  const site = resolveTargetSite()
  await startFinalOptimize({
    draft: lastDraft(),
    context: contextCache,
    externalReply: modal.partial,
    siteName: site?.name ?? '外部站点',
  })
}

/** S5：第二次优化（终稿）——把外部回答消化进最终指令。 */
async function startFinalOptimize(input: {
  draft: string, context?: string, externalReply: string, siteName: string,
}): Promise<void> {
  const draft = input.draft.length > 0 ? input.draft : lastDraft()
  const prefix = relayPrefix(input.siteName)
  setState({
    modal: {
      kind: 'relay-preview', phase: 'streaming', text: prefix,
      draft, context: input.context ?? '', externalReply: input.externalReply, prefix, gen: 0,
    },
  })
  await streamOptimizeInto('relay-preview', {
    draft, context: input.context, externalReply: input.externalReply, phase: 'final',
  }, prefix)
}

/** 会话 id 与压缩背景快照：超时续等 / 重生成路径复用，避免重复压缩。 */
let sessionRef: string | undefined
let contextCache: string | undefined
let draftSnapshot = ''

/** 记录用户草稿（闪电按钮触发时调用），供超时续等路径回取。 */
export function rememberDraft(draft: string): void {
  draftSnapshot = draft
}

/** 最近一次编辑过的草稿：优先当前弹窗，其次快照。 */
function lastDraft(): string {
  const modal = getState().modal
  if (modal && 'draft' in modal && typeof modal.draft === 'string' && modal.draft.length > 0) return modal.draft
  return draftSnapshot
}

/** 重新生成：沿用当前弹窗的输入重新调用对应链路。 */
export async function regenerate(): Promise<void> {
  const modal = getState().modal
  if (modal?.kind === 'optimize') {
    setState({ modal: { ...modal, phase: 'streaming', text: '', gen: modal.gen + 1, error: undefined } })
    await streamOptimizeInto('optimize', { draft: modal.draft, context: contextCache, phase: 'outbound' }, '')
  } else if (modal?.kind === 'relay-preview') {
    setState({ modal: { ...modal, phase: 'streaming', text: modal.prefix, gen: modal.gen + 1, error: undefined } })
    await streamOptimizeInto('relay-preview', {
      draft: modal.draft, context: modal.context, externalReply: modal.externalReply, phase: 'final',
    }, modal.prefix)
  }
}

async function streamOptimizeInto(
  kind: 'optimize' | 'relay-preview',
  payload: { draft: string, context?: string, externalReply?: string, phase: 'single' | 'outbound' | 'final' },
  prefix: string,
): Promise<void> {
  optimizeAbort?.abort()
  optimizeAbort = new AbortController()
  let accum = ''
  try {
    await apiOptimize(payload, (delta) => {
      accum += delta
      const m = getState().modal
      if (m?.kind === kind) patchModal({ text: prefix + stripAttachHint(accum).text })
    }, optimizeAbort.signal)
    if (getState().modal?.kind === kind) {
      // 收尾时把尾注「附件提示」整行摘掉：正文保持干净，提示单独走 attachHint 字段。
      const { text, hint } = stripAttachHint(accum)
      patchModal({
        phase: 'ready',
        text: prefix + text,
        attachHint: attachHintApplies(hint) ? hint : undefined,
      })
    }
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return
    if (getState().modal?.kind === kind) patchModal({ phase: 'ready', error: String((err as Error)?.message ?? err) })
  }
}

/**
 * 剥掉优化器追加的尾注「附件提示」。
 *
 * 流式过程中标记可能还没到齐，此时先原样渲染；一旦标记出现就立刻截断，
 * 让用户看不到那行元信息（它只该出现在提示条里）。
 */
function stripAttachHint(raw: string): { text: string, hint: string } {
  return splitAttachHint(raw)
}

/** 撤回：关闭弹窗并停掉倒计时，不写不存。 */
export function withdraw(): void {
  optimizeAbort?.abort()
  stopCountdown()
  setState({ modal: null })
}

/** 超时倒计时（等待态展示剩余秒数；仅 UI 提示，真实超时由页面内表达式判定）。 */
export function startCountdown(totalMs: number): void {
  stopCountdown()
  const deadline = Date.now() + totalMs
  countdownTimer = setInterval(() => {
    const modal = getState().modal
    if (modal?.kind !== 'relay-wait' || modal.timedOut) return stopCountdown()
    const remain = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
    patchModal({ remain })
    if (remain === 0) stopCountdown()
  }, 1000)
}

function stopCountdown(): void {
  if (countdownTimer !== null) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
}

/** 选项二最终写入输入框时的引导语：说明内容来自哪个站点的协作。 */
function relayPrefix(siteName: string): string {
  return `【任务要求】以下提示词已结合 ${siteName} 的回复整理而成，请据此完成任务。\n\n`
}

/**
 * S6：把终稿写入 DSH 输入框（选项二的终点）。写入的是**优化后的提示词**，
 * 绝不是网页原文，也绝不自动发送——发送与否由用户决定。
 */
export function insertOptimized(text: string): void {
  // 去掉引导语前缀，输入框里只留提示词正文。
  const body = stripPrefix(splitAttachHint(text).text).trim()
  if (body.length === 0) return
  getSetDraft()?.(body)
  stopCountdown()
  setState({ modal: null })
}

/** 剥掉 relayPrefix 加上的引导语（用户可能已在预览里删掉，故做容错匹配）。 */
function stripPrefix(text: string): string {
  return text.replace(/^【任务要求】以下提示词已结合[^\n]*\n+/, '')
}

// ── 单轮整理链路（保留：外部回复的二次整理入口） ──

/** 把捕捉到的网页原文交给 LLM 二次提取整理（结果可编辑）。 */
export async function startExtract(input: { raw: string, site: string, siteName: string, url: string, intent: string }): Promise<void> {
  setState({
    modal: {
      kind: 'extract', phase: 'streaming', text: '', raw: input.raw,
      site: input.site, siteName: input.siteName, url: input.url, intent: input.intent, gen: 0,
    },
  })
  await streamExtractInto({ raw: input.raw, siteName: input.siteName, url: input.url, intent: input.intent })
}

async function streamExtractInto(payload: { raw: string, siteName?: string, url?: string, intent?: string }): Promise<void> {
  optimizeAbort?.abort()
  optimizeAbort = new AbortController()
  let accum = ''
  try {
    const result = await apiExtract(payload, (delta) => {
      accum += delta
      if (getState().modal?.kind === 'extract') patchModal({ text: accum })
    }, optimizeAbort.signal)
    if (getState().modal?.kind !== 'extract') return
    patchModal({
      phase: 'ready',
      // 降级通道的提示贴在弹窗里，让用户知道这份内容是启发式清洗而非模型整理。
      ...(result.fallbackReason ? { error: `已降级处理：${result.fallbackReason}` } : {}),
    })
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return
    if (getState().modal?.kind === 'extract') patchModal({ phase: 'ready', error: String((err as Error)?.message ?? err) })
  }
}

/** 整理结果作为素材优化成提示词（整理路径的收尾）。 */
export async function optimizeTidied(): Promise<void> {
  const modal = getState().modal
  if (modal?.kind !== 'extract') return
  const tidied = modal.text.trim()
  if (tidied.length === 0) {
    patchModal({ error: '整理结果为空：无法继续优化' })
    return
  }
  const site = getState().sites.find((s) => s.id === modal.site) ?? null
  const prefix = relayPrefix(site?.name ?? modal.siteName)
  setState({
    modal: {
      kind: 'relay-preview', phase: 'streaming', text: prefix,
      draft: tidied, context: '', externalReply: '', prefix, gen: 0,
    },
  })
  await streamOptimizeInto('relay-preview', { draft: tidied, phase: 'final' }, prefix)
}

// ── 捕获存档 ──

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
  stopCountdown()
  setState({ modal: null })
}

export async function refreshHistory(): Promise<void> {
  setState({ captures: await apiListCaptures() })
}
