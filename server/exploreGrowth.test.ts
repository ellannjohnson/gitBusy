import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  loadGrowthHistory,
  rankGrowth,
  recordGrowthObservation,
  saveGrowthHistory,
  type GrowthCandidate,
  type GrowthHistory,
} from './exploreGrowth.ts'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const day = 86_400_000
const now = Date.parse('2026-09-03T12:00:00.000Z')

const candidate = (id: number, stars: number, name = `owner/repo-${id}`): GrowthCandidate => ({
  id,
  full_name: name,
  stargazers_count: stars,
})

test('growth ranking computes net deltas only after a real baseline (R-A10)', () => {
  const initial: GrowthHistory = { version: 1, repos: {} }
  const history = recordGrowthObservation(initial, [candidate(1, 100), candidate(2, 200)], now - 8 * day)
  const result = rankGrowth(history, [candidate(1, 160), candidate(2, 205)], 7, now)

  assert.equal(result.status, 'ready')
  assert.equal(result.repos[0].id, 1)
  assert.equal(result.repos[0].starGrowth, 60)
  assert.equal(result.repos[0].baselineStars, 100)
})

test('growth ranking stays building when its window has no baseline (R-A9/R-A10)', () => {
  const initial: GrowthHistory = { version: 1, repos: {} }
  const history = recordGrowthObservation(initial, [candidate(1, 100)], now - 8 * day)
  const result = rankGrowth(history, [candidate(1, 160)], 30, now)

  assert.equal(result.status, 'building')
  assert.deepEqual(result.repos, [])
  assert.match(result.note, /30-day baseline/)
})

test('rankGrowth rejects periodDays outside the supported set (R-A1)', () => {
  const initial: GrowthHistory = { version: 1, repos: {} }
  assert.throws(
    () => rankGrowth(initial, [], 5 as unknown as 7, now),
    /periodDays/,
  )
})

test('recordGrowthObservation deduplicates same id within a pass keeping the higher star count (R-A2)', () => {
  const initial: GrowthHistory = { version: 1, repos: {} }
  const history = recordGrowthObservation(initial, [candidate(1, 50), candidate(1, 90)], now)
  const entry = history.repos['1']
  assert.ok(entry, 'repo id 1 must be present')
  assert.equal(entry.observations.length, 1)
  assert.equal(entry.observations[0].stars, 90)
})

test('recordGrowthObservation prunes observations older than 35 days (R-A3)', () => {
  const initial: GrowthHistory = { version: 1, repos: {} }
  const stale = recordGrowthObservation(initial, [candidate(1, 10)], now - 40 * day)
  const fresh = recordGrowthObservation(stale, [candidate(1, 20)], now)
  const entry = fresh.repos['1']
  assert.ok(entry, 'repo id 1 must remain after pruning')
  assert.equal(entry.observations.length, 1, 'stale observation pruned')
  assert.equal(entry.observations[0].stars, 20)
  assert.equal(entry.observations[0].observedAt, now)
})

test('recordGrowthObservation is pure / deterministic (R-A4)', () => {
  const initial: GrowthHistory = { version: 1, repos: {} }
  const a = recordGrowthObservation(initial, [candidate(1, 50), candidate(2, 80)], now - 3 * day)
  const b = recordGrowthObservation(initial, [candidate(1, 50), candidate(2, 80)], now - 3 * day)
  assert.deepEqual(a, b)
})

test('rankGrowth excludes candidates without a baseline and counts them in candidatesExcluded (R-A5)', () => {
  const initial: GrowthHistory = { version: 1, repos: {} }
  const seeded = recordGrowthObservation(initial, [candidate(2, 100)], now - 8 * day)
  const result = rankGrowth(seeded, [candidate(1, 500), candidate(2, 130)], 7, now)
  assert.equal(result.status, 'ready')
  assert.equal(result.repos.length, 1)
  assert.equal(result.repos[0].id, 2)
  assert.equal(result.meta.candidatesExcluded, 1)
  assert.equal(result.meta.candidatesConsidered, 2)
})

test('rankGrowth sorts repos descending by starGrowth (R-A6)', () => {
  const initial: GrowthHistory = { version: 1, repos: {} }
  const seeded = recordGrowthObservation(
    initial,
    [candidate(1, 100), candidate(2, 100), candidate(3, 100)],
    now - 8 * day,
  )
  const result = rankGrowth(
    seeded,
    [candidate(1, 110), candidate(2, 175), candidate(3, 145)],
    7,
    now,
  )
  const growth = result.repos.map((r) => r.starGrowth)
  for (let i = 1; i < growth.length; i++) {
    assert.ok(growth[i - 1] >= growth[i], 'must be sorted descending')
  }
})

