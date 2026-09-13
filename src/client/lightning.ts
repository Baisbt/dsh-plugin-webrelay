/**
 * dsh-webrelay —— 闪电按钮（conversation.input.right 槽）。
 * 渲染在模型选择器左侧；点击弹出两项菜单：
 *   ① 优化提示词（不发送）
 *   ② 整理上下文并发送到浏览器
 * 另有独立的「浏览器面板」开关按钮（🖥）。
 */
import { createElement as h, Fragment, useEffect, useRef, useState, type ReactElement } from 'react'
import { captureSetDraft, fetchSites, getState, setState, notify, type SiteInfo } from './state.js'
import { startOptimize, startRelay } from './flow.js'

interface LightningProps {
  input?: { draft?: string }
  inputActions?: { setDraft?: (text: string) => void }
  sessionId?: string
}

const LIGHTNING_SVG = h('svg', {
  width: 16, height: 16, viewBox: '0 0 16 16', fill: 'currentColor',
}, h('path', { d: 'M9.5 1 3.8 9h3.4l-.7 6L12.2 7H8.8l.7-6z' }))

const MONITOR_SVG = h('svg', {
  width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4,
}, [
  h('rect', { x: 1.8, y: 2.8, width: 12.4, height: 8.4, rx: 1.2 }),
  h('path', { d: 'M5.5 13.6h5M8 11.2v2.4' }),
])

export function Lightning(props: LightningProps): ReactElement {
  const [menuOpen, setMenuOpen] = useState(false)
  const [sites, setSites] = useState<SiteInfo[]>([])
  const [recognized, setRecognized] = useState<string | null>(null)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // 每次渲染捕获输入框写入口（供"插入输入框"动作使用）。
  captureSetDraft(props.inputActions?.setDraft)

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (!menuRef.current?.contains(target) && !btnRef.current?.contains(target)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const openMenu = async (): Promise<void> => {
    const opening = !menuOpen
    setMenuOpen(opening)
    if (!opening) return
    try {
      const list = await fetchSites()
      if (list.length > 0) {
        setSites(list)
        setState({ sites: list })
      }
    } catch { /* 菜单仍可开，选项二会在点击时校验 */ }
    setRecognized(getState().recognizedSiteId)
  }

  const draft = (props.input?.draft ?? '').trim()
  const recognizedSite = sites.find((s) => s.id === recognized) ?? null

  const rect = btnRef.current?.getBoundingClientRect()
  const menuStyle: Record<string, string> = rect
    ? { left: `${Math.min(rect.left, window.innerWidth - 260)}px`, bottom: `${window.innerHeight - rect.top + 6}px` }
    : { left: '16px', bottom: '96px' }

  return h(Fragment, null,
    h('button', {
      ref: btnRef,
      className: 'dsh-webrelay-btn',
      title: 'webrelay：优化提示词 / 中继发送',
      'aria-expanded': menuOpen,
      onClick: () => void openMenu(),
    }, LIGHTNING_SVG),
    h('button', {
      className: 'dsh-webrelay-btn',
      title: '打开 / 关闭右侧浏览器面板',
      onClick: () => {
        const next = !getState().open
        setState({ open: next, historyOpen: next ? getState().historyOpen : false })
        if (next) void refreshSites()
      },
    }, MONITOR_SVG),
    menuOpen && h('div', {
      ref: menuRef, className: 'dsh-webrelay-menu', style: menuStyle,
    },
      h('button', {
        className: 'dsh-webrelay-menu-item',
        disabled: draft.length === 0,
        onClick: () => {
          setMenuOpen(false)
          void startOptimize(draft)
        },
      }, '✨ 优化提示词（不发送）'),
      h('button', {
        className: 'dsh-webrelay-menu-item',
        disabled: draft.length === 0,
        onClick: () => {
          setMenuOpen(false)
          void startRelay(draft, props.sessionId)
        },
      }, '⚡ 整理上下文并发送到浏览器'),
      h('div', { className: 'dsh-webrelay-menu-note' },
        draft.length === 0
          ? '先在输入框写下要处理的内容'
          : recognizedSite
            ? `已识别站点：${recognizedSite.name}${recognizedSite.experimental ? '（实验性）' : ''}`
            : '未识别站点：选项二需先在右侧面板加载站点'),
    ),
  )
}

async function refreshSites(): Promise<void> {
  try {
    const list = await fetchSites()
    if (list.length > 0) setState({ sites: list })
  } catch {
    notify('无法获取站点配置（/dsh-webrelay/api/sites）')
  }
}
