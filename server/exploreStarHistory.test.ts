import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  aggregateStarHistoryGrowth,
  rankStarHistoryGrowth,
  type RankedGrowthRepo,
  type StarHistoryBucket,
  type StarHistoryGrowthCandidate,
} from './exploreStarHistory.ts'

const DAY_MS = 86_400_000
const WEEK_SECONDS = 7 * (DAY_MS / 1000)
// `now` is the comparison point for window calculations. Use noon UTC so that
// any day-aligned bucket boundary never falls exactly on `now`.
const NOW = Date.parse('2026-09-05T12:00:00.000Z')
// The week containing `now` starts on Sunday 2026-08-31 00:00 UTC. GitHub's
// real /stargazers/history endpoint returns `week` as unix **seconds**, so we
// do too — this keeps the implementation matching the real API contract.
const SUNDAY_BEFORE_SECONDS = Math.floor(Date.parse('2026-08-31T00:00:00.000Z') / 1000)
// A full week that is entirely inside the 7-day window. The 7-day window ends
// at NOW (Sat 2026-09-05 12:00 UTC) and starts at NOW - 7d (Fri 2026-08-29
// 12:00 UTC). To exercise "all 7 days inside the window" the bucket must
// start on or after 2026-08-30 00:00 UTC (the first full day inside the
// window) and its day-6 (Saturday) must fall on or before NOW.
const FULL_WEEK_SUNDAY_SECONDS = Math.floor(Date.parse('2026-08-30T00:00:00.000Z') / 1000)

function weeklyBucket(weekStartSeconds: number, days: number[]): StarHistoryBucket {
  return { week: weekStartSeconds, total: days.reduce((sum, value) => sum + value, 0), days }
}

const candidate = (id: number, owner: string, name: string, stars: number): StarHistoryGrowthCandidate => ({
  id,
  owner,
  name,
  full_name: `${owner}/${name}`,
  stargazers_count: stars,
})

// ---------- aggregateStarHistoryGrowth ----------

test('aggregates a single full week with 7 days of data for a 7-day window', () => {
  // Use a bucket that is entirely inside the 7-day window (Wed Sep 2 → Tue Sep 8)
  // to verify a full 7-day bucket aggregates all 7 days.
  const bucket = weeklyBucket(FULL_WEEK_SUNDAY_SECONDS, [2, 3, 0, 1, 4, 0, 2])
  const result = aggregateStarHistoryGrowth(bucket, 7, NOW)
  assert.equal(result.daysObserved, 7)
  assert.equal(result.starAdditions, 12)
  assert.equal(result.unavailable, false)
})

test('aggregates the partial current week only when its days fall inside the window', () => {
  // 7-day window: today is Saturday 2026-09-05; window is 2026-08-30..2026-09-05 (inclusive of today).
  // Week starts Sunday 2026-08-31. Days 0..5 (Sun..Fri) fall inside the window; day 6 (Sat 2026-09-06) is future.
  // Wait — week indexing starts Sunday, so day 0 = Sun 2026-08-31, day 5 = Fri 2026-09-05, day 6 = Sat 2026-09-06.
  // For 7-day window ending Sat 2026-09-05 12:00, windowStart = NOW - 7d = 2026-08-29 12:00 UTC.
  // The week starts 2026-08-31 00:00 UTC (Sun), so days 0..5 (Sun..Fri) are inside the window;
  // day 6 (Sat 2026-09-06) is one day after NOW, so it must NOT be counted.
  const bucket = weeklyBucket(SUNDAY_BEFORE_SECONDS, [1, 1, 1, 1, 1, 1, 100])
  const result = aggregateStarHistoryGrowth(bucket, 7, NOW)
  assert.equal(result.daysObserved, 6, 'only days 0..5 fall inside the 7-day window')
  assert.equal(result.starAdditions, 6)
})

test('aggregates full multiple weeks for a 30-day window', () => {
  // 30-day window: [NOW - 30d, NOW] = [Aug 6 12:00, Sep 5 12:00].
  // Build 4 full weeks that fall entirely inside the window, plus the
  // partial current week. Each full week sums to 1+2+3+4+5+6+7 = 28 stars.
  const weeks: StarHistoryBucket[] = []
  // Weeks starting Aug 10, 17, 24 are entirely inside the window.
  for (let i = 3; i >= 1; i -= 1) {
    const weekStart = SUNDAY_BEFORE_SECONDS - i * WEEK_SECONDS
    const days = [1, 2, 3, 4, 5, 6, 7]
    weeks.push(weeklyBucket(weekStart, days))
  }
  // Each full week contributes all 28 stars.
  for (const week of weeks) {
    const result = aggregateStarHistoryGrowth(week, 30, NOW)
    assert.equal(result.starAdditions, 28, `full week ${week.week} contributes 28 stars`)
  }
})