test('rankGrowth tie-breaks deterministically by baselineStars DESC then id ASC (R-A7)', () => {
  const initial: GrowthHistory = { version: 1, repos: {} }
  const seeded = recordGrowthObservation(
    initial,
    [candidate(1, 100), candidate(2, 250), candidate(3, 50)],
    now - 8 * day,
  )
  // All three have identical +10 growth — tie broken by baselineStars DESC then id ASC
  const result = rankGrowth(
    seeded,
    [candidate(1, 110), candidate(2, 260), candidate(3, 60)],
    7,
    now,
  )
  assert.deepEqual(result.repos.map((r) => r.id), [2, 1, 3])
})

test('rankGrowth caps the result at 100 repos (R-A8)', () => {
  const initial: GrowthHistory = { version: 1, repos: {} }
  const cands: GrowthCandidate[] = []
  for (let id = 1; id <= 150; id++) {
    cands.push(candidate(id, 1000))
  }
  const seeded = recordGrowthObservation(initial, cands, now - 8 * day)
  const refreshed = cands.map((c) => candidate(c.id, 1000 + (c.id % 50)))
  const result = rankGrowth(seeded, refreshed, 7, now)
  assert.equal(result.repos.length, 100)
})

test('rankGrowth exposes windowStart and windowEnd from observations (R-A11)', () => {
  const initial: GrowthHistory = { version: 1, repos: {} }
  const seeded = recordGrowthObservation(initial, [candidate(1, 100)], now - 8 * day)
  const result = rankGrowth(seeded, [candidate(1, 110)], 7, now)
  // windowStart/windowEnd derive from observation timestamps, not from API call time.
  assert.equal(result.meta.windowStart, now - 8 * day)
  assert.equal(result.meta.windowEnd, now - 8 * day)
})

test('rankGrowth applies the 2-day tolerance and excludes stale baselines (R-A12)', () => {
  const initial: GrowthHistory = { version: 1, repos: {} }
  // 60-day-old observation is outside the 30-day window + 2-day tolerance
  const seeded = recordGrowthObservation(initial, [candidate(1, 50)], now - 60 * day)
  const result = rankGrowth(seeded, [candidate(1, 200)], 30, now)
  assert.equal(result.status, 'building')
  assert.equal(result.repos.length, 0)
  assert.equal(result.meta.candidatesExcluded, 1)
})

test('atomic write round-trip preserves the history deep-equal (R-A13)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gitbusy-growth-'))
  try {
    const filePath = join(dir, 'growth-history.json')
    const seeded: GrowthHistory = { version: 1, repos: { '1': { observations: [{ observedAt: now - day, stars: 5 }] } } }
    saveGrowthHistory(filePath, seeded)
    const loaded = loadGrowthHistory(filePath)
    assert.deepEqual(loaded, seeded)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('corrupt JSON yields empty history and never throws across the public API (R-A14)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gitbusy-growth-'))
  try {
    const filePath = join(dir, 'growth-history.json')
    writeFileSync(filePath, '{ this is not json', 'utf8')
    const loaded = loadGrowthHistory(filePath)
    assert.deepEqual(loaded, { version: 1, repos: {} })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('retention prune on load drops observations older than 35 days (R-A16)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gitbusy-growth-'))
  try {
    const filePath = join(dir, 'growth-history.json')
    const stale: GrowthHistory = {
      version: 1,
      repos: {
        '1': { observations: [{ observedAt: now - 40 * day, stars: 10 }] },
        '2': { observations: [{ observedAt: now - 1 * day, stars: 10 }] },
      },
    }
    saveGrowthHistory(filePath, stale, now)
    const loaded = loadGrowthHistory(filePath, now)
    assert.deepEqual(Object.keys(loaded.repos).sort(), ['2'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('growth-history.json never contains credentials, keychain refs, or full repo objects (R-A27)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gitbusy-growth-'))
  try {
    const filePath = join(dir, 'growth-history.json')
    const seeded: GrowthHistory = { version: 1, repos: {} }
    const updated = recordGrowthObservation(seeded, [candidate(1, 100, 'owner/repo')], now - day)
    saveGrowthHistory(filePath, updated)
    const raw = readFileSync(filePath, 'utf8')
    assert.ok(!/ghp_|github_pat_|token|secret/i.test(raw), 'no credential-shaped strings')
    assert.ok(!/keychain/i.test(raw), 'no keychain references')
    assert.ok(!/description|language|topics/.test(raw), 'no extra repo fields')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// Silence the unused-import warning for join under tsx's --experimental-strip-types
void join
