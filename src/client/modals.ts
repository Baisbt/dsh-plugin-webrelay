/**
 * dsh-webrelay —— 弹窗组（portal 渲染到 body）：
 *   optimize      选项一：优化结果（可编辑），[撤回][重新生成][插入输入框]
 *   relay-preview 选项二：发送预览（背景 + 优化提示词，可编辑），[撤回][重新生成][发送到浏览器]
 *   relay-wait    选项二：发送等待（可取消）
 *   capture       抓取结果（可编辑），[保存][插入输入框][复制][关闭]
 */
import { createElement as h, Fragment, useEffect, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { getState, patchModal, useStore, notify } from './state.js'
import { cancelWait, confirmSend, insertIntoInput, regenerate, saveCapture, withdraw } from './flow.js'
import { SiteManagerDialog } from './site-manager.js'

export function ModalRoot(): ReactElement | null {
  const modal = useStore().modal
  if (!modal) return null
  const dialog = h('div', { className: 'dsh-webrelay-dialog', onMouseDown: stopPropagation },
    modal.kind === 'optimize' && h(Fragment, { key: 'o' }, OptimizeDialog(modal)),
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

function useEscape(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') withdraw() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
}

function OptimizeDialog(modal: Extract<import('./state.js').ModalState, { kind: 'optimize' }>): ReactNode {
  useEscape()
  const streaming = modal.phase === 'streaming'
  return [
    h('div', { className: 'dsh-webrelay-dialog-head' },
      '✨ 优化提示词',
      h('span', { className: 'dsh-webrelay-dialog-target' }, '仅展示，不会发送'),
    ),
    h('textarea', {
      className: 'dsh-webrelay-textarea',
      value: modal.text,
      readOnly: streaming,
      placeholder: streaming ? '优化中…' : '',
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => patchModal({ text: e.target.value }),
    }),
    modal.error && h('div', { className: 'dsh-webrelay-error' }, modal.error),
    h('div', { className: 'dsh-webrelay-actions' },
      h('button', { className: 'dsh-webrelay-btn2', onClick: withdraw }, '撤回'),
      h('button', {
        className: 'dsh-webrelay-btn2', disabled: streaming,
        onClick: () => void regenerate(),
      }, streaming ? '优化中…' : '重新生成'),
      h('button', {
        className: 'dsh-webrelay-btn2', 'data-primary': true, disabled: streaming || modal.text.trim().length === 0,
        onClick: () => insertIntoInput(modal.text),
      }, '插入输入框'),
    ),
  ]
}

function RelayPreviewDialog(modal: Extract<import('./state.js').ModalState, { kind: 'relay-preview' }>): ReactNode {
  useEscape()
  const streaming = modal.phase === 'streaming'
  const site = getState().sites.find((s) => s.id === getState().recognizedSiteId)
  return [
    h('div', { className: 'dsh-webrelay-dialog-head' },
      '⚡ 中继发送预览',
      h('span', { className: 'dsh-webrelay-dialog-target' }, `目标：${site?.name ?? '未识别站点'}`),
    ),
    modal.context.length > 0 && h('details', { className: 'dsh-webrelay-context' },
      h('summary', { style: { cursor: 'pointer' } }, '对话流背景（已并入下方消息，可展开查看）'),
      h('div', { style: { whiteSpace: 'pre-wrap', marginTop: '6px' } }, modal.context),
    ),
    h('textarea', {
      className: 'dsh-webrelay-textarea',
      value: modal.text,
      readOnly: streaming,
      placeholder: streaming ? '优化中…' : '',
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => patchModal({ text: e.target.value }),
    }),
    modal.error && h('div', { className: 'dsh-webrelay-error' }, modal.error),
    h('div', { className: 'dsh-webrelay-actions' },
      h('button', { className: 'dsh-webrelay-btn2', onClick: withdraw }, '撤回'),
      h('button', {
        className: 'dsh-webrelay-btn2', disabled: streaming,
        onClick: () => void regenerate(),
      }, streaming ? '优化中…' : '重新生成'),
      h('button', {
        className: 'dsh-webrelay-btn2', 'data-primary': true, disabled: streaming,
        onClick: () => void confirmSend(),
      }, streaming ? '等待优化…' : '发送到浏览器'),
    ),
  ]
}

function RelayWaitDialog(modal: Extract<import('./state.js').ModalState, { kind: 'relay-wait' }>): ReactNode {
  return [
    h('div', { className: 'dsh-webrelay-dialog-head' }, '⚡ 正在中继发送'),
    h('div', { className: 'dsh-webrelay-wait' },
      h('div', { className: 'dsh-webrelay-spinner' }),
      h('span', null, modal.status),
    ),
    h('div', { className: 'dsh-webrelay-actions' },
      h('button', { className: 'dsh-webrelay-btn2', onClick: cancelWait }, '取消'),
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
