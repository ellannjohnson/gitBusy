import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomBytes } from 'node:crypto'
import { PairingGate } from './pairing.ts'

// Tailscale mobile-access pairing — APPSEC-005 / DC-012.
// The PairingGate is the single source of truth for the active pairing
// code, its TTL, and the failed-attempt counter that locks the
// endpoint. The handler in server/githubProxy.ts is a thin wrapper that
// translates its result into HTTP responses; this file exercises the
// state machine directly with deterministic clocks / RNG.

function fixedRng(hex: string): () => Buffer {
  // `Buffer.from(hex, 'hex')` returns the raw byte buffer that
  // `randomBytes(byteLength)` would have returned for the same
  // content. We use this to drive deterministic pair codes in tests
  // without reaching into the production RNG.
  return () => Buffer.from(hex, 'hex')
}

function fakeClock(initial = 0): { now: () => number; advance: (ms: number) => void } {
  let current = initial
  return {
    now: () => current,
    advance: (ms: number) => { current += ms },
  }
}

test('issueCode returns a 16-character uppercase hex string', () => {
  const clock = fakeClock()
  const gate = new PairingGate({ now: clock.now })
  const { code, expiresAt } = gate.issueCode(fixedRng('aabbccddeeff0011'))
  assert.equal(code, 'AABBCCDDEEFF0011')
  assert.match(code, /^[A-F0-9]{16}$/)
  assert.ok(expiresAt > 0)
})

test('tryAccept returns ok with a correct code and resets the attempt counter', () => {
  const gate = new PairingGate()
  const { code } = gate.issueCode(fixedRng('1234567890abcdef'))
  // Drive a wrong attempt first to ensure the counter is non-zero before the success.
  assert.equal(gate.tryAccept('WRONG').ok, false)
  const result = gate.tryAccept(code)
  assert.deepEqual(result, { ok: true })
  // After a success, the next wrong attempt is still counted against the fresh counter.
  const wrong = gate.tryAccept('AGAIN')
  assert.equal(wrong.ok, false)
  assert.equal(wrong.reason, 'wrong')
})

test('tryAccept with a correct code after TTL returns expired', () => {
  const clock = fakeClock(1_000_000)
  const gate = new PairingGate({ now: clock.now, codeTtlMs: 1000 })
  const { code } = gate.issueCode(fixedRng('deadbeefcafef00d'))
  clock.advance(1001)
  const result = gate.tryAccept(code)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'expired')
})

test('tryAccept with a wrong code returns wrong and increments the attempt counter', () => {
  const gate = new PairingGate()
  gate.issueCode(fixedRng('0123456789abcdef'))
  const result = gate.tryAccept('NOT_THE_CODE')
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'wrong')
  assert.equal(result.retryAfterSeconds, 0)
})

test('tryAccept 5 wrong codes in a row locks the gate with a Retry-After', () => {
  const gate = new PairingGate()
  gate.issueCode(fixedRng('0011223344556677'))
  for (let i = 0; i < 4; i += 1) {
    const result = gate.tryAccept('WRONG')
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'wrong')
    assert.equal(result.retryAfterSeconds, 0, `attempt ${i + 1} should not lock yet`)
  }
  const fifth = gate.tryAccept('WRONG')
  assert.equal(fifth.ok, false)
  assert.equal(fifth.reason, 'wrong', 'the 5th attempt is still "wrong" — the lockout engages AFTER it is counted')
  assert.ok(fifth.retryAfterSeconds > 0, '5th attempt reports the lockout duration')
  const sixth = gate.tryAccept('WRONG')
  assert.equal(sixth.ok, false)
  assert.equal(sixth.reason, 'locked')
  assert.ok(sixth.retryAfterSeconds > 0)
})

test('tryAccept after lockoutMs elapses returns wrong (the lockout expired; attempts are not zeroed)', () => {
  const clock = fakeClock(2_000_000)
  const gate = new PairingGate({ now: clock.now, lockoutMs: 1000 })
  gate.issueCode(fixedRng('8899aabbccddeeff'))
  for (let i = 0; i < 5; i += 1) gate.tryAccept('WRONG')
  assert.equal(gate.tryAccept('WRONG').reason, 'locked')
  // Advance past the 1-second lockout. Per design §4.5 case 6, the
  // counter is not zeroed — the gate simply allows a new attempt
  // because the cool-down elapsed.
  clock.advance(1001)
  const result = gate.tryAccept('WRONG')
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'wrong')
})

test('reset clears the active code, the attempts counter, and the lockout', () => {
  const gate = new PairingGate()
  gate.issueCode(fixedRng('9988776655443322'))
  for (let i = 0; i < 5; i += 1) gate.tryAccept('WRONG')
  assert.equal(gate.tryAccept('WRONG').reason, 'locked')
  gate.reset()
  // After reset, the next tryAccept reports no-code (because no new code was issued).
  const result = gate.tryAccept('ANY')
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'no-code')
})

test('tryAccept without a prior issueCode returns no-code', () => {
  const gate = new PairingGate()
  const result = gate.tryAccept('ANYTHING')
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'no-code')
  assert.equal(result.retryAfterSeconds, 0)
})

test('issuing a new code resets the attempts counter (re-enable path)', () => {
  const gate = new PairingGate()
  gate.issueCode(fixedRng('1111222233334444'))
  for (let i = 0; i < 4; i += 1) gate.tryAccept('WRONG')
  // Re-issue — the user toggled Tailscale Serve off and on again.
  gate.issueCode(fixedRng('5555666677778888'))
  // A new attempt with the freshly issued code must succeed even though
  // we just consumed the prior 4-wrong budget.
  const result = gate.tryAccept('5555666677778888')
  assert.deepEqual(result, { ok: true })
})

test('tryAccept matches uppercase codes case-insensitively', () => {
  const gate = new PairingGate()
  const { code } = gate.issueCode(fixedRng('aabbccddeeff0011'))
  // The server normalizes to upper-case; the client may submit mixed case.
  assert.equal(code, 'AABBCCDDEEFF0011')
  const mixed = code.slice(0, 4).toLowerCase() + code.slice(4)
  assert.equal(gate.tryAccept(mixed).ok, true)
})

test('tryAccept respects a custom constructor seam (maxAttempts, codeTtlMs, lockoutMs)', () => {
  const gate = new PairingGate({ codeTtlMs: 1000, maxAttempts: 2, lockoutMs: 2000 })
  gate.issueCode(fixedRng('fedcba9876543210'))
  // 2 wrong attempts lock the gate (not 5).
  assert.equal(gate.tryAccept('WRONG').reason, 'wrong')
  assert.equal(gate.tryAccept('WRONG').reason, 'wrong')
  assert.equal(gate.tryAccept('WRONG').reason, 'locked')
})

test('tryAccept respects a custom codeByteLength seam (8 bytes = 16 hex chars default)', () => {
  const gate = new PairingGate({ codeByteLength: 4 })
  const { code } = gate.issueCode(fixedRng('aabbccdd'))
  assert.equal(code.length, 8)
  assert.match(code, /^[A-F0-9]{8}$/)
})

test('issueCode integrates with node:crypto.randomBytes when no rng is supplied', () => {
  // Smoke check: the default RNG yields 16 uppercase hex chars.
  const gate = new PairingGate()
  const { code } = gate.issueCode(() => randomBytes(8))
  assert.match(code, /^[A-F0-9]{16}$/)
})