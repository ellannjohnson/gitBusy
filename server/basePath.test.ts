import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BASE_PATH, BASE_PATH_PREFIX } from './basePath.ts'
import { handleApiRequest } from './githubProxy.ts'
import { resolveStaticFile } from './staticFiles.ts'

// PROD-BL-005 — /gitbusy/ is centralized in a single module. The
// handlers (api + static) and the resolver must agree on the same
// prefix; the constants are not exported as a configuration knob.

test('BASE_PATH and BASE_PATH_PREFIX are the canonical gitBusy paths', () => {
  assert.equal(BASE_PATH, '/gitbusy/')
  assert.equal(BASE_PATH_PREFIX, '/gitbusy')
})

test('handleApiRequest strips BASE_PATH_PREFIX before matching routes', async () => {
  // The guard for /gitbusy/api/does-not-exist must short-circuit to
  // 404 JSON because /api/ does not match a known route. If the
  // prefix strip is broken, the path resolves to /gitbusy/api/...
  // which does not start with /api/ and the SPA fallback fires
  // (status 200/HTML).
  let nextCalled = false
  const req: any = {
    url: '/gitbusy/api/does-not-exist',
    method: 'GET',
    headers: { host: '127.0.0.1:5174' },
  }
  const res = { headers: {}, statusCode: 0, body: null as string | null,
    setHeader(name: string, value: string) { this.headers[name] = value; return this },
    end(payload?: Buffer | string) { this.body = payload ? payload.toString() : null; return this } } as any
  await handleApiRequest(req, res, () => { nextCalled = true })
  assert.equal(nextCalled, false)
  assert.equal(res.statusCode, 404)
  assert.equal(res.body, JSON.stringify({ error: 'Unknown API route' }))
})

test('resolveStaticFile strips BASE_PATH_PREFIX before serving files', () => {
  // The static resolver must serve the same file at both
  // /gitbusy/... and /...; if the prefix string drifts, the
  // dual-base contract breaks.
  const a = resolveStaticFile({ urlPath: '/gitbusy/assets/index.js', distRoot: '/srv/dist' })
  const b = resolveStaticFile({ urlPath: '/assets/index.js', distRoot: '/srv/dist' })
  assert.equal(a?.absolutePath, '/srv/dist/assets/index.js')
  assert.equal(b?.absolutePath, '/srv/dist/assets/index.js')
})
