// Server-side audit log — DC-001.
// Writes a structured JSON line to stderr so the runtime directory's
// server.log captures it without exposing credentials. Callers pass
// stable event names and a flat record of scalar values.
//
// The forbidden-key filter is a defense-in-depth: it rejects any
// payload whose top-level key contains a sensitive substring
// (case-insensitive: token / secret / password / authorization /
// cookie / body / response). A future caller who forgets the rule
// gets an immediate throw at the audit() call site rather than a
// token leaking to stderr. Nested values are NOT deeply inspected
// — the structured log line only includes top-level scalars.

type Level = 'info' | 'warn' | 'error'

const FORBIDDEN_KEY_FRAGMENTS = [
  'token',
  'secret',
  'password',
  'authorization',
  'cookie',
  'body',
  'response',
]

function hasForbiddenKey(key: string): boolean {
  const lower = key.toLowerCase()
  return FORBIDDEN_KEY_FRAGMENTS.some((fragment) => lower.includes(fragment))
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

export function audit(event: string, payload: Record<string, unknown> = {}, level: Level = 'info'): void {
  const safe: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (hasForbiddenKey(key)) {
      throw new Error(`audit() refuses to log forbidden key "${key}"`)
    }
    if (isScalar(value)) safe[key] = value
  }
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...safe })
  process.stderr.write(line + '\n')
}