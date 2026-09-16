import assert from 'node:assert/strict'
import { test } from 'node:test'
import { audit } from './audit.ts'

// Server-side audit logger — DC-001.
// Writes a structured JSON line to stderr so it can be captured by
// the runtime directory's server.log without exposing credentials.
// The forbidden-key check rejects any payload whose top-level key
// contains a sensitive substring so a future caller cannot
// accidentally pass an access token or HTTP body to be logged.

// Capture stderr writes during the test so we can assert the output.
type StderrSnapshot = { writes: string[]; restore: () => void }
function captureStderr(): StderrSnapshot {
  const writes: string[] = []
  const original = process.stderr.write.bind(process.stderr)
  // Replace stderr.write with one that records the line and forwards to
  // the original writer so the test runner's output stays intact.
  process.stderr.write = ((chunk: any, ...rest: any[]): boolean => {
    if (typeof chunk === 'string') writes.push(chunk)
    return (original as any)(chunk, ...rest)
  }) as typeof process.stderr.write
  return {
    writes,
    restore: () => { process.stderr.write = original },
  }
}

test('audit writes a JSON line containing the event name and a safe payload', () => {
  const snap = captureStderr()
  try {
    audit('foo_event', { ok: true, count: 3 })
    assert.equal(snap.writes.length, 1)
    const line = snap.writes[0]
    assert.ok(line.endsWith('\n'))
    const parsed = JSON.parse(line.trim())
    assert.equal(parsed.event, 'foo_event')
    assert.equal(parsed.ok, true)
    assert.equal(parsed.count, 3)
    assert.equal(typeof parsed.ts, 'string')
    assert.equal(typeof parsed.level, 'string')
  } finally {
    snap.restore()
  }
})

test('audit uses the requested log level', () => {
  const snap = captureStderr()
  try {
    audit('warn_event', { ok: false }, 'warn')
    const parsed = JSON.parse(snap.writes[0].trim())
    assert.equal(parsed.level, 'warn')
    assert.equal(parsed.event, 'warn_event')
  } finally {
    snap.restore()
  }
})

test('audit throws on a forbidden top-level key (token)', () => {
  assert.throws(() => audit('foo', { accessToken: 'gho_x' }))
  assert.throws(() => audit('foo', { token: 'x' }))
  assert.throws(() => audit('foo', { refresh_token: 'ghr_x' }))
})

test('audit throws on a forbidden top-level key (authorization / cookie / body / secret / password)', () => {
  assert.throws(() => audit('foo', { authorization_header: 'Bearer x' }))
  assert.throws(() => audit('foo', { cookie: 'session=abc' }))
  assert.throws(() => audit('foo', { request_body: 'foo=bar' }))
  assert.throws(() => audit('foo', { client_secret: 'sk_x' }))
  assert.throws(() => audit('foo', { password: 'hunter2' }))
})

test('audit throws case-insensitively on forbidden substrings', () => {
  assert.throws(() => audit('foo', { Authorization_Header: 'Bearer x' }))
  assert.throws(() => audit('foo', { MyTokenField: 'x' }))
  assert.throws(() => audit('foo', { CookieJar: 'x' }))
  assert.throws(() => audit('foo', { ResponseBody: 'x' }))
})

test('audit strips non-scalar values silently (only scalars reach stderr)', () => {
  const snap = captureStderr()
  try {
    audit('foo', { ok: true, deep: { inner: 'x' }, list: [1, 2], fn: () => 1 })
    assert.equal(snap.writes.length, 1)
    const parsed = JSON.parse(snap.writes[0].trim())
    assert.equal(parsed.ok, true)
    assert.equal(parsed.deep, undefined)
    assert.equal(parsed.list, undefined)
    assert.equal(parsed.fn, undefined)
  } finally {
    snap.restore()
  }
})

test('audit accepts an empty payload', () => {
  const snap = captureStderr()
  try {
    audit('bare_event')
    assert.equal(snap.writes.length, 1)
    const parsed = JSON.parse(snap.writes[0].trim())
    assert.equal(parsed.event, 'bare_event')
  } finally {
    snap.restore()
  }
})

test('audit does NOT echo the access-token prefix patterns in any line', () => {
  // Belt-and-suspenders: even if a future change bypasses the key
  // filter, the structured line must not contain a token prefix.
  const snap = captureStderr()
  try {
    audit('safe_event', { ok: true, count: 1 })
    const line = snap.writes[0]
    assert.equal(line.includes('gho_'), false)
    assert.equal(line.includes('ghp_'), false)
    assert.equal(line.includes('ghr_'), false)
    assert.equal(line.includes('ghs_'), false)
    assert.equal(line.includes('ghu_'), false)
    assert.equal(line.includes('github_pat_'), false)
  } finally {
    snap.restore()
  }
})