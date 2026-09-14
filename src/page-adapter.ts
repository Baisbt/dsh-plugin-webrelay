/**
 * dsh-webrelay —— 页面适配器表达式生成器。
 *
 * 把"填入 → 发送 → 等待生成结束 → 抓取回复"编译为一段在目标页面内执行的
 * async IIFE 字符串（经 CDP Runtime.evaluate 注入）。选择器语义与
 * src/client/relay-run.ts（iframe 同源路径）保持一致：候选选择器链、
 * contenteditable execCommand 写入、generating 标记 + 回复文本稳定判定。
 * 改动发送/等待逻辑时请同步两处。
 */
import type { SiteConfig } from './config.js'

export interface AdapterOutcome {
  ok: boolean
  reply: string
  url: string
  error?: string
}

export function buildAdapterExpression(site: SiteConfig, message: string): string {
  const payload = JSON.stringify({
    selectors: site.adapter,
    message,
  })
  return `(async () => {
  const { selectors, message } = ${payload};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isVisible = (el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  };
  const queryOne = (list) => {
    for (const sel of list) {
      let els;
      try { els = document.querySelectorAll(sel); } catch { continue; }
      for (const el of els) if (isVisible(el)) return el;
    }
    return null;
  };
  const fillTextarea = (el, text) => {
    const desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    if (desc && desc.set) desc.set.call(el, text); else el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const fillEditable = (el, text) => {
    el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    el.focus();
    const sel = getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch (e) { ok = false; }
    if (!ok) {
      el.textContent = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
    }
  };
  const pressEnter = (el) => {
    const init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent('keydown', init));
    el.dispatchEvent(new KeyboardEvent('keyup', init));
  };
  const clickSend = () => {
    const btn = queryOne(selectors.send || []);
    if (btn) { btn.click(); return true; }
    return false;
  };
  const replyCount = () => {
    for (const sel of selectors.replies) {
      try {
        const n = document.querySelectorAll(sel).length;
        if (n > 0) return n;
      } catch (e) {}
    }
    return 0;
  };
  const lastReply = () => {
    for (const sel of selectors.replies) {
      let els;
      try { els = document.querySelectorAll(sel); } catch (e) { continue; }
      for (let i = els.length - 1; i >= 0; i--) {
        const text = (els[i].innerText || '').trim();
        if (text) return text;
      }
    }
    return '';
  };
  const generating = () => queryOne(selectors.generating || []) !== null;

  const input = queryOne(selectors.input);
  if (!input) return { ok: false, reply: '', url: location.href, error: '未找到对话框输入框（可在 sites.yml 修正该站点的 adapter.input 选择器）' };
  if (input.tagName === 'TEXTAREA') fillTextarea(input, message);
  else if (selectors.inputContentEditable || input.isContentEditable) fillEditable(input, message);
  else fillTextarea(input, message);
  await sleep(400);

  if (selectors.sendMode === 'click') {
    if (!clickSend()) return { ok: false, reply: '', url: location.href, error: '未找到发送按钮（可修正 adapter.send 或把 sendMode 改为 enter）' };
  } else {
    pressEnter(input);
    if (selectors.sendMode === 'enter-then-click') {
      await sleep(600);
      clickSend();
    }
  }

  const before = replyCount();
  const deadline = Date.now() + 180000;
  let stable = 0;
  let lastText = '';
  while (Date.now() < deadline) {
    await sleep(500);
    const busy = generating();
    const text = lastReply();
    if (!busy && text) {
      if (text === lastText) stable++; else stable = 0;
      lastText = text;
      if (stable >= 3 && (replyCount() > before || before === 0)) break;
    } else {
      stable = 0;
    }
  }
  if (!lastText) return { ok: false, reply: '', url: location.href, error: '等待超时且未抓取到回复：站点可能已改版（修正 adapter.replies / adapter.generating），或发送未成功' };
  return { ok: true, reply: lastText, url: location.href };
})()`
}

/**
 * 只读抓取表达式：读取联动标签页当前正文（只读路径，CDP 模式）。
 *
 * 与 buildAdapterExpression 同样优先用 replies 选择器（拿到干净的对话/正文节点），
 * 未命中则退化为 body.innerText。**不注入、不发送、不改状态**——纯粹读操作。
 */
export function buildCaptureExpression(site: SiteConfig): string {
  const payload = JSON.stringify({ replies: site.adapter.replies })
  return `(() => {
  const { replies } = ${payload};
  const parts = [];
  for (const sel of (replies || [])) {
    let els;
    try { els = document.querySelectorAll(sel); } catch (e) { continue; }
    if (!els || els.length === 0) continue;
    for (const el of els) {
      const text = (el.innerText || '').trim();
      if (text) parts.push(text);
    }
    break;
  }
  if (parts.length > 0) return { ok: true, raw: parts.join('\\n\\n---\\n\\n'), url: location.href };
  const body = (document.body && document.body.innerText || '').trim();
  if (!body) return { ok: false, raw: '', url: location.href, error: '页面正文为空（站点可能仍在加载或已改版）' };
  return { ok: true, raw: body, url: location.href };
})()`
}

