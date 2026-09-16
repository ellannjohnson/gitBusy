import type { IncomingMessage, ServerResponse } from 'node:http'
import { serveStaticFile } from './staticFiles.ts'

// Production HTTP server. Reuses the existing API handler from
// `server/githubProxy.ts` (passed in as `handleApiRequest`) so the
// Vite plugin and the standalone server serve the same routes.
// Static files are served from the production `dist/` directory
// under both `/` and `/gitbusy/` (the Vite base path baked into
// the build output).

export type ProductionServerOptions = {
  distRoot: string
  handleApiRequest: (request: IncomingMessage, response: ServerResponse, next: () => void) => Promise<void>
  // Optional seams so tests can drive the static handler without
  // touching the real filesystem.
  readStream?: (absolutePath: string) => import('node:stream').Readable
  fileExists?: (absolutePath: string) => Promise<boolean>
}

export type ListenOptions = {
  host: string
  port: number
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

// Parse host/port from GITBUSY_HOST/GITBUSY_PORT (or direct override).
// Refuses non-loopback hosts unless explicitly allow-listed via
// GITBUSY_ALLOW_NON_LOOPBACK=1 — binding to 0.0.0.0 would expose the
// GitHub proxy and credential surface to the LAN.
export function parseListenOptions(env: Record<string, string | undefined>): ListenOptions {
  const host = (env.GITBUSY_HOST || '127.0.0.1').trim() || '127.0.0.1'
  const portText = (env.GITBUSY_PORT || '5174').trim()
  const port = Number.parseInt(portText, 10)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`GITBUSY_PORT must be an integer between 1 and 65535 (got ${JSON.stringify(portText)})`)
  }
  if (!LOOPBACK_HOSTS.has(host)) {
    const allow = env.GITBUSY_ALLOW_NON_LOOPBACK === '1'
    if (!allow) {
      throw new Error(`Refusing to bind ${host}: loopback only (set GITBUSY_HOST=127.0.0.1 or GITBUSY_ALLOW_NON_LOOPBACK=1)`)
    }
  }
  return { host, port }
}

// Build the request listener the Node http server invokes. Routes:
// - /api/* (and /gitbusy/api/* after strip) → handleApiRequest
// - everything else → static file from distRoot
//
// Both Vite dev (HMR) and the production server register the same
// handler at the same priority so behavior is identical.
export function buildProductionServerRequestListener(opts: ProductionServerOptions) {
  return async function listener(request: IncomingMessage, response: ServerResponse): Promise<void> {
    await new Promise<void>((resolve) => {
      let settled = false
      const done = () => { if (!settled) { settled = true; resolve() } }
      let deferred = false
      void opts.handleApiRequest(request, response, () => {
        deferred = true
        // Defer to static file handler when the API router has no opinion.
        void serveStaticFile({
          request: { url: request.url },
          response: adaptServerResponse(response),
          distRoot: opts.distRoot,
          ...(opts.readStream ? { readStream: opts.readStream } : {}),
          ...(opts.fileExists ? { fileExists: opts.fileExists } : {}),
        }).then(done, done)
      }).then(() => {
        // If handleApiRequest handled the request itself (no defer),
        // resolve so the listener does not hang.
        if (!deferred) done()
      })
    })
  }
}

// Adapt a real Node ServerResponse to the smaller StaticResponse
// interface so serveStaticFile does not have to know about http types.
// Node's ServerResponse already exposes `statusCode` as a settable
// property, so this is essentially a structural cast.
function adaptServerResponse(response: ServerResponse) {
  return response as unknown as import('./staticFiles.ts').StaticResponse
}