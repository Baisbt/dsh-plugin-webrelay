/**
 * dsh-webrelay —— 站点管理弹窗。
 * 配置显性展示（文件路径 + 全部站点）+ 添加 / 排序 / 隐藏 / 删除 / 重置 / 恢复全部默认。
 * 全部操作经 POST /dsh-webrelay/api/sites/manage 写回用户 sites.yml。
 */
import { createElement as h, useState, type ReactNode } from 'react'
import { apiManage, getState, notify, refreshSitesIntoState, type BrowserInfo, type SiteInfo } from './state.js'
import { withdraw } from './flow.js'

function siteBadges(site: SiteInfo): string[] {
  const badges: string[] = []
  badges.push(site.source === 'factory' ? '出厂' : '自定义')
  if (site.experimental) badges.push('实验性')
  if (site.hidden) badges.push('已隐藏')
  if (site.openIn === 'system') badges.push('当前浏览器')
  return badges
}

function BrowserSelect({ site, browsers, busy }: { site: SiteInfo, browsers: BrowserInfo[], busy: boolean }): ReactNode {
  if (site.openIn !== 'cdp') return null
  return h('select', {
    className: 'dsh-webrelay-select',
    title: '该站点联动使用的浏览器实例（实例在下方"联动浏览器"区维护）',
    disabled: busy,
    value: site.browser ?? 'default',
    onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
      const browser = e.target.value === 'default' ? null : e.target.value
      void (async () => {
        const r = await apiManage('bind-browser', { id: site.id, browser })
        if (!r.ok) return notify(r.error ?? '绑定失败')
        await refreshSitesIntoState()
      })()
    },
  },
    browsers.map((b) => h('option', { key: b.id, value: b.id }, `🧭 ${b.label}`)),
  )
}

export function SiteManagerDialog(): ReactNode {
  const sites = getState().sites
  const browsers = getState().browsers
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [browserAdding, setBrowserAdding] = useState(false)
  const [browserLabel, setBrowserLabel] = useState('')
  const [browserType, setBrowserType] = useState('chrome')
  const [browserProfile, setBrowserProfile] = useState('Default')
  const [editingBrowser, setEditingBrowser] = useState<string | null>(null)

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
          BrowserSelect({ site, browsers, busy }),
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
    browserAdding
      ? h('div', { className: 'dsh-webrelay-add-form' },
        h('input', {
          className: 'dsh-webrelay-input', placeholder: '实例名称（如 Edge 工作号）', value: browserLabel,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setBrowserLabel(e.target.value),
        }),
        h('select', {
          className: 'dsh-webrelay-select', value: browserType,
          onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setBrowserType(e.target.value),
        },
          h('option', { value: 'chrome' }, 'Chrome'),
          h('option', { value: 'edge' }, 'Edge'),
        ),
        h('input', {
          className: 'dsh-webrelay-input', placeholder: '账户配置目录名（Default / Profile 1…）', value: browserProfile,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setBrowserProfile(e.target.value),
        }),
        h('button', {
          className: 'dsh-webrelay-btn2', 'data-primary': true, disabled: busy,
          onClick: () => {
            if (browserLabel.trim().length === 0) return notify('请填写实例名称')
            setBrowserAdding(false)
            void run(async () => {
              const r = await apiManage('browser-add', { label: browserLabel.trim(), type: browserType, profile: browserProfile.trim() || 'Default' })
              if (r.ok) { setBrowserLabel(''); setBrowserProfile('') }
              return r
            })
          },
        }, '添加'),
        h('button', { className: 'dsh-webrelay-btn2', onClick: () => setBrowserAdding(false) }, '取消'),
      )
      : null,
    h('div', { className: 'dsh-webrelay-browsers' },
      h('div', { className: 'dsh-webrelay-browsers-head' }, '联动浏览器实例（联动站点按此绑定；账户在联动浏览器内用头像菜单添加）'),
      (browsers.length > 0 ? browsers : [{ id: 'default', label: '默认联动浏览器', type: 'chrome', port: 9222 } as BrowserInfo]).map((b) => h('div', { key: b.id, className: 'dsh-webrelay-site-row' },
        h('div', { className: 'dsh-webrelay-site-info' },
          editingBrowser === b.id
            ? h('div', { className: 'dsh-webrelay-add-form' },
              h('input', {
                className: 'dsh-webrelay-input', value: browserLabel, placeholder: '实例名称',
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => setBrowserLabel(e.target.value),
              }),
              h('select', {
                className: 'dsh-webrelay-select', value: browserType,
                onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setBrowserType(e.target.value),
              },
                h('option', { value: 'chrome' }, 'Chrome'),
                h('option', { value: 'edge' }, 'Edge'),
              ),
              h('input', {
                className: 'dsh-webrelay-input', value: browserProfile, placeholder: '账户配置目录名',
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => setBrowserProfile(e.target.value),
              }),
              h('button', {
                className: 'dsh-webrelay-btn2', 'data-primary': true, disabled: busy,
                onClick: () => {
                  setEditingBrowser(null)
                  void run(async () => {
                    const r = await apiManage('browser-edit', { browser: b.id, label: browserLabel.trim(), type: browserType, profile: browserProfile.trim() || 'Default' })
                    if (r.ok) setBrowserLabel('')
                    return r
                  })
                },
              }, '保存'),
              h('button', { className: 'dsh-webrelay-btn2', onClick: () => setEditingBrowser(null) }, '取消'),
            )
            : h('div', null,
              h('div', { className: 'dsh-webrelay-site-line' },
                h('span', { className: 'dsh-webrelay-site-name' }, b.label),
                h('span', { className: 'dsh-webrelay-site-badge' }, b.type),
                h('span', { className: 'dsh-webrelay-site-badge' }, `端口 ${b.port}`),
              ),
              h('div', { className: 'dsh-webrelay-site-meta' }, `账户配置：${b.id === 'default' ? 'Default（默认实例）' : '见编辑表单'}`),
            ),
        ),
        b.id !== 'default' && editingBrowser !== b.id && h('div', { className: 'dsh-webrelay-site-ops' },
          h('button', {
            className: 'dsh-webrelay-mini', title: '修改实例名称 / 浏览器类型 / 账户配置', disabled: busy,
            onClick: () => {
              setBrowserLabel(b.label)
              setBrowserType(b.type)
              setBrowserProfile(b.id === 'default' ? 'Default' : 'Default')
              setEditingBrowser(b.id)
            },
          }, '编辑'),
          h('button', {
            className: 'dsh-webrelay-mini', 'data-danger': true, disabled: busy,
            onClick: () => {
              if (!window.confirm(`删除联动浏览器「${b.label}」？绑定它的站点将回到默认实例。`)) return
              void run(() => apiManage('browser-remove', { browser: b.id }))
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
        h('button', { className: 'dsh-webrelay-btn2', disabled: busy, onClick: () => setBrowserAdding((v) => !v) }, '＋ 添加联动浏览器'),
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
