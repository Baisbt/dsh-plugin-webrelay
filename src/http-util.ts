/**
 * dsh-webrelay —— HTTP 工具：信任判据 / 请求体读取 / 统一 JSON 响应。
 * 信任判据与 router/dsh-GreaterClarity-plugin 同款：Host 必须回环（防 DNS rebinding），
 * 浏览器请求的 Origin 还须与 Host 同源（防跨站 CSRF）；非浏览器客户端无 Origin 直接放行。
 */

export const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
} as const

const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i
export const MAX_BODY_BYTES = 8 * 1024 * 1024

export function trustedRequest(req: { headers?: Record<string, unknown> }): boolean {
  const headers = req.headers || {}
  const host = typeof headers.host === 'string' ? headers.host : ''
  if (!LOCAL_HOST_RE.test(host)) return false
  const origin = typeof headers.origin === 'string' ? headers.origin : ''
  if (origin === '') return true
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

export function rejectUntrusted(res: {
  writeHead(code: number, headers: Record<string, string>): unknown
  end(body?: string): unknown
}): void {
  try {
    res.writeHead(403, JSON_HEADERS)
    res.end(JSON.stringify({ ok: false, error: 'untrusted request origin' }))
  } catch {
    // socket already gone
  }
}

export function respondJson(res: any, status: number, body: unknown): void {
  try {
    res.writeHead(status, JSON_HEADERS)
    res.end(JSON.stringify(body))
  } catch {
    // socket already gone
  }
}

export function respondError(res: any, err: unknown): void {
  const status = (err as any)?.statusCode === 413 ? 413 : 400
  respondJson(res, status, { ok: false, error: String((err as any)?.message ?? err) })
}

export function readBody(req: any): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY_BYTES) {
        const err = new Error(`body exceeds ${MAX_BODY_BYTES} bytes`) as Error & { statusCode?: number }
        err.statusCode = 413
        req.pause()
        reject(err)
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}
