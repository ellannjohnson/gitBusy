import { randomBytes } from 'node:crypto'

// Tailscale mobile-access pairing — APPSEC-005 / DC-012.
// The PairingGate is the single source of truth for the active pairing
// code, its TTL, and the failed-attempt counter that locks the
// endpoint. The handler in server/githubProxy.ts is a thin wrapper that
// translates its result into HTTP responses.
//
// Defaults: 8 random bytes (16 uppercase hex chars, 64 bits of entropy),
// 5-minute TTL, 5 wrong attempts per lifetime lock the gate for 5
// minutes. The counter is per code value, not per remote IP — the
// service is a single-user local / tailnet-paired product, so a more
// elaborate keying scheme adds complexity without changing the threat
// model. The constructor accepts seams for tests and for a future
// configuration surface.

export type PairingGateOptions = {
  codeByteLength?: number
  maxAttempts?: number
  codeTtlMs?: number
  lockoutMs?: number
  now?: () => number
}

export type PairingAttempt =
  | { ok: true }
  | { ok: false; reason: 'no-code' | 'expired' | 'locked' | 'wrong'; retryAfterSeconds: number }

export class PairingGate {
  readonly codeByteLength: number
  readonly maxAttempts: number
  readonly codeTtlMs: number
  readonly lockoutMs: number
  private readonly now: () => number
  private code = ''
  private codeExpiresAt = 0
  private attempts = 0
  private lockedUntil = 0

  constructor(opts: PairingGateOptions = {}) {
    this.codeByteLength = opts.codeByteLength ?? 8
    this.maxAttempts = opts.maxAttempts ?? 5
    this.codeTtlMs = opts.codeTtlMs ?? 5 * 60 * 1000
    this.lockoutMs = opts.lockoutMs ?? 5 * 60 * 1000
    this.now = opts.now ?? (() => Date.now())
  }

  // Mints a fresh code, resets the attempt counter, and clears any
  // active lockout. The caller must NOT log the returned `code`.
  issueCode(rng: () => Buffer = () => randomBytes(this.codeByteLength)): { code: string; expiresAt: number } {
    this.code = rng().toString('hex').toUpperCase()
    this.codeExpiresAt = this.now() + this.codeTtlMs
    this.attempts = 0
    this.lockedUntil = 0
    return { code: this.code, expiresAt: this.codeExpiresAt }
  }

  // Forgets the active code. Use when the user toggles Tailscale Serve
  // off, or when the operator wants to invalidate a code in flight.
  reset(): void {
    this.code = ''
    this.codeExpiresAt = 0
    this.attempts = 0
    this.lockedUntil = 0
  }

  // Returns the active pairing code (empty string when none). The
  // /api/network/status handler reads this so the SPA can show the
  // code in Settings; the caller is responsible for not leaking it.
  activeCode(): string {
    return this.code
  }

  // Validates a pairing submission. `rawCode` is the trimmed, upper-
  // cased string from the request body. The function is the only place
  // that mutates `attempts` / `lockedUntil`.
  tryAccept(rawCode: string): PairingAttempt {
    const now = this.now()
    if (!this.code) return { ok: false, reason: 'no-code', retryAfterSeconds: 0 }
    if (now >= this.codeExpiresAt) return { ok: false, reason: 'expired', retryAfterSeconds: 0 }
    if (now < this.lockedUntil) {
      return { ok: false, reason: 'locked', retryAfterSeconds: Math.ceil((this.lockedUntil - now) / 1000) }
    }
    if (rawCode.trim().toUpperCase() !== this.code) {
      this.attempts += 1
      if (this.attempts >= this.maxAttempts) {
        this.lockedUntil = now + this.lockoutMs
      }
      return {
        ok: false,
        reason: 'wrong',
        retryAfterSeconds: this.lockedUntil > now ? Math.ceil((this.lockedUntil - now) / 1000) : 0,
      }
    }
    this.attempts = 0
    this.lockedUntil = 0
    return { ok: true }
  }
}