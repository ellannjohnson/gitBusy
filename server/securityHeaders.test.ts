import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  SECURITY_HEADERS,
  HTML_CSP_HEADER,
  applySecurityHeaders,
  applyHtmlSecurityHeaders,
  type ResponseWithHeaders,
} from './securityHeaders.ts'

// Centralized response security headers — APPSEC-002.
// The helper is the single source of truth for the four headers
// shipped on every response; tests assert the frozen shape and the
// exact value the helper sets.

function fakeResponse(): ResponseWithHeaders & { headers: Record<string, string> } {
  return {
    headers: {},
    setHeader(name: string, value: string) {
      this.headers[name] = value
      return this
    },
  }
}

test('SECURITY_HEADERS is a frozen object with the three non-CSP entries', () => {
  assert.equal(Object.isFrozen(SECURITY_HEADERS), true)
  assert.equal(SECURITY_HEADERS['X-Content-Type-Options'], 'nosniff')
  assert.equal(SECURITY_HEADERS['X-Frame-Options'], 'DENY')
  assert.equal(SECURITY_HEADERS['Referrer-Policy'], 'no-referrer')
  // CSP must NOT be in the base set — it is HTML-only.
  assert.equal(SECURITY_HEADERS['Content-Security-Policy'], undefined)
})

test('HTML_CSP_HEADER exposes the exact policy the design approved', () => {
  // The CSP string is part of the security contract. Any change here
  // must be intentional and reviewed. Asserting the literal string
  // makes accidental edits fail loudly.
  assert.equal(
    HTML_CSP_HEADER,
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self' data:; connect-src 'self' https://api.github.com https://github.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  )
})

test('applySecurityHeaders sets the three headers and leaves CSP unset', () => {
  const res = fakeResponse()
  applySecurityHeaders(res)
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff')
  assert.equal(res.headers['X-Frame-Options'], 'DENY')
  assert.equal(res.headers['Referrer-Policy'], 'no-referrer')
  assert.equal(res.headers['Content-Security-Policy'], undefined)
})

test('applyHtmlSecurityHeaders sets the three headers plus the exact CSP', () => {
  const res = fakeResponse()
  applyHtmlSecurityHeaders(res)
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff')
  assert.equal(res.headers['X-Frame-Options'], 'DENY')
  assert.equal(res.headers['Referrer-Policy'], 'no-referrer')
  assert.equal(res.headers['Content-Security-Policy'], HTML_CSP_HEADER)
})

type FakeResponse = ResponseWithHeaders & { headers: Record<string, string>; getHeader?: (name: string) => unknown }

test('applySecurityHeaders does not overwrite a header the caller already set', () => {
  // The design says we do not override an existing header. This is
  // implemented by introspecting `getHeader` on Node's ServerResponse
  // (the only call shape the helper is wired to). A fake response that
  // does not expose `getHeader` falls through to "set unconditionally".
  const res = fakeResponse() as FakeResponse
  res.headers['X-Frame-Options'] = 'SAMEORIGIN'
  res.getHeader = (name: string) => res.headers[name]
  applySecurityHeaders(res)
  assert.equal(res.headers['X-Frame-Options'], 'SAMEORIGIN')
})
