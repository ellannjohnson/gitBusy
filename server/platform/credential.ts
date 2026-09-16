import { spawn } from 'node:child_process'
import { audit } from '../audit.ts'

// github OAuth credential envelope. Stored verbatim across platforms so
// a macOS install and a Linux install encode the same shape and can
// share test fixtures.
export type GithubOAuthCredential = {
  accessToken: string
  tokenType: string
  scope: string
  expiresAt?: number
  refreshToken?: string
  refreshTokenExpiresAt?: number
}

export type CredentialBackend = {
  read(): Promise<GithubOAuthCredential | null>
  write(cred: GithubOAuthCredential): Promise<void>
  clear(): Promise<void>
}

const GITHUB_OAUTH_KEYCHAIN_SERVICE = 'gitBusy GitHub OAuth'
const GITHUB_OAUTH_KEYCHAIN_ACCOUNT = 'github-oauth-token'
const LEGACY_GITHUB_ACCESS_TOKEN = /^(?:gh[opsu]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)$/

// DC-001: process-scoped counter of legacy-token upgrades. A process
// that increments this more than once is a strong signal that the
// operator's Keychain / secret-tool entry is stuck in the pre-JSON
// envelope and will be re-normalized on every read. The counter is
// read via __test.getLegacyUpgradeCount().
let legacyCredentialUpgrades = 0

function finitePositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function normalize(raw: string | null): GithubOAuthCredential | null {
  if (!raw) return null
  const stored = raw.trim()
  let value: Record<string, unknown>
  try {
    value = JSON.parse(stored) as Record<string, unknown>
  } catch {
    // gitBusy versions before the JSON credential envelope stored a GitHub
    // access token directly in the same Keychain item. Keep that credential
    // usable while rejecting arbitrary non-JSON Keychain content.
    if (!LEGACY_GITHUB_ACCESS_TOKEN.test(stored)) return null
    legacyCredentialUpgrades += 1
    audit('legacy_oauth_credential_upgraded', {
      keychain_service: GITHUB_OAUTH_KEYCHAIN_SERVICE,
      count: legacyCredentialUpgrades,
    })
    return { accessToken: stored, tokenType: 'bearer', scope: '' }
  }
  if (typeof value.accessToken !== 'string' || !value.accessToken) return null
  return {
    accessToken: value.accessToken,
    tokenType: typeof value.tokenType === 'string' && value.tokenType ? value.tokenType : 'bearer',
    scope: typeof value.scope === 'string' ? value.scope : '',
    expiresAt: finitePositiveNumber(value.expiresAt),
    refreshToken: typeof value.refreshToken === 'string' && value.refreshToken ? value.refreshToken : undefined,
    refreshTokenExpiresAt: finitePositiveNumber(value.refreshTokenExpiresAt),
  }
}

function spawnCollect(binary: string, args: string[], stdinPayload?: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => { stdout += chunk })
    child.stderr?.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      resolve({ stdout, stderr, code })
    })
    if (stdinPayload !== undefined) child.stdin.end(stdinPayload)
  })
}

function createMacosKeychainBackend(): CredentialBackend {
  return {
    async read() {
      try {
        const { stdout, code } = await spawnCollect('/usr/bin/security', [
          'find-generic-password',
          '-a', GITHUB_OAUTH_KEYCHAIN_ACCOUNT,
          '-s', GITHUB_OAUTH_KEYCHAIN_SERVICE,
          '-w',
        ])
        if (code !== 0) return null
        return normalize(stdout.trim())
      } catch {
        return null
      }
    },
    async write(cred) {
      await spawnCollect('/usr/bin/security', [
        'add-generic-password',
        '-a', GITHUB_OAUTH_KEYCHAIN_ACCOUNT,
        '-s', GITHUB_OAUTH_KEYCHAIN_SERVICE,
        '-w', JSON.stringify(cred),
        '-U',
      ])
    },
    async clear() {
      try {
        await spawnCollect('/usr/bin/security', [
          'delete-generic-password',
          '-a', GITHUB_OAUTH_KEYCHAIN_ACCOUNT,
          '-s', GITHUB_OAUTH_KEYCHAIN_SERVICE,
        ])
      } catch {
        // Idempotent: missing entry is success.
      }
    },
  }
}

// Linux primary: libsecret via `secret-tool`. The launcher is documented
// in DIRECTIVE.md §2.3. We require explicit user consent by requiring
// the binary to be present (the launcher documents the install command).
function createLinuxSecretToolBackend(): CredentialBackend {
  return {
    async read() {
      try {
        const { stdout, code } = await spawnCollect('secret-tool', [
          'lookup',
          'service', GITHUB_OAUTH_KEYCHAIN_SERVICE,
          'account', GITHUB_OAUTH_KEYCHAIN_ACCOUNT,
        ])
        if (code !== 0) return null
        return normalize(stdout.trim())
      } catch {
        return null
      }
    },
    async write(cred) {
      await spawnCollect('secret-tool', [
        'store',
        '--label', GITHUB_OAUTH_KEYCHAIN_SERVICE,
        'service', GITHUB_OAUTH_KEYCHAIN_SERVICE,
        'account', GITHUB_OAUTH_KEYCHAIN_ACCOUNT,
      ], JSON.stringify(cred))
    },
    async clear() {
      try {
        await spawnCollect('secret-tool', [
          'clear',
          'service', GITHUB_OAUTH_KEYCHAIN_SERVICE,
          'account', GITHUB_OAUTH_KEYCHAIN_ACCOUNT,
        ])
      } catch {
        // Idempotent: missing entry is success.
      }
    },
  }
}

// In-memory backend used by tests. Production code paths never construct
// this directly; it is exported through the testing seam below.
function createInMemoryBackend(initial: GithubOAuthCredential | null = null): CredentialBackend & { snapshot(): GithubOAuthCredential | null } {
  let stored: GithubOAuthCredential | null = initial
  return {
    read: async () => stored,
    write: async (cred) => { stored = cred },
    clear: async () => { stored = null },
    snapshot: () => stored,
  }
}

// Public dispatcher. The platform dispatch happens once at module load
// time and is captured by closure; later changes to process.platform
// (not expected) do not retroactively change behavior.
function createPlatformCredentialBackend(): CredentialBackend {
  if (process.platform === 'darwin') return createMacosKeychainBackend()
  return createLinuxSecretToolBackend()
}

// Internal seam for tests only. Strips the surrounding closure so tests
// can inject a backend without invoking real keychain / secret-tool code.
export function __test_createPlatformCredentialBackend(backend: CredentialBackend): CredentialBackend {
  return {
    async read() {
      try {
        return await backend.read()
      } catch {
        return null
      }
    },
    async write(cred) {
      try {
        await backend.write(cred)
      } catch {
        // Swallow on the dispatcher side so callers do not need to wrap.
      }
    },
    async clear() {
      try {
        await backend.clear()
      } catch {
        // Idempotent.
      }
    },
  }
}

const backend = createPlatformCredentialBackend()

export async function readGithubOAuthCredential(): Promise<GithubOAuthCredential | null> {
  return backend.read()
}

export async function saveGithubOAuthCredential(cred: GithubOAuthCredential): Promise<void> {
  return backend.write(cred)
}

export async function deleteGithubOAuthCredential(): Promise<void> {
  return backend.clear()
}

// Test-only helpers — not part of the production API surface.
export const __test = {
  createInMemoryBackend,
  normalize,
  getLegacyUpgradeCount: () => legacyCredentialUpgrades,
}