/**
 * 外发表达式（选项二 S3 + S4，CDP 模式）：填入 → 提交 → 等待生成结束 → 取回最后一条回复。
 *
 * 与 buildAdapterExpression（旧"中继发送"）的差别：
 *   - 只在**已存在**的标签页上操作（续接当前对话，不新建会话、不动导航）；
 *   - 把"上一次回复内容"记为基线，只在本轮回复**与基线不同**时才判定完成，
 *     避免慢站点上"还没开始生成就抓到上一条回复"的竞态。
 *   - 超时后不立即失败：把已经抓到的文本一并返回，由用户决定是续等还是采用。
 *
 * 安全：本表达式会代用户提交内容，仅在用户点击闪电按钮后经本函数执行。
 */
export function buildSendExpression(site: SiteConfig, message: string, timeoutMs: number): string {
  const payload = JSON.stringify({ selectors: site.adapter, message, timeoutMs })
  return `(async () => {
  const { selectors, message, timeoutMs } = ${payload};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isVisible = (el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  };
  const queryOne = (list) => {
    for (const sel of (list || [])) {
      let els;
      try { els = document.querySelectorAll(sel); } catch (e) { continue; }
      for (const el of els) if (isVisible(el)) return el;
    }
    return null;
  };
  const fillTextarea = (el, text) => {
    const desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    if (desc && desc.set) desc.set.call(el, text); else el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const fillEditable = (el, text) => {
    el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    el.focus();
    const sel = getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch (e) { ok = false; }
    if (!ok) {
      el.textContent = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
    }
  };
  const pressEnter = (el) => {
    const init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent('keydown', init));
    el.dispatchEvent(new KeyboardEvent('keyup', init));
  };
  const clickSend = () => {
    const btn = queryOne(selectors.send || []);
    if (btn) { btn.click(); return true; }
    return false;
  };
  const replyCount = () => {
    for (const sel of (selectors.replies || [])) {
      try {
        const n = document.querySelectorAll(sel).length;
        if (n > 0) return n;
      } catch (e) {}
    }
    return 0;
  };
  const lastReply = () => {
    for (const sel of (selectors.replies || [])) {
      let els;
      try { els = document.querySelectorAll(sel); } catch (e) { continue; }
      for (let i = els.length - 1; i >= 0; i--) {
        const text = (els[i].innerText || '').trim();
        if (text) return text;
      }
    }
    return '';
  };
  const generating = () => queryOne(selectors.generating || []) !== null;

  const input = queryOne(selectors.input);
  if (!input) return { ok: false, reply: '', url: location.href, error: '未找到对话框输入框（可在 sites.yml 修正该站点的 adapter.input 选择器）' };

  const baseline = lastReply();
  const before = replyCount();

  if (input.tagName === 'TEXTAREA') fillTextarea(input, message);
  else if (selectors.inputContentEditable || input.isContentEditable) fillEditable(input, message);
  else fillTextarea(input, message);
  await sleep(400);

  if (selectors.sendMode === 'click') {
    if (!clickSend()) return { ok: false, reply: '', url: location.href, error: '未找到发送按钮（可修正 adapter.send 或把 sendMode 改为 enter）' };
  } else {
    pressEnter(input);
    if (selectors.sendMode === 'enter-then-click') {
      await sleep(600);
      clickSend();
    }
  }

  const deadline = Date.now() + timeoutMs;
  let sawGenerating = false;
  let stable = 0;
  let lastText = '';
  while (Date.now() < deadline) {
    await sleep(500);
    const busy = generating();
    if (busy) { sawGenerating = true; stable = 0; continue; }
    const text = lastReply();
    // 完成判据：内容非空、与发送前的基线不同、且连续三次稳定（生成已收尾）。
    if (text && text !== baseline) {
      if (text === lastText) stable++; else { stable = 1; lastText = text; }
      if (stable >= 3 && (sawGenerating || replyCount() > before)) {
        return { ok: true, reply: text, url: location.href, timedOut: false };
      }
    } else {
      stable = 0;
    }
  }
  // 超时：把已抓到的部分一并带回（若与基线相同则视为没等到新回复）。
  const partial = lastReply();
  const gotNew = partial && partial !== baseline;
  return {
    ok: false,
    reply: gotNew ? partial : '',
    url: location.href,
    timedOut: true,
    error: gotNew
      ? '等待外部回复超时（已抓到部分内容，可继续等待或直接采用）'
      : '等待外部回复超时：站点可能已改版（修正 adapter.replies / adapter.generating），或发送未成功',
  };
})()`
}

/** 适配器自测页：一个最小"聊天页"夹具，用于验证注入/等待/抓取全链路（无需真实站点账号）。 */
export function adapterTestPageHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>webrelay adapter test</title></head>
<body style="font-family:sans-serif;max-width:640px;margin:40px auto">
<h3>dsh-webrelay 适配器自测页</h3>
<div id="replies"></div>
<textarea id="chat-input" placeholder="输入消息"></textarea>
<button id="send">发送</button>
<script>
  var n = 0;
  function send() {
    var input = document.getElementById('chat-input');
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    var replies = document.getElementById('replies');
    var marker = document.createElement('div');
    marker.id = 'generating';
    marker.textContent = '生成中…';
    document.body.appendChild(marker);
    setTimeout(function () {
      marker.remove();
      n += 1;
      var div = document.createElement('div');
      div.className = 'ds-markdown';
      div.textContent = '回复 #' + n + '：' + text;
      replies.appendChild(div);
    }, 2500);
  }
  document.getElementById('send').addEventListener('click', send);
  document.getElementById('chat-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); send(); }
  });
</script>
</body></html>`
}
