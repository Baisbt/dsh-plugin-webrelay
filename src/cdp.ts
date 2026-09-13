/**
 * dsh-webrelay —— 专用联动浏览器（CDP）管理。
 *
 * 一个独立配置目录的 Chromium 实例（默认 Chrome，找不到时回退 Edge），
 * 首次启动后用户在其中登录各站点，登录态长期保存在 $DSH_HOME/webrelay/browser-profile。
 * 插件经 http://127.0.0.1:<port>/json（发现）+ /devtools/page/<id>（WebSocket）操作标签页。
 *
 * 安全边界：调试端口仅回环；本模块只对 URL 命中站点 match 白名单的标签页执行注入
 * （白名单校验在调用方 index.ts 的 relay 路由完成，本模块的 findTab 提供 match 匹配）。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DSH_HOME, matchSite, type CdpConfig, type WebrelayConfig } from './config.js'

export const BROWSER_PROFILE_DIR = join(DSH_HOME, 'webrelay', 'browser-profile')

export interface CdpTarget {
  id: string
  title: string
  url: string
}

interface CdpResponse {
  id?: number
  result?: { result?: { value?: unknown, type?: string }, exceptionDetails?: { exception?: { description?: string } } }
  error?: { message: string }
}

/** Chrome/Edge 常见安装路径探测（Windows 优先，其次 PATH 常见 Unix 位置）。 */
export function detectBrowserPath(): string | null {
  const candidates: string[] = []
  if (process.platform === 'win32') {
    const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files'
    const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
    const lap = process.env['LocalAppData'] ?? join(process.env.USERPROFILE ?? 'C:\\Users\\x', 'AppData', 'Local')
    candidates.push(
      join(pf, 'Google\\Chrome\\Application\\chrome.exe'),
      join(pf86, 'Google\\Chrome\\Application\\chrome.exe'),
      join(lap, 'Google\\Chrome\\Application\\chrome.exe'),
      join(pf, 'Microsoft\\Edge\\Application\\msedge.exe'),
      join(pf86, 'Microsoft\\Edge\\Application\\msedge.exe'),
    )
  } else {
    candidates.push(
      '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
      '/opt/google/chrome/chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    )
  }
  return candidates.find((p) => existsSync(p)) ?? null
}

async function fetchJson(url: string, method = 'GET', timeoutMs = 4000): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { method, signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

/** 调试端口是否就绪。 */
export async function probePort(port: number): Promise<boolean> {
  try {
    await fetchJson(`http://127.0.0.1:${port}/json/version`, 'GET', 1500)
    return true
  } catch {
    return false
  }
}

/** 列出普通页面标签页（排除 devtools/扩展等）。 */
export async function listTargets(port: number): Promise<CdpTarget[]> {
  const raw = await fetchJson(`http://127.0.0.1:${port}/json/list`) as Array<Record<string, unknown>>
  return raw
    .filter((t) => t.type === 'page' && typeof t.id === 'string')
    .map((t) => ({ id: t.id as string, title: String(t.title ?? ''), url: String(t.url ?? '') }))
}

/** 启动专用实例（独立配置目录），并等待调试端口就绪。 */
export async function launchBrowser(config: CdpConfig): Promise<{ ok: boolean, error?: string, browserPath?: string }> {
  if (await probePort(config.port)) return { ok: true }
  const browserPath = config.browserPath ?? detectBrowserPath()
  if (!browserPath || !existsSync(browserPath)) {
    return { ok: false, error: '未找到 Chrome/Edge：请在 sites.yml 的 cdp.browserPath 手动指定浏览器路径' }
  }
  const args = [
    `--remote-debugging-port=${config.port}`,
    `--user-data-dir=${BROWSER_PROFILE_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=DialWifiPhase2Auth',
  ]
  if (config.headless) args.push('--headless=new')
  args.push('about:blank')
  try {
    const child = spawn(browserPath, args, { detached: true, stdio: 'ignore' })
    child.unref()
  } catch (err) {
    return { ok: false, error: `启动浏览器失败：${String((err as Error)?.message ?? err)}` }
  }
  const deadline = Date.now() + config.startupTimeoutMs
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 400))
    if (await probePort(config.port)) return { ok: true, browserPath }
  }
  return { ok: false, error: `浏览器已启动但调试端口 ${config.port} 未就绪（超时 ${config.startupTimeoutMs}ms）` }
}

/** 确保专用实例在跑：已监听则直接用；否则启动。 */
export async function ensureBrowser(config: CdpConfig): Promise<{ ok: boolean, error?: string }> {
  if (await probePort(config.port)) return { ok: true }
  return launchBrowser(config)
}

/** 按 URL 匹配查找标签页（命中站点 match 白名单）。 */
export async function findTab(config: WebrelayConfig, siteId: string): Promise<{ target?: CdpTarget, error?: string }> {
  const site = config.sites.find((s) => s.id === siteId)
  if (!site) return { error: `未知站点：${siteId}` }
  const targets = await listTargets(config.cdp.port)
  const hit = targets.find((t) => {
    try {
      return matchSite(config, new URL(t.url).hostname) !== undefined && site.match.some((m) => {
        const host = new URL(t.url).hostname.toLowerCase()
        return host === m || host.endsWith('.' + m)
      })
    } catch {
      return false
    }
  })
  if (!hit) return { error: `未找到「${site.name}」的联动标签页：请先在面板中打开该站点` }
  return { target: hit }
}

/** 打开（或激活已存在的）站点标签页，返回其 target。 */
export async function openSiteTab(config: WebrelayConfig, siteId: string): Promise<{ ok: boolean, target?: CdpTarget, error?: string }> {
  const site = config.sites.find((s) => s.id === siteId)
  if (!site) return { ok: false, error: `未知站点：${siteId}` }
  const ensured = await ensureBrowser(config.cdp)
  if (!ensured.ok) return { ok: false, error: ensured.error }
  const found = await findTab(config, siteId)
  if (found.target) {
    // 激活已有标签页并导航到入口地址（若停在其它页则回到 home）。
    try {
      await fetchJson(`http://127.0.0.1:${config.cdp.port}/json/activate/${found.target.id}`, 'PUT', 3000)
    } catch { /* 激活失败不阻断 */ }
    return { ok: true, target: found.target }
  }
  try {
    const created = await fetchJson(
      `http://127.0.0.1:${config.cdp.port}/json/new?${encodeURIComponent(site.home)}`,
      'PUT',
      6000,
    ) as Record<string, unknown>
    const target: CdpTarget = { id: String(created.id ?? ''), title: String(created.title ?? ''), url: String(created.url ?? site.home) }
    return { ok: true, target }
  } catch (err) {
    return { ok: false, error: `打开标签页失败：${String((err as Error)?.message ?? err)}` }
  }
}

/**
 * 在目标标签页执行一段 async 表达式并取回返回值。
 * 表达式须返回 Promise；awaitPromise + returnByValue。
 */
export async function evaluateOnTarget(port: number, targetId: string, expression: string, timeoutMs = 200_000): Promise<{ ok: boolean, value?: unknown, error?: string }> {
  const wsUrl = `ws://127.0.0.1:${port}/devtools/page/${targetId}`
  const ws = new WebSocket(wsUrl)
  const run = new Promise<{ ok: boolean, value?: unknown, error?: string }>((resolve, reject) => {
    const timer = setTimeout(() => {
      try { ws.close() } catch { /* ignore */ }
      reject(new Error(`页面执行超时（${timeoutMs}ms）`))
    }, timeoutMs)
    ws.onerror = () => {
      clearTimeout(timer)
      reject(new Error('CDP WebSocket 连接失败（浏览器可能刚重启，请重试）'))
    }
    ws.onopen = () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true, userGesture: true },
      }))
    }
    ws.onmessage = (event) => {
      let msg: CdpResponse
      try {
        msg = JSON.parse(String(event.data)) as CdpResponse
      } catch {
        return // 非 JSON 帧（事件等），忽略
      }
      if (msg.id !== 1) return
      clearTimeout(timer)
      if (msg.error) {
        resolve({ ok: false, error: msg.error.message })
        return
      }
      const details = msg.result?.exceptionDetails
      if (details) {
        resolve({ ok: false, error: details.exception?.description ?? '页面脚本异常' })
        return
      }
      resolve({ ok: true, value: msg.result?.result?.value })
    }
  })
  try {
    return await run
  } finally {
    try { ws.close() } catch { /* ignore */ }
  }
}