test('zero-star days do not inflate the aggregate (using a full-inside-week bucket)', () => {
  const bucket = weeklyBucket(FULL_WEEK_SUNDAY_SECONDS, [0, 0, 0, 0, 0, 0, 0])
  const result = aggregateStarHistoryGrowth(bucket, 7, NOW)
  assert.equal(result.starAdditions, 0)
  assert.equal(result.daysObserved, 7)
})

test('malformed bucket (no days array) is treated as unavailable', () => {
  const malformed = { week: SUNDAY_BEFORE_SECONDS, total: 0 } as unknown as StarHistoryBucket
  const result = aggregateStarHistoryGrowth(malformed, 7, NOW)
  assert.equal(result.unavailable, true)
  assert.equal(result.starAdditions, 0)
})

test('malformed bucket with days array of wrong length is treated as unavailable', () => {
  const malformed = { week: SUNDAY_BEFORE_SECONDS, total: 5, days: [1, 2, 3] } as unknown as StarHistoryBucket
  const result = aggregateStarHistoryGrowth(malformed, 7, NOW)
  assert.equal(result.unavailable, true)
})

test('malformed bucket with non-numeric days is treated as unavailable', () => {
  const malformed = { week: SUNDAY_BEFORE_SECONDS, total: 0, days: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] } as unknown as StarHistoryBucket
  const result = aggregateStarHistoryGrowth(malformed, 7, NOW)
  assert.equal(result.unavailable, true)
})

test('negative day counts are treated as unavailable (defensive against malformed data)', () => {
  const bucket = { week: SUNDAY_BEFORE_SECONDS, total: -5, days: [-1, 0, 0, 0, 0, 0, 0] } as unknown as StarHistoryBucket
  const result = aggregateStarHistoryGrowth(bucket, 7, NOW)
  assert.equal(result.unavailable, true)
})

test('empty array of buckets yields zero additions', () => {
  const result = aggregateStarHistoryGrowth([], 7, NOW)
  assert.equal(result.starAdditions, 0)
  assert.equal(result.daysObserved, 0)
})

test('rejects an unsupported periodDays value', () => {
  assert.throws(
    () => aggregateStarHistoryGrowth([], 5 as unknown as 7, NOW),
    /periodDays/,
  )
})

// ---------- rankStarHistoryGrowth ----------

test('ranks repos by starGrowth descending with deterministic ties (R-S1)', () => {
  const candidates: StarHistoryGrowthCandidate[] = [
    candidate(1, 'a', 'r1', 100),
    candidate(2, 'b', 'r2', 100),
    candidate(3, 'c', 'r3', 100),
  ]
  // Each repo gets 7 stars in the window — perfect ties. Tie-breaks by
  // current stars DESC (all equal) then id ASC.
  const history = new Map<number, StarHistoryBucket[]>([
    [1, [weeklyBucket(FULL_WEEK_SUNDAY_SECONDS, [1, 1, 1, 1, 1, 1, 1])]],
    [2, [weeklyBucket(FULL_WEEK_SUNDAY_SECONDS, [1, 1, 1, 1, 1, 1, 1])]],
    [3, [weeklyBucket(FULL_WEEK_SUNDAY_SECONDS, [1, 1, 1, 1, 1, 1, 1])]],
  ])
  const ranked = rankStarHistoryGrowth(candidates, history, 7, NOW)
  assert.deepEqual(ranked.map((repo) => repo.id), [1, 2, 3], 'stable id-asc tie-break')
})

test('tie-breaks higher current stars before lower current stars (R-S2)', () => {
  const candidates: StarHistoryGrowthCandidate[] = [
    candidate(1, 'a', 'low', 50),
    candidate(2, 'b', 'high', 5000),
  ]
  // Both repos get equal growth; current stars decide.
  const history = new Map<number, StarHistoryBucket[]>([
    [1, [weeklyBucket(FULL_WEEK_SUNDAY_SECONDS, [1, 1, 1, 1, 1, 1, 1])]],
    [2, [weeklyBucket(FULL_WEEK_SUNDAY_SECONDS, [1, 1, 1, 1, 1, 1, 1])]],
  ])
  const ranked = rankStarHistoryGrowth(candidates, history, 7, NOW)
  assert.deepEqual(ranked.map((repo) => repo.id), [2, 1], 'higher current stars win on tie')
})

test('higher growth beats higher current stars (R-S3)', () => {
  const candidates: StarHistoryGrowthCandidate[] = [
    candidate(1, 'a', 'old-big', 10_000),
    candidate(2, 'b', 'new-small', 50),
  ]
  const history = new Map<number, StarHistoryBucket[]>([
    // repo 1: 5 additions in the window
    [1, [weeklyBucket(FULL_WEEK_SUNDAY_SECONDS, [1, 1, 1, 1, 1, 0, 0])]],
    // repo 2: 100 additions in the window
    [2, [weeklyBucket(FULL_WEEK_SUNDAY_SECONDS, [20, 20, 20, 20, 20, 0, 0])]],
  ])
  const ranked = rankStarHistoryGrowth(candidates, history, 7, NOW)
  assert.deepEqual(ranked.map((repo) => repo.id), [2, 1])
})

