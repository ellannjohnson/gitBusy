import { Readable } from 'node:stream'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { applyHtmlSecurityHeaders, applySecurityHeaders } from './securityHeaders.ts'
import { BASE_PATH_PREFIX } from './basePath.ts'

// Static file serving for the production HTTP server. Used by
// `server/productionServer.ts` after `handleApiRequest` defers a
// non-API request via its `next` callback.

export type StaticRequest = { url?: string }

export type StaticResponse = {
  setHeader(name: string, value: string): unknown
  statusCode: number
  end(payload?: Buffer | string): unknown
}

// Minimal MIME map. The Vite production build emits .js, .css, .svg,
// .png, .ico, .woff/woff2; everything else falls back to
// application/octet-stream so we do not invent type metadata.
const MIME_BY_EXT: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

const GITBUSY_PREFIX = BASE_PATH_PREFIX

// Decode percent-encoding and lowercase for case-insensitive ext lookup.
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return ''
  }
}

// Resolve the URL path to a file path under distRoot. Returns null
// when:
// - the URL escapes distRoot via traversal, encoded %2e%2e, or NUL
//   bytes;
// - the resolved path is not inside distRoot (defense in depth).
// The /gitbusy/ prefix is stripped so the same dist tree works at both
// `/` and `/gitbusy/`. SPA routes that resolve to non-asset paths
// fall back to `index.html` because the Vite output is single-page.
export function resolveStaticFile(opts: { urlPath: string; distRoot: string }): { absolutePath: string; mime: string } | null {
  let path = opts.urlPath
  // Strip the /gitbusy/ prefix when present so both base paths work.
  if (path === GITBUSY_PREFIX) path = '/'
  else if (path.startsWith(`${GITBUSY_PREFIX}/`)) path = path.slice(GITBUSY_PREFIX.length)

  // Reject obvious traversal markers. The path resolver below also
  // defends by checking the final path stays inside distRoot.
  if (path.includes('\0') || path.includes('\\')) return null

  // Split, decode each segment, drop leading slash artifacts.
  const segments = path.split('/').filter((segment) => segment !== '')
  if (segments.length === 0) {
    return { absolutePath: `${opts.distRoot}/index.html`, mime: MIME_BY_EXT['.html'] }
  }

  // Reject any segment that is a literal '..' or decodes to '..'
  // (defense against encoded %2e%2e).
  const decodedSegments: string[] = []
  for (const segment of segments) {
    const decoded = decodeSegment(segment)
    if (!decoded || decoded === '.' || decoded === '..') return null
    // NUL bytes are never valid in a URL path; reject after decode.
    if (decoded.includes('\0')) return null
    decodedSegments.push(decoded)
  }

  const candidate = `${opts.distRoot}/${decodedSegments.join('/')}`
  // Final safety: the resolved path must start with distRoot.
  if (!candidate.startsWith(opts.distRoot + '/') && candidate !== opts.distRoot) return null

  // Determine MIME from extension; fall back to octet-stream.
  const lastDot = candidate.lastIndexOf('.')
  const lastSlash = candidate.lastIndexOf('/')
  const ext = lastDot > lastSlash ? candidate.slice(lastDot).toLowerCase() : ''
  const mime = MIME_BY_EXT[ext] || 'application/octet-stream'

  // SPA fall-through: if the URL has no extension (last segment has
  // no dot), serve index.html so client-side routing still works.
  if (!ext) {
    return { absolutePath: `${opts.distRoot}/index.html`, mime: MIME_BY_EXT['.html']! }
  }
  return { absolutePath: candidate, mime }
}

export type ServeOptions = {
  request: StaticRequest
  response: StaticResponse
  distRoot: string
  // Injected seam so tests can drive the stream without touching disk.
  readStream?: (absolutePath: string) => Readable
  // Injected seam: does the resolved path exist as a regular file?
  fileExists?: (absolutePath: string) => Promise<boolean> | boolean
}

// Write the file (or a 404) to the response. The default seams call
// the real filesystem via node:fs; tests inject fakes.
export async function serveStaticFile(opts: ServeOptions): Promise<void> {
  const url = opts.request.url || '/'
  // Strip query string for resolution.
  const queryIndex = url.indexOf('?')
  const urlPath = queryIndex === -1 ? url : url.slice(0, queryIndex)
  const resolved = resolveStaticFile({ urlPath, distRoot: opts.distRoot })
  if (!resolved) {
    applySecurityHeaders(opts.response)
    opts.response.statusCode = 404
    opts.response.end('Not found')
    return
  }
  const exists = opts.fileExists ?? defaultFileExists
  if (!(await exists(resolved.absolutePath))) {
    applySecurityHeaders(opts.response)
    opts.response.statusCode = 404
    opts.response.end('Not found')
    return
  }
  // text/html responses ship the HTTP CSP header in addition to the
  // three base security headers; JSON and asset responses get the
  // three base headers only.
  if (resolved.mime === MIME_BY_EXT['.html']) {
    applyHtmlSecurityHeaders(opts.response)
  } else {
    applySecurityHeaders(opts.response)
  }
  opts.response.setHeader('Content-Type', resolved.mime)
  opts.response.setHeader('Cache-Control', 'no-store')
  opts.response.statusCode = 200
  const factory = opts.readStream ?? defaultReadStream
  const stream = factory(resolved.absolutePath)
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  opts.response.end(Buffer.concat(chunks))
}

async function defaultFileExists(path: string): Promise<boolean> {
  try {
    const result = await stat(path)
    return result.isFile()
  } catch {
    return false
  }
}

function defaultReadStream(absolutePath: string): Readable {
  return createReadStream(absolutePath) as unknown as Readable
}