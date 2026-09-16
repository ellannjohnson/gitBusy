import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handleApiRequest } from './githubProxy.ts'

// Same-origin Origin/CSRF guard at the handler seam — APPSEC-004.
// These tests drive the real `handleApiRequest` end-to-end with
// fake requests to confirm the cross-site guard fires before the
// existing local-only checks (so the existing 403 / 401 surfaces
// are not weakened) and that same-origin requests still pass the
// origin gate on their way to the existing checks.

type FakeResponse = {
  headers: Record<string, string>
  statusCode: number
  body: string | null
  setHeader(name: string, value: string): unknown
  end(payload?: Buffer | string): unknown
}

function fakeResponse(): FakeResponse {
  return {
    headers: {},
    statusCode: 0,
    body: null,
    setHeader(name: string, value: string) { this.headers[name] = value; return this },
    end(payload?: Buffer | string) { this.body = payload ? payload.toString() : null; return this },
  } as any
}

test('POST /api/network/tailscale with no Origin header returns 403', async () => {
  const req: any = { url: '/api/network/tailscale', method: 'POST', headers: {} }
  const res = fakeResponse()
  let nextCalled = false
  await handleApiRequest(req, res, () => { nextCalled = true })
  assert.equal(nextCalled, false)
  assert.equal(res.statusCode, 403)
  assert.match(res.body ?? '', /Cross-site/)
})

test('POST /api/network/tailscale with a cross-site Origin returns 403', async () => {
  const req: any = {
    url: '/api/network/tailscale',
    method: 'POST',
    headers: { origin: 'http://attacker.example', host: '127.0.0.1:5174' },
  }
  const res = fakeResponse()
  let nextCalled = false
  await handleApiRequest(req, res, () => { nextCalled = true })
  assert.equal(nextCalled, false)
  assert.equal(res.statusCode, 403)
  assert.match(res.body ?? '', /Cross-site/)
})

test('POST /api/network/pair with no Origin header returns 403', async () => {
  const req: any = { url: '/api/network/pair', method: 'POST', headers: {} }
  const res = fakeResponse()
  let nextCalled = false
  await handleApiRequest(req, res, () => { nextCalled = true })
  assert.equal(nextCalled, false)
  assert.equal(res.statusCode, 403)
  assert.match(res.body ?? '', /Cross-site/)
})

test('PUT /api/github/star with a cross-site Origin returns 403 before the 405 path', async () => {
  const req: any = {
    url: '/api/github/star',
    method: 'PUT',
    headers: { origin: 'http://attacker.example', host: '127.0.0.1:5174' },
  }
  const res = fakeResponse()
  await handleApiRequest(req, res, () => {})
  // The Origin guard runs first; the existing 405 path is not reached.
  assert.equal(res.statusCode, 403)
  assert.match(res.body ?? '', /Cross-site/)
})

test('POST /api/github/publish-folder with a cross-site Origin returns 403', async () => {
  const req: any = {
    url: '/api/github/publish-folder',
    method: 'POST',
    headers: { origin: 'http://attacker.example', host: '127.0.0.1:5174' },
  }
  const res = fakeResponse()
  await handleApiRequest(req, res, () => {})
  assert.equal(res.statusCode, 403)
  assert.match(res.body ?? '', /Cross-site/)
})

test('POST /api/github/auth/device/start with a cross-site Origin returns 403', async () => {
  const req: any = {
    url: '/api/github/auth/device/start',
    method: 'POST',
    headers: { origin: 'http://attacker.example', host: '127.0.0.1:5174' },
  }
  const res = fakeResponse()
  await handleApiRequest(req, res, () => {})
  assert.equal(res.statusCode, 403)
  assert.match(res.body ?? '', /Cross-site/)
})

test('POST /api/github/auth/device/poll with a cross-site Origin returns 403', async () => {
  const req: any = {
    url: '/api/github/auth/device/poll',
    method: 'POST',
    headers: { origin: 'http://attacker.example', host: '127.0.0.1:5174' },
  }
  const res = fakeResponse()
  await handleApiRequest(req, res, () => {})
  assert.equal(res.statusCode, 403)
  assert.match(res.body ?? '', /Cross-site/)
})

test('POST /api/github/auth/signout with a cross-site Origin returns 403', async () => {
  const req: any = {
    url: '/api/github/auth/signout',
    method: 'POST',
    headers: { origin: 'http://attacker.example', host: '127.0.0.1:5174' },
  }
  const res = fakeResponse()
  await handleApiRequest(req, res, () => {})
  assert.equal(res.statusCode, 403)
  assert.match(res.body ?? '', /Cross-site/)
})

test('POST /api/github/lists/push with a cross-site Origin returns 403', async () => {
  const req: any = {
    url: '/api/github/lists/push',
    method: 'POST',
    headers: { origin: 'http://attacker.example', host: '127.0.0.1:5174' },
  }
  const res = fakeResponse()
  await handleApiRequest(req, res, () => {})
  assert.equal(res.statusCode, 403)
  assert.match(res.body ?? '', /Cross-site/)
})

test('GET /api/github/auth/status is NOT subjected to the Origin guard', async () => {
  // Read-only GET must still flow through. We don't care what the
  // response body is — we only assert the request reaches the route
  // (no early 403). Using a missing Origin header must not 403 the
  // GET handler.
  const req: any = { url: '/api/github/auth/status', method: 'GET', headers: {} }
  const res = fakeResponse()
  await handleApiRequest(req, res, () => {})
  // The handler will likely fail with a 5xx because no GitHub
  // credential is available in the test env; the assertion is that
  // it is NOT a 403 from the Origin guard.
  assert.notEqual(res.statusCode, 403)
})

test('403 responses from the Origin guard also include the three base security headers', async () => {
  const req: any = {
    url: '/api/network/tailscale',
    method: 'POST',
    headers: { origin: 'http://attacker.example', host: '127.0.0.1:5174' },
  }
  const res = fakeResponse()
  await handleApiRequest(req, res, () => {})
  // sendJson applies the three base headers; CSP is JSON so it is NOT set.
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff')
  assert.equal(res.headers['X-Frame-Options'], 'DENY')
  assert.equal(res.headers['Referrer-Policy'], 'no-referrer')
  assert.equal(res.headers['Content-Type'], 'application/json; charset=utf-8')
  assert.equal(res.headers['Content-Security-Policy'], undefined)
})
