/**
 * dsh-webrelay —— 弹窗组（portal 渲染到 body）：
 *   optimize      选项二 S2：第一次优化（初稿，待外发）[撤回][重新生成][发送到浏览器]
 *   relay-wait    S3/S4：发送中 / 等待回复（带倒计时）[取消] 或超时[继续等待][采用已抓内容][撤回]
 *   relay-preview 选项二 S5：第二次优化（终稿）[撤回][重新生成][插入输入框]
 *   extract       单轮整理结果（可编辑）[撤回][重新整理][优化为提示词]
 *   capture       抓取结果（可编辑），[保存][插入输入框][复制][关闭]
 */
import { createElement as h, Fragment, useEffect, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  getState, patchModal, setState, useStore, notify,
} from './state.js'
import {
  adoptPartial, continueWaiting, insertIntoInput, insertOptimized, optimizeTidied,
  regenerate, resolveTargetSite, saveCapture, sendToBrowser, withdraw,
} from './flow.js'
import { attachHintApplies } from '../optimize.js'
import { SiteManagerDialog } from './site-manager.js'

export function ModalRoot(): ReactElement | null {
  const modal = useStore().modal
  // hook 必须无条件调用：此前 useEscape 只在部分弹窗里调用，弹窗切换时 hook 数量
// 变化触发 React #300，整个浮层子树被卸载（面板"关闭且无法再打开"的根源）。
  useEscape(modal?.kind !== 'sites')
  if (!modal) return null
  const dialog = h('div', { className: 'dsh-webrelay-dialog', onMouseDown: stopPropagation },
    modal.kind === 'optimize' && h(Fragment, { key: 'o' }, OptimizeDialog(modal)),
    modal.kind === 'extract' && h(Fragment, { key: 'x' }, ExtractDialog(modal)),
    modal.kind === 'relay-preview' && h(Fragment, { key: 'r' }, RelayPreviewDialog(modal)),
    modal.kind === 'relay-wait' && h(Fragment, { key: 'w' }, RelayWaitDialog(modal)),
    modal.kind === 'capture' && h(Fragment, { key: 'c' }, CaptureDialog(modal)),
    modal.kind === 'sites' && h(Fragment, { key: 's' }, h(SiteManagerDialog)),
  )
  return createPortal(
    h('div', { className: 'dsh-webrelay-backdrop', onMouseDown: modal.kind === 'sites' ? undefined : withdraw }, dialog),
    document.body,
  )
}

function stopPropagation(e: React.MouseEvent): void {
  e.stopPropagation()
}

function useEscape(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') withdraw() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [enabled])
}

/** S2：第一次优化（初稿）。确认后发送到外部浏览器，才进入外发链路。 */
function OptimizeDialog(modal: Extract<import('./state.js').ModalState, { kind: 'optimize' }>): ReactNode {
  const streaming = modal.phase === 'streaming'
  const site = resolveTargetSite()
  return [
    h('div', { className: 'dsh-webrelay-dialog-head' },
      '⚡ 第 1 次优化（待外发）',
      h('span', { className: 'dsh-webrelay-dialog-target' },
        site ? `目标：${site.name}` : '确认后发送给外部浏览器'),
    ),
    h('div', { style: { fontSize: '11px', opacity: 0.55 } },
      '已结合对话上下文完成初步优化。点「发送到浏览器」把它投递给外部 AI，'
      + '回复到达后会再做第二次优化。'),
    h('textarea', {
      className: 'dsh-webrelay-textarea',
      value: modal.text,
      readOnly: streaming,
      placeholder: streaming ? '优化中…' : '',
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => patchModal({ text: e.target.value }),
    }),
    AttachHint(modal.attachHint),
    modal.error && h('div', { className: 'dsh-webrelay-error' }, modal.error),
    h('div', { className: 'dsh-webrelay-actions' },
      h('button', { className: 'dsh-webrelay-btn2', onClick: withdraw }, '撤回'),
      h('button', {
        className: 'dsh-webrelay-btn2', disabled: streaming,
        onClick: () => void regenerate(),
      }, streaming ? '优化中…' : '重新生成'),
      h('button', {
        className: 'dsh-webrelay-btn2', 'data-primary': true,
        disabled: streaming || modal.text.trim().length === 0,
        onClick: () => void sendToBrowser(),
      }, streaming ? '等待优化…' : '发送到浏览器 →'),
    ),
  ]
}

