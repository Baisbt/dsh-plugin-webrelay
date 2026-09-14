/**
 * dsh-webrelay —— shell.overlay 槽的 Overlay 根：浏览器面板 + 弹窗 + 轻提示。
 * shell.overlay 是 additive list 层，本插件只渲染自绘的停靠面板，不触碰其他插件。
 */
import { createElement as h, Component, Fragment, useCallback, useEffect, useRef, type ReactElement, type ReactNode } from 'react'
import { apiListCaptures, apiReadCapture, getState, notify, setState, useStore, type CaptureMeta } from './state.js'
import { registerFrame, currentTarget } from './relay-run.js'
import { ModalRoot } from './modals.js'
import { CdpLinkageView } from './cdp-view.js'

/** 渲染错误边界：任何子树崩溃都降级为可恢复的错误卡片，而不是拖死整个浮层（面板"再也打不开"的根源）。 */
class OverlayBoundary extends Component<{ children?: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }
  render() {
    if (this.state.error !== null) {
      return h('div', {
        className: 'dsh-webrelay-toast',
        style: {
          position: 'fixed', top: '16px', left: '50%', transform: 'translateX(-50%)',
          zIndex: 10030, padding: '10px 14px', borderRadius: '8px', fontSize: '12px',
          background: 'var(--dsh-bg-elevated, #2a2a2e)', color: '#f28b82',
          boxShadow: '0 8px 24px rgb(0 0 0 / 35%)', pointerEvents: 'auto', maxWidth: '70vw',
        },
      },
        `webrelay 浮层渲染出错：${this.state.error.message}`,
        h('button', {
          className: 'dsh-webrelay-btn2', style: { marginLeft: '8px' },
          onClick: () => { this.setState({ error: null }) },
        }, '恢复'),
      )
    }
    return this.props.children
  }
}

export function OverlayRoot(): ReactElement {
  const s = useStore()
  return h(OverlayBoundary, null,
    h(Fragment, null,
      s.notice !== null && h('div', {
        className: 'dsh-webrelay-toast',
        style: {
          position: 'fixed', top: '16px', left: '50%', transform: 'translateX(-50%)',
          zIndex: 10030, padding: '8px 14px', borderRadius: '8px', fontSize: '13px',
          background: 'var(--dsh-bg-elevated, #2a2a2e)', color: 'var(--dsh-fg, #e8eaed)',
          boxShadow: '0 8px 24px rgb(0 0 0 / 35%)', pointerEvents: 'auto',
        },
      }, s.notice),
      s.modal !== null && h(OverlayBoundary, { key: 'modal' }, h(ModalRoot)),
      s.open && h(OverlayBoundary, { key: 'panel' }, h(BrowserPanel)),
    ),
  )
}

