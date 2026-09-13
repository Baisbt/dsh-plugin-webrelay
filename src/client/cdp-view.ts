/**
 * dsh-webrelay —— CDP 联动视图（openIn: 'cdp' 的站点在面板中的呈现）。
 * 显示联动浏览器状态、目标标签页，提供启动/打开动作；注入抓取由闪电按钮选项二触发。
 */
import { createElement as h, useEffect, useState, type ReactElement } from 'react'
import { apiCdpLaunch, apiCdpOpen, apiCdpStatus, notify, type CdpStatus, type SiteInfo } from './state.js'

export function CdpLinkageView({ site }: { site: SiteInfo }): ReactElement {
  const [status, setStatus] = useState<CdpStatus | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = async (): Promise<void> => {
    const s = await apiCdpStatus()
    setStatus(s)
  }

  useEffect(() => { void refresh() }, [])

  const launch = async (): Promise<void> => {
    setBusy(true)
    const r = await apiCdpLaunch()
    setBusy(false)
    if (!r.ok) return notify(r.error ?? '启动失败')
    await refresh()
  }

  const open = async (): Promise<void> => {
    setBusy(true)
    const r = await apiCdpOpen(site.id)
    setBusy(false)
    if (!r.ok) return notify(r.error ?? '打开失败')
    await refresh()
  }

  const running = status?.running === true
  const siteTab = status?.targets.find((t) => {
    try {
      const host = new URL(t.url).hostname.toLowerCase()
      return site.match.some((m) => host === m || host.endsWith('.' + m))
    } catch {
      return false
    }
  })

  return h('div', { className: 'dsh-webrelay-system-note' },
    h('div', { style: { fontSize: '13px', lineHeight: 1.8, padding: '0 8px', maxWidth: '460px' } },
      h('div', null,
        '联动浏览器：',
        h('b', null, running ? `已连接（端口 ${status?.port}）` : '未启动'),
      ),
      h('div', { style: { opacity: 0.7, fontSize: '12px' } }, `独立配置目录：${status?.profileDir ?? '…'}`),
      h('div', { style: { opacity: 0.7, fontSize: '12px' } },
        siteTab
          ? `联动标签页：${siteTab.title || siteTab.url}`
          : running ? '尚无该站点的联动标签页' : '首次使用请先启动，再打开站点并登录一次'),
      h('div', { style: { opacity: 0.55, fontSize: '11px', marginTop: '4px' } },
        '在联动模式下，闪电按钮「整理上下文并发送到浏览器」会注入到真实标签页并抓取回复。'),
    ),
    h('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } },
      !running && h('button', { className: 'dsh-webrelay-btn2', 'data-primary': true, disabled: busy, onClick: () => void launch() }, '启动联动浏览器'),
      running && h('button', { className: 'dsh-webrelay-btn2', 'data-primary': true, disabled: busy, onClick: () => void open() }, siteTab ? '激活站点标签页' : '打开站点标签页'),
      h('button', { className: 'dsh-webrelay-btn2', disabled: busy, onClick: () => void refresh() }, '刷新状态'),
    ),
  )
}
