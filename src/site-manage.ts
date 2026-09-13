/**
 * dsh-webrelay —— 站点管理（面板"站点管理"弹窗的 host 端实现）。
 *
 * 语义：
 *   自定义站点  remove = 从用户 sites.yml 移除该条目
 *   出厂站点    remove = 写入 deleted: 列表（出厂条目无法真删，会被默认模板合并回来）
 *   hide/reset  只写用户层的覆盖字段（hidden/openIn/stub），出厂定义保持完整
 *   reset-all   用户 sites.yml 整文件还原为出厂模板（注释一并还原）
 * 结构化写回（yaml stringify）会覆盖手写注释——已与用户确认的取舍。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { readUserRaw, writeUserRaw, loadConfig, CONFIG_PATHS } from './config.js'

/** 新增站点的通用适配器：候选链尽量宽，用户可在 sites.yml 里按实际页面收窄。 */
const GENERIC_ADAPTER = {
  input: ['textarea', 'div[contenteditable="true"]'],
  inputContentEditable: false,
  send: [],
  sendMode: 'enter-then-click',
  replies: ['[class*="markdown"]', '[class*="message-content"]', '[class*="message"]'],
  generating: ['[class*="stop"]', '[class*="generating"]'],
}

/** 出厂站点 id（与 sites.default.yml 对应的固定五个）。 */
const FACTORY_ID_SET = new Set(['deepseek', 'chatgpt', 'doubao', 'qianwen', 'gemini'])

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
}

function slugify(text: string): string {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug.length > 0 ? slug.slice(0, 32) : 'site'
}

function uniqueId(base: string): string {
  const taken = new Set(loadConfig().sites.map((s) => s.id))
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

function withUserSites(mutate: (sites: Record<string, unknown>, raw: Record<string, unknown>) => void): void {
  const raw = readUserRaw()
  const sites = asRecord(raw.sites)
  mutate(sites, raw)
  raw.sites = sites
  writeUserRaw(raw)
}

function deletedList(raw: Record<string, unknown>): string[] {
  const v = raw.deleted
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

export function manageSites(body: Record<string, unknown>): { ok: boolean, error?: string } {
  const action = typeof body.action === 'string' ? body.action : ''
  const id = typeof body.id === 'string' ? body.id.trim() : ''
  switch (action) {
    case 'add': {
      const url = typeof body.url === 'string' ? body.url.trim() : ''
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        return { ok: false, error: '网址格式无效' }
      }
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return { ok: false, error: '仅支持 http(s) 网址' }
      }
      const host = parsed.hostname.toLowerCase()
      const name = typeof body.name === 'string' && body.name.trim().length > 0 ? body.name.trim() : host
      const newId = uniqueId(slugify(name))
      const home = `${parsed.origin}${parsed.pathname === '/' ? '/' : parsed.pathname}`
      withUserSites((sites) => {
        sites[newId] = {
          name,
          home,
          match: [host],
          experimental: true,
          hidden: false,
          openIn: 'relay',
          adapter: GENERIC_ADAPTER,
        }
      })
      return { ok: true }
    }
    case 'remove': {
      if (!id) return { ok: false, error: '缺少站点 id' }
      if (FACTORY_ID_SET.has(id)) {
        const raw = readUserRaw()
        const deleted = deletedList(raw)
        if (!deleted.includes(id)) deleted.push(id)
        raw.deleted = deleted
        writeUserRaw(raw)
      } else {
        withUserSites((sites) => { delete sites[id] })
      }
      return { ok: true }
    }
    case 'hide': {
      const hidden = body.hidden === true
      if (!id) return { ok: false, error: '缺少站点 id' }
      withUserSites((sites) => { sites[id] = { ...asRecord(sites[id]), hidden } })
      return { ok: true }
    }
    case 'openIn': {
      const raw = typeof body.openIn === 'string' ? body.openIn : ''
      const openIn = raw === 'system' ? 'system' : raw === 'cdp' ? 'cdp' : 'relay'
      if (!id) return { ok: false, error: '缺少站点 id' }
      withUserSites((sites) => { sites[id] = { ...asRecord(sites[id]), openIn } })
      return { ok: true }
    }
    case 'reorder': {
      const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string') : []
      if (ids.length === 0) return { ok: false, error: '缺少排序 id 列表' }
      withUserSites((sites) => {
        const ordered: Record<string, unknown> = {}
        const rest = new Set(Object.keys(sites))
        for (const key of ids) {
          if (rest.has(key)) { ordered[key] = sites[key]; rest.delete(key) }
        }
        for (const key of rest) ordered[key] = sites[key]
        // 就地替换键序（保留全部用户条目）
        for (const key of Object.keys(sites)) delete sites[key]
        Object.assign(sites, ordered)
      })
      return { ok: true }
    }
    case 'bind-browser': {
      // browser: null 表示回到默认实例；有值必须形如实例 id。
      const browser = typeof body.browser === 'string' && body.browser.trim().length > 0 ? body.browser.trim() : null
      if (!id) return { ok: false, error: '缺少站点 id' }
      withUserSites((sites) => {
        const entry = { ...asRecord(sites[id]) }
        if (browser === null) delete entry.browser
        else entry.browser = browser
        sites[id] = entry
      })
      return { ok: true }
    }
    case 'browser-add': {
      const label = typeof body.label === 'string' ? body.label.trim() : ''
      const type = body.type === 'edge' ? 'edge' : body.type === 'custom' ? 'custom' : 'chrome'
      const profile = typeof body.profile === 'string' && body.profile.trim().length > 0 ? body.profile.trim() : 'Default'
      const port = typeof body.port === 'number' && body.port > 0 && body.port < 65536 ? Math.floor(body.port) : undefined
      if (label.length === 0) return { ok: false, error: '请填写实例显示名称' }
      const newId = uniqueId(slugify(label))
      withUserSites((sites, raw) => {
        const browsers = asRecord(raw.browsers)
        browsers[newId] = { label, type, profile, ...(port !== undefined ? { port } : {}) }
        raw.browsers = browsers
      })
      return { ok: true }
    }
    case 'browser-remove': {
      const browserId = typeof body.browser === 'string' ? body.browser.trim() : ''
      if (browserId.length === 0) return { ok: false, error: '缺少实例 id' }
      if (browserId === 'default') return { ok: false, error: '默认实例不可删除' }
      withUserSites((sites, raw) => {
        const browsers = asRecord(raw.browsers)
        delete browsers[browserId]
        raw.browsers = browsers
        // 解绑引用该实例的站点（回到默认实例）
        for (const key of Object.keys(sites)) {
          const entry = asRecord(sites[key])
          if (entry.browser === browserId) delete entry.browser
        }
      })
      return { ok: true }
    }
    case 'reset-site': {
      if (!id) return { ok: false, error: '缺少站点 id' }
      withUserSites((sites, raw) => {
        delete sites[id]
        raw.deleted = deletedList(raw).filter((x) => x !== id)
      })
      return { ok: true }
    }
    case 'reset-all': {
      // 先确保目录存在，再整文件还原为出厂模板（保留出厂模板的注释）。
      writeUserRaw({})
      writeFileSync(CONFIG_PATHS.userFile, readFileSync(CONFIG_PATHS.defaultFile, 'utf8'), 'utf8')
      return { ok: true }
    }
    default:
      return { ok: false, error: `未知操作：${action}` }
  }
}
