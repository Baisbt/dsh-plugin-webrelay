/**
 * dsh-webrelay —— 专用联动浏览器（CDP）管理：按"浏览器实例"运作。
 *
 * 实例 = 独立进程（独立调试端口 + 独立配置子目录 webrelay/browser-profile/<id>），
 * 同类型浏览器可经 --profile-directory 承载多个账户配置（用户在联动浏览器里
 * 通过 Chrome 头像菜单添加人员即可）。
 * 站点经 sites.<id>.browser 绑定实例；未绑定用默认实例（cdp 段配置）。
 *
 * 安全边界：调试端口仅回环；只对 URL 命中站点 match 白名单的标签页执行注入。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DSH_HOME, matchSite, type BrowserInstance, type SiteConfig, type WebrelayConfig } from './config.js'

export const BROWSER_PROFILE_ROOT = join(DSH_HOME, 'webrelay', 'browser-profile')

export interface CdpTarget {
  id: string
  title: string
  url: string
}

/** 站点解析出的具体联动浏览器（启动参数/端口的最终形态）。 */
export interface ResolvedBrowser {
  id: string
  label: string
  type: BrowserInstance['type']
  port: number
  browserPath: string | null
  userDataDir: string
  profile: string
}

interface CdpResponse {
  id?: number
  result?: { result?: { value?: unknown, type?: string }, exceptionDetails?: { exception?: { description?: string } } }
  error?: { message: string }
}

const CHROME_PATHS = (): string[] => {
  if (process.platform === 'win32') {
    const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files'
    const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
    const lap = process.env['LocalAppData'] ?? join(process.env.USERPROFILE ?? 'C:\\Users\\x', 'AppData', 'Local')
    return [
      join(pf, 'Google\\Chrome\\Application\\chrome.exe'),
      join(pf86, 'Google\\Chrome\\Application\\chrome.exe'),
      join(lap, 'Google\\Chrome\\Application\\chrome.exe'),
    ]
  }
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
}

const EDGE_PATHS = (): string[] => {
  if (process.platform === 'win32') {
    const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files'
    const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
    return [
      join(pf, 'Microsoft\\Edge\\Application\\msedge.exe'),
      join(pf86, 'Microsoft\\Edge\\Application\\msedge.exe'),
    ]
  }
  return ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
}

/** 按类型探测安装路径；custom 类型必须有显式 path。 */
export function detectBrowserPath(type: BrowserInstance['type'], explicit?: string | null): string | null {
  if (explicit && explicit.length > 0) return existsSync(explicit) ? explicit : explicit // 显式路径不校验存在性，交给启动报错
  if (type === 'custom') return null
  const candidates = type === 'edge' ? [...EDGE_PATHS(), ...CHROME_PATHS()] : [...CHROME_PATHS(), ...EDGE_PATHS()]
  return candidates.find((p) => existsSync(p)) ?? null
}

/** 把站点解析为其绑定的联动浏览器（未绑定 → 默认实例，取 cdp 段配置）。 */
export function resolveBrowser(config: WebrelayConfig, site: SiteConfig): ResolvedBrowser {
  const id = site.browser ?? 'default'
  const inst = config.browsers.find((b) => b.id === id)
  if (inst) {
    return {
      id: inst.id,
      label: inst.label,
      type: inst.type,
      port: inst.port,
      browserPath: detectBrowserPath(inst.type, inst.path),
      userDataDir: join(BROWSER_PROFILE_ROOT, inst.id),
      profile: inst.profile,
    }
  }
  return {
    id: 'default',
    label: '默认联动浏览器',
    type: 'chrome',
    port: config.cdp.port,
    browserPath: detectBrowserPath('chrome', config.cdp.browserPath),
    userDataDir: join(BROWSER_PROFILE_ROOT, 'default'),
    profile: 'Default',
  }
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

/** 启动实例（独立配置目录 + 账户配置），initialUrl 作为初始页（避免遗留 about:blank）。 */
export async function launchBrowser(browser: ResolvedBrowser, headless: boolean, initialUrl: string | undefined, startupTimeoutMs: number): Promise<{ ok: boolean, error?: string }> {
  if (await probePort(browser.port)) return { ok: true }
  const browserPath = browser.browserPath
  if (!browserPath) {
    return { ok: false, error: `未找到 ${browser.type === 'edge' ? 'Edge' : 'Chrome'}：请在 sites.yml 中为该实例指定 path` }
  }
  const args = [
    `--remote-debugging-port=${browser.port}`,
    `--user-data-dir=${browser.userDataDir}`,
    `--profile-directory=${browser.profile}`,
    '--no-first-run',
    '--no-default-browser-check',
  ]
  if (headless) args.push('--headless=new')
  args.push(initialUrl ?? 'about:blank')
  try {
    const child = spawn(browserPath, args, { detached: true, stdio: 'ignore' })
    child.unref()
  } catch (err) {
    return { ok: false, error: `启动浏览器失败：${String((err as Error)?.message ?? err)}` }
  }
  const deadline = Date.now() + startupTimeoutMs
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 400))
    if (await probePort(browser.port)) return { ok: true }
  }
  return { ok: false, error: `浏览器已启动但调试端口 ${browser.port} 未就绪（超时 ${startupTimeoutMs}ms）` }
}

