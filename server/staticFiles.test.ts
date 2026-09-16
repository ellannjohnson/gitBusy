import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Readable } from 'node:stream'
import { resolveStaticFile, serveStaticFile, type StaticRequest, type StaticResponse } from './staticFiles.ts'

// Pure path-resolution tests for the static file handler.

const DIST = '/srv/gitbusy/dist'

function fakeResponse(): StaticResponse & { headers: Record<string, string>; status: number; body: Buffer | string | null } {
  // Mirror the real Node ServerResponse shape: `statusCode` is a
  // settable numeric property, not a function. We preserve the
  // header name's case so we can assert on the literal key.
  return {
    headers: {},
    status: 0,
    body: null,
    setHeader(name: string, value: string) { this.headers[name] = value; return this },
    statusCode: 0,
    end(payload?: Buffer | string) { this.body = payload ?? null; return this },
  } as any
}

test('serves dist/index.html for /', () => {
  const r = resolveStaticFile({ urlPath: '/', distRoot: DIST })
  assert.notEqual(r, null)
  assert.equal(r!.absolutePath, `${DIST}/index.html`)
  assert.equal(r!.mime, 'text/html; charset=utf-8')
})

test('serves dist/gitbusy/index.html for /gitbusy/', () => {
  const r = resolveStaticFile({ urlPath: '/gitbusy/', distRoot: DIST })
  assert.notEqual(r, null)
  assert.equal(r!.absolutePath, `${DIST}/index.html`)
  assert.equal(r!.mime, 'text/html; charset=utf-8')
})

test('serves dist/gitbusy/index.html for /gitbusy (no trailing slash)', () => {
  const r = resolveStaticFile({ urlPath: '/gitbusy', distRoot: DIST })
  assert.notEqual(r, null)
  assert.equal(r!.absolutePath, `${DIST}/index.html`)
})

test('serves asset files under dist/assets/ at /gitbusy/assets/...', () => {
  const r = resolveStaticFile({ urlPath: '/gitbusy/assets/index-Abc.js', distRoot: DIST })
  assert.notEqual(r, null)
  assert.equal(r!.absolutePath, `${DIST}/assets/index-Abc.js`)
  assert.equal(r!.mime, 'application/javascript; charset=utf-8')
})

test('serves asset files at root /assets/... too', () => {
  const r = resolveStaticFile({ urlPath: '/assets/index-Abc.css', distRoot: DIST })
  assert.notEqual(r, null)
  assert.equal(r!.absolutePath, `${DIST}/assets/index-Abc.css`)
  assert.equal(r!.mime, 'text/css; charset=utf-8')
})

test('rejects traversal with encoded %2e%2e', () => {
  const r = resolveStaticFile({ urlPath: '/gitbusy/%2e%2e/etc/passwd', distRoot: DIST })
  assert.equal(r, null)
})

test('rejects traversal with literal ../', () => {
  const r = resolveStaticFile({ urlPath: '/gitbusy/../etc/passwd', distRoot: DIST })
  assert.equal(r, null)
})

test('rejects backslash separators', () => {
  // Windows-style separators must never escape distRoot.
  const r = resolveStaticFile({ urlPath: '/gitbusy/..\\..\\etc\\passwd', distRoot: DIST })
  assert.equal(r, null)
})

test('rejects paths that escape distRoot via ..', () => {
  const r = resolveStaticFile({ urlPath: '/../package.json', distRoot: DIST })
  assert.equal(r, null)
})

test('unknown extension served as application/octet-stream', () => {
  const r = resolveStaticFile({ urlPath: '/gitbusy/assets/blob.unknownext', distRoot: DIST })
  assert.notEqual(r, null)
  assert.equal(r!.mime, 'application/octet-stream')
})

test('SPA nested path falls through to index.html', () => {
  const r = resolveStaticFile({ urlPath: '/gitbusy/explore', distRoot: DIST })
  assert.notEqual(r, null)
  assert.equal(r!.absolutePath, `${DIST}/index.html`)
})

test('serveStaticFile writes headers and ends with body when stream produces data', async () => {
  const req: StaticRequest = { url: '/gitbusy/' }
  const res = fakeResponse()
  // Use a custom stream factory so we don't touch the real filesystem.
  const calls: Array<{ path: string }> = []
  await serveStaticFile({
    request: req,
    response: res,
    distRoot: DIST,
    readStream: (path) => {
      calls.push({ path })
      return Readable.from(Buffer.from('<!doctype html>'))
    },
    fileExists: () => Promise.resolve(true),
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].path, `${DIST}/index.html`)
  assert.equal(res.headers['Content-Type'], 'text/html; charset=utf-8')
  assert.equal(res.headers['Cache-Control'], 'no-store')
  assert.equal(res.statusCode, 200)
  assert.equal((res.body as Buffer).toString('utf8'), '<!doctype html>')
})

