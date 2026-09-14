/**
 * dsh-webrelay —— CDP 联动视图（openIn: 'cdp' 的站点在面板中的呈现）。
 *
 * 单击站点页签即直达：视图挂载时自动完成「启动联动浏览器 → 打开/激活站点标签页」。
 * 提供关闭标签页、刷新状态，并展示该站点的捕获历史（点击查看详情）。
 */
import { createElement as h, useEffect, useRef, useState, type ReactElement } from 'react'
import {
  apiCdpClose, apiCdpLaunch, apiCdpOpen, apiCdpStatus, apiListCaptures, apiReadCapture,
  getState, notify, setState, type CaptureMeta, type CdpStatus, type SiteInfo,
} from './state.js'

type Phase = 'idle' | 'launching' | 'opening' | 'ready'

export function CdpLinkageView({ site }: { site: SiteInfo }): ReactElement {
  const [status, setStatus] = useState<CdpStatus | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [captures, setCaptures] = useState<CaptureMeta[]>([])
  const started = useRef(false)

  const refresh = async (): Promise<void> => {
    setStatus(await apiCdpStatus())
    setCaptures((await apiListCaptures()).filter((c) => c.site === site.id))
  }

  const ensureOpen = async (): Promise<void> => {
    if (started.current) return
    started.current = true
    setError(null)
    try {
      setPhase('launching')
      const launch = await apiCdpLaunch(site.id)
      if (!launch.ok) throw new Error(launch.error ?? '联动浏览器启动失败')
      setPhase('opening')
      const open = await apiCdpOpen(site.id)
      if (!open.ok) throw new Error(open.error ?? '打开站点标签页失败')
      setPhase('ready')
    } catch (err) {
      setPhase('idle')
      setError(String((err as Error)?.message ?? err))
    }
    await refresh()
  }

  useEffect(() => { void ensureOpen() }, [])

  const instanceId = site.browser ?? 'default'
  const instance = status?.instances.find((i) => i.id === instanceId) ?? status?.instances.find((i) => i.id === 'default')
  const siteTab = instance?.targets.find((t) => {
    try {
      const host = new URL(t.url).hostname.toLowerCase()
      return site.match.some((m) => host === m || host.endsWith('.' + m))
    } catch {
      return false
    }
  })

  const phaseText = phase === 'launching'
    ? '正在启动联动浏览器…'
    : phase === 'opening'
      ? '正在打开站点标签页…'
      : null

  const openCapture = async (file: string): Promise<void> => {
    const entry = await apiReadCapture(file)
    if (!entry) return notify('读取捕获失败')
    setState({
      modal: {
        kind: 'capture', reply: entry.reply, url: entry.url,
        site: entry.site, siteName: entry.siteName, prompt: entry.prompt, savedFile: entry.file,
      },
    })
  }

  return h('div', { className: 'dsh-webrelay-system-note' },
    h('div', { style: { fontSize: '13px', lineHeight: 1.8, padding: '0 8px', maxWidth: '500px' } },
      h('div', null,
        `联动浏览器「${instance?.label ?? instanceId}」：`,
        h('b', null, phaseText ?? (instance?.running ? `已连接（端口 ${instance.port}）` : '未启动')),
      ),
      h('div', { style: { opacity: 0.7, fontSize: '12px' } },
        `独立配置目录：${status?.profileRoot ?? '…'}\\${instanceId} · 账户配置：${site.browser ?? '默认'}`),
      h('div', { style: { opacity: 0.7, fontSize: '12px' } },
        siteTab
          ? `联动标签页：${siteTab.title || siteTab.url}`
          : instance?.running ? '尚无该站点的联动标签页' : '启动后将在联动浏览器中打开站点（首次需登录一次）'),
      h('div', { style: { opacity: 0.55, fontSize: '11px', marginTop: '4px' } },
        '在联动模式下，闪电按钮「与外部 AI 协作优化」会在真实标签页里填写并发送你的提示词，等待回复完成后只读捕捉，再整合成终稿写入输入框。'),
      error !== null && h('div', { className: 'dsh-webrelay-error', style: { marginTop: '6px' } }, error),
    ),
    h('div', { style: { display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' } },
      h('button', {
        className: 'dsh-webrelay-btn2', 'data-primary': true,
        disabled: phase === 'launching' || phase === 'opening',
        onClick: () => {
          started.current = false
          void ensureOpen()
        },
      }, '打开 / 激活站点标签页'),
      h('button', {
        className: 'dsh-webrelay-btn2',
        disabled: busyOr(phase, !siteTab),
        title: '关闭联动浏览器中该站点的标签页（联动浏览器窗口保留）',
        onClick: () => {
          void (async () => {
            const r = await apiCdpClose(site.id)
            if (!r.ok) return notify(r.error ?? '关闭失败')
            notify('联动标签页已关闭')
            await refresh()
          })()
        },
      }, '关闭标签页'),
      h('button', { className: 'dsh-webrelay-btn2', onClick: () => void refresh() }, '刷新状态'),
    ),
    h('div', { className: 'dsh-webrelay-capture-list' },
      h('div', { className: 'dsh-webrelay-browsers-head' }, `捕获记录（${site.name}）`),
      captures.length === 0
        ? h('div', { style: { fontSize: '12px', opacity: 0.55, padding: '2px 0' } }, '暂无捕获：保存过的抓取结果会存档在这里')
        : captures.map((c) => h('button', {
          key: c.file,
          className: 'dsh-webrelay-history-item',
          onClick: () => void openCapture(c.file),
        },
          h('div', null, c.prompt.replace(/\s+/g, ' ').slice(0, 70) || '（无提示词）'),
          h('div', { className: 'dsh-webrelay-history-meta' }, `${new Date(c.createdAt).toLocaleString()} · 点击查看全文`),
        )),
    ),
  )
}

function busyOr(phase: Phase, tabMissing: boolean): boolean {
  return phase === 'launching' || phase === 'opening' || tabMissing
}