/**
 * 尾注「附件提示」条：**纯文案，没有任何控件**。
 *
 * 这是插件在附件这件事上的全部职责——只提醒"这次可能要带文件、大概是哪类"，
 * 不做检测、不读磁盘、不发起上传。用户看到后自行用目标页面自带的
 * 📎/回形针按钮把文件传上去，然后照常点「发送到浏览器」。
 *
 * 优化器判定不需要附件时（提示内容为"本次无需附件"）这里整块不渲染，
 * 避免每个弹窗都挂一条无信息量的提示。
 */
function AttachHint(hint: string | undefined): ReactNode {
  if (!hint || !attachHintApplies(hint)) return null
  return h('div', { className: 'dsh-webrelay-hint' },
    h('span', { className: 'dsh-webrelay-hint-icon' }, '📎'),
    h('span', null,
      `本次提示词可能需要附件——${hint}`,
      h('br'),
      h('span', { style: { opacity: 0.65 } },
        '请在外部浏览器里用页面自带的附件按钮上传；本插件不会读取或代传任何文件。'),
    ),
  )
}

function ExtractDialog(modal: Extract<import('./state.js').ModalState, { kind: 'extract' }>): ReactNode {
  const streaming = modal.phase === 'streaming'
  return [
    h('div', { className: 'dsh-webrelay-dialog-head' },
      '🧽 整理捕捉结果',
      h('span', { className: 'dsh-webrelay-dialog-target' }, `来源：${modal.siteName}`),
    ),
    h('div', { style: { fontSize: '11px', opacity: 0.55 } },
      '已从页面捕捉原文，并经模型去噪、还原结构；确认后将继续优化为提示词。'),
    h('textarea', {
      className: 'dsh-webrelay-textarea',
      value: modal.text,
      readOnly: streaming,
      placeholder: streaming ? '整理中…' : '（未整理出内容）',
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => patchModal({ text: e.target.value }),
    }),
    modal.error && h('div', { className: 'dsh-webrelay-error' }, modal.error),
    h('div', { className: 'dsh-webrelay-actions' },
      h('button', { className: 'dsh-webrelay-btn2', onClick: withdraw }, '撤回'),
      h('button', {
        className: 'dsh-webrelay-btn2',
        onClick: () => notify('原文已保留在本弹窗的「原始抓取」记录中；如需查看请重新捕捉'),
        title: `原始捕捉 ${modal.raw.length} 字符`,
      }, `原始 ${modal.raw.length} 字符`),
      h('button', {
        className: 'dsh-webrelay-btn2', disabled: streaming,
        onClick: () => void regenerate(),
      }, streaming ? '整理中…' : '重新整理'),
      h('button', {
        className: 'dsh-webrelay-btn2', 'data-primary': true,
        disabled: streaming || modal.text.trim().length === 0,
        onClick: () => void optimizeTidied(),
      }, streaming ? '整理中…' : '优化为提示词 →'),
    ),
  ]
}

/** S5：第二次优化（终稿）——已把外部回答消化进指令。 */
function RelayPreviewDialog(modal: Extract<import('./state.js').ModalState, { kind: 'relay-preview' }>): ReactNode {
  const streaming = modal.phase === 'streaming'
  const hasReply = modal.externalReply.trim().length > 0
  return [
    h('div', { className: 'dsh-webrelay-dialog-head' },
      '✨ 第 2 次优化（终稿）',
      h('span', { className: 'dsh-webrelay-dialog-target' }, '确认后写入输入框'),
    ),
    h('div', { style: { fontSize: '11px', opacity: 0.55 } },
      hasReply
        ? `已吸收外部回复（${modal.externalReply.length} 字符）并重写为最终指令；确认后写入输入框，不会自动发送。`
        : '已基于整理结果重写为最终指令；确认后写入输入框，不会自动发送。'),
    h('textarea', {
      className: 'dsh-webrelay-textarea',
      value: modal.text,
      readOnly: streaming,
      placeholder: streaming ? '优化中…' : '',
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => patchModal({ text: e.target.value }),
    }),
    AttachHint(modal.attachHint),
    modal.error && h('div', { className: 'dsh-webrelay-error' }, modal.error),
    h('div', { className: 'dsh-webrelay-actions' },
      h('button', { className: 'dsh-webrelay-btn2', onClick: withdraw }, '撤回'),
      hasReply && h('button', {
        className: 'dsh-webrelay-btn2',
        onClick: () => setState({ modal: { kind: 'capture', reply: modal.externalReply, url: '', site: '', siteName: '外部回复', prompt: modal.draft } }),
        title: '查看外部 AI 的原始回复',
      }, '查看外部回复'),
      h('button', {
        className: 'dsh-webrelay-btn2', disabled: streaming,
        onClick: () => void regenerate(),
      }, streaming ? '优化中…' : '重新生成'),
      h('button', {
        className: 'dsh-webrelay-btn2', 'data-primary': true,
        disabled: streaming || modal.text.trim().length === 0,
        onClick: () => insertOptimized(modal.text),
      }, streaming ? '等待优化…' : '插入输入框'),
    ),
  ]
}

