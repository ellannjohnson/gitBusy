import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handleApiRequest } from './githubProxy.ts'

// DC-003 — unknown /api/* paths must return JSON 404, not the SPA shell.
// The four known API routes (/api/network/status, /api/network/tailscale,
// /api/network/pair, anything under /api/github/) continue to be served
// by the existing handler. Everything else starting with /api/ short-circuits
// to a 404 JSON response.

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

test('unknown /api/does-not-exist returns 404 JSON, not the SPA shell', async () => {
  let nextCalled = false
  const req: any = {
    url: '/api/does-not-exist',
    method: 'GET',
    headers: { host: '127.0.0.1:5174' },
  }
  const res = fakeResponse()
  await handleApiRequest(req, res, () => { nextCalled = true })
  assert.equal(nextCalled, false, 'handleApiRequest must not defer unknown /api/* paths')
  assert.equal(res.statusCode, 404)
  assert.equal(res.body, JSON.stringify({ error: 'Unknown API route' }))
  assert.equal(res.headers['Content-Type'], 'application/json; charset=utf-8')
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff')
})

test('encoded traversal under /api/* returns 404 JSON', async () => {
  // The URL parser normalizes '/api/%2e%2e/etc/passwd' to '/etc/passwd'
  // (the .. segment collapses with /api/), so it no longer starts with
  // /api/ and falls through to the SPA fallback (which is correct). A
  // payload that stays under /api/* but still hides encoded bytes must
  // be short-circuited to 404 JSON.
  let nextCalled = false
  const req: any = {
    url: '/api/%2f..%2f..%2fetc/passwd',
    method: 'GET',
    headers: { host: '127.0.0.1:5174' },
  }
  const res = fakeResponse()
  await handleApiRequest(req, res, () => { nextCalled = true })
  assert.equal(nextCalled, false)
  assert.equal(res.statusCode, 404)
  assert.equal(res.body, JSON.stringify({ error: 'Unknown API route' }))
})

test('unknown /api/network/foo returns 404 JSON (only the three known network routes are valid)', async () => {
  let nextCalled = false
  const req: any = {
    url: '/api/network/foo',
    method: 'GET',
    headers: { host: '127.0.0.1:5174' },
  }
  const res = fakeResponse()
  await handleApiRequest(req, res, () => { nextCalled = true })
  assert.equal(nextCalled, false)
  assert.equal(res.statusCode, 404)
  assert.equal(res.body, JSON.stringify({ error: 'Unknown API route' }))
})

test('unknown /gitbusy/api/... strips the base path before the 404 guard fires', async () => {
  let nextCalled = false
  const req: any = {
    url: '/gitbusy/api/does-not-exist',
    method: 'GET',
    headers: { host: '127.0.0.1:5174' },
  }
  const res = fakeResponse()
  await handleApiRequest(req, res, () => { nextCalled = true })
  assert.equal(nextCalled, false)
  assert.equal(res.statusCode, 404)
  assert.equal(res.body, JSON.stringify({ error: 'Unknown API route' }))
})

test('known /api/github/... still reaches the handler (does NOT short-circuit)', async () => {
  // /api/github/auth/status is a real route. We only assert that the new
  // 404 guard does not pre-empt it: the request gets handled (status code
  // is some real response, not 404).
  const req: any = {
    url: '/api/github/auth/status',
    method: 'GET',
    headers: { host: '127.0.0.1:5174' },
  }
  const res = fakeResponse()
  await handleApiRequest(req, res, () => {})
  // The body should NOT be the new 404 sentinel.
  assert.notEqual(res.body, JSON.stringify({ error: 'Unknown API route' }))
})

test('non-API paths under /gitbusy/ still defer via next()', async () => {
  // SPA fallback must be preserved: /gitbusy/something-not-api goes to next().
  let nextCalled = false
  const req: any = {
    url: '/gitbusy/some/spa/route',
    method: 'GET',
    headers: { host: '127.0.0.1:5174' },
  }
  const res = fakeResponse()
  await handleApiRequest(req, res, () => { nextCalled = true })
  assert.equal(nextCalled, true, 'SPA fallback paths must still defer to next()')
})
