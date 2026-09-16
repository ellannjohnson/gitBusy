import { existsSync } from 'node:fs'
import { join, delimiter as PATH_DELIMITER } from 'node:path'

// Returns the absolute path of the Tailscale binary on this host,
// or '' if Tailscale is not installed.
//
// On macOS we keep the historical candidates (the .app bundle plus
// ~/.local/bin/tailscale) and never scan PATH for arbitrary binaries;
// doing so would risk surfacing a similarly-named tool installed for
// something else.
//
// On Linux we look at distro-managed locations first
// (/usr/bin/tailscale, /usr/local/bin/tailscale,
// /opt/tailscale/bin/tailscale) and then walk PATH. The Tailscale apt
// and rpm packages install to /usr/bin/tailscale; the snap and static
// tarball installs land elsewhere on PATH.
const LINUX_DISTRO_CANDIDATES = [
  '/usr/bin/tailscale',
  '/usr/local/bin/tailscale',
  '/opt/tailscale/bin/tailscale',
] as const

const MACOS_DARWIN_CANDIDATES = (home: string): string[] => [
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  home ? join(home, '.local/bin/tailscale') : '',
]

export type ResolveOptions = {
  home: string
  pathDirs: string[]
  platform: NodeJS.Platform
  exists: (path: string) => boolean
}

// Pure resolver. Tests inject `exists` and `pathDirs` so we can drive
// every branch without touching the host filesystem or environment.
export function resolveTailscaleBinary(opts: ResolveOptions): string {
  const platform = opts.platform
  const home = opts.home || ''
  if (platform === 'darwin') {
    return MACOS_DARWIN_CANDIDATES(home).find((c) => c && opts.exists(c)) || ''
  }
  for (const candidate of LINUX_DISTRO_CANDIDATES) {
    if (opts.exists(candidate)) return candidate
  }
  for (const dir of opts.pathDirs) {
    if (!dir || !dir.trim()) continue
    const candidate = join(dir, 'tailscale')
    if (opts.exists(candidate)) return candidate
  }
  return ''
}

// Production resolver. Reads environment and dispatches based on
// process.platform. Caches the resolution per process so the proxy
// does not stat() the binary on every request.
let cached: string | null = null
export function tailscaleBinary(): string {
  if (cached !== null) return cached
  const home = process.env.HOME || ''
  const pathEnv = process.env.PATH || ''
  const platform = process.platform
  const pathDirs = platform === 'win32'
    ? pathEnv.split(';')
    : pathEnv.split(PATH_DELIMITER)
  cached = resolveTailscaleBinary({ home, pathDirs, platform, exists: existsSync })
  return cached
}