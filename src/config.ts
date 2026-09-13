/**
 * dsh-webrelay —— 配置加载。
 *
 * 分两层：
 *   出厂默认  <包根>/sites.default.yml（随插件分发，只读）
 *   用户配置  $DSH_HOME/webrelay/sites.yml（首次运行自动从出厂默认复制，用户可随时编辑）
 *
 * 每次读取都重新解析（文件极小），因此用户编辑无需重启；解析失败回退出厂默认并保留 .bak。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_FILE = join(PACKAGE_ROOT, 'sites.default.yml')
export const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
export const WEBRELAY_DIR = join(DSH_HOME, 'webrelay')
const USER_FILE = join(WEBRELAY_DIR, 'sites.yml')

/** 单站 DOM 适配器：全部为候选选择器链，按序取第一个命中者。 */
export interface SiteAdapter {
  input: string[]
  inputContentEditable: boolean
  send: string[]
  sendMode: 'enter' | 'click' | 'enter-then-click'
  replies: string[]
  generating: string[]
}

export interface SiteConfig {
  id: string
  name: string
  home: string
  match: string[]
  experimental: boolean
  /** true = 不在面板页签显示，但识别与代理仍然有效。 */
  hidden: boolean
  /** relay = 内置 iframe（闪电按钮选项二可用）；system = 在用户当前浏览器新标签页打开（带登录态）。 */
  openIn: 'relay' | 'system'
  adapter: SiteAdapter
}

export interface RelayConfig {
  stripHeaders: string[]
  injectShim: boolean
  upstreamTimeoutMs: number
}

export interface OptimizeConfig {
  provider: string | null
  model: string | null
  temperature: number
  maxTokens: number
  /** 'off' 关闭思考链（默认）；null = 跟随模型默认。 */
  reasoningEffort: string | null
}

export interface CaptureConfig {
  dir: string | null
  recentLimit: number
}

export interface WebrelayConfig {
  sites: SiteConfig[]
  /** 用户已"删除"的出厂站点 id（出厂站点无法真删，会被默认模板合并回来）。 */
  deleted: string[]
  relay: RelayConfig
  optimize: OptimizeConfig
  capture: CaptureConfig
}

const SEND_MODES = new Set(['enter', 'click', 'enter-then-click'])

function strArray(v: unknown, fallback: string[]): string[] {
  if (!Array.isArray(v)) return fallback
  const out = v.filter((x): x is string => typeof x === 'string' && x.length > 0)
  return out.length > 0 || fallback.length === 0 ? out : fallback
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
}

function sanitizeAdapter(v: unknown): SiteAdapter {
  const r = asRecord(v)
  return {
    input: strArray(r.input, ['textarea', 'div[contenteditable="true"]']),
    inputContentEditable: r.inputContentEditable === true,
    send: strArray(r.send, []),
    sendMode: SEND_MODES.has(r.sendMode as string) ? r.sendMode as SiteAdapter['sendMode'] : 'enter',
    replies: strArray(r.replies, []),
    generating: strArray(r.generating, []),
  }
}

function sanitizeSite(id: string, v: unknown): SiteConfig | null {
  const r = asRecord(v)
  const match = strArray(r.match, []).map((m) => m.toLowerCase())
  if (match.length === 0 || typeof r.home !== 'string') return null
  return {
    id,
    name: typeof r.name === 'string' && r.name.length > 0 ? r.name : id,
    home: r.home,
    match,
    experimental: r.experimental === true,
    hidden: r.hidden === true,
    openIn: r.openIn === 'system' ? 'system' : 'relay',
    adapter: sanitizeAdapter(r.adapter),
  }
}

function sanitizeRelay(v: unknown): RelayConfig {
  const r = asRecord(v)
  return {
    stripHeaders: strArray(r.stripHeaders, [
      'x-frame-options',
      'content-security-policy',
      'content-security-policy-report-only',
      'cross-origin-opener-policy',
      'cross-origin-embedder-policy',
      'cross-origin-resource-policy',
    ]).map((h) => h.toLowerCase()),
    injectShim: r.injectShim !== false,
    upstreamTimeoutMs: typeof r.upstreamTimeoutMs === 'number' && r.upstreamTimeoutMs > 0 ? r.upstreamTimeoutMs : 60000,
  }
}

function sanitizeOptimize(v: unknown): OptimizeConfig {
  const r = asRecord(v)
  return {
    provider: typeof r.provider === 'string' && r.provider.length > 0 ? r.provider : null,
    model: typeof r.model === 'string' && r.model.length > 0 ? r.model : null,
    temperature: typeof r.temperature === 'number' && r.temperature >= 0 && r.temperature <= 2 ? r.temperature : 0.4,
    maxTokens: typeof r.maxTokens === 'number' && r.maxTokens > 0 ? Math.floor(r.maxTokens) : 4096,
    reasoningEffort: typeof r.reasoningEffort === 'string' && r.reasoningEffort.length > 0 ? r.reasoningEffort : 'off',
  }
}

function sanitizeCapture(v: unknown): CaptureConfig {
  const r = asRecord(v)
  return {
    dir: typeof r.dir === 'string' && r.dir.length > 0 ? r.dir : null,
    recentLimit: typeof r.recentLimit === 'number' && r.recentLimit > 0 ? Math.floor(r.recentLimit) : 30,
  }
}