test('serveStaticFile 404s when resolveStaticFile returns null', async () => {
  const req: StaticRequest = { url: '/gitbusy/%2e%2e/etc/passwd' }
  const res = fakeResponse()
  await serveStaticFile({
    request: req,
    response: res,
    distRoot: DIST,
    readStream: () => { throw new Error('should not be called for traversal') },
  })
  assert.equal(res.statusCode, 404)
})

test('serveStaticFile 404s when the file does not exist on disk', async () => {
  const req: StaticRequest = { url: '/gitbusy/missing.html' }
  const res = fakeResponse()
  await serveStaticFile({
    request: req,
    response: res,
    distRoot: DIST,
    readStream: () => { throw new Error('missing') },
    fileExists: () => Promise.resolve(false),
  })
  assert.equal(res.statusCode, 404)
})

test('rejects URL-encoded NUL bytes', () => {
  const r = resolveStaticFile({ urlPath: '/gitbusy/%00.txt', distRoot: DIST })
  assert.equal(r, null)
})

// APPSEC-002 — centralized security headers + HTTP CSP on text/html.

test('serveStaticFile for /gitbusy/ sets the three security headers plus the exact CSP', async () => {
  const req: StaticRequest = { url: '/gitbusy/' }
  const res = fakeResponse()
  await serveStaticFile({
    request: req,
    response: res,
    distRoot: DIST,
    readStream: () => Readable.from(Buffer.from('<!doctype html><html></html>')),
    fileExists: () => Promise.resolve(true),
  })
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff')
  assert.equal(res.headers['X-Frame-Options'], 'DENY')
  assert.equal(res.headers['Referrer-Policy'], 'no-referrer')
  assert.match(res.headers['Content-Security-Policy'] ?? '', /^default-src 'self'; script-src 'self';/)
})

test('serveStaticFile for a JS asset sets the three headers but NO Content-Security-Policy', async () => {
  const req: StaticRequest = { url: '/gitbusy/assets/index-Abc.js' }
  const res = fakeResponse()
  await serveStaticFile({
    request: req,
    response: res,
    distRoot: DIST,
    readStream: () => Readable.from(Buffer.from('console.log(1)')),
    fileExists: () => Promise.resolve(true),
  })
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff')
  assert.equal(res.headers['X-Frame-Options'], 'DENY')
  assert.equal(res.headers['Referrer-Policy'], 'no-referrer')
  assert.equal(res.headers['Content-Security-Policy'], undefined)
})

test('serveStaticFile for a CSS asset sets the three headers but NO Content-Security-Policy', async () => {
  const req: StaticRequest = { url: '/gitbusy/assets/index-Abc.css' }
  const res = fakeResponse()
  await serveStaticFile({
    request: req,
    response: res,
    distRoot: DIST,
    readStream: () => Readable.from(Buffer.from('body{color:red}')),
    fileExists: () => Promise.resolve(true),
  })
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff')
  assert.equal(res.headers['Referrer-Policy'], 'no-referrer')
  assert.equal(res.headers['Content-Security-Policy'], undefined)
})

test('serveStaticFile 404 on traversal still sets the three security headers', async () => {
  const req: StaticRequest = { url: '/gitbusy/%2e%2e/etc/passwd' }
  const res = fakeResponse()
  await serveStaticFile({
    request: req,
    response: res,
    distRoot: DIST,
    readStream: () => { throw new Error('should not be called for traversal') },
  })
  assert.equal(res.statusCode, 404)
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff')
  assert.equal(res.headers['X-Frame-Options'], 'DENY')
  assert.equal(res.headers['Referrer-Policy'], 'no-referrer')
  assert.equal(res.headers['Content-Security-Policy'], undefined)
})

test('serveStaticFile 404 on missing file still sets the three security headers', async () => {
  const req: StaticRequest = { url: '/gitbusy/missing.html' }
  const res = fakeResponse()
  await serveStaticFile({
    request: req,
    response: res,
    distRoot: DIST,
    readStream: () => { throw new Error('missing') },
    fileExists: () => Promise.resolve(false),
  })
  assert.equal(res.statusCode, 404)
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff')
  assert.equal(res.headers['X-Frame-Options'], 'DENY')
})

test('serveStaticFile SPA fallback /gitbusy/explore sets the three headers plus the CSP', async () => {
  const req: StaticRequest = { url: '/gitbusy/explore' }
  const res = fakeResponse()
  await serveStaticFile({
    request: req,
    response: res,
    distRoot: DIST,
    readStream: () => Readable.from(Buffer.from('<html>spa</html>')),
    fileExists: () => Promise.resolve(true),
  })
  assert.equal(res.headers['Content-Type'], 'text/html; charset=utf-8')
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff')
  assert.match(res.headers['Content-Security-Policy'] ?? '', /^default-src 'self';/)
})