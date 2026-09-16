import { existsSync, mkdirSync, readFileSync, openSync, writeSync, closeSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'

export function growthHistoryPath(runtimeDir?: string): string {
  const dir = runtimeDir ?? resolveDefaultRuntimeDir()
  return join(dir, 'growth-history.json')
}

function resolveDefaultRuntimeDir(): string {
  const home = process.env.HOME || ''
  if (!home) return '/tmp/gitBusy'
  // Mirror the runtime location the macOS bundle uses when bundled, and the
  // dev fallback when running from a checkout.
  if (process.env.GITBUSY_RUNTIME_DIR) return process.env.GITBUSY_RUNTIME_DIR
  const bundled = join(home, 'Library/Application Support/gitBusy')
  const dev = join(process.cwd(), '.gitbusy-runtime')
  // Prefer the bundled location once the runtime marker exists; otherwise default to dev.
  if (existsSync(bundled)) return bundled
  return existsSync(dev) ? dev : bundled
}

export type GrowthCandidate = {
  id: number
  full_name: string
  stargazers_count: number
}

export type GrowthObservation = {
  observedAt: number
  stars: number
}

export type GrowthRepoHistory = {
  observations: GrowthObservation[]
}

export type GrowthHistory = {
  version: 1
  repos: Record<string, GrowthRepoHistory>
}

export type GrowthRankedRepo = {
  id: number
  full_name: string
  stargazers_count: number
  starGrowth: number
  baselineStars: number
  baselineAt: number
}

export type GrowthRankResult = {
  status: 'ready' | 'building'
  periodDays: 7 | 14 | 30
  note: string
  repos: GrowthRankedRepo[]
  meta: {
    trackedRepos: number
    observationsTotal: number
    windowStart: number | null
    windowEnd: number | null
    candidatesConsidered: number
    candidatesExcluded: number
  }
}

const DAY_MS = 86_400_000
const RETENTION_DAYS = 35
const RETENTION_MS = RETENTION_DAYS * DAY_MS
const TOLERANCE_DAYS = 2
const RESULT_CAP = 100

export function recordGrowthObservation(
  history: GrowthHistory,
  candidates: GrowthCandidate[],
  now: number,
): GrowthHistory {
  const cutoff = now - RETENTION_MS
  // Deep-clone input to preserve purity (callers can mutate freely).
  const next: GrowthHistory = { version: 1, repos: {} }
  for (const key of Object.keys(history.repos)) {
    const entry = history.repos[key]
    const kept = entry.observations
      .filter((obs) => obs.observedAt >= cutoff)
      .sort((a, b) => a.observedAt - b.observedAt)
    if (kept.length > 0) {
      next.repos[key] = { observations: kept }
    }
  }
  // De-duplicate by id within the pass; keep the highest observed star count.
  const byId = new Map<number, GrowthCandidate>()
  for (const c of candidates) {
    const existing = byId.get(c.id)
    if (!existing || c.stargazers_count > existing.stargazers_count) {
      byId.set(c.id, c)
    }
  }
  for (const c of byId.values()) {
    const key = String(c.id)
    const entry = next.repos[key] ?? { observations: [] }
    const lastObs = entry.observations[entry.observations.length - 1]
    // Skip if this exact observedAt is already recorded AND stars match.
    if (lastObs && lastObs.observedAt === now && lastObs.stars === c.stargazers_count) {
      continue
    }
    entry.observations = [...entry.observations, { observedAt: now, stars: c.stargazers_count }].sort(
      (a, b) => a.observedAt - b.observedAt,
    )
    next.repos[key] = entry
  }
  return next
}

function pickBaseline(observations: GrowthObservation[], boundary: number, toleranceBoundary: number): GrowthObservation | null {
  let best: GrowthObservation | null = null
  for (const obs of observations) {
    if (obs.observedAt > boundary) continue
    if (obs.observedAt < toleranceBoundary) continue
    if (!best || obs.observedAt > best.observedAt) best = obs
  }
  return best
}

export function rankGrowth(
  history: GrowthHistory,
  candidates: GrowthCandidate[],
  periodDays: 7 | 14 | 30,
  now: number,
): GrowthRankResult {
  if (periodDays !== 7 && periodDays !== 14 && periodDays !== 30) {
    throw new Error(`Unsupported periodDays: ${periodDays}. Must be 7, 14, or 30.`)
  }
  const periodMs = periodDays * DAY_MS
  const boundary = now - periodMs
  const toleranceBoundary = boundary - TOLERANCE_DAYS * DAY_MS

  // Compute observation totals and window bounds from tracked history first.
  let observationsTotal = 0
  let windowStart: number | null = null
  let windowEnd: number | null = null
  for (const entry of Object.values(history.repos)) {
    for (const obs of entry.observations) {
      observationsTotal++
      if (windowStart === null || obs.observedAt < windowStart) windowStart = obs.observedAt
      if (windowEnd === null || obs.observedAt > windowEnd) windowEnd = obs.observedAt
    }
  }

  const candidatesConsidered = candidates.length
  const ranked: GrowthRankedRepo[] = []
  let excluded = 0

  for (const c of candidates) {
    const entry = history.repos[String(c.id)]
    if (!entry) {
      excluded++
      continue
    }
    const baseline = pickBaseline(entry.observations, boundary, toleranceBoundary)
    if (!baseline) {
      excluded++
      continue
    }
    ranked.push({
      id: c.id,
      full_name: c.full_name,
      stargazers_count: c.stargazers_count,
      starGrowth: c.stargazers_count - baseline.stars,
      baselineStars: baseline.stars,
      baselineAt: baseline.observedAt,
    })
  }

  ranked.sort((a, b) => {
    if (b.starGrowth !== a.starGrowth) return b.starGrowth - a.starGrowth
    if (b.baselineStars !== a.baselineStars) return b.baselineStars - a.baselineStars
    return a.id - b.id
  })

  const capped = ranked.slice(0, RESULT_CAP)
  const trackedRepos = Object.keys(history.repos).length

  if (capped.length === 0) {
    return {
      status: 'building',
      periodDays,
      note: `Building ${periodDays}-day baseline — need at least one observation older than ${periodDays} days.`,
      repos: [],
      meta: {
        trackedRepos,
        observationsTotal,
        windowStart,
        windowEnd,
        candidatesConsidered,
        candidatesExcluded: excluded,
      },
    }
  }

  return {
    status: 'ready',
    periodDays,
    note: `Showing fastest growth in the last ${periodDays} days, among tracked repositories.`,
    repos: capped,
    meta: {
      trackedRepos,
      observationsTotal,
      windowStart,
      windowEnd,
      candidatesConsidered,
      candidatesExcluded: excluded,
    },
  }
}

export function loadGrowthHistory(filePath: string, now?: number): GrowthHistory {
  if (!existsSync(filePath)) {
    return { version: 1, repos: {} }
  }
  try {
    const raw = readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw) as GrowthHistory
    if (!parsed || parsed.version !== 1 || typeof parsed.repos !== 'object' || parsed.repos === null) {
      return { version: 1, repos: {} }
    }
    // Defensive prune on load (covers hand-edited files and clock drift).
    if (now !== undefined) {
      const cutoff = now - RETENTION_MS
      const pruned: GrowthHistory = { version: 1, repos: {} }
      for (const [key, entry] of Object.entries(parsed.repos)) {
        const kept = (entry?.observations ?? []).filter((obs) => obs.observedAt >= cutoff)
        if (kept.length > 0) pruned.repos[key] = { observations: kept }
      }
      return pruned
    }
    return parsed
  } catch {
    return { version: 1, repos: {} }
  }
}

let writeFlightInProgress = 0

export function saveGrowthHistory(filePath: string, history: GrowthHistory, now?: number): void {
  const flight = ++writeFlightInProgress
  const directory = dirname(filePath)
  mkdirSync(directory, { recursive: true })
  const payload = JSON.stringify(history, null, 2)
  const tmp = `${filePath}.${process.pid}.${flight}.tmp`
  const fd = openSync(tmp, 'w')
  try {
    writeSync(fd, payload)
  } finally {
    closeSync(fd)
  }
  renameSync(tmp, filePath)
  if (now !== undefined) {
    // `now` reserved for future schema migration; intentionally unused today.
    void now
  }
}
