/**
 * dsh-webrelay —— Client 半入口。
 * 职责：样式注入 + 槽位注册：
 *   conversation.input.right → 闪电按钮 + 面板开关（模型选择器左侧）
 *   shell.overlay            → 浏览器面板 / 弹窗 / 轻提示（additive 层，自绘停靠面板）
 * 全部经 ctx.effect 挂接，插件卸载即净。
 */
import { STYLES } from './styles.js'
import { fetchSites, getState, setState } from './state.js'
import { Lightning } from './lightning.js'
import { OverlayRoot } from './panel.js'

export const inject = ['slots']

// 调试探针：控制台可直接读写插件状态机（window.__DSH_WEBRELAY_DEBUG__.state()）。
;(() => {
  const w = window as unknown as Record<string, unknown>
  w.__DSH_WEBRELAY_DEBUG__ = { getState, setState }
})()

export function apply(ctx: any): void {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-webrelay'
    style.textContent = STYLES
    document.head.appendChild(style)
    return () => { style.remove() }
  })

  // 站点配置预取（失败静默：菜单/面板打开时会重试）。
  void fetchSites()
    .then((sites) => { if (sites.length > 0) setState({ sites }) })
    .catch(() => { /* ignore */ })

  // 闪电按钮：conversation.input.right 是 list 槽，DOM 序在模型选择器之前（additive，不冲突）。
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'dsh-webrelay-lightning',
    order: 40,
  }, Lightning))

  // 浏览器面板 / 弹窗 / 提示：shell.overlay 是 root 级 additive list 层。
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'dsh-webrelay-overlay',
    order: 20,
  }, OverlayRoot))
}
