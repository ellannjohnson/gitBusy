import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Readable } from 'node:stream'
import {
  parseListenOptions,
  buildProductionServerRequestListener,
  type ProductionServerOptions,
} from './productionServer.ts'

// The production server module wraps handleApiRequest + staticFiles
// into a Node http request listener. These tests cover the wiring
// (binding defaults, request routing, static-fallback) without
// touching the network.

test('parseListenOptions defaults to 127.0.0.1:5174', () => {
  const opts = parseListenOptions({})
  assert.equal(opts.host, '127.0.0.1')
  assert.equal(opts.port, 5174)
})

test('parseListenOptions honors GITBUSY_HOST and GITBUSY_PORT', () => {
  const opts = parseListenOptions({
    GITBUSY_HOST: '127.0.0.2',
    GITBUSY_PORT: '6000',
    GITBUSY_ALLOW_NON_LOOPBACK: '1',
  })
  assert.equal(opts.host, '127.0.0.2')
  assert.equal(opts.port, 6000)
})

test('parseListenOptions rejects non-loopback hosts unless explicitly allow-listed', () => {
  // Binding to 0.0.0.0 exposes the API to the LAN. Default-deny.
  assert.throws(() => parseListenOptions({ GITBUSY_HOST: '0.0.0.0' }), /loopback/i)
  assert.throws(() => parseListenOptions({ GITBUSY_HOST: '192.168.1.1' }), /loopback/i)
})

test('parseListenOptions accepts loopback aliases', () => {
  assert.equal(parseListenOptions({ GITBUSY_HOST: 'localhost' }).host, 'localhost')
  assert.equal(parseListenOptions({ GITBUSY_HOST: '::1' }).host, '::1')
})

test('parseListenOptions rejects invalid ports', () => {
  assert.throws(() => parseListenOptions({ GITBUSY_PORT: 'not-a-port' }), /port/i)
  assert.throws(() => parseListenOptions({ GITBUSY_PORT: '0' }), /port/i)
  assert.throws(() => parseListenOptions({ GITBUSY_PORT: '70000' }), /port/i)
})

test('listener routes API paths to handleApiRequest', async () => {
  const apiCalls: Array<{ url: string }> = []
  const handleApiRequest = async (request: any, response: any, _next: any) => {
    apiCalls.push({ url: request.url })
    response.statusCode = 200
    response.end('api-ok')
  }
  const opts: ProductionServerOptions = {
    distRoot: '/srv/dist',
    handleApiRequest: handleApiRequest as any,
  }
  const listener = buildProductionServerRequestListener(opts)
  const fakeReq: any = { url: '/api/github/auth/status', method: 'GET', headers: {} }
  const fakeRes: any = {
    headers: {},
    statusCode: 0,
    body: null,
    setHeader(name: string, value: string) { this.headers[name] = value; return this },
    end(payload?: Buffer | string) { this.body = payload ?? null; return this },
  }
  await listener(fakeReq, fakeRes)
  assert.equal(apiCalls.length, 1)
  assert.equal(apiCalls[0].url, '/api/github/auth/status')
  assert.equal(fakeRes.statusCode, 200)
  assert.equal(fakeRes.body, 'api-ok')
})

test('listener falls through to static files for non-API paths', async () => {
  // The real handleApiRequest defers non-API paths by calling next().
  // The fake below mirrors that behavior so the production listener's
  // next-callback path is exercised end to end.
  const handleApiRequest = async (_request: any, _response: any, next: any) => { next() }
  const opts: ProductionServerOptions = {
    distRoot: '/srv/dist',
    handleApiRequest: handleApiRequest as any,
    readStream: (path) => {
      assert.equal(path, '/srv/dist/index.html')
      return Readable.from(Buffer.from('<html>OK</html>'))
    },
    fileExists: () => Promise.resolve(true),
  }
  const listener = buildProductionServerRequestListener(opts)
  const fakeReq: any = { url: '/gitbusy/', method: 'GET', headers: {} }
  const fakeRes: any = {
    headers: {},
    statusCode: 0,
    body: null,
    setHeader(name: string, value: string) { this.headers[name] = value; return this },
    end(payload?: Buffer | string) { this.body = payload ?? null; return this },
  }
  await listener(fakeReq, fakeRes)
  assert.equal(fakeRes.statusCode, 200)
  assert.equal(fakeRes.headers['Content-Type'], 'text/html; charset=utf-8')
  assert.equal(fakeRes.body?.toString(), '<html>OK</html>')
})