function sanitizeConfig(raw: unknown): WebrelayConfig {
  const r = asRecord(raw)
  const sites: SiteConfig[] = []
  for (const [id, value] of Object.entries(asRecord(r.sites))) {
    const site = sanitizeSite(id, value)
    if (site) sites.push(site)
  }
  return {
    sites,
    deleted: [],
    relay: sanitizeRelay(r.relay),
    optimize: sanitizeOptimize(r.optimize),
    capture: sanitizeCapture(r.capture),
  }
}

function readYamlFile(path: string): unknown {
  return parseYaml(readFileSync(path, 'utf8'))
}

/** 出厂默认配置（包内 sites.default.yml）。 */
function loadDefaults(): WebrelayConfig {
  try {
    return sanitizeConfig(readYamlFile(DEFAULT_FILE))
  } catch (err) {
    // 出厂文件随包分发，缺失属于打包事故：给出最小可运行骨架，保证宿主不被拖垮。
    console.error('[dsh-webrelay] failed to load bundled sites.default.yml:', (err as Error)?.message)
    return sanitizeConfig({})
  }
}

/** 读取用户 sites.yml 的原始 YAML 对象（文件缺失/损坏时返回空对象，不抛错）。 */
export function readUserRaw(): Record<string, unknown> {
  try {
    if (!existsSync(USER_FILE)) return {}
    return asRecord(readYamlFile(USER_FILE))
  } catch {
    return {}
  }
}

/** 结构化写回用户 sites.yml（会覆盖手写注释；「恢复全部默认」走整文件还原不受影响）。 */
export function writeUserRaw(raw: Record<string, unknown>): void {
  mkdirSync(WEBRELAY_DIR, { recursive: true })
  const header = '# dsh-webrelay 用户配置（可手改，也可在插件"站点管理"界面维护）\n'
  writeFileSync(USER_FILE, header + stringifyYaml(raw), 'utf8')
}

let defaults: WebrelayConfig | undefined

/**
 * 生效配置 = 出厂默认 ⊕ 用户配置（浅层按键合并；sites 按站合并）。
 * 用户文件不存在时先复制出厂默认，方便用户直接改。
 * 站点顺序：用户文件里出现的站点排前（用户显式排序），其余出厂站点按原顺序殿后；
 * `deleted:` 列表里的出厂站点不参与合并（用户"删除"出厂站点的语义）。
 */
export function loadConfig(): WebrelayConfig {
  defaults ??= loadDefaults()
  if (!existsSync(USER_FILE)) {
    try {
      mkdirSync(WEBRELAY_DIR, { recursive: true })
      writeFileSync(USER_FILE, readFileSync(DEFAULT_FILE, 'utf8'), 'utf8')
    } catch {
      // 只读环境：继续用出厂默认
    }
  }
  if (!existsSync(USER_FILE)) return defaults
  try {
    const user = asRecord(readYamlFile(USER_FILE))
    const deleted = strArray(user.deleted, [])
    const userSites = asRecord(user.sites)
    // 站点合并：出厂为底、用户覆盖；顺序 = 用户文件序 → 出厂序（剔除 deleted）。
    const factoryRawById = new Map<string, Record<string, unknown>>()
    const mergedSites: Record<string, unknown> = {}
    for (const s of defaults.sites) {
      if (deleted.includes(s.id)) continue
      const raw = { name: s.name, home: s.home, match: s.match, experimental: s.experimental, hidden: s.hidden, openIn: s.openIn, adapter: s.adapter }
      factoryRawById.set(s.id, raw)
      mergedSites[s.id] = raw
    }
    for (const [id, v] of Object.entries(userSites)) {
      // deleted 同时过滤出厂层与用户层条目（初始整份拷贝会带出厂条目，删除语义必须一致）。
      if (deleted.includes(id)) continue
      // 用户层条目（如管理界面写的 {hidden:true} stub）合并到出厂定义之上，而不是整体替换。
      mergedSites[id] = { ...(factoryRawById.get(id) ?? {}), ...asRecord(v) }
    }
    const sanitizedById = new Map<string, SiteConfig>()
    for (const [id, v] of Object.entries(mergedSites)) {
      const site = sanitizeSite(id, v)
      if (site) sanitizedById.set(id, site)
    }
    const sites: SiteConfig[] = []
    const seen = new Set<string>()
    for (const id of Object.keys(userSites)) {
      const site = sanitizedById.get(id)
      if (site) { sites.push(site); seen.add(id) }
    }
    for (const id of Object.keys(mergedSites)) {
      if (seen.has(id)) continue
      const site = sanitizedById.get(id)
      if (site) sites.push(site)
    }
    const merged: Record<string, unknown> = {
      ...defaults,
      ...user,
      relay: { ...defaults.relay, ...asRecord(user.relay) },
      optimize: { ...defaults.optimize, ...asRecord(user.optimize) },
      capture: { ...defaults.capture, ...asRecord(user.capture) },
    }
    const config = sanitizeConfig(merged)
    config.sites = sites
    config.deleted = deleted
    return config
  } catch (err) {
    // 损坏的用户配置不静默丢弃：留一份 .bak 再回默认。
    try { renameSync(USER_FILE, USER_FILE + '.bak') } catch { /* ignore */ }
    console.error('[dsh-webrelay] user sites.yml parse failed, backed up to .bak:', (err as Error)?.message)
    return defaults
  }
}

/** 目标 host 是否命中任一站点的 match 白名单。 */
export function matchSite(config: WebrelayConfig, host: string): SiteConfig | undefined {
  const h = host.toLowerCase()
  return config.sites.find((s) => s.match.some((m) => h === m || h.endsWith('.' + m)))
}

export const CONFIG_PATHS = { userFile: USER_FILE, defaultFile: DEFAULT_FILE } as const