/** S3/S4：发送与等待回复（带倒计时）；超时后转为可续等态。 */
function RelayWaitDialog(modal: Extract<import('./state.js').ModalState, { kind: 'relay-wait' }>): ReactNode {
  const remain = modal.remain ?? 0
  if (modal.timedOut) {
    const hasPartial = (modal.partial?.length ?? 0) > 0
    return [
      h('div', { className: 'dsh-webrelay-dialog-head' }, '⏱ 等待超时'),
      h('div', { style: { padding: '10px 2px', fontSize: '12px', lineHeight: 1.7 } }, modal.status),
      h('div', { className: 'dsh-webrelay-actions' },
        h('button', { className: 'dsh-webrelay-btn2', onClick: withdraw }, '撤回'),
        h('button', { className: 'dsh-webrelay-btn2', onClick: () => void continueWaiting() }, '继续等待'),
        hasPartial && h('button', {
          className: 'dsh-webrelay-btn2', 'data-primary': true,
          onClick: () => void adoptPartial(),
        }, '采用已抓内容 →'),
      ),
    ]
  }
  return [
    h('div', { className: 'dsh-webrelay-dialog-head' }, '⚡ 正在处理'),
    h('div', { className: 'dsh-webrelay-wait' },
      h('div', { className: 'dsh-webrelay-spinner' }),
      h('span', null, modal.status),
    ),
    remain > 0 && h('div', { style: { fontSize: '11px', opacity: 0.55, textAlign: 'center' } },
      `最长等待 ${remain}s ；超时后可继续等待或采用已抓内容`),
    h('div', { className: 'dsh-webrelay-actions' },
      h('button', { className: 'dsh-webrelay-btn2', onClick: withdraw }, '取消'),
    ),
  ]
}

function CaptureDialog(modal: Extract<import('./state.js').ModalState, { kind: 'capture' }>): ReactNode {
  const fromHistory = typeof modal.savedFile === 'string'
  return [
    h('div', { className: 'dsh-webrelay-dialog-head' },
      fromHistory ? '🗂 捕获记录' : '📥 外部 AI 回复',
      h('span', { className: 'dsh-webrelay-dialog-target' }, modal.siteName),
    ),
    h('textarea', {
      className: 'dsh-webrelay-textarea',
      value: modal.reply,
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => patchModal({ reply: e.target.value }),
    }),
    fromHistory && h('div', { style: { fontSize: '11px', opacity: 0.55 } }, `已存档：${modal.savedFile}`),
    h('div', { className: 'dsh-webrelay-actions' },
      !fromHistory && h('button', {
        className: 'dsh-webrelay-btn2',
        disabled: Boolean(modal.savedFile),
        onClick: () => void saveCapture(),
      }, modal.savedFile ? '已保存' : '保存'),
      h('button', {
        className: 'dsh-webrelay-btn2', 'data-primary': !fromHistory,
        onClick: () => insertIntoInput(modal.reply),
      }, '插入输入框'),
      h('button', {
        className: 'dsh-webrelay-btn2',
        onClick: () => {
          void navigator.clipboard.writeText(modal.reply).then(
            () => notify('已复制到剪贴板'),
            () => notify('复制失败：请手动选择文本复制'),
          )
        },
      }, '复制'),
      h('button', { className: 'dsh-webrelay-btn2', onClick: withdraw }, fromHistory ? '关闭' : '丢弃'),
    ),
  ]
}
