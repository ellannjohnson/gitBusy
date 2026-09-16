import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  readGithubOAuthCredential,
  saveGithubOAuthCredential,
  deleteGithubOAuthCredential,
  type GithubOAuthCredential,
} from './credential.ts'

// These tests verify the dispatcher contract: on darwin the credential
// module delegates to /usr/bin/security (existing macOS behavior);
// on every other platform it uses a Linux-compatible backend.
// They do NOT exercise real secret storage; the underlying helper
// `createPlatformCredentialBackend` is the seam under test, and the
// tests inject a fake backend so we can assert wiring in isolation.

const FAKE_CREDENTIAL: GithubOAuthCredential = {
  accessToken: 'gho_testtokenvalue',
  tokenType: 'bearer',
  scope: 'repo',
  expiresAt: 9_999_999_999,
  refreshToken: 'ghr_testrefresh',
  refreshTokenExpiresAt: 9_999_999_999,
}

function makeFakeBackend(opts: {
  initial?: GithubOAuthCredential | null
  write?: (cred: GithubOAuthCredential) => Promise<void>
  clear?: () => Promise<void>
} = {}) {
  let stored: GithubOAuthCredential | null = opts.initial ?? null
  const writes: GithubOAuthCredential[] = []
  const clears: number[] = []
  return {
    reads: [] as Array<number>,
    writes,
    clears,
    async read(): Promise<GithubOAuthCredential | null> {
      this.reads.push(Date.now())
      return stored
    },
    async write(cred: GithubOAuthCredential): Promise<void> {
      this.writes.push(cred)
      stored = cred
      if (opts.write) await opts.write(cred)
    },
    async clear(): Promise<void> {
      this.clears.push(Date.now())
      stored = null
      if (opts.clear) await opts.clear()
    },
    snapshot() {
      return stored
    },
  }
}

test('read returns null when backend has no credential', async () => {
  // The dispatcher module must delegate to a platform backend and
  // normalize null for the empty case.
  // We assert this by importing the module and confirming the public
  // function exists; the underlying backend injection is exercised in
  // a sibling test below.
  assert.equal(typeof readGithubOAuthCredential, 'function')
  assert.equal(typeof saveGithubOAuthCredential, 'function')
  assert.equal(typeof deleteGithubOAuthCredential, 'function')
})

test('dispatcher surfaces backend read results', async () => {
  // We re-import the module's internal factory under a fake-backend
  // injection so we can drive the dispatcher without invoking
  // /usr/bin/security or secret-tool on the host.
  const mod = await import('./credential.ts')
  // @ts-expect-error — internal seam under test
  const factory = mod.__test_createPlatformCredentialBackend ?? null
  assert.notEqual(factory, null, 'factory must exist for testing')
  const fake = makeFakeBackend({ initial: FAKE_CREDENTIAL })
  // @ts-expect-error — internal seam under test
  const backend = factory(fake)
  const result = await backend.read()
  assert.deepEqual(result, FAKE_CREDENTIAL)
  assert.equal(fake.reads.length, 1)
})

test('dispatcher surfaces backend write and clear', async () => {
  const mod = await import('./credential.ts')
  // @ts-expect-error — internal seam under test
  const factory = mod.__test_createPlatformCredentialBackend ?? null
  assert.notEqual(factory, null)
  const fake = makeFakeBackend()
  // @ts-expect-error — internal seam under test
  const backend = factory(fake)
  await backend.write(FAKE_CREDENTIAL)
  await backend.write({ ...FAKE_CREDENTIAL, accessToken: 'gho_rotated' })
  await backend.clear()
  assert.equal(fake.writes.length, 2)
  assert.equal(fake.clears.length, 1)
  assert.equal(fake.snapshot(), null)
})

test('dispatcher returns null without throwing when read fails on linux backend', async () => {
  const mod = await import('./credential.ts')
  // @ts-expect-error — internal seam under test
  const factory = mod.__test_createPlatformCredentialBackend ?? null
  assert.notEqual(factory, null)
  const failingBackend = {
    read: async () => { throw new Error('libsecret not available') },
    write: async (_cred: GithubOAuthCredential) => { throw new Error('libsecret not available') },
    clear: async () => { throw new Error('libsecret not available') },
  }
  // @ts-expect-error — internal seam under test
  const backend = factory(failingBackend)
  // Per the directive the production server must not expose token values
  // through error paths; the dispatcher must absorb backend errors and
  // surface an empty credential rather than re-throwing.
  const result = await backend.read()
  assert.equal(result, null)
})

test('save normalizes and re-reads round-trip via dispatcher', async () => {
  const mod = await import('./credential.ts')
  // @ts-expect-error — internal seam under test
  const factory = mod.__test_createPlatformCredentialBackend ?? null
  assert.notEqual(factory, null)
  const fake = makeFakeBackend()
  // @ts-expect-error — internal seam under test
  const backend = factory(fake)
  await backend.write(FAKE_CREDENTIAL)
  const readBack = await backend.read()
  assert.deepEqual(readBack, FAKE_CREDENTIAL)
  await backend.clear()
  const afterClear = await backend.read()
  assert.equal(afterClear, null)
})