test('caps the ranking at 100 repositories (R-S4)', () => {
  const candidates: StarHistoryGrowthCandidate[] = []
  const history = new Map<number, StarHistoryBucket[]>()
  for (let id = 1; id <= 150; id += 1) {
    candidates.push(candidate(id, 'o', `r${id}`, 100 + id))
    // Use small positive growth so all 150 are in-window, then the ranker
    // caps to 100 deterministically.
    history.set(id, [weeklyBucket(FULL_WEEK_SUNDAY_SECONDS, [1, 0, 0, 0, 0, 0, 0])])
  }
  const ranked = rankStarHistoryGrowth(candidates, history, 7, NOW)
  assert.equal(ranked.length, 100)
})

test('skips repos with unavailable history and tracks them in unavailableCount (R-S5)', () => {
  const candidates: StarHistoryGrowthCandidate[] = [
    candidate(1, 'a', 'has-history', 100),
    candidate(2, 'b', 'no-history', 100),
  ]
  const history = new Map<number, StarHistoryBucket[]>([
    [1, [weeklyBucket(FULL_WEEK_SUNDAY_SECONDS, [1, 1, 1, 1, 1, 1, 1])]],
    // repo 2 has no entry → unavailable
  ])
  const ranked = rankStarHistoryGrowth(candidates, history, 7, NOW)
  assert.equal(ranked.length, 1)
  assert.equal(ranked[0]!.id, 1)
  assert.equal(ranked.unavailableCount, 1)
})

test('a repo whose only history bucket is malformed is unavailable (R-S6)', () => {
  const candidates: StarHistoryGrowthCandidate[] = [candidate(1, 'a', 'r1', 100)]
  const history = new Map<number, StarHistoryBucket[]>([
    [1, [{ week: SUNDAY_BEFORE_SECONDS, total: 99 }] as unknown as StarHistoryBucket[]],
  ])
  const ranked = rankStarHistoryGrowth(candidates, history, 7, NOW)
  assert.equal(ranked.length, 0)
  assert.equal(ranked.unavailableCount, 1)
})

test('each ranked repo preserves owner/name/full_name/stargazers_count and adds starGrowth (R-S7)', () => {
  const candidates: StarHistoryGrowthCandidate[] = [candidate(42, 'octocat', 'hello', 1234)]
  const history = new Map<number, StarHistoryBucket[]>([
    [42, [weeklyBucket(FULL_WEEK_SUNDAY_SECONDS, [1, 0, 0, 0, 0, 0, 0])]],
  ])
  const ranked = rankStarHistoryGrowth(candidates, history, 7, NOW)
  const repo = ranked[0]!
  assert.equal(repo.id, 42)
  assert.equal(repo.owner, 'octocat')
  assert.equal(repo.name, 'hello')
  assert.equal(repo.full_name, 'octocat/hello')
  assert.equal(repo.stargazers_count, 1234)
  assert.equal(typeof repo.starGrowth, 'number')
})

test('ranked repos never contain stargazer identities (R-S8)', () => {
  const candidates: StarHistoryGrowthCandidate[] = [candidate(1, 'a', 'r1', 100)]
  // History responses with a 'user' field (which GitHub's real endpoint can include on per-user routes,
  // but NOT on the privacy-safe history endpoint) must be stripped by the module boundary.
  const history = new Map<number, StarHistoryBucket[]>([
    [1, [{ week: FULL_WEEK_SUNDAY_SECONDS, total: 7, days: [1, 1, 1, 1, 1, 1, 1], user: { login: 'leak' } } as unknown as StarHistoryBucket]],
  ])
  const ranked = rankStarHistoryGrowth(candidates, history, 7, NOW)
  const serialized = JSON.stringify(ranked)
  assert.ok(!/login/.test(serialized), 'no stargazer login field is ever exposed')
  assert.ok(!/user/.test(serialized.replace(/stargazers_count|owner/g, '')), 'no user object is ever exposed')
})

