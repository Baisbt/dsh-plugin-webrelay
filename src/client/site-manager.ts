/**
 * dsh-webrelay —— 站点管理弹窗。
 * 配置显性展示（文件路径 + 全部站点）+ 添加 / 排序 / 隐藏 / 删除 / 重置 / 恢复全部默认。
 * 全部操作经 POST /dsh-webrelay/api/sites/manage 写回用户 sites.yml。
 */
import { createElement as h, useState, type ReactNode } from 'react'
import { apiManage, getState, notify, refreshSitesIntoState, type SiteInfo } from './state.js'
import { withdraw } from './flow.js'

function siteBadges(site: SiteInfo): string[] {
  const badges: string[] = []
  badges.push(site.source === 'factory' ? '出厂' : '自定义')
  if (site.experimental) badges.push('实验性')
  if (site.hidden) badges.push('已隐藏')
  if (site.openIn === 'system') badges.push('当前浏览器')
  return badges
}

export function SiteManagerDialog(): ReactNode {
  const sites = getState().sites
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async (fn: () => Promise<{ ok: boolean, error?: string }>): Promise<void> => {
    setBusy(true)
    const result = await fn()
    setBusy(false)
    if (!result.ok) return notify(result.error ?? '操作失败')
    await refreshSitesIntoState()
  }

  const move = (id: string, delta: -1 | 1): void => {
    const ids = sites.map((s) => s.id)
    const i = ids.indexOf(id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    void run(() => apiManage('reorder', { ids }))
  }

  const add = async (): Promise<void> => {
    if (url.trim().length === 0) return notify('请填写网址')
    setAdding(false)
    await run(() => apiManage('add', { name: name.trim(), url: url.trim() }))
    setName('')
    setUrl('')
  }

  return [
    h('div', { className: 'dsh-webrelay-dialog-head' },
      '🗂 站点管理',
      h('span', { className: 'dsh-webrelay-dialog-target' }, '$DSH_HOME/webrelay/sites.yml'),
    ),
    h('div', { className: 'dsh-webrelay-site-list' },
      sites.map((site, index) => h('div', { key: site.id, className: 'dsh-webrelay-site-row', 'data-hidden': site.hidden },
        h('div', { className: 'dsh-webrelay-site-info' },
          h('div', { className: 'dsh-webrelay-site-line' },
            h('span', { className: 'dsh-webrelay-site-name' }, site.name),
            siteBadges(site).map((b) => h('span', { key: b, className: 'dsh-webrelay-site-badge' }, b)),
          ),
          h('div', { className: 'dsh-webrelay-site-meta' }, site.home),
        ),
        h('div', { className: 'dsh-webrelay-site-ops' },
          h('button', {
            className: 'dsh-webrelay-mini', title: '上移', disabled: busy || index === 0,
            onClick: () => move(site.id, -1),
          }, '↑'),
          h('button', {
            className: 'dsh-webrelay-mini', title: '下移', disabled: busy || index === sites.length - 1,
            onClick: () => move(site.id, 1),
          }, '↓'),
          h('button', {
            className: 'dsh-webrelay-mini', title: site.hidden ? '在页签显示' : '从页签隐藏（识别与代理仍生效）',
            disabled: busy,
            onClick: () => void run(() => apiManage('hide', { id: site.id, hidden: !site.hidden })),
          }, site.hidden ? '显示' : '隐藏'),
          h('button', {
            className: 'dsh-webrelay-mini',
            title: '打开方式循环切换：内置（iframe，可自动注入）→ 联动（专用浏览器，可自动注入）→ 浏览器（当前浏览器，手动）',
            disabled: busy,
            onClick: () => {
              const next = site.openIn === 'relay' ? 'cdp' : site.openIn === 'cdp' ? 'system' : 'relay'
              void run(() => apiManage('openIn', { id: site.id, openIn: next }))
            },
          }, site.openIn === 'relay' ? '改为联动' : site.openIn === 'cdp' ? '改为浏览器' : '改为内置'),
          h('button', {
            className: 'dsh-webrelay-mini', title: '恢复出厂适配器与默认设置（自定义站点则整体还原为可出厂合并状态）',
            disabled: busy,
            onClick: () => void run(() => apiManage('reset-site', { id: site.id })),
          }, '重置'),
          h('button', {
            className: 'dsh-webrelay-mini', 'data-danger': true, title: site.source === 'factory' ? '从页签移除（写入 deleted 列表，可重置恢复）' : '删除该站点',
            disabled: busy,
            onClick: () => {
              if (!window.confirm(`删除站点「${site.name}」？${site.source === 'factory' ? '（出厂站点会移入已删除列表，可用"重置"恢复）' : ''}`)) return
              void run(() => apiManage('remove', { id: site.id }))
            },
          }, '删除'),
        ),
      )),
    ),
    adding
      ? h('div', { className: 'dsh-webrelay-add-form' },
        h('input', {
          className: 'dsh-webrelay-input', placeholder: '显示名称（可留空）', value: name,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value),
        }),
        h('input', {
          className: 'dsh-webrelay-input', placeholder: 'https:// 对话页网址', value: url,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setUrl(e.target.value),
        }),
        h('button', { className: 'dsh-webrelay-btn2', 'data-primary': true, disabled: busy, onClick: () => void add() }, '添加'),
        h('button', { className: 'dsh-webrelay-btn2', onClick: () => setAdding(false) }, '取消'),
      )
      : h('div', { className: 'dsh-webrelay-actions', style: { justifyContent: 'flex-start' } },
        h('button', { className: 'dsh-webrelay-btn2', disabled: busy, onClick: () => setAdding(true) }, '＋ 添加站点'),
        h('button', {
          className: 'dsh-webrelay-btn2', disabled: busy,
          title: '整份配置还原为出厂模板（含注释），自添加站点与排序等改动都会清除',
          onClick: () => {
            if (!window.confirm('恢复全部默认？用户配置将被还原为出厂模板。')) return
            void run(() => apiManage('reset-all'))
          },
        }, '恢复全部默认'),
      ),
    h('div', { className: 'dsh-webrelay-actions' },
      h('button', { className: 'dsh-webrelay-btn2', onClick: withdraw }, '完成'),
    ),
  ]
}