/** 按站点 match 白名单在实例的标签页中查找。 */
export async function findTab(browser: ResolvedBrowser, site: SiteConfig): Promise<{ target?: CdpTarget, error?: string }> {
  const targets = await listTargets(browser.port)
  const hit = targets.find((t) => {
    try {
      const host = new URL(t.url).hostname.toLowerCase()
      return site.match.some((m) => host === m || host.endsWith('.' + m))
    } catch {
      return false
    }
  })
  if (!hit) return { error: `未找到「${site.name}」的联动标签页：请先打开该站点` }
  return { target: hit }
}

/**
 * 打开（或激活已存在的）站点标签页：
 *  - 已有匹配标签页 → 激活；
 *  - 首次（实例未启动）→ 以站点地址作为初始页直接启动（不产生 about:blank）；
 *  - 已启动但无匹配 → 复用遗留空白页导航，否则新开标签页。
 */
export async function openSiteTab(config: WebrelayConfig, site: SiteConfig): Promise<{ ok: boolean, target?: CdpTarget, error?: string }> {
  const browser = resolveBrowser(config, site)
  const wasRunning = await probePort(browser.port)
  if (!wasRunning) {
    const launched = await launchBrowser(browser, config.cdp.headless, site.home, config.cdp.startupTimeoutMs)
    if (!launched.ok) return { ok: false, error: launched.error }
    const found = await findTab(browser, site)
    if (found.target) return { ok: true, target: found.target }
    return { ok: false, error: found.error }
  }
  const found = await findTab(browser, site)
  if (found.target) {
    try {
      await fetchJson(`http://127.0.0.1:${browser.port}/json/activate/${found.target.id}`, 'PUT', 3000)
    } catch { /* 激活失败不阻断 */ }
    return { ok: true, target: found.target }
  }
  // 复用遗留空白页，避免标签页堆积。
  const targets = await listTargets(browser.port)
  const blank = targets.find((t) => t.url === 'about:blank' || t.url === '')
  if (blank) {
    await evaluateOnTarget(browser.port, blank.id, `location.href = ${JSON.stringify(site.home)}; true`, 15000)
    return { ok: true, target: { ...blank, url: site.home } }
  }
  try {
    const created = await fetchJson(
      `http://127.0.0.1:${browser.port}/json/new?${encodeURIComponent(site.home)}`,
      'PUT',
      6000,
    ) as Record<string, unknown>
    const target: CdpTarget = { id: String(created.id ?? ''), title: String(created.title ?? ''), url: String(created.url ?? site.home) }
    return { ok: true, target }
  } catch (err) {
    return { ok: false, error: `打开标签页失败：${String((err as Error)?.message ?? err)}` }
  }
}

/** 关闭站点的联动标签页。 */
export async function closeTab(browser: ResolvedBrowser, site: SiteConfig): Promise<{ ok: boolean, error?: string }> {
  const found = await findTab(browser, site)
  if (!found.target) return { ok: false, error: found.error ?? '未找到联动标签页' }
  try {
    await fetch(`http://127.0.0.1:${browser.port}/json/close/${found.target.id}`, { method: 'PUT' })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: `关闭标签页失败：${String((err as Error)?.message ?? err)}` }
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
