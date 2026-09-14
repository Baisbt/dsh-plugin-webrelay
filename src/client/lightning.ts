/**
 * dsh-webrelay —— 闪电按钮（conversation.input.right 槽）。
 * 渲染在模型选择器左侧；点击弹出两项菜单：
 *   ① 优化提示词（不发送）—— 优化输入框草稿，弹窗确认后插入输入框；
 *   ② 与外部 AI 协作优化 —— 压缩上下文 → 第一次优化 → 发送到外部浏览器 →
 *      等待并捕捉回复 → 第二次优化 → 写入输入框（全程分步弹窗、可撤回）。
 *      未识别到站点时该项**仍可点击**：点击后按情况引导（打开面板 / 启动联动浏览器 / 挂载页面）。
 * 另有独立的「浏览器面板」开关按钮（🖥）。
 */
import { createElement as h, Fragment, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { apiCdpLaunch, apiCdpOpen, captureSetDraft, fetchSites, getState, notify, setState, useStore, type SiteInfo } from './state.js'
import { canCollaborate, resolveTargetSite, startCapture, startOptimize } from './flow.js'

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
  const [connecting, setConnecting] = useState(false)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // 每次渲染捕获输入框写入口（供"插入输入框"动作使用）。
  captureSetDraft(props.inputActions?.setDraft)

  // 订阅 store：面板 / 联动视图改了站点表或激活站点时，本组件随之重渲染。
  const store = useStore()

  /** 站点表有两个来源：store（面板/联动视图写入）与本组件拉取的副本，合并后以 store 为准。 */
  const allSites = useMemo(
    () => (store.sites.length > 0 ? store.sites : sites),
    [store.sites, sites],
  )

  // 目标站点不再存成独立 state（会与 store 脱节），直接由当前 store 推导：
  // 联动模式下 recognizedSiteId 恒为 null，靠 activeSiteId 回退——这正是之前菜单
  // 显示"未识别"而面板显示"已连接"的根因。
  const recognizedSite = useMemo(
    () => resolveTargetSite(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.recognizedSiteId, store.activeSiteId, store.sites, sites, menuOpen],
  )
  const ready = canCollaborate(recognizedSite)

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
    // 拉一次站点表：结果写回 store 后，上面的 useMemo 会自动重算识别结果。
    // 冷启动（面板尚未挂载）时 store 里可能还没有 activeSiteId，这里顺带补一次，
    // 否则联动站点会因为"无人选中它"而在菜单里被判成未识别。
    try {
      const list = await fetchSites()
      if (list.length > 0) {
        setSites(list)
        const before = getState()
        const patch: Parameters<typeof setState>[0] = { sites: list }
        if (before.activeSiteId === null) {
          const picked = list.find((x) => !x.hidden) ?? null
          patch.activeSiteId = picked?.id ?? null
          if (picked && picked.openIn === 'cdp') patch.recognizedSiteId = picked.id
        }
        setState(patch)
      }
    } catch { /* 菜单仍可开，选项二会在点击时校验 */ }
  }

  const draft = (props.input?.draft ?? '').trim()

  /**
   * 未就绪时点击「与外部 AI 协作优化」：不报错了事，而是尽力把它接上——
   *   1. 已知是联动站点 → 启动联动浏览器并打开/激活该站点标签页；
   *   2. 否则 → 打开右侧面板并选中一个非 system 站点，让面板去挂载页面。
   */
  const connect = async (): Promise<void> => {
    setConnecting(true)
    try {
      const all = allSites.length > 0 ? allSites : await fetchSites()
      if (all.length > 0) {
        setSites(all)
        setState({ sites: all })
      }
      const activeId = getState().activeSiteId
      const active = all.find((s) => s.id === activeId)
      const cdpSite = all.find((s) => s.openIn === 'cdp')
      const target = active && active.openIn !== 'system' ? active : cdpSite ?? all.find((s) => s.openIn === 'relay')

      if (!target) {
        notify('没有可用的外部站点：请在「管理」里添加一个站点（并设为内置或联动模式）')
        return
      }

      setState({ open: true, activeSiteId: target.id })
      if (target.openIn === 'cdp') {
        // 联动模式：确保浏览器已启动、站点标签页已打开（与联动视图同款流程）。
        // 写 recognizedSiteId 后，上面的 useMemo 会重算出 recognizedSite → 菜单变为就绪态。
        setState({ recognizedSiteId: target.id })
        const launch = await apiCdpLaunch(target.id)
        if (!launch.ok) throw new Error(launch.error ?? '联动浏览器启动失败')
        const open = await apiCdpOpen(target.id)
        if (!open.ok) throw new Error(open.error ?? '打开站点标签页失败')
        notify(`已连接联动浏览器：${target.name}（可再次点击开始协作）`)
      } else {
        notify(`已打开「${target.name}」：页面加载完成后即可再次点击开始协作`)
      }
    } catch (err) {
      notify(`连接失败：${String((err as Error)?.message ?? err)}`)
    } finally {
      setConnecting(false)
      void refreshSites()
    }
  }

  const rect = btnRef.current?.getBoundingClientRect()
  const menuStyle: Record<string, string> = rect
    ? { left: `${Math.min(rect.left, window.innerWidth - 260)}px`, bottom: `${window.innerHeight - rect.top + 6}px` }
    : { left: '16px', bottom: '96px' }

  return h(Fragment, null,
    h('button', {
      ref: btnRef,
      className: 'dsh-webrelay-btn',
      title: 'webrelay：优化提示词 / 与外部 AI 协作优化',
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
        // 未就绪时仍可点击：点击即尝试连接（不再做成死禁用）。
        'data-connect': !ready,
        disabled: connecting,
        onClick: () => {
          if (ready) {
            setMenuOpen(false)
            if (draft.length === 0) return void notify('请先在输入框写下你的需求草稿')
            void startCapture(props.sessionId, draft)
          } else {
            void connect()
          }
        },
      }, connecting
        ? '⏳ 正在连接外部浏览器…'
        : ready ? '⚡ 与外部 AI 协作优化' : '🔗 连接外部浏览器'),
      h('div', { className: 'dsh-webrelay-menu-note' },
        ready
          ? `已识别站点：${recognizedSite?.name}${recognizedSite?.experimental ? '（实验性）' : ''}；`
            + (draft.length === 0
              ? '请先在输入框写下需求，再点这项开始协作'
              : '将压缩上下文 → 优化 → 发送给它 → 等待回复 → 再次优化 → 写入输入框')
          : '尚未连接外部浏览器：点击上方按钮即可启动联动浏览器 / 打开面板加载站点'),
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
