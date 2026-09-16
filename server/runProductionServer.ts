// Production server entry. Wires the standalone Node http server to
// the shared API handler and the production `dist/` static directory.
//
// Usage (from inside the bundled tarball):
//   ./bin/gitbusy-server.js
//   ./bin/gitbusy-server.js --port 6000
//
// Environment variables:
//   GITBUSY_HOST       — bind address (default 127.0.0.1)
//   GITBUSY_PORT       — bind port (default 5174)
//   GITBUSY_ALLOW_NON_LOOPBACK=1 — opt-in to bind on 0.0.0.0
//   GITBUSY_DIST       — path to the production build (default ../dist
//                        relative to this file; the launcher passes an
//                        absolute path via --dist)

import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildProductionServerRequestListener, parseListenOptions } from './productionServer.ts'
import { currentRuntimePaths } from './platform/runtimeDir.ts'
import { logLine } from './logging.ts'

function parseArgs(argv: string[]): { distRoot: string; envOverrides: Record<string, string> } {
  const envOverrides: Record<string, string> = {}
  let distRoot = ''
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--port' && argv[i + 1]) { envOverrides.GITBUSY_PORT = argv[++i] }
    else if (arg === '--host' && argv[i + 1]) { envOverrides.GITBUSY_HOST = argv[++i] }
    else if (arg === '--dist' && argv[i + 1]) { distRoot = argv[++i] }
  }
  return { distRoot, envOverrides }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const { distRoot: distArg, envOverrides } = parseArgs(argv)
  // Apply CLI overrides on top of the current environment.
  const env: Record<string, string | undefined> = { ...process.env, ...envOverrides }
  const listen = parseListenOptions(env)

  // Resolve dist root: explicit --dist wins, else relative to this file
  // (../dist inside the bundle, ../app/dist in dev).
  let distRoot = distArg
  if (!distRoot) {
    const here = dirname(fileURLToPath(import.meta.url))
    distRoot = resolve(here, '..', 'dist')
  }

  // The OAuth client ID is public configuration, not a credential. A
  // packaged build may carry it next to the server source so end users do
  // not need to set an environment variable manually. Access/refresh tokens
  // remain in the platform credential store and are never read here.
  if (!process.env.GITBUSY_GITHUB_CLIENT_ID) {
    const resourcePath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'gitbusy-github-client-id')
    if (existsSync(resourcePath)) {
      const clientId = readFileSync(resourcePath, 'utf8').trim()
      if (clientId) process.env.GITBUSY_GITHUB_CLIENT_ID = clientId
    }
  }
  const { handleApiRequest } = await import('./githubProxy.ts')

  const paths = currentRuntimePaths()
  // Touch the runtime dir so log/pid writes succeed.
  const { mkdir } = await import('node:fs/promises')
  await mkdir(paths.runtime, { recursive: true })
  await mkdir(dirname(paths.log), { recursive: true })

  const listener = buildProductionServerRequestListener({
    distRoot,
    handleApiRequest,
  })

  const server = createServer(listener)

  // Graceful shutdown — bound by the 2 s directive budget.
  let shuttingDown = false
  const shutdown = (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    logLine(process.stdout, 'info', `Received ${signal}; shutting down.`)
    const timer = setTimeout(() => {
      logLine(process.stderr, 'error', 'Shutdown timed out; forcing exit.')
      process.exit(1)
    }, 2000)
    timer.unref()
    server.close(() => {
      clearTimeout(timer)
      process.exit(0)
    })
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  server.listen(listen.port, listen.host, () => {
    logLine(process.stdout, 'info', `gitBusy production server listening on http://${listen.host}:${listen.port}`)
    logLine(process.stdout, 'info', `Serving static files from ${distRoot}`)
  })
}

main().catch((error) => {
  logLine(process.stderr, 'error', `gitBusy production server failed to start: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})