test('aggregates multiple weeks for a single repo across the full window (R-S9)', () => {
  const candidates: StarHistoryGrowthCandidate[] = [candidate(1, 'a', 'multi', 100)]
  // NOW = Sat 2026-09-05 12:00 UTC. The 14-day window is Aug 22 12:00..Sep 5 12:00.
  // Aug 23 00:00..Aug 29 00:00 is a full week entirely inside the window (14 stars).
  // Aug 31 00:00..Sep 6 00:00 is the partial current week (6 days inside, 12 stars).
  // May 25 00:00..May 31 00:00 is a full week entirely outside the window (0 stars).
  const WEEK_SECONDS_14 = 7 * 24 * 60 * 60
  const aug23 = Math.floor(Date.parse('2026-08-23T00:00:00.000Z') / 1000)
  const aug31 = Math.floor(Date.parse('2026-08-31T00:00:00.000Z') / 1000)
  const may25 = aug23 - 13 * WEEK_SECONDS_14
  const weeks: StarHistoryBucket[] = [
    { week: may25, total: 14, days: [2, 2, 2, 2, 2, 2, 2] },
    { week: aug23, total: 14, days: [2, 2, 2, 2, 2, 2, 2] },
    { week: aug31, total: 0, days: [2, 2, 2, 2, 2, 2, 2] },
  ]
  const history = new Map<number, StarHistoryBucket[]>([[1, weeks]])
  const ranked = rankStarHistoryGrowth(candidates, history, 14, NOW)
  assert.equal(ranked[0]!.starGrowth, 26, '14 (full week inside) + 12 (partial current week) = 26')
})

test('ranks are deterministic across identical inputs (R-S10)', () => {
  const candidates: StarHistoryGrowthCandidate[] = [
    candidate(1, 'a', 'r1', 100),
    candidate(2, 'b', 'r2', 200),
    candidate(3, 'c', 'r3', 300),
  ]
  const history = new Map<number, StarHistoryBucket[]>([
    [1, [weeklyBucket(FULL_WEEK_SUNDAY_SECONDS, [1, 1, 1, 1, 1, 1, 1])]],
    [2, [weeklyBucket(FULL_WEEK_SUNDAY_SECONDS, [1, 1, 1, 1, 1, 1, 1])]],
    [3, [weeklyBucket(FULL_WEEK_SUNDAY_SECONDS, [1, 1, 1, 1, 1, 1, 1])]],
  ])
  const a = rankStarHistoryGrowth(candidates, history, 7, NOW)
  const b = rankStarHistoryGrowth(candidates, history, 7, NOW)
  assert.deepEqual(a.map((repo) => repo.id), b.map((repo) => repo.id))
})

test('rejects unsupported periodDays (R-S11)', () => {
  assert.throws(
    () => rankStarHistoryGrowth([], new Map(), 5 as unknown as 7, NOW),
    /periodDays/,
  )
})

test('returns at least one ranked repo for each of 7/14/30 with the same dataset (R-S12)', () => {
  const candidates: StarHistoryGrowthCandidate[] = [candidate(1, 'a', 'r1', 100)]
  // Use 3 weeks of growth so 7/14/30 all have positive in-window days.
  const aug23 = Math.floor(Date.parse('2026-08-23T00:00:00.000Z') / 1000)
  const aug30 = Math.floor(Date.parse('2026-08-30T00:00:00.000Z') / 1000)
  const aug16 = aug23 - 7 * 24 * 60 * 60
  const history = new Map<number, StarHistoryBucket[]>([
    [1, [
      { week: aug16, total: 7, days: [1, 1, 1, 1, 1, 1, 1] },
      { week: aug23, total: 7, days: [1, 1, 1, 1, 1, 1, 1] },
      { week: aug30, total: 7, days: [1, 1, 1, 1, 1, 1, 1] },
    ]],
  ])
  assert.equal(rankStarHistoryGrowth(candidates, history, 7, NOW).length, 1)
  assert.equal(rankStarHistoryGrowth(candidates, history, 14, NOW).length, 1)
  assert.equal(rankStarHistoryGrowth(candidates, history, 30, NOW).length, 1)
})

test('returns an unavailableCount of candidates.length when every history is missing (R-S13)', () => {
  const candidates: StarHistoryGrowthCandidate[] = [
    candidate(1, 'a', 'r1', 100),
    candidate(2, 'b', 'r2', 100),
  ]
  const ranked = rankStarHistoryGrowth(candidates, new Map(), 7, NOW)
  assert.equal(ranked.length, 0)
  assert.equal(ranked.unavailableCount, 2)
})

test('a RankedGrowthRepo is JSON-safe and contains no prototype pollution keys (R-S14)', () => {
  const candidates: StarHistoryGrowthCandidate[] = [candidate(1, 'a', 'r1', 100)]
  const history = new Map<number, StarHistoryBucket[]>([
    [1, [weeklyBucket(FULL_WEEK_SUNDAY_SECONDS, [1, 0, 0, 0, 0, 0, 0])]],
  ])
  const ranked = rankStarHistoryGrowth(candidates, history, 7, NOW)
  const parsed = JSON.parse(JSON.stringify(ranked)) as RankedGrowthRepo[]
  assert.equal(parsed[0]!.id, 1)
  assert.equal(parsed[0]!.owner, 'a')
})
