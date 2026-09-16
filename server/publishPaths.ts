import { Buffer } from 'node:buffer'

// Publish-path canonicalization — APPSEC-006 / DC-011.
// Replaces the inline `validPublishPath` literal check in
// `server/githubProxy.ts:preparePublishFiles` with a single pure
// function that:
//   1. Trims and rejects empty input.
//   2. Rejects paths that start with `/` or `\` (leading-slash rule
//      covers Windows-style paths as well).
//   3. Splits on `/`, percent-decodes each segment in isolation so a
//      malformed `%` in one segment does not abort the whole path.
//   4. NFC-normalizes each decoded segment so user-provided paths
//      collapse to the same form GitHub stores.
//   5. Rejects segments equal to `.` or `..`, segments containing NUL,
//      and segments that exceed the per-segment byte ceiling.
//   6. Rejects the documented reserved top-level segment names
//      (`.git`, `.github`, `.hg`, `.svn`, `node_modules`) on a
//      case-insensitive comparison.
//
// Returns either `{ ok: true, canonical }` for downstream dedupe
// and emit, or `{ ok: false, reason }` for the existing `filesSkipped`
// list with a stable user-facing reason.

export const RESERVED_TOP_LEVEL: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  '.github',
  '.hg',
  '.svn',
])

export const MAX_PATH_BYTES = 240
export const MAX_SEGMENT_BYTES = 100

export type CanonicalizeResult =
  | { ok: true; canonical: string }
  | {
      ok: false
      reason:
        | 'too-long'
        | 'empty'
        | 'leading-slash'
        | 'segment-empty'
        | 'segment-dot'
        | 'segment-nul'
        | 'segment-bad-encoding'
        | 'reserved'
        | 'segment-too-long'
    }

export function canonicalizePublishPath(raw: string): CanonicalizeResult {
  if (typeof raw !== 'string') return { ok: false, reason: 'empty' }
  const trimmed = raw.trim()
  if (!trimmed) return { ok: false, reason: 'empty' }
  if (trimmed.startsWith('/') || trimmed.startsWith('\\') || trimmed.includes('\\')) return { ok: false, reason: 'leading-slash' }
  if (Buffer.byteLength(trimmed, 'utf8') > MAX_PATH_BYTES) return { ok: false, reason: 'too-long' }

  const rawSegments = trimmed.split('/')
  const decoded: string[] = []
  for (const seg of rawSegments) {
    if (!seg) return { ok: false, reason: 'segment-empty' }
    let segment: string
    try {
      segment = decodeURIComponent(seg)
    } catch {
      return { ok: false, reason: 'segment-bad-encoding' }
    }
    if (segment.includes('\0')) return { ok: false, reason: 'segment-nul' }
    if (segment === '.' || segment === '..') return { ok: false, reason: 'segment-dot' }
    if (Buffer.byteLength(segment, 'utf8') > MAX_SEGMENT_BYTES) return { ok: false, reason: 'segment-too-long' }
    decoded.push(segment.normalize('NFC'))
  }

  // Reserved-name check is case-insensitive on the top-level segment.
  // The decoded form has already been NFC-normalized so e.g. an
  // NFC-equivalent of `.git` is rejected identically.
  const firstLower = decoded[0].toLowerCase()
  if (RESERVED_TOP_LEVEL.has(firstLower)) return { ok: false, reason: 'reserved' }

  return { ok: true, canonical: decoded.join('/') }
}