import { join } from 'node:path'

// XDG Base Directory paths plus the macOS Application Support path.
// We expose only the resolved paths the proxy/launcher ask for; no
// process-wide state is mutated.

export type PlatformPaths = {
  // Directory that holds ephemeral runtime state (pid file).
  runtime: string
  // Log file path.
  log: string
  // PID file path. Always inside `runtime`.
  pid: string
  // Cache directory (Vite cache, future ephemeral caches).
  cache: string
  // Long-lived data directory (credentials fallback, downloads).
  data: string
}

export type RuntimeOptions = {
  home: string
  env: Record<string, string | undefined>
  platform: NodeJS.Platform
}

// Pure resolver: given the host env, return absolute paths. Tests pass
// `env` and `platform` explicitly so they do not depend on the host
// environment.
export function runtimePaths(opts: RuntimeOptions): PlatformPaths {
  const home = opts.home || ''
  if (opts.platform === 'darwin') {
    const root = join(home, 'Library/Application Support/gitBusy')
    return {
      runtime: root,
      log: join(root, 'server.log'),
      pid: join(root, 'server.pid'),
      cache: join(root, 'cache'),
      data: join(root, 'data'),
    }
  }
  // Linux + other POSIX. Honor XDG Base Directory spec.
  const runtime = opts.env.XDG_RUNTIME_DIR || '/tmp'
  const stateHome = opts.env.XDG_STATE_HOME || join(home, '.local/state')
  const cacheHome = opts.env.XDG_CACHE_HOME || join(home, '.cache')
  const dataHome = opts.env.XDG_DATA_HOME || join(home, '.local/share')
  const runtimeRoot = join(runtime, 'gitbusy')
  const stateRoot = join(stateHome, 'gitbusy')
  return {
    runtime: runtimeRoot,
    log: join(stateRoot, 'server.log'),
    pid: join(runtimeRoot, 'server.pid'),
    cache: join(cacheHome, 'gitbusy'),
    data: join(dataHome, 'gitbusy'),
  }
}

// Production entry point. Reads process.env + process.platform.
export function currentRuntimePaths(): PlatformPaths {
  return runtimePaths({
    home: process.env.HOME || '',
    env: process.env,
    platform: process.platform,
  })
}