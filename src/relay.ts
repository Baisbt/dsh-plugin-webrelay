/**
 * dsh-webrelay —— relay 反向代理。
 *
 * 路径形态：/dsh-webrelay/proxy/<rid>/<target-url>（target 为原始 URL，含 scheme）。
 * rid 是浏览器面板每次打开生成的会话 id：per-rid 内存 Cookie jar 的键，
 * 也让 iframe 内发起的所有子请求天然携带会话上下文。
 *
 * 设计要点：
 *  - 仅回环 + Origin 同源（http-util.trustedRequest）；
 *  - 目标 host 必须命中站点 match 白名单，防开放代理；
 *  - 3xx 手动转发（Location 重写回代理前缀），Cookie 逐跳进出 jar；
 *  - HTML 响应执行重写（去 CSP meta、注 <base>、改写属性、注入 fetch/XHR/EventSource shim），
 *    其余内容类型流式透传（fetch 已自动解压，不回传 content-encoding/content-length）。
 */
import { Readable } from 'node:stream'
import { matchSite, type RelayConfig, type WebrelayConfig } from './config.js'

interface JarEntry {
  name: string
  value: string
  host: string
}

/** per-rid 内存 Cookie jar：进程生命周期内有效，重启即清空（不落盘，不存凭据）。 */
export class CookieJar {
  private jars = new Map<string, JarEntry[]>()
  private sweeps = new Map<string, ReturnType<typeof setTimeout>>()

  private jar(rid: string): JarEntry[] {
    let jar = this.jars.get(rid)
    if (!jar) {
      jar = []
      this.jars.set(rid, jar)
      // 8 小时无活动自动回收，防内存缓慢累积。
      this.sweeps.set(rid, setTimeout(() => { this.jars.delete(rid); this.sweeps.delete(rid) }, 8 * 3600 * 1000))
    }
    return jar
  }

  store(rid: string, host: string, setCookieValues: string[]): void {
    if (setCookieValues.length === 0) return
    const jar = this.jar(rid)
    for (const raw of setCookieValues) {
      const eq = raw.indexOf('=')
      const semi = raw.indexOf(';')
      if (eq <= 0) continue
      const name = raw.slice(0, eq).trim()
      const end = semi >= 0 && semi > eq ? semi : raw.length
      const value = raw.slice(eq + 1, end)
      if (name.length === 0) continue
      const existing = jar.findIndex((c) => c.name === name && c.host === host)
      if (end === raw.length && value === '') {
        if (existing >= 0) jar.splice(existing, 1)
        continue
      }
      const entry: JarEntry = { name, value, host }
      if (existing >= 0) jar[existing] = entry
      else jar.push(entry)
    }
  }

  header(rid: string, host: string): string | undefined {
    const jar = this.jars.get(rid)
    if (!jar || jar.length === 0) return undefined
    const relevant = jar.filter((c) => host === c.host || host.endsWith('.' + c.host) || c.host.endsWith('.' + host))
    if (relevant.length === 0) return undefined
    return relevant.map((c) => `${c.name}=${c.value}`).join('; ')
  }
}

