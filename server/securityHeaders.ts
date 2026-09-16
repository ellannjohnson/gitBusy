// Centralized response security headers — APPSEC-002.
// The helper is the single source of truth for the four headers we
// ship on every response. JSON responses use `applySecurityHeaders`;
// text/html responses additionally receive the HTTP Content-Security-
// Policy header via `applyHtmlSecurityHeaders`.
//
// The CSP is set as an HTTP response header rather than via a
// <meta http-equiv="Content-Security-Policy"> tag so non-Vite dev runs
// and the bundled `dist/` shell both receive it without an HTML edit.
// CSP is intentionally NOT applied to JSON or asset responses — it is
// meaningful only on document responses and would otherwise inflate
// the response size on every API call.

export type ResponseWithHeaders = {
  setHeader(name: string, value: string): unknown
}

export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
})

// The exact CSP string is part of the security contract. Directives:
// - default-src 'self'       same-origin only (Tailscale HTTPS shares 'self')
// - script-src 'self'        no remote scripts, no inline, no eval
// - style-src 'self' 'unsafe-inline'
//                            React 19 + Vite may inline style attrs;
//                            inline CSS is not an XSS vector
// - img-src 'self' https: data:
//                            GitHub avatars + existing inline fallback
// - font-src 'self' data:    inline base64 fonts if any
// - connect-src 'self' https://api.github.com https://github.com
//                            only outbound fetch targets in production
// - object-src 'none'        no <object>/<embed>/<applet>
// - base-uri 'self'          <base> cannot redirect to an attacker origin
// - frame-ancestors 'none'   supersedes X-Frame-Options; honored on header form
// - form-action 'self'       same-origin form submissions only
export const HTML_CSP_HEADER =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self' data:; connect-src 'self' https://api.github.com https://github.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"

// Write the three base headers. Existing caller-set headers are
// preserved — callers that want to opt out for one specific response
// may set the header before invoking this helper.
export function applySecurityHeaders(response: ResponseWithHeaders): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (responseHeadersHave(response, name)) continue
    response.setHeader(name, value)
  }
}

// Same as `applySecurityHeaders` plus the HTTP CSP header. Use only
// on `text/html` responses (the SPA shell).
export function applyHtmlSecurityHeaders(response: ResponseWithHeaders): void {
  applySecurityHeaders(response)
  if (!responseHeadersHave(response, 'Content-Security-Policy')) {
    response.setHeader('Content-Security-Policy', HTML_CSP_HEADER)
  }
}

// Defensive: detect a previously-set header even on response objects
// that record it on a `headers` object or `getHeader()` method. The
// `StaticResponse` shape used in `server/staticFiles.ts` exposes only
// `setHeader`, so for the contract we honor `setHeader`'s prior calls
// by introspecting the optional `getHeader()` method when present
// (Node's ServerResponse exposes it).
function responseHeadersHave(response: ResponseWithHeaders & { getHeader?: (name: string) => unknown }, name: string): boolean {
  if (typeof response.getHeader === 'function') {
    return response.getHeader(name) !== undefined
  }
  return false
}
