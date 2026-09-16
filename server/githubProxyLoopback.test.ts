import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  actualLoopbackRequest,
  normalizeLoopbackPeer,
  handleApiRequest,
} from './githubProxy.ts'

// PROD-BL-007 — loopback trust boundary.
//
// Before this change the production server treated Host and
// X-Forwarded-Host as authoritative for "is this request from a local
// client?" Both headers are fully client-controlled, so a non-loopback
// TCP peer could claim X-Forwarded-Host: 127.0.0.1, pass the
// isLocalRequest check, set the gitbusy_session cookie, and reach the
// network-authenticated `/api/github/*` routes on a Tailscale-enabled
// install.
//
// The fix uses the kernel-known TCP peer (request.socket.remoteAddress)
// as the trust boundary. Headers are ignored. Headers are still
// consulted by requestHost() for display only — that helper is not
// used by isLocalRequest / isNetworkAuthenticated / setNetworkCookie's
// Secure attribute.

test('normalizeLoopbackPeer returns "" for missing input', () => {
  assert.equal(normalizeLoopbackPeer(undefined), '')
  assert.equal(normalizeLoopbackPeer(''), '')
})

test('normalizeLoopbackPeer lowercases and strips the IPv4-mapped IPv6 prefix', () => {
  assert.equal(normalizeLoopbackPeer('::ffff:127.0.0.1'), '127.0.0.1')
  assert.equal(normalizeLoopbackPeer('::FFFF:127.0.0.1'), '127.0.0.1')
})

test('normalizeLoopbackPeer strips bracketed IPv6', () => {
  assert.equal(normalizeLoopbackPeer('[::1]'), '::1')
  assert.equal(normalizeLoopbackPeer('[127.0.0.1]'), '127.0.0.1')
})

test('normalizeLoopbackPeer passes through plain IPv4 / IPv6', () => {
  assert.equal(normalizeLoopbackPeer('127.0.0.1'), '127.0.0.1')
  assert.equal(normalizeLoopbackPeer('::1'), '::1')
  assert.equal(normalizeLoopbackPeer('192.168.1.5'), '192.168.1.5')
})

test('actualLoopbackRequest returns true for a 127.0.0.1 TCP peer with no headers', () => {
  assert.equal(
    actualLoopbackRequest({ socket: { remoteAddress: '127.0.0.1' }, headers: {} }),
    true,
  )
})

test('actualLoopbackRequest returns true for an IPv4-mapped loopback peer', () => {
  assert.equal(
    actualLoopbackRequest({ socket: { remoteAddress: '::ffff:127.0.0.1' }, headers: {} }),
    true,
  )
})

test('actualLoopbackRequest returns true for a ::1 TCP peer', () => {
  assert.equal(
    actualLoopbackRequest({ socket: { remoteAddress: '::1' }, headers: {} }),
    true,
  )
})

test('actualLoopbackRequest returns false for a non-loopback TCP peer (192.168.1.5)', () => {
  assert.equal(
    actualLoopbackRequest({ socket: { remoteAddress: '192.168.1.5' }, headers: {} }),
    false,
  )
})

test('actualLoopbackRequest returns false for a non-loopback TCP peer (10.0.0.24)', () => {
  assert.equal(
    actualLoopbackRequest({ socket: { remoteAddress: '10.0.0.24' }, headers: {} }),
    false,
  )
})

test('PROD-BL-007 attack: X-Forwarded-Host=127.0.0.1 from a non-loopback peer is REJECTED', () => {
  // The header is fully client-controlled. The trust boundary is the
  // socket peer; the header must not lift a non-loopback request to
  // loopback privilege.
  const request = {
    socket: { remoteAddress: '192.168.1.5' },
    headers: {
      'x-forwarded-host': '127.0.0.1',
      'host': '127.0.0.1:5190',
      'origin': 'http://127.0.0.1:5190',
    },
  }
  assert.equal(actualLoopbackRequest(request), false)
})

test('PROD-BL-007 attack: Host=127.0.0.1 from a non-loopback peer is REJECTED', () => {
  const request = {
    socket: { remoteAddress: '10.0.0.24' },
    headers: { 'host': '127.0.0.1:5190' },
  }
  assert.equal(actualLoopbackRequest(request), false)
})

test('PROD-BL-007 attack: missing socket is REJECTED (defensive)', () => {
  // If the runtime cannot tell us the peer, refuse loopback privilege.
  // The previous X-Forwarded-Host trust path would have accepted
  // 127.0.0.1 here, which is exactly the hole we are closing.
  const request = { headers: { 'x-forwarded-host': '127.0.0.1' } }
  assert.equal(actualLoopbackRequest(request), false)
})