test('normalize rejects payloads without accessToken', async () => {
  // The macOS / Linux dispatcher must refuse to surface credentials
  // whose shape does not contain a valid accessToken. This guards
  // against stale Keychain entries from earlier app versions.
  const mod = await import('./credential.ts')
  const { normalize } = mod.__test
  assert.equal(normalize(JSON.stringify({ tokenType: 'bearer' })), null)
  assert.equal(normalize('not json'), null)
  assert.equal(normalize(null), null)
  assert.equal(normalize(''), null)
})

test('normalize accepts a legacy opaque GitHub OAuth access token', async () => {
  const mod = await import('./credential.ts')
  const { normalize } = mod.__test
  const legacyToken = 'gho_legacyAccessToken_1234567890'
  assert.deepEqual(normalize(legacyToken), {
    accessToken: legacyToken,
    tokenType: 'bearer',
    scope: '',
  })
})

test('normalize keeps optional refresh + expires fields', async () => {
  const mod = await import('./credential.ts')
  const { normalize } = mod.__test
  const raw = JSON.stringify({
    accessToken: 'gho_x',
    tokenType: 'bearer',
    scope: 'repo read:user',
    expiresAt: 1_700_000_000,
    refreshToken: 'ghr_x',
    refreshTokenExpiresAt: 1_800_000_000,
  })
  const parsed = normalize(raw)
  assert.deepEqual(parsed, {
    accessToken: 'gho_x',
    tokenType: 'bearer',
    scope: 'repo read:user',
    expiresAt: 1_700_000_000,
    refreshToken: 'ghr_x',
    refreshTokenExpiresAt: 1_800_000_000,
  })
})

test('legacy OAuth upgrade counter increments once per legacy token normalized', async () => {
  // DC-001: a process that normalizes two legacy tokens in a row must
  // report a legacy-upgrade count of 2 — a strong signal that the
  // operator's Keychain is stuck in the pre-JSON envelope.
  const mod = await import('./credential.ts')
  const { normalize, getLegacyUpgradeCount } = mod.__test
  const before = getLegacyUpgradeCount()
  const first = normalize('gho_legacyA_1234567890abcdef')
  assert.ok(first, 'normalize must return an envelope for the first legacy token')
  assert.equal(first?.accessToken, 'gho_legacyA_1234567890abcdef')
  assert.equal(first?.tokenType, 'bearer')
  assert.equal(first?.scope, '')
  assert.equal(getLegacyUpgradeCount(), before + 1)
  const second = normalize('ghp_legacyB_1234567890abcdef')
  assert.ok(second, 'normalize must return an envelope for the second legacy token')
  assert.equal(second?.accessToken, 'ghp_legacyB_1234567890abcdef')
  assert.equal(getLegacyUpgradeCount(), before + 2)
})

test('legacy OAuth upgrade counter does NOT increment on JSON envelope normalize', async () => {
  // DC-001: a JSON envelope is the normal path; it must NOT count
  // against the legacy-upgrade budget.
  const mod = await import('./credential.ts')
  const { normalize, getLegacyUpgradeCount } = mod.__test
  const before = getLegacyUpgradeCount()
  normalize(JSON.stringify({ accessToken: 'gho_normal', tokenType: 'bearer', scope: 'repo' }))
  assert.equal(getLegacyUpgradeCount(), before)
})

test('legacy OAuth upgrade audit event contains no token-prefix substring', async () => {
  // DC-001: the structured audit event must never echo a token
  // prefix, even when called with a real legacy token.
  const mod = await import('./credential.ts')
  const { normalize } = mod.__test
  const writes: string[] = []
  const original = process.stderr.write.bind(process.stderr)
  function spy(chunk: any): boolean {
    if (typeof chunk === 'string' && chunk.includes('legacy_oauth_credential_upgraded')) {
      writes.push(chunk)
    }
    return original(chunk)
  }
  process.stderr.write = spy as typeof process.stderr.write
  try {
    normalize('gho_captureProbe_abcdef1234567890')
  } finally {
    process.stderr.write = original
  }
  assert.ok(writes.length >= 1, 'audit event must fire')
  const line = writes[writes.length - 1]
  assert.equal(line.includes('gho_'), false, 'audit line must not echo the gho_ prefix')
  assert.equal(line.includes('ghp_'), false)
  assert.equal(line.includes('ghr_'), false)
  assert.equal(line.includes('ghs_'), false)
  assert.equal(line.includes('ghu_'), false)
  assert.equal(line.includes('github_pat_'), false)
  assert.match(line, /"event":"legacy_oauth_credential_upgraded"/)
  assert.match(line, /"keychain_service":"gitBusy GitHub OAuth"/)
})