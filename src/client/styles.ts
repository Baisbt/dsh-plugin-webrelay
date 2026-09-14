/**
 * dsh-webrelay —— 样式。全部类名 dsh-webrelay-* 前缀，避免与宿主/其他插件冲突。
 */
export const STYLES = `
.dsh-webrelay-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; padding: 0;
  border: none; border-radius: 6px; background: transparent;
  color: var(--dsh-fg-muted, #9aa0a6); cursor: pointer; flex: none;
}
.dsh-webrelay-btn:hover, .dsh-webrelay-btn[aria-expanded="true"] { background: color-mix(in srgb, currentColor 12%, transparent); color: var(--dsh-fg, #e8eaed); }
.dsh-webrelay-btn svg { display: block; }

.dsh-webrelay-menu {
  position: fixed; z-index: 10020; min-width: 240px; padding: 6px;
  background: var(--dsh-bg-elevated, #2a2a2e); color: var(--dsh-fg, #e8eaed);
  border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
  border-radius: 10px; box-shadow: 0 8px 28px rgb(0 0 0 / 35%);
}
.dsh-webrelay-menu-item {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 8px 10px; border: none; border-radius: 7px;
  background: transparent; color: inherit; font-size: 13px; text-align: left; cursor: pointer;
}
.dsh-webrelay-menu-item:hover { background: color-mix(in srgb, currentColor 10%, transparent); }
.dsh-webrelay-menu-item[disabled] { opacity: 0.45; cursor: not-allowed; }
/* 未就绪但仍可点击：用于「🔗 连接外部浏览器」，与真正的禁用项区分开。 */
.dsh-webrelay-menu-item[data-connect="true"] {
  opacity: 1; cursor: pointer;
  color: var(--dsh-accent, #6aa8ff);
  background: color-mix(in srgb, var(--dsh-accent, #6aa8ff) 9%, transparent);
}
.dsh-webrelay-menu-item[data-connect="true"]:hover { background: color-mix(in srgb, var(--dsh-accent, #6aa8ff) 16%, transparent); }
.dsh-webrelay-menu-note { padding: 4px 10px 6px; font-size: 11px; opacity: 0.6; }

.dsh-webrelay-panel {
  position: absolute; top: 0; right: 0; bottom: 0; z-index: 9000;
  display: flex; flex-direction: column;
  background: var(--dsh-bg, #1b1b1f); color: var(--dsh-fg, #e8eaed);
  border-left: 1px solid color-mix(in srgb, currentColor 14%, transparent);
  box-shadow: -12px 0 32px rgb(0 0 0 / 30%);
  pointer-events: auto; min-width: 320px;
}
.dsh-webrelay-panel-drag {
  position: absolute; top: 0; left: -3px; bottom: 0; width: 7px;
  cursor: col-resize; z-index: 2;
}
.dsh-webrelay-panel-head {
  display: flex; align-items: center; gap: 6px; flex: none;
  padding: 8px 10px; border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
}
.dsh-webrelay-panel-title { font-size: 12px; font-weight: 600; opacity: 0.85; margin-right: 2px; }
.dsh-webrelay-site-tab {
  padding: 3px 9px; border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
  border-radius: 999px; background: transparent; color: inherit;
  font-size: 12px; cursor: pointer; white-space: nowrap;
}
.dsh-webrelay-site-tab:hover { background: color-mix(in srgb, currentColor 10%, transparent); }
.dsh-webrelay-site-tab[data-active="true"] { background: color-mix(in srgb, currentColor 16%, transparent); }
.dsh-webrelay-badge {
  margin-left: auto; padding: 2px 8px; border-radius: 999px; flex: none;
  font-size: 11px; background: color-mix(in srgb, #34a853 22%, transparent);
}
.dsh-webrelay-badge[data-unknown="true"] { background: color-mix(in srgb, #ea8600 22%, transparent); }
.dsh-webrelay-frame-wrap { position: relative; flex: 1; min-height: 0; background: #fff; }
.dsh-webrelay-frame { position: absolute; inset: 0; width: 100%; height: 100%; border: none; }
.dsh-webrelay-panel-foot {
  display: flex; align-items: center; gap: 6px; flex: none;
  padding: 6px 10px; border-top: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  font-size: 12px;
}
.dsh-webrelay-history {
  flex: none; max-height: 40%; overflow: auto;
  border-top: 1px solid color-mix(in srgb, currentColor 12%, transparent);
}
.dsh-webrelay-history-item {
  display: block; width: 100%; padding: 7px 12px; border: none; border-bottom: 1px solid color-mix(in srgb, currentColor 8%, transparent);
  background: transparent; color: inherit; text-align: left; cursor: pointer; font-size: 12px;
}
.dsh-webrelay-history-item:hover { background: color-mix(in srgb, currentColor 8%, transparent); }
.dsh-webrelay-history-item .dsh-webrelay-history-meta { opacity: 0.55; font-size: 11px; margin-top: 2px; }

.dsh-webrelay-backdrop {
  position: fixed; inset: 0; z-index: 10010;
  display: flex; align-items: center; justify-content: center;
  background: rgb(0 0 0 / 45%); pointer-events: auto;
}
.dsh-webrelay-dialog {
  display: flex; flex-direction: column; gap: 10px;
  width: min(680px, 92vw); max-height: 82vh; padding: 14px 16px;
  background: var(--dsh-bg-elevated, #2a2a2e); color: var(--dsh-fg, #e8eaed);
  border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
  border-radius: 12px; box-shadow: 0 16px 48px rgb(0 0 0 / 45%);
}
.dsh-webrelay-dialog-head { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; }
.dsh-webrelay-dialog-target { margin-left: auto; font-size: 11px; font-weight: 400; opacity: 0.6; }
.dsh-webrelay-context {
  max-height: 120px; overflow: auto; padding: 8px 10px;
  font-size: 12px; line-height: 1.5; white-space: pre-wrap; opacity: 0.75;
  background: color-mix(in srgb, currentColor 6%, transparent); border-radius: 8px;
}
.dsh-webrelay-textarea {
  flex: 1; min-height: 180px; resize: vertical; padding: 10px 12px;
  font: 13px/1.6 ui-sans-serif, system-ui, sans-serif; color: inherit;
  background: color-mix(in srgb, currentColor 6%, transparent);
  border: 1px solid color-mix(in srgb, currentColor 14%, transparent); border-radius: 8px;
}
.dsh-webrelay-textarea:focus { outline: 1px solid color-mix(in srgb, currentColor 30%, transparent); }
.dsh-webrelay-error { font-size: 12px; color: #f28b82; white-space: pre-wrap; }
.dsh-webrelay-wait { display: flex; align-items: center; gap: 10px; padding: 24px 4px; font-size: 13px; }
.dsh-webrelay-spinner {
  width: 16px; height: 16px; border-radius: 50%; flex: none;
  border: 2px solid color-mix(in srgb, currentColor 25%, transparent);
  border-top-color: currentColor; animation: dsh-webrelay-spin 0.9s linear infinite;
}
@keyframes dsh-webrelay-spin { to { transform: rotate(360deg); } }
.dsh-webrelay-actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
.dsh-webrelay-btn2 {
  padding: 6px 14px; border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  border-radius: 8px; background: transparent; color: inherit; font-size: 13px; cursor: pointer;
}
.dsh-webrelay-btn2:hover { background: color-mix(in srgb, currentColor 10%, transparent); }
.dsh-webrelay-btn2[data-primary="true"] { background: #4c7dff; border-color: #4c7dff; color: #fff; }
.dsh-webrelay-btn2[data-primary="true"]:hover { background: #3d6bef; }

.dsh-webrelay-site-list { flex: 1; min-height: 120px; overflow: auto; display: flex; flex-direction: column; gap: 4px; }
.dsh-webrelay-site-row {
  display: flex; align-items: center; gap: 8px; padding: 7px 10px;
  border: 1px solid color-mix(in srgb, currentColor 10%, transparent); border-radius: 8px;
}
.dsh-webrelay-site-row[data-hidden="true"] { opacity: 0.5; }
.dsh-webrelay-site-info { min-width: 0; flex: 1; }
.dsh-webrelay-site-line { display: flex; align-items: center; gap: 6px; }
.dsh-webrelay-site-name { font-size: 13px; font-weight: 600; }
.dsh-webrelay-site-badge {
  font-size: 10px; padding: 1px 6px; border-radius: 999px;
  background: color-mix(in srgb, currentColor 10%, transparent); opacity: 0.8;
}
.dsh-webrelay-site-meta { font-size: 11px; opacity: 0.55; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsh-webrelay-site-ops { display: flex; gap: 4px; flex: none; }
.dsh-webrelay-mini {
  padding: 3px 8px; font-size: 11px; border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
  border-radius: 6px; background: transparent; color: inherit; cursor: pointer;
}
.dsh-webrelay-mini:hover { background: color-mix(in srgb, currentColor 10%, transparent); }
.dsh-webrelay-mini[data-danger="true"]:hover { background: color-mix(in srgb, #f28b82 25%, transparent); }
.dsh-webrelay-add-form { display: flex; gap: 6px; flex-wrap: wrap; }
.dsh-webrelay-input {
  flex: 1; min-width: 140px; padding: 7px 10px; font-size: 13px; color: inherit;
  background: color-mix(in srgb, currentColor 6%, transparent);
  border: 1px solid color-mix(in srgb, currentColor 14%, transparent); border-radius: 8px;
}
/* ── 工作流提示（「本次提示词可能需要附件」等轻量告知） ── */
/* 纯文案行：不承载任何操作，也不触发任何文件读写，因此刻意做得极轻。 */
.dsh-webrelay-hint {
  display: flex; align-items: flex-start; gap: 6px;
  padding: 6px 9px; border-radius: 8px; font-size: 11px; line-height: 1.6;
  background: color-mix(in srgb, #4c7dff 8%, transparent);
  border: 1px solid color-mix(in srgb, #4c7dff 22%, transparent);
  opacity: 0.9;
}
.dsh-webrelay-hint[data-warn] {
  background: color-mix(in srgb, #ea8600 10%, transparent);
  border-color: color-mix(in srgb, #ea8600 30%, transparent);
}
.dsh-webrelay-hint-icon { flex: none; }
.dsh-webrelay-hint > span:last-child { flex: 1; }

.dsh-webrelay-system-note {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; text-align: center;
  background: var(--dsh-bg, #1b1b1f); color: var(--dsh-fg, #e8eaed); padding: 24px;
}

.dsh-webrelay-select {
  padding: 3px 6px; font-size: 11px; color: inherit;
  background: color-mix(in srgb, currentColor 6%, transparent);
  border: 1px solid color-mix(in srgb, currentColor 14%, transparent); border-radius: 6px;
}
.dsh-webrelay-browsers { display: flex; flex-direction: column; gap: 4px; }
.dsh-webrelay-browsers-head { font-size: 11px; opacity: 0.6; padding: 2px 2px; }

.dsh-webrelay-capture-list { width: 100%; max-height: 32%; overflow: auto; margin-top: 10px; }
`
