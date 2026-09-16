import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handleApiRequest } from './githubProxy.ts'

// Stage 2 handler-level integration tests.
// Exercises the new APPSEC-005 / APPSEC-007 wiring at the public
// handler seam so the unit tests on the new modules are anchored to
// the request/response contract.
//
// We deliberately avoid driving the authenticated publish-folder /
// pair / Tailscale paths from this file because each requires either
// real Keychain/secret-tool state or a mock of the network layer.
// The unit tests on `server/pairing.ts`, `server/publishPaths.ts`,
// `server/restErrors.ts`, and `server/audit.ts` cover the inner
// logic; the cross-site / header assertions below verify the new
// modules are wired into the public handler shape.

type FakeResponse = {
  headers: Record<string, string>
  statusCode: number
  body: string | null
  setHeader(name: string, value: string | number | string[]): unknown
  end(payload?: Buffer | string): unknown
}

function fakeResponse(): FakeResponse {
  return {
    headers: {},
    statusCode: 0,
    body: null,
    setHeader(name: string, value: string | number | string[]) { this.headers[name] = String(value); return this },
    end(payload?: Buffer | string) { this.body = payload ? payload.toString() : null; return this },
  } as any
}

// APPSEC-005 — handler-level rejection paths inherit the security headers.
test('POST /api/network/pair with a cross-site Origin returns 403 with the three base headers', async () => {
  const req: any = {
    url: '/api/network/pair',
    method: 'POST',
    headers: { origin: 'http://attacker.example', host: '127.0.0.1:5174' },
  }
  const res = fakeResponse()
  await handleApiRequest(req, res, () => {})
  assert.equal(res.statusCode, 403)
  assert.match(res.body ?? '', /Cross-site/)
  // sendJson inherits the security headers via Stage 1.
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff')
  assert.equal(res.headers['X-Frame-Options'], 'DENY')
  assert.equal(res.headers['Referrer-Policy'], 'no-referrer')
  assert.equal(res.headers['Content-Type'], 'application/json; charset=utf-8')
  // CSP is JSON, not HTML.
  assert.equal(res.headers['Content-Security-Policy'], undefined)
})

// APPSEC-007 — JSON 401 from auth/status inherits the security headers.
test('GET /api/github/auth/status responses carry the three base headers', async () => {
  // The auth-status GET is a read-only path; we don't care about the
  // body, only that the handler emits the security headers (Stage 1
  // baseline) regardless of the eventual payload.
  const req: any = {
    url: '/api/github/auth/status',
    method: 'GET',
    headers: { host: '127.0.0.1:5174' },
  }
  const res = fakeResponse()
  await handleApiRequest(req, res, () => {})
  // Whatever status the handler eventually returns (likely 5xx because
  // no GitHub credential is available in the test env), the three base
  // headers must be set.
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff')
  assert.equal(res.headers['X-Frame-Options'], 'DENY')
  assert.equal(res.headers['Referrer-Policy'], 'no-referrer')
  assert.equal(res.headers['Content-Type'], 'application/json; charset=utf-8')
})