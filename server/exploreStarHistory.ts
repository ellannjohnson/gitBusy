// Pure aggregation + ranking for GitHub's official
// `GET /repos/{owner}/{repo}/stargazers/history` endpoint.
//
// The endpoint returns an array of weekly buckets (newest first):
//   { week: <unix-seconds-sunday>, total: <number>, days: [sun..sat] }
// This module aggregates those weekly buckets into a per-period total of
// star additions and returns a deterministic ranking.
//
// Safety:
// - No stargazer identities are ever returned to the caller.
// - The history response may include other fields; we only read what we need.
// - The module is pure: callers pass `now` explicitly; no clock, no fs.

const DAY_MS = 86_400_000

export type StarHistoryBucket = {
  week: number // unix seconds at the start of the week (Sunday)
  total?: number
  days?: number[] // index 0 = Sunday, length 7
  [extra: string]: unknown
}

export type StarHistoryGrowthCandidate = {
  id: number
  owner: string
  name: string
  full_name: string
  stargazers_count: number
}

export type AggregateGrowthResult = {
  starAdditions: number
  daysObserved: number
  unavailable: boolean
}

export type RankedGrowthRepo = {
  id: number
  owner: string
  name: string
  full_name: string
  stargazers_count: number
  starGrowth: number
}

export type RankedGrowthResult = RankedGrowthRepo[] & { unavailableCount: number }

function isSupportedPeriod(periodDays: number): periodDays is 7 | 14 | 30 {
  return periodDays === 7 || periodDays === 14 || periodDays === 30
}

function asInteger(value: unknown): number | null {
  if (typeof value !== 'number') return null
  if (!Number.isFinite(value)) return null
  if (!Number.isInteger(value)) return null
  return value
}

function isValidBucket(bucket: unknown): bucket is StarHistoryBucket {
  if (!bucket || typeof bucket !== 'object') return false
  const week = asInteger((bucket as StarHistoryBucket).week)
  if (week === null || week <= 0) return false
  const days = (bucket as StarHistoryBucket).days
  if (!Array.isArray(days) || days.length !== 7) return false
  for (const day of days) {
    if (asInteger(day) === null || (day as number) < 0) return false
  }
  return true
}

/**
 * Aggregate a single weekly bucket's day counts whose calendar day falls inside
 * the requested `[windowStart, now]` window. Bucket boundaries are calendar-based
 * on whatever timezone GitHub used to bucket the data (not guaranteed UTC).
 */
function aggregateBucketDays(
  bucket: StarHistoryBucket,
  periodDays: 7 | 14 | 30,
  now: number,
): AggregateGrowthResult {
  const windowStart = now - periodDays * DAY_MS
  let starAdditions = 0
  let daysObserved = 0
  const weekMs = bucket.week * 1000
  for (let i = 0; i < 7; i += 1) {
    const dayStartMs = weekMs + i * DAY_MS
    if (dayStartMs < windowStart) continue
    if (dayStartMs > now) continue
    const count = bucket.days![i]!
    starAdditions += count
    daysObserved += 1
  }
  return { starAdditions, daysObserved, unavailable: false }
}

export function aggregateStarHistoryGrowth(
  history: StarHistoryBucket[] | StarHistoryBucket,
  periodDays: 7 | 14 | 30,
  now: number,
): AggregateGrowthResult {
  if (!isSupportedPeriod(periodDays)) {
    throw new Error(`Unsupported periodDays: ${periodDays}. Must be 7, 14, or 30.`)
  }
  const buckets = Array.isArray(history) ? history : [history]
  if (buckets.length === 0) {
    return { starAdditions: 0, daysObserved: 0, unavailable: false }
  }
  let totalAdditions = 0
  let totalDays = 0
  for (const bucket of buckets) {
    if (!isValidBucket(bucket)) {
      return { starAdditions: 0, daysObserved: 0, unavailable: true }
    }
    const result = aggregateBucketDays(bucket, periodDays, now)
    totalAdditions += result.starAdditions
    totalDays += result.daysObserved
  }
  return { starAdditions: totalAdditions, daysObserved: totalDays, unavailable: false }
}

export function rankStarHistoryGrowth(
  candidates: StarHistoryGrowthCandidate[],
  historyById: Map<number, StarHistoryBucket[]>,
  periodDays: 7 | 14 | 30,
  now: number,
): RankedGrowthResult {
  if (!isSupportedPeriod(periodDays)) {
    throw new Error(`Unsupported periodDays: ${periodDays}. Must be 7, 14, or 30.`)
  }
  const ranked: RankedGrowthRepo[] = []
  let unavailableCount = 0
  for (const candidate of candidates) {
    const history = historyById.get(candidate.id)
    if (!history || history.length === 0) {
      unavailableCount += 1
      continue
    }
    const aggregate = aggregateStarHistoryGrowth(history, periodDays, now)
    if (aggregate.unavailable) {
      unavailableCount += 1
      continue
    }
    if (aggregate.starAdditions <= 0) {
      // No growth in the window — drop from the "fastest growing" shelf rather
      // than return negative or zero entries.
      continue
    }
    ranked.push({
      id: candidate.id,
      owner: candidate.owner,
      name: candidate.name,
      full_name: candidate.full_name,
      stargazers_count: candidate.stargazers_count,
      starGrowth: aggregate.starAdditions,
    })
  }
  ranked.sort((a, b) => {
    if (b.starGrowth !== a.starGrowth) return b.starGrowth - a.starGrowth
    if (b.stargazers_count !== a.stargazers_count) return b.stargazers_count - a.stargazers_count
    return a.id - b.id
  })
  const capped = ranked.slice(0, 100)
  const result = capped as RankedGrowthResult
  result.unavailableCount = unavailableCount
  return result
}
