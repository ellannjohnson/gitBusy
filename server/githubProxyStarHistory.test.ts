import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  type GithubStarHistoryFetcher,
  type StarHistoryCandidate,
  fetchStarHistoryGrowth,
} from './githubProxyStarHistory.ts'

const NOW = Date.parse('2026-09-05T12:00:00.000Z')
const FULL_WEEK = Math.floor(Date.parse('2026-08-30T00:00:00.000Z') / 1000)

function candidate(id: number, owner: string, name: string, stars: number): StarHistoryCandidate {
  return {
    id,
    owner: { login: owner },
    name,
    full_name: `${owner}/${name}`,
    stargazers_count: stars,
  }
}

function makeBucket(weekStart: number, days: number[]) {
  return { week: weekStart, total: days.reduce((sum, value) => sum + value, 0), days }
}

test('fetchStarHistoryGrowth requests the exact /stargazers/history path with API version 2026-03-10 (R-P1)', async () => {
  const calls: Array<{ path: string; apiVersion: string | undefined }> = []
  const fetcher: GithubStarHistoryFetcher = async (owner, name, authz, apiVersion) => {
    calls.push({ path: `/repos/${owner}/${name}/stargazers/history`, apiVersion })
    return [makeBucket(FULL_WEEK, [1, 1, 1, 1, 1, 1, 1])]
  }
  const result = await fetchStarHistoryGrowth({
    kind: 'growth-7',
    candidates: [candidate(1, 'octocat', 'hello', 100)],
    fetcher,
    apiVersion: '2026-03-10',
    now: NOW,
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.path, '/repos/octocat/hello/stargazers/history')
  assert.equal(calls[0]!.apiVersion, '2026-03-10')
  assert.equal(result.kind, 'growth-7')
  assert.equal(result.repos.length, 1)
})

test('fetchStarHistoryGrowth propagates the same authorization header to every repo request (R-P2)', async () => {
  const seenAuthz: Array<string | undefined> = []
  const fetcher: GithubStarHistoryFetcher = async (owner, name, authz) => {
    seenAuthz.push(authz)
    return [makeBucket(FULL_WEEK, [1, 1, 1, 1, 1, 1, 1])]
  }
  await fetchStarHistoryGrowth({
    kind: 'growth-7',
    candidates: [candidate(1, 'a', 'r1', 100), candidate(2, 'b', 'r2', 100)],
    fetcher,
    authorization: 'Bearer test-token',
    apiVersion: '2026-03-10',
    concurrency: 4,
    now: NOW,
  })
  assert.equal(seenAuthz.length, 2)
  for (const authz of seenAuthz) assert.equal(authz, 'Bearer test-token')
})

test('fetchStarHistoryGrowth caps concurrency to the requested limit (R-P3)', async () => {
  let active = 0
  let peakActive = 0
  let started = 0
  const total = 12
  const fetcher: GithubStarHistoryFetcher = async () => {
    active += 1
    peakActive = Math.max(peakActive, active)
    started += 1
    // Yield so that the runWithConcurrency loop can dispatch the next item
    // while this one is still "in flight", then return immediately.
    await Promise.resolve()
    active -= 1
    return [makeBucket(FULL_WEEK, [1, 1, 1, 1, 1, 1, 1])]
  }
  const candidates = Array.from({ length: total }, (_, i) => candidate(i + 1, 'o', `r${i + 1}`, 100))
  const result = await fetchStarHistoryGrowth({
    kind: 'growth-7',
    candidates,
    fetcher,
    authorization: 'Bearer t',
    apiVersion: '2026-03-10',
    concurrency: 3,
    now: NOW,
  })
  assert.equal(started, total, 'every candidate was fetched exactly once')
  assert.ok(peakActive <= 3, `peak concurrency was ${peakActive}, expected ≤ 3`)
  assert.equal(result.repos.length, total)
})

test('fetchStarHistoryGrowth returns full repo fields plus a starGrowth additive field (R-P4)', async () => {
  const fetcher: GithubStarHistoryFetcher = async () => [makeBucket(FULL_WEEK, [1, 1, 1, 1, 1, 1, 1])]
  const result = await fetchStarHistoryGrowth({
    kind: 'growth-7',
    candidates: [candidate(42, 'octocat', 'hello-world', 1234)],
    fetcher,
    authorization: 'Bearer t',
    apiVersion: '2026-03-10',
    now: NOW,
  })
  const repo = result.repos[0]!
  assert.equal(repo.id, 42)
  assert.equal(repo.owner, 'octocat')
  assert.equal(repo.name, 'hello-world')
  assert.equal(repo.full_name, 'octocat/hello-world')
  assert.equal(repo.starsCount, 1234)
  assert.equal(repo.starGrowth, 7)
  assert.ok(repo.description === null || typeof repo.description === 'string')
})

test('fetchStarHistoryGrowth returns status=ready and a source note when at least one ranking exists (R-P5)', async () => {
  const fetcher: GithubStarHistoryFetcher = async () => [makeBucket(FULL_WEEK, [1, 1, 1, 1, 1, 1, 1])]
  const result = await fetchStarHistoryGrowth({
    kind: 'growth-7',
    candidates: [candidate(1, 'a', 'r1', 100)],
    fetcher,
    apiVersion: '2026-03-10',
    now: NOW,
  })
  assert.equal(result.status, 'ready')
  assert.ok(typeof result.note === 'string' && result.note.length > 0)
  assert.equal(result.periodDays, 7)
})

test('fetchStarHistoryGrowth maps a per-repo fetch error to an unavailable skip, not a hard failure (R-P6)', async () => {
  const fetcher: GithubStarHistoryFetcher = async (owner, name) => {
    if (name === 'missing') {
      throw new Error('GitHub API returned 404')
    }
    return [makeBucket(FULL_WEEK, [1, 1, 1, 1, 1, 1, 1])]
  }
  const result = await fetchStarHistoryGrowth({
    kind: 'growth-7',
    candidates: [candidate(1, 'a', 'ok', 100), candidate(2, 'b', 'missing', 100)],
    fetcher,
    authorization: 'Bearer t',
    apiVersion: '2026-03-10',
    now: NOW,
  })
  assert.equal(result.repos.length, 1)
  assert.equal(result.repos[0]!.name, 'ok')
  assert.equal(result.meta.unavailableCount, 1)
})

test('fetchStarHistoryGrowth returns an empty ranking + unavailableCount equal to candidates when every fetch fails (R-P7)', async () => {
  const fetcher: GithubStarHistoryFetcher = async () => {
    throw new Error('GitHub API returned 502')
  }
  const result = await fetchStarHistoryGrowth({
    kind: 'growth-7',
    candidates: [candidate(1, 'a', 'r1', 100), candidate(2, 'b', 'r2', 100)],
    fetcher,
    apiVersion: '2026-03-10',
    now: NOW,
  })
  assert.equal(result.repos.length, 0)
  assert.equal(result.meta.unavailableCount, 2)
  assert.ok(typeof result.error === 'string' && /unavailable|rate|502/i.test(result.error), `error text: ${result.error}`)
})

test('fetchStarHistoryGrowth ranks by starGrowth descending with deterministic tie-breaks (R-P8)', async () => {
  let callIndex = 0
  const fetcher: GithubStarHistoryFetcher = async (owner, name) => {
    callIndex += 1
    if (name === 'big') return [makeBucket(FULL_WEEK, [10, 10, 10, 10, 10, 10, 10])]
    if (name === 'small') return [makeBucket(FULL_WEEK, [1, 1, 1, 1, 1, 1, 1])]
    return [makeBucket(FULL_WEEK, [5, 5, 5, 5, 5, 5, 5])]
  }
  const result = await fetchStarHistoryGrowth({
    kind: 'growth-7',
    candidates: [
      candidate(1, 'o', 'small', 100),
      candidate(2, 'o', 'big', 100),
      candidate(3, 'o', 'mid', 100),
    ],
    fetcher,
    apiVersion: '2026-03-10',
    now: NOW,
  })
  assert.deepEqual(result.repos.map((repo) => repo.starGrowth), [70, 35, 7])
})

test('fetchStarHistoryGrowth caps the ranking at 100 repos (R-P9)', async () => {
  const fetcher: GithubStarHistoryFetcher = async () => [makeBucket(FULL_WEEK, [1, 0, 0, 0, 0, 0, 0])]
  const candidates = Array.from({ length: 150 }, (_, i) => candidate(i + 1, 'o', `r${i + 1}`, 100 + i))
  const result = await fetchStarHistoryGrowth({
    kind: 'growth-7',
    candidates,
    fetcher,
    apiVersion: '2026-03-10',
    now: NOW,
  })
  assert.equal(result.repos.length, 100)
})

test('fetchStarHistoryGrowth sanitizes stargazer identities out of any bucket payload (R-P10)', async () => {
  // Even if a misconfigured fetcher (or a future GitHub response change) leaks
  // an identity-bearing field, the result must not expose it.
  const fetcher: GithubStarHistoryFetcher = async () => [
    {
      week: FULL_WEEK,
      total: 7,
      days: [1, 1, 1, 1, 1, 1, 1],
      user: { login: 'leaked-identity' },
      stargazer: { login: 'also-leaked' },
    },
  ]
  const result = await fetchStarHistoryGrowth({
    kind: 'growth-7',
    candidates: [candidate(1, 'a', 'r1', 100)],
    fetcher,
    apiVersion: '2026-03-10',
    now: NOW,
  })
  const serialized = JSON.stringify(result)
  assert.ok(!/leaked-identity/.test(serialized), 'no leaked identity string')
  assert.ok(!/also-leaked/.test(serialized), 'no leaked stargazer string')
  assert.ok(!/stargazer[^s]/.test(serialized), 'no stargazer field beyond stargazers_count')
})

test('fetchStarHistoryGrowth exposes meta with safe fields only (no credentials, no identities) (R-P11)', async () => {
  const fetcher: GithubStarHistoryFetcher = async () => [makeBucket(FULL_WEEK, [1, 1, 1, 1, 1, 1, 1])]
  const result = await fetchStarHistoryGrowth({
    kind: 'growth-7',
    candidates: [candidate(1, 'a', 'r1', 100)],
    fetcher,
    authorization: 'Bearer secret-token',
    apiVersion: '2026-03-10',
    now: NOW,
  })
  const serialized = JSON.stringify(result)
  assert.ok(!/secret-token/.test(serialized), 'no credential text leaks into the result')
  assert.equal(result.meta.candidatesConsidered, 1)
  assert.equal(result.meta.unavailableCount, 0)
})

test('fetchStarHistoryGrowth supports all three growth windows (R-P12)', async () => {
  const windowCounts: Record<string, number> = { 'growth-7': 0, 'growth-14': 0, 'growth-30': 0 }
  const fetcher: GithubStarHistoryFetcher = async () => [makeBucket(FULL_WEEK, [1, 1, 1, 1, 1, 1, 1])]
  for (const kind of ['growth-7', 'growth-14', 'growth-30'] as const) {
    const result = await fetchStarHistoryGrowth({
      kind,
      candidates: [candidate(1, 'a', 'r1', 100)],
      fetcher,
      apiVersion: '2026-03-10',
      now: NOW,
    })
    windowCounts[kind] = result.periodDays!
  }
  assert.deepEqual(windowCounts, { 'growth-7': 7, 'growth-14': 14, 'growth-30': 30 })
})