test('listener serves SPA fallback under /gitbusy/<route> as index.html', async () => {
  const handleApiRequest = async (_request: any, _response: any, next: any) => { next() }
  const opts: ProductionServerOptions = {
    distRoot: '/srv/dist',
    handleApiRequest: handleApiRequest as any,
    readStream: (path) => {
      assert.equal(path, '/srv/dist/index.html')
      return Readable.from(Buffer.from('<html>spa</html>'))
    },
    fileExists: () => Promise.resolve(true),
  }
  const listener = buildProductionServerRequestListener(opts)
  const fakeReq: any = { url: '/gitbusy/explore/littleknown', method: 'GET', headers: {} }
  const fakeRes: any = {
    headers: {},
    statusCode: 0,
    body: null,
    setHeader(name: string, value: string) { this.headers[name] = value; return this },
    end(payload?: Buffer | string) { this.body = payload ?? null; return this },
  }
  await listener(fakeReq, fakeRes)
  assert.equal(fakeRes.statusCode, 200)
  assert.equal(fakeRes.body?.toString(), '<html>spa</html>')
})

test('listener 404s traversal attempts without touching the filesystem', async () => {
  const opts: ProductionServerOptions = {
    distRoot: '/srv/dist',
    handleApiRequest: async (_req: any, _res: any, next: any) => { next() },
    fileExists: () => { throw new Error('must not stat on traversal') },
    readStream: () => { throw new Error('must not stream on traversal') },
  }
  const listener = buildProductionServerRequestListener(opts)
  const fakeReq: any = { url: '/gitbusy/%2e%2e/etc/passwd', method: 'GET', headers: {} }
  const fakeRes: any = {
    headers: {},
    statusCode: 0,
    body: null,
    setHeader(name: string, value: string) { this.headers[name] = value; return this },
    end(payload?: Buffer | string) { this.body = payload ?? null; return this },
  }
  await listener(fakeReq, fakeRes)
  assert.equal(fakeRes.statusCode, 404)
})

// APPSEC-002 — the deferred static-fallback path must ship the three
// base security headers on every response (404 included) and the HTTP
// CSP header on every text/html response (SPA shell + fallback).

test('listener deferred fallback to /gitbusy/ ships the three headers plus the CSP', async () => {
  const handleApiRequest = async (_request: any, _response: any, next: any) => { next() }
  const opts: ProductionServerOptions = {
    distRoot: '/srv/dist',
    handleApiRequest: handleApiRequest as any,
    readStream: () => Readable.from(Buffer.from('<html>OK</html>')),
    fileExists: () => Promise.resolve(true),
  }
  const listener = buildProductionServerRequestListener(opts)
  const fakeReq: any = { url: '/gitbusy/', method: 'GET', headers: {} }
  const fakeRes: any = {
    headers: {},
    statusCode: 0,
    body: null,
    setHeader(name: string, value: string) { this.headers[name] = value; return this },
    end(payload?: Buffer | string) { this.body = payload ?? null; return this },
  }
  await listener(fakeReq, fakeRes)
  assert.equal(fakeRes.statusCode, 200)
  assert.equal(fakeRes.headers['X-Content-Type-Options'], 'nosniff')
  assert.equal(fakeRes.headers['X-Frame-Options'], 'DENY')
  assert.equal(fakeRes.headers['Referrer-Policy'], 'no-referrer')
  assert.match(fakeRes.headers['Content-Security-Policy'] ?? '', /^default-src 'self';/)
})

test('listener deferred fallback for an asset path ships the three headers WITHOUT CSP', async () => {
  const handleApiRequest = async (_request: any, _response: any, next: any) => { next() }
  const opts: ProductionServerOptions = {
    distRoot: '/srv/dist',
    handleApiRequest: handleApiRequest as any,
    readStream: () => Readable.from(Buffer.from('console.log(1)')),
    fileExists: () => Promise.resolve(true),
  }
  const listener = buildProductionServerRequestListener(opts)
  const fakeReq: any = { url: '/gitbusy/assets/index-Abc.js', method: 'GET', headers: {} }
  const fakeRes: any = {
    headers: {},
    statusCode: 0,
    body: null,
    setHeader(name: string, value: string) { this.headers[name] = value; return this },
    end(payload?: Buffer | string) { this.body = payload ?? null; return this },
  }
  await listener(fakeReq, fakeRes)
  assert.equal(fakeRes.headers['X-Content-Type-Options'], 'nosniff')
  assert.equal(fakeRes.headers['Referrer-Policy'], 'no-referrer')
  assert.equal(fakeRes.headers['Content-Security-Policy'], undefined)
})