/**
 * dsh-webrelay —— Host 半入口。
 *
 * 职责：注册自有 HTTP 路由（relay 代理 + JSON API）与智能体工具，全部经
 * ctx.effect 挂接，卸载即净。依赖策略与 router/dsh-GreaterClarity-plugin 一致：
 * 只 inject 'webServer'，其余服务（llm / tools）运行时懒取，缺失时对应功能
 * 降级报错而不是拒绝整个插件加载 —— 兼容性优先。
 *
 * 路由（全部 /dsh-webrelay/ 前缀，信任判据见 http-util.ts）：
 *   ANY  /dsh-webrelay/proxy/<rid>/<target-url>  反向代理（站点白名单）
 *   GET  /dsh-webrelay/api/sites                 站点列表（含 DOM 适配器）
 *   POST /dsh-webrelay/api/sites/manage          站点管理（添加/删除/隐藏/排序/重置）
 *   POST /dsh-webrelay/api/optimize              提示词优化（text/plain 流式回传）
 *   GET  /dsh-webrelay/api/captures              捕获列表
 *   POST /dsh-webrelay/api/captures              保存捕获
 *   GET  /dsh-webrelay/api/captures/read?file=   读取单条捕获
 */
import { loadConfig, type WebrelayConfig } from './config.js'
import { manageSites } from './site-manage.js'
import { CookieJar, handleProxy, parseProxyPath } from './relay.js'
import { buildAdapterExpression, adapterTestPageHtml } from './page-adapter.js'
import { findTab, listTargets, openSiteTab, evaluateOnTarget, detectBrowserPath, resolveBrowser, launchBrowser, probePort, BROWSER_PROFILE_ROOT } from './cdp.js'
import { optimizePrompt, type LlmLike } from './optimize.js'
import { listCaptures, readCapture, saveCapture } from './captures.js'
import { registerCapturesTool } from './tools.js'
import { readBody, rejectUntrusted, respondError, respondJson, trustedRequest } from './http-util.js'
import { recentContext } from './context.js'
import type { SessionQueryLike } from './types.js'

export const name = 'dsh-webrelay'
export const inject = ['webServer']

interface WebServerLike {
  register(opts: { kind: 'exact' | 'prefix', path: string, handler: (req: any, res: any) => void }): () => void
}

/**
 * 宿主上下文的最小结构面（不 import cordis 类型，保持零依赖）。
 * 注意：未列入 inject 的服务一律经 ctx.get() 懒取（cordis 对属性访问有 inject 守卫）。
 */
interface HostContext {
  effect(fn: () => unknown, name?: string): unknown
  get(service: string): unknown
  webServer: WebServerLike
}