const HOP_HEADERS = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
])

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** 解析 /dsh-webrelay/proxy/<rid>/<target...>；失败返回 null。 */
export function parseProxyPath(pathname: string): { rid: string; target: URL } | null {
  const prefix = '/dsh-webrelay/proxy/'
  if (!pathname.startsWith(prefix)) return null
  const rest = pathname.slice(prefix.length)
  const slash = rest.indexOf('/')
  if (slash <= 0) return null
  const rid = rest.slice(0, slash)
  const targetRaw = rest.slice(slash + 1)
  if (!/^[0-9a-f]{8,64}$/i.test(rid)) return null
  let target: URL
  try {
    target = new URL(decodeURI(targetRaw))
  } catch {
    try { target = new URL(encodeURI(targetRaw)) } catch { return null }
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return null
  return { rid, target }
}

/** HTML 内联 shim：把页面运行期的同源绝对路径请求改写回代理前缀。 */
export function buildShim(rid: string, targetOrigin: string): string {
  const PREFIX = `/dsh-webrelay/proxy/${rid}/`
  return `<script data-dsh-webrelay-shim>(function(){
'use strict';
var PREFIX = ${JSON.stringify(PREFIX)};
var ORIGIN = ${JSON.stringify(targetOrigin)};
function toProxy(u){
  try {
    if (typeof u !== 'string' || u.length === 0) return u;
    if (u.indexOf(PREFIX) === 0) return u;
    if (u.charAt(0) === '/') return PREFIX + ORIGIN + u;
    if (/^https?:\\/\\//i.test(u)) {
      var p = new URL(u);
      return PREFIX + p.origin + p.pathname + p.search;
    }
    return u;
  } catch (e) { return u; }
}
var of = window.fetch;
if (of) {
  window.fetch = function(input, init){
    try {
      if (typeof input === 'string') input = toProxy(input);
      else if (input && typeof input.url === 'string') input = new Request(toProxy(input.url), input);
    } catch (e) {}
    return of.call(this, input, init);
  };
}
var oo = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function(){
  try { arguments[1] = toProxy(arguments[1]); } catch (e) {}
  return oo.apply(this, arguments);
};
if (window.EventSource) {
  var OE = window.EventSource;
  function PatchedES(u, cfg){ return new OE(toProxy(u), cfg); }
  PatchedES.prototype = OE.prototype;
  try { window.EventSource = PatchedES; } catch (e) {}
}
var ps = history.pushState, rs = history.replaceState;
function fixU(u){
  try { if (typeof u === 'string' && u.charAt(0) === '/') return PREFIX + ORIGIN + u; } catch (e) {}
  return u;
}
if (ps) history.pushState = function(s, t, u){ return ps.call(history, s, t, fixU(u)); };
if (rs) history.replaceState = function(s, t, u){ return rs.call(history, s, t, fixU(u)); };
})();</script>`
}

const ATTR_RE = /\s(href|src|action|formaction)\s*=\s*("([^"]*)"|'([^']*)')/gi
const CSP_META_RE = /<meta\s+[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi

/** HTML 重写：解 CSP 限制 + 让相对/同源 URL 落回代理。 */
export function rewriteHtml(html: string, rid: string, target: URL, config: WebrelayConfig): string {
  const PREFIX = `/dsh-webrelay/proxy/${rid}/`
  let out = html.replace(CSP_META_RE, '')
  // 先做属性级 URL 改写，再注入 base/shim（注入内容自身不能被再次改写）。
  out = out.replace(ATTR_RE, (full, attr: string, _q: string, dq: string, sq: string) => {
    const url = (dq !== undefined ? dq : sq) ?? ''
    if (url.length === 0) return full
    let rewritten: string | null = null
    if (url.startsWith('/')) rewritten = `${PREFIX}${target.origin}${url}`
    else if (url.startsWith('//')) rewritten = `${PREFIX}https:${url}`
    else if (/^https?:\/\//i.test(url)) {
      try {
        const p = new URL(url)
        // 白名单外的绝对 URL 保持原样（外跳）。
        if (matchSite(config, p.hostname)) {
          rewritten = `${PREFIX}${p.origin}${p.pathname}${p.search}`
        }
      } catch { /* keep */ }
    }
    return rewritten === null ? full : ` ${attr}="${rewritten}"`
  })
  if (config.relay.injectShim) {
    const shim = buildShim(rid, target.origin)
    if (/<head[^>]*>/i.test(out)) {
      out = out.replace(/<head[^>]*>/i, (m) => m + shim)
    } else {
      out = shim + out
    }
  }
  // 相对资源锚定到目标路径目录（target 无尾斜杠时按其目录处理）。
  const dir = target.pathname.endsWith('/') ? target.pathname : target.pathname.replace(/[^/]*$/, '/')
  const baseTag = `<base href="${PREFIX}${target.origin}${dir}">`
  if (/<base\s/i.test(out)) {
    out = out.replace(/<base\s[^>]*>/i, baseTag)
  } else if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head[^>]*>/i, (m) => m + baseTag)
  } else {
    out = baseTag + out
  }
  return out
}

export interface RelayDeps {
  config: () => WebrelayConfig
  jar: CookieJar
  log?: (msg: string) => void
}