function BrowserPanel(): ReactElement {
  const s = useStore()
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const dragState = useRef<{ startX: number, startWidth: number } | null>(null)

  const visibleSites = s.sites.filter((site) => !site.hidden)
  const activeSite = visibleSites.find((site) => site.id === s.activeSiteId)
    ?? (s.sites.find((site) => site.id === s.activeSiteId) ?? null)

  useEffect(() => {
    // 面板打开时若尚未加载站点列表，则拉一次。
    if (s.sites.length === 0 || visibleSites.length === 0) {
      void refreshSites()
    } else if (s.activeSiteId === null) {
      // 自动选中首个可见站点；若是联动（CDP）站点，同步写 recognizedSiteId，
      // 否则闪电菜单会因 recognizedSiteId 恒为 null 而误判为"未识别"。
      const first = s.sites.find((x) => !x.hidden) ?? null
      setState({
        activeSiteId: first?.id ?? null,
        recognizedSiteId: first && first.openIn === 'cdp' ? first.id : null,
      })
    }
    if (s.historyOpen && s.captures.length === 0) void refreshHistory()
  }, [])

  const onFrameLoad = useCallback(() => {
    registerFrame(frameRef.current)
    const target = currentTarget()
    const { sites } = getState()
    if (target) {
      const host = target.hostname.toLowerCase()
      const hit = sites.find((site) => site.match.some((m) => host === m || host.endsWith('.' + m)))
      setState({ recognizedSiteId: hit?.id ?? null })
    } else {
      setState({ recognizedSiteId: null })
    }
  }, [])

  const onDragStart = (e: React.MouseEvent): void => {
    dragState.current = { startX: e.clientX, startWidth: getState().panelWidth }
    const onMove = (ev: MouseEvent): void => {
      const start = dragState.current
      if (!start) return
      const width = Math.min(920, Math.max(340, start.startWidth + (start.startX - ev.clientX)))
      setState({ panelWidth: width })
    }
    const onUp = (): void => {
      dragState.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const close = (): void => setState({ open: false, recognizedSiteId: null })

  if (s.sites.length === 0) {
    return h('div', { className: 'dsh-webrelay-panel', style: { width: `${s.panelWidth}px` } },
      h('div', { className: 'dsh-webrelay-panel-head' },
        h('span', { className: 'dsh-webrelay-panel-title' }, '内置浏览器'),
        h('button', { className: 'dsh-webrelay-btn', style: { marginLeft: 'auto' }, onClick: close }, '✕'),
      ),
      h('div', { style: { padding: '16px', fontSize: '13px', opacity: 0.7 } },
  s.sites.length === 0 ? '站点配置加载失败或为空：请检查 $DSH_HOME/webrelay/sites.yml' : '所有站点均已隐藏：在"管理"里恢复显示'),
    )
  }

  return h('div', { className: 'dsh-webrelay-panel', style: { width: `${s.panelWidth}px` } },
    h('div', { className: 'dsh-webrelay-panel-drag', onMouseDown: onDragStart }),
    h('div', { className: 'dsh-webrelay-panel-head' },
      h('span', { className: 'dsh-webrelay-panel-title' }, '内置浏览器'),
      visibleSites.map((site) => h('button', {
        key: site.id,
        className: 'dsh-webrelay-site-tab',
        'data-active': site.id === activeSite?.id,
        title: site.home + (site.experimental ? '（实验性适配）' : ''),
        onClick: () => {
          if (site.openIn === 'system') {
            window.open(site.home, '_blank', 'noopener')
            return
          }
          setState({ activeSiteId: site.id, recognizedSiteId: site.openIn === 'cdp' ? site.id : null })
        },
      }, site.name)),
      h('button', {
        className: 'dsh-webrelay-site-tab',
        title: '站点管理：添加 / 排序 / 隐藏 / 删除 / 恢复默认',
        onClick: () => setState({ modal: { kind: 'sites' } }),
      }, '管理'),
      h('span', {
        className: 'dsh-webrelay-badge',
        'data-unknown': s.recognizedSiteId === null,
      }, s.recognizedSiteId !== null ? '已识别' : '未识别'),
    ),
    h('div', { className: 'dsh-webrelay-frame-wrap' },
      activeSite && activeSite.openIn === 'relay' && h('iframe', {
        key: `${s.rid}:${activeSite.id}`,
        ref: frameRef,
        className: 'dsh-webrelay-frame',
        src: `/dsh-webrelay/proxy/${s.rid}/${activeSite.home}`,
        onLoad: onFrameLoad,
      }),
      activeSite && activeSite.openIn === 'cdp' && h(CdpLinkageView, { site: activeSite, key: activeSite.id }),
      activeSite && activeSite.openIn === 'system' && h('div', { className: 'dsh-webrelay-system-note' },
        h('div', { style: { fontSize: '13px', lineHeight: 1.7, padding: '0 8px' } },
          `「${activeSite.name}」已设置为在当前浏览器打开（新标签页，带你的登录态）。`,
          '该模式下闪电按钮的自动注入/抓取不可用（二期 CDP 联动后开放）。'),
        h('button', {
          className: 'dsh-webrelay-btn2', style: { marginTop: '10px' },
          onClick: () => { window.open(activeSite.home, '_blank', 'noopener') },
        }, '在当前浏览器打开'),
      ),
    ),
    s.historyOpen && h('div', { className: 'dsh-webrelay-history' },
      s.captures.length === 0
        ? h('div', { style: { padding: '10px 12px', fontSize: '12px', opacity: 0.6 } }, '暂无捕获记录')
        : s.captures.map((c) => HistoryItem({ capture: c })),
    ),
    h('div', { className: 'dsh-webrelay-panel-foot' },
      h('button', {
        className: 'dsh-webrelay-site-tab',
        title: '在系统默认浏览器打开（面板嵌入失败时的降级通道）',
        onClick: () => { if (activeSite) window.open(activeSite.home, '_blank', 'noopener') },
      }, '系统浏览器打开'),
      h('button', {
        className: 'dsh-webrelay-site-tab',
        onClick: () => {
          const next = !getState().historyOpen
          setState({ historyOpen: next })
          if (next) void refreshHistory()
        },
      }, '捕获历史'),
      h('button', { className: 'dsh-webrelay-site-tab', style: { marginLeft: 'auto' }, onClick: close }, '关闭'),
    ),
  )
}

function HistoryItem({ capture }: { capture: CaptureMeta }): ReactElement {
  return h('button', {
    className: 'dsh-webrelay-history-item',
    onClick: async () => {
      const entry = await apiReadCapture(capture.file)
      if (!entry) return notify('读取捕获失败')
      setState({
        modal: {
          kind: 'capture', reply: entry.reply, url: entry.url,
          site: entry.site, siteName: entry.siteName, prompt: entry.prompt, savedFile: entry.file,
        },
      })
    },
  },
    h('div', null, capture.prompt.replace(/\s+/g, ' ').slice(0, 60) || '（无提示词）'),
    h('div', { className: 'dsh-webrelay-history-meta' },
      `${new Date(capture.createdAt).toLocaleString()} · ${capture.siteName}`),
  )
}

async function refreshSites(): Promise<void> {
  try {
    const res = await fetch('/dsh-webrelay/api/sites')
    const body = await res.json() as { ok: boolean, sites?: import('./state.js').SiteInfo[] }
    if (body.ok && body.sites && body.sites.length > 0) {
      const before = getState()
      // 首次回填（此前没有激活站点）时顺带选定首个可见站点；
      // 若选中的是联动（CDP）站点，一并写 recognizedSiteId，避免闪电菜单误判"未识别"。
      // 若此前已有激活站点，则保持用户当前选择不动。
      if (before.activeSiteId === null) {
        const picked = body.sites.find((x) => !x.hidden) ?? null
        setState({
          sites: body.sites,
          activeSiteId: picked?.id ?? null,
          recognizedSiteId: picked && picked.openIn === 'cdp' ? picked.id : before.recognizedSiteId,
        })
      } else {
        setState({ sites: body.sites })
      }
    }
  } catch {
    notify('站点配置加载失败')
  }
}

async function refreshHistory(): Promise<void> {
  setState({ captures: await apiListCaptures() })
}