export function apply(ctx: HostContext): void {
  const jar = new CookieJar()
  const config = (): WebrelayConfig => loadConfig()
  const disposers: Array<() => void> = []

  /** 结构化懒取服务：缺服务时抛出可读错误，而不是让插件拒载。 */
  const lazyService = <T,>(serviceName: string): T => {
    const service = ctx.get(serviceName)
    if (service === undefined || service === null) {
      throw new Error(`dsh-webrelay: service "${serviceName}" is not available in this profile`)
    }
    return service as T
  }

  // ── relay 反向代理 ──
  disposers.push(ctx.webServer.register({
    kind: 'prefix',
    path: '/dsh-webrelay/proxy',
    handler: (req, res) => {
      if (!trustedRequest(req)) return rejectUntrusted(res)
      // handler 收到的 req.url 是完整路径；prefix 命中已由 webServer 保证。
      const parsed = parseProxyPath(req.url ?? '')
      if (!parsed) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('dsh-webrelay: malformed proxy path')
        return
      }
      void handleProxy({ config, jar }, parsed.rid, parsed.target, req, res)
    },
  }))

  // ── 站点列表（client 面板/识别/适配执行器共用） ──
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-webrelay/api/sites',
    handler: (req, res) => {
      if (!trustedRequest(req)) return rejectUntrusted(res)
      const c = config()
      const factoryIds = new Set(['deepseek', 'chatgpt', 'doubao', 'qianwen', 'gemini'])
      respondJson(res, 200, {
        ok: true,
        sites: c.sites.map((s) => ({
          id: s.id,
          name: s.name,
          home: s.home,
          match: s.match,
          experimental: s.experimental,
          hidden: s.hidden,
          openIn: s.openIn,
          browser: s.browser,
          source: factoryIds.has(s.id) ? 'factory' : 'custom',
          adapter: s.adapter,
        })),
        browsers: [
          { id: 'default', label: '默认联动浏览器', type: 'chrome', port: c.cdp.port },
          ...c.browsers.map((b) => ({ id: b.id, label: b.label, type: b.type, port: b.port })),
        ],
        deleted: c.deleted,
      })
    },
  }))

  // ── 站点管理（写回用户 sites.yml；结构化写回会覆盖手写注释） ──
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-webrelay/api/sites/manage',
    handler: async (req, res) => {
      if (!trustedRequest(req)) return rejectUntrusted(res)
      try {
        const body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>
        const result = manageSites(body)
        respondJson(res, result.ok ? 200 : 400, result)
      } catch (err) {
        respondError(res, err)
      }
    },
  }))

  // ── CDP 专用联动浏览器（状态 / 启动 / 打开站点 / 中继注入） ──
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-webrelay/api/cdp/status',
    handler: async (req, res) => {
      if (!trustedRequest(req)) return rejectUntrusted(res)
      try {
        const cfg = config()
        // 默认实例 + 用户实例表，逐一探测端口并列标签页。
        const instances: Array<Record<string, unknown>> = []
        const probe = async (id: string, label: string, type: string, port: number) => {
          let running = false
          let targets: Array<{ id: string, title: string, url: string }> = []
          try {
            targets = await listTargets(port)
            running = true
          } catch { /* 未启动 */ }
          instances.push({ id, label, type, port, running, targets })
        }
        await probe('default', '默认联动浏览器', 'chrome', cfg.cdp.port)
        for (const b of cfg.browsers) {
          if (b.id === 'default') continue
          await probe(b.id, b.label, b.type, b.port)
        }
        respondJson(res, 200, {
          ok: true,
          profileRoot: BROWSER_PROFILE_ROOT,
          headless: cfg.cdp.headless,
          instances,
        })
      } catch (err) {
        respondError(res, err)
      }
    },
  }))

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-webrelay/api/cdp/launch',
    handler: async (req, res) => {
      if (!trustedRequest(req)) return rejectUntrusted(res)
      try {
        const body = JSON.parse((await readBody(req)) || '{}') as { siteId?: unknown }
        const siteId = typeof body.siteId === 'string' ? body.siteId : ''
        const cfg = config()
        const site = cfg.sites.find((s) => s.id === siteId)
        const browser = site
          ? resolveBrowser(cfg, site)
          : { id: 'default', label: '默认', type: 'chrome' as const, port: cfg.cdp.port, browserPath: detectBrowserPath('chrome', cfg.cdp.browserPath), userDataDir: `${BROWSER_PROFILE_ROOT}\default`, profile: 'Default' }
        const result = await launchBrowser(browser, cfg.cdp.headless, undefined, cfg.cdp.startupTimeoutMs)
        respondJson(res, result.ok ? 200 : 400, result.ok ? { ok: true, port: browser.port } : { ok: false, error: result.error })
      } catch (err) {
        respondError(res, err)
      }
    },
  }))

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-webrelay/api/cdp/open',
    handler: async (req, res) => {
      if (!trustedRequest(req)) return rejectUntrusted(res)
      try {
        const body = JSON.parse((await readBody(req)) || '{}') as { siteId?: unknown }
        const siteId = typeof body.siteId === 'string' ? body.siteId : ''
        if (siteId.length === 0) throw new Error('siteId is required')
        const cfg = config()
        const site = cfg.sites.find((s) => s.id === siteId)
        if (!site) throw new Error(`未知站点：${siteId}`)
        const result = await openSiteTab(cfg, site)
        respondJson(res, result.ok ? 200 : 400, result.ok ? { ok: true, target: result.target } : { ok: false, error: result.error })
      } catch (err) {
        respondError(res, err)
      }
    },
  }))

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-webrelay/api/cdp/relay',
    handler: async (req, res) => {
      if (!trustedRequest(req)) return rejectUntrusted(res)
      try {
        const body = JSON.parse((await readBody(req)) || '{}') as { siteId?: unknown, message?: unknown }
        const siteId = typeof body.siteId === 'string' ? body.siteId : ''
        const message = typeof body.message === 'string' ? body.message : ''
        if (siteId.length === 0) throw new Error('siteId is required')
        if (message.trim().length === 0) throw new Error('message is required')
        const cfg = config()
        const site = cfg.sites.find((s) => s.id === siteId)
        if (!site) throw new Error(`未知站点：${siteId}`)
        const browser = resolveBrowser(cfg, site)
        if (!await probePort(browser.port)) {
          const ensured = await openSiteTab(cfg, site)
          if (!ensured.ok) throw new Error(ensured.error ?? '联动浏览器不可用')
        }
        const found = await findTab(browser, site)
        if (!found.target) throw new Error(found.error ?? '未找到联动标签页')
        const outcome = await evaluateOnTarget(
          browser.port,
          found.target.id,
          buildAdapterExpression(site, message),
        ) as { ok: boolean, value?: unknown, error?: string }
        if (!outcome.ok) throw new Error(outcome.error ?? '页面执行失败')
        const value = outcome.value as { ok?: boolean, reply?: string, url?: string, error?: string }
        if (!value?.ok) throw new Error(value?.error ?? '适配器执行失败')
        respondJson(res, 200, { ok: true, reply: value.reply, url: value.url })
      } catch (err) {
        respondError(res, err)
      }
    },
  }))

  // ── 适配器自测页（最小"聊天页"夹具，配合临时站点条目验证 CDP 注入链路） ──
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-webrelay/adapter-test',
    handler: (req, res) => {
      if (!trustedRequest(req)) return rejectUntrusted(res)
      try {
        const html = adapterTestPageHtml()
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
        res.end(html)
      } catch {
        try { res.end() } catch { /* gone */ }
      }
    },
  }))

  // ── 提示词优化（流式） ──
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-webrelay/api/optimize',
    handler: async (req, res) => {
      if (!trustedRequest(req)) return rejectUntrusted(res)
      try {
        const body = JSON.parse((await readBody(req)) || '{}') as {
          draft?: unknown, context?: unknown, provider?: unknown, model?: unknown
        }
        const draft = typeof body.draft === 'string' ? body.draft : ''
        if (draft.trim().length === 0) throw new Error('draft is required')
        const context = typeof body.context === 'string' ? body.context : undefined
        const provider = typeof body.provider === 'string' && body.provider.length > 0 ? body.provider : undefined
        const model = typeof body.model === 'string' && body.model.length > 0 ? body.model : undefined
        const cfg = config()
        const llm = lazyService<LlmLike>('llm')
        // text/plain chunked 流式回传增量文本；client 用 fetch reader 逐段渲染。
        res.writeHead(200, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
          'Transfer-Encoding': 'chunked',
        })
        const result = await optimizePrompt(
          llm,
          { draft, context, provider, model },
          { temperature: cfg.optimize.temperature, maxTokens: cfg.optimize.maxTokens, model: { provider: cfg.optimize.provider, model: cfg.optimize.model }, reasoningEffort: cfg.optimize.reasoningEffort },
          (delta) => {
            try { res.write(delta) } catch { /* socket gone */ }
          },
        )
        res.end()
        const logger = ctx.get('logger') as { debug?(...args: unknown[]): void } | undefined
        logger?.debug?.(`dsh-webrelay: optimized via ${result.provider}/${result.model} (${result.text.length} chars)`)
      } catch (err) {
        // 头已发出时只能截断流；否则回 JSON 错误。
        if (res.headersSent) {
          try { res.end('\n[dsh-webrelay] 优化失败：' + String((err as Error)?.message ?? err)) } catch { /* gone */ }
          return
        }
        respondError(res, err)
      }
    },
  }))

  // ── 捕获列表 / 保存 / 读取 ──
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-webrelay/api/captures',
    handler: async (req, res) => {
      if (!trustedRequest(req)) return rejectUntrusted(res)
      try {
        const cfg = config()
        if (req.method === 'POST') {
          const body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>
          const site = typeof body.site === 'string' ? body.site : 'unknown'
          const reply = typeof body.reply === 'string' ? body.reply : ''
          if (reply.trim().length === 0) throw new Error('reply is required')
          const saved = saveCapture(cfg.capture.dir, {
            site,
            siteName: typeof body.siteName === 'string' ? body.siteName : site,
            url: typeof body.url === 'string' ? body.url : '',
            prompt: typeof body.prompt === 'string' ? body.prompt : '',
            reply,
          })
          respondJson(res, 200, { ok: true, capture: { file: saved.file, createdAt: saved.createdAt } })
        } else {
          respondJson(res, 200, { ok: true, captures: listCaptures(cfg.capture.dir, cfg.capture.recentLimit) })
        }
      } catch (err) {
        respondError(res, err)
      }
    },
  }))

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-webrelay/api/captures/read',
    handler: (req, res) => {
      if (!trustedRequest(req)) return rejectUntrusted(res)
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const file = url.searchParams.get('file') ?? ''
        const cfg = config()
        const entry = readCapture(cfg.capture.dir, file)
        if (!entry) throw new Error('capture not found')
        respondJson(res, 200, { ok: true, capture: entry })
      } catch (err) {
        respondError(res, err)
      }
    },
  }))

  // ── 对话流背景（client 传 sessionId，host 读全量事件压成转写） ──
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-webrelay/api/context',
    handler: async (req, res) => {
      if (!trustedRequest(req)) return rejectUntrusted(res)
      try {
        const body = JSON.parse((await readBody(req)) || '{}') as { sessionId?: unknown, limit?: unknown }
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
        if (sessionId.length === 0) throw new Error('sessionId is required')
        const limit = typeof body.limit === 'number' && body.limit > 0 ? Math.min(Math.floor(body.limit), 40) : 10
        const sessionQuery = lazyService<SessionQueryLike>('sessionQuery')
        const context = await recentContext(sessionQuery, sessionId, limit)
        respondJson(res, 200, { ok: true, context })
      } catch (err) {
        respondError(res, err)
      }
    },
  }))

  // ── 智能体工具（tools 服务缺失时静默跳过） ──
  registerCapturesTool(ctx, () => config().capture)

  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
  })
}