/** 处理一条代理请求（handler 已完成前缀匹配与信任校验）。 */
export async function handleProxy(deps: RelayDeps, rid: string, target: URL, req: any, res: any): Promise<void> {
  const config = deps.config()
  const site = matchSite(config, target.hostname)
  if (!site) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('dsh-webrelay: target host is not in the configured site list')
    return
  }
  const relayCfg = config.relay
  const jarHeader = deps.jar.header(rid, target.hostname)
  const headers: Record<string, string> = {
    accept: typeof req.headers.accept === 'string' ? req.headers.accept : '*/*',
    'accept-language': typeof req.headers['accept-language'] === 'string' ? req.headers['accept-language'] : 'zh-CN,zh;q=0.9,en;q=0.8',
    'user-agent': typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : DEFAULT_UA,
    host: target.host,
  }
  const contentType = req.headers['content-type']
  if (typeof contentType === 'string') headers['content-type'] = contentType
  const referer = req.headers.referer
  if (typeof referer === 'string' && referer.length > 0) {
    // 上游期望的 Referer 是它自己的 origin（尽力还原，失败不阻断）。
    try {
      const r = new URL(referer)
      const m = parseProxyPath(r.pathname)
      headers.referer = m ? `${m.target.origin}/` : `${target.origin}/`
    } catch { /* drop */ }
  }
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin.length > 0) headers.origin = target.origin
  if (jarHeader) headers.cookie = jarHeader

  const method = (req.method ?? 'GET').toUpperCase()
  const hasBody = method !== 'GET' && method !== 'HEAD'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), relayCfg.upstreamTimeoutMs)
  let upstream: Response
  try {
    upstream = await fetch(target, {
      method,
      headers,
      body: hasBody ? Readable.toWeb(req) as unknown as BodyInit : undefined,
      redirect: 'manual',
      signal: controller.signal,
      // undici 默认拒绝向目标发送手动声明的 host 头以外的东西；duplex 需要显式声明流式 body。
      ...(hasBody ? { duplex: 'half' } as { duplex: 'half' } : {}),
    } as RequestInit)
  } catch (err) {
    clearTimeout(timer)
    try {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(`dsh-webrelay: upstream fetch failed: ${(err as Error)?.message ?? err}`)
    } catch { /* socket gone */ }
    return
  }
  clearTimeout(timer)

  // Set-Cookie 逐跳进 jar（去 Domain/Secure 语义，按 host 记账）。
  const setCookies = collectSetCookies(upstream.headers)
  deps.jar.store(rid, target.hostname, setCookies)

  // 响应头：剥限制头 + 跳过头（fetch 已解压）。
  const outHeaders: Record<string, string> = {}
  upstream.headers.forEach((value, name) => {
    const n = name.toLowerCase()
    if (HOP_HEADERS.has(n) || n === 'content-encoding' || n === 'content-length' || n === 'set-cookie') return
    if (relayCfg.stripHeaders.includes(n)) return
    outHeaders[name] = value
  })

  // 3xx：Location 重写回代理命名空间，让浏览器在代理空间内继续跳转。
  if (upstream.status >= 300 && upstream.status < 400) {
    const location = upstream.headers.get('location')
    if (location) {
      let next: URL | null = null
      try { next = new URL(location, target) } catch { /* keep */ }
      outHeaders['location'] = next ? `${`/dsh-webrelay/proxy/${rid}/`}${next.href}` : location
    }
    res.writeHead(upstream.status, outHeaders)
    res.end()
    return
  }

  const contentTypeHeader = upstream.headers.get('content-type') ?? ''
  if (contentTypeHeader.includes('text/html')) {
    const html = await upstream.text()
    const body = rewriteHtml(html, rid, target, config)
    outHeaders['content-type'] = 'text/html; charset=utf-8'
    outHeaders['cache-control'] = 'no-store'
    delete outHeaders['content-length']
    res.writeHead(upstream.status, outHeaders)
    res.end(body)
    return
  }

  res.writeHead(upstream.status, outHeaders)
  if (upstream.body) {
    const stream = Readable.fromWeb(upstream.body as any)
    stream.on('error', () => { try { res.destroy() } catch { /* gone */ } })
    stream.pipe(res)
  } else {
    res.end()
  }
}

function collectSetCookies(headers: Headers): string[] {
  const anyHeaders = headers as Headers & { getSetCookie?: () => string[] }
  if (typeof anyHeaders.getSetCookie === 'function') return anyHeaders.getSetCookie()
  const single = headers.get('set-cookie')
  return single ? [single] : []
}