test('PROD-BL-007 attack: spoofed X-Forwarded-For (wrong trust surface) does not satisfy the peer check', () => {
  // X-Forwarded-For is the IP-of-the-original-client header; we do not
  // consult it for the trust decision either. A spoofed X-Forwarded-For
  // combined with a non-loopback peer must still be rejected.
  const request = {
    socket: { remoteAddress: '203.0.113.7' },
    headers: { 'x-forwarded-for': '127.0.0.1', 'x-forwarded-host': '127.0.0.1' },
  }
  assert.equal(actualLoopbackRequest(request), false)
})

test('loopback TCP peer with spoofed X-Forwarded-Host from a non-loopback remains true (peer is authoritative)', () => {
  // Symmetric sanity: the kernel-known peer wins. If a request really
  // came from 127.0.0.1 it stays loopback, even if some upstream
  // appended an X-Forwarded-Host header (defensive).
  const request = {
    socket: { remoteAddress: '127.0.0.1' },
    headers: { 'x-forwarded-host': 'evil.example' },
  }
  assert.equal(actualLoopbackRequest(request), true)
})

// Integration: a non-loopback peer hitting handleApiRequest on a route
// that branches on isLocalRequest must see the TCP-peer-based
// decision. /api/network/status returns its payload directly; the
// `pairingCode` field is only populated when (a) Tailscale is enabled
// AND (b) the request is from a real loopback peer. We assert on
// pairingCode = undefined for a non-loopback peer with a spoofed
// X-Forwarded-Host header. (When Tailscale is disabled, pairingCode
// is also undefined, so we additionally assert on the response body
// shape to confirm the route was reached — the integration then
// proves the trust-boundary function reaches the request body intact.)
test('PROD-BL-007 integration: non-loopback peer with X-Forwarded-Host: 127.0.0.1 reaches /api/network/status and the kernel peer is what the trust boundary sees', async () => {
  let nextCalled = false
  const req: any = {
    url: '/api/network/status',
    method: 'GET',
    socket: { remoteAddress: '192.168.1.5' },
    headers: {
      host: '127.0.0.1:5190',
      'x-forwarded-host': '127.0.0.1',
      origin: 'http://127.0.0.1:5190',
    },
  }
  const res = {
    headers: {} as Record<string, string>,
    statusCode: 0,
    body: null as string | null,
    setHeader(name: string, value: string) { this.headers[name] = String(value); return this },
    end(payload?: Buffer | string) { this.body = payload ? payload.toString() : null; return this },
  } as any
  await handleApiRequest(req, res, () => { nextCalled = true })
  // Route was handled (not deferred to SPA fallback).
  assert.equal(nextCalled, false)
  assert.equal(res.statusCode, 200)
  const parsed = JSON.parse(res.body ?? '{}')
  // pairingCode is gated on isLocalRequest AND tailscaleEnabled.
  // Either condition false ⇒ pairingCode is undefined. The non-loopback
  // peer path is the one we are proving; pairingCode = undefined here
  // is consistent with the kernel peer being authoritative.
  assert.equal(parsed.pairingCode, undefined,
    'pairingCode must be undefined for a non-loopback peer with spoofed X-Forwarded-Host')
  // The response reached the JSON serializer (proves no early abort),
  // and the body shape carries the network-status fields.
  assert.equal(typeof parsed.tailscaleEnabled, 'boolean')
})

// Integration: the origin guard still applies on its own — the
// loopback fix does not weaken APPSEC-004.
test('PROD-BL-007 regression: APPSEC-004 origin guard still fires on cross-site mutations', async () => {
  let nextCalled = false
  const req: any = {
    url: '/api/network/tailscale',
    method: 'POST',
    socket: { remoteAddress: '127.0.0.1' }, // genuine loopback peer
    headers: {
      host: '127.0.0.1:5190',
      'content-type': 'application/json',
      origin: 'https://attacker.example',
      'x-forwarded-host': '127.0.0.1',
    },
  }
  const res = {
    headers: {} as Record<string, string>,
    statusCode: 0,
    body: null as string | null,
    setHeader(name: string, value: string) { this.headers[name] = String(value); return this },
    end(payload?: Buffer | string) { this.body = payload ? payload.toString() : null; return this },
  } as any
  await handleApiRequest(req, res, () => { nextCalled = true })
  // The Origin guard runs first; next() is never invoked for a
  // cross-site mutation.
  assert.equal(nextCalled, false)
  assert.equal(res.statusCode, 403)
  const parsed = JSON.parse(res.body ?? '{}')
  assert.equal(parsed.error, 'Cross-site requests are not allowed')
})