import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  requestOrigin,
  originMatchesLocal,
  originMatchesTailscale,
  checkMutationOrigin,
} from './requestSecurity.ts'

// Same-origin Origin/CSRF guard for mutating endpoints — APPSEC-004.
// The check accepts:
//   - http://127.0.0.1:<port> / http://localhost:<port> / http://[::1]:<port>
//   - https://<configured-tailscale-host> with constant-time compare
// Anything else (including a missing Origin header, a cross-site
// request, or a non-loopback http: origin) is denied.

test('requestOrigin returns "" when no Origin header is present', () => {
  assert.equal(requestOrigin({ headers: {} }), '')
})

test('requestOrigin returns "" when Origin is an empty string', () => {
  assert.equal(requestOrigin({ headers: { origin: '' } }), '')
})

test('requestOrigin returns the trimmed Origin header value', () => {
  assert.equal(requestOrigin({ headers: { origin: ' http://127.0.0.1:5174 ' } }), 'http://127.0.0.1:5174')
})

test('requestOrigin returns "" when Origin is not a string', () => {
  assert.equal(requestOrigin({ headers: { origin: 42 as unknown } }), '')
})

test('originMatchesLocal accepts http://127.0.0.1:<port>', () => {
  assert.equal(originMatchesLocal('http://127.0.0.1:5174', 5174, '127.0.0.1'), true)
})

test('originMatchesLocal accepts http://localhost:<port> with default-port rule', () => {
  // http://localhost without an explicit port matches when the local
  // bind host is also loopback.
  assert.equal(originMatchesLocal('http://localhost', 5174, '127.0.0.1'), true)
})

test('originMatchesLocal rejects a port mismatch', () => {
  assert.equal(originMatchesLocal('http://127.0.0.1:6000', 5174, '127.0.0.1'), false)
})

test('originMatchesLocal rejects http://attacker.example', () => {
  assert.equal(originMatchesLocal('http://attacker.example', 5174, '127.0.0.1'), false)
})

test('originMatchesLocal rejects https:// on a local bind', () => {
  // We do not accept https on a local bind — the local-only endpoint
  // is HTTP, not HTTPS.
  assert.equal(originMatchesLocal('https://127.0.0.1:5174', 5174, '127.0.0.1'), false)
})

test('originMatchesTailscale accepts the configured HTTPS host (exact match)', () => {
  assert.equal(originMatchesTailscale('https://user.tailnet.ts.net', 'https://user.tailnet.ts.net/gitbusy'), true)
})

test('originMatchesTailscale rejects a different Tailscale host', () => {
  assert.equal(originMatchesTailscale('https://other.tailnet.ts.net', 'https://user.tailnet.ts.net/gitbusy'), false)
})

test('originMatchesTailscale rejects http:// on a Tailscale config', () => {
  assert.equal(originMatchesTailscale('http://user.tailnet.ts.net', 'https://user.tailnet.ts.net/gitbusy'), false)
})

test('originMatchesTailscale rejects an empty tailscaleUrl', () => {
  assert.equal(originMatchesTailscale('https://user.tailnet.ts.net', ''), false)
})

test('originMatchesTailscale rejects malformed origins', () => {
  assert.equal(originMatchesTailscale('not a url', 'https://user.tailnet.ts.net/gitbusy'), false)
  assert.equal(originMatchesTailscale('://broken', 'https://user.tailnet.ts.net/gitbusy'), false)
})

test('checkMutationOrigin denies a missing Origin header', () => {
  const decision = checkMutationOrigin({
    request: { headers: {} },
    port: 5174,
    host: '127.0.0.1',
    tailscaleUrl: '',
  })
  assert.equal(decision.ok, false)
  assert.equal(decision.reason, 'missing-origin')
})

test('checkMutationOrigin accepts a local-loopback Origin', () => {
  const decision = checkMutationOrigin({
    request: { headers: { origin: 'http://127.0.0.1:5174' } },
    port: 5174,
    host: '127.0.0.1',
    tailscaleUrl: '',
  })
  assert.deepEqual(decision, { ok: true })
})

test('checkMutationOrigin accepts a Tailscale Origin when configured', () => {
  const decision = checkMutationOrigin({
    request: { headers: { origin: 'https://user.tailnet.ts.net' } },
    port: 5174,
    host: '127.0.0.1',
    tailscaleUrl: 'https://user.tailnet.ts.net/gitbusy',
  })
  assert.deepEqual(decision, { ok: true })
})

test('checkMutationOrigin denies a hostile cross-site Origin', () => {
  const decision = checkMutationOrigin({
    request: { headers: { origin: 'http://attacker.example' } },
    port: 5174,
    host: '127.0.0.1',
    tailscaleUrl: 'https://user.tailnet.ts.net/gitbusy',
  })
  assert.equal(decision.ok, false)
  assert.equal(decision.reason, 'unknown-origin')
})

test('checkMutationOrigin denies an Origin that is neither local nor Tailscale', () => {
  const decision = checkMutationOrigin({
    request: { headers: { origin: 'http://localhost:6000' } },
    port: 5174,
    host: '127.0.0.1',
    tailscaleUrl: '',
  })
  assert.equal(decision.ok, false)
  assert.equal(decision.reason, 'unknown-origin')
})
