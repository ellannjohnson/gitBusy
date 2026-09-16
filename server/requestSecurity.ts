import { timingSafeEqual } from 'node:crypto'

// Same-origin Origin / CSRF guard for mutating endpoints — APPSEC-004.
// The check accepts:
//   - http://127.0.0.1:<port> / http://localhost:<port> / http://[::1]:<port>
//   - https://<configured-tailscale-host> with constant-time compare
// Anything else (including a missing Origin header, a cross-site
// request, or a non-loopback http: origin) is denied.
//
// The check is intentionally narrow: it adds Origin verification
// without introducing a CSRF-token cookie. Browsers always set the
// Origin header on `fetch()` POSTs, so the SPA is unaffected. Curl-
// based local testing must add `-H 'Origin: http://127.0.0.1:5174'`.

export type OriginDecision =
  | { ok: true }
  | { ok: false; reason: 'missing-origin' | 'unknown-origin' }

export type RequestLike = { headers?: Record<string, unknown> }

export function requestOrigin(request: RequestLike): string {
  const raw = request.headers?.['origin']
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  return ''
}

// Accept http://127.0.0.1:<port>, http://localhost:<port>, http://[::1]:<port>.
// The default-port rule treats an unspecified port as matching the
// loopback bind (browser fetch() against http://127.0.0.1/ omits the
// default 80 port from the Origin header).
export function originMatchesLocal(origin: string, port: number, host: string): boolean {
  try {
    const url = new URL(origin)
    if (url.protocol !== 'http:') return false
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost' && url.hostname !== '::1') return false
    const portMatch = url.port === String(port)
    const defaultPort = !url.port && (host === '127.0.0.1' || host === 'localhost')
    return portMatch || defaultPort
  } catch {
    return false
  }
}

// tailscaleUrl is the configured https://<dnsName>/gitbusy value
// (see enableGitBusyServe in server/githubProxy.ts). Compare against
// the request origin using a constant-time string compare to avoid
// timing oracles even though the comparison is constant length.
export function originMatchesTailscale(origin: string, tailscaleUrl: string): boolean {
  if (!tailscaleUrl) return false
  try {
    const a = new URL(origin)
    const b = new URL(tailscaleUrl)
    if (a.protocol !== 'https:' || b.protocol !== 'https:') return false
    if (a.hostname !== b.hostname) return false
    const aSig = Buffer.from(a.origin)
    const bSig = Buffer.from(b.origin)
    if (aSig.length !== bSig.length) return false
    return timingSafeEqual(aSig, bSig)
  } catch {
    return false
  }
}

export function checkMutationOrigin(opts: {
  request: RequestLike
  port: number
  host: string
  tailscaleUrl: string
}): OriginDecision {
  const origin = requestOrigin(opts.request)
  if (!origin) return { ok: false, reason: 'missing-origin' }
  if (originMatchesLocal(origin, opts.port, opts.host)) return { ok: true }
  if (originMatchesTailscale(origin, opts.tailscaleUrl)) return { ok: true }
  return { ok: false, reason: 'unknown-origin' }
}
