import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildExploreQueries,
  getPreferenceSignals,
  rankLittleKnownRepos,
  rankPersonalizedRepos,
} from './exploreRanking.ts'

test('learning exploration uses explicit learning and education topics', () => {
  const queries = buildExploreQueries('learning')
  assert.ok(queries.some((query) => query.includes('topic:learning')))
  assert.ok(queries.some((query) => query.includes('topic:education')))
  assert.ok(queries.every((query) => query.includes('archived:false')))
})

test('personalized exploration derives bounded topic and language signals from stars', () => {
  const signals = getPreferenceSignals([
    { topics: ['self-hosted', 'docker'], language: 'TypeScript' },
    { topics: ['self-hosted', 'privacy'], language: 'TypeScript' },
    { topics: ['docker'], language: 'Go' },
  ])
  assert.deepEqual(signals.slice(0, 3), [
    { kind: 'topic', value: 'self-hosted', count: 2 },
    { kind: 'topic', value: 'docker', count: 2 },
    { kind: 'topic', value: 'privacy', count: 1 },
  ])
  const queries = buildExploreQueries('personalized', signals)
  assert.ok(queries.some((query) => query.includes('topic:self-hosted')))
  assert.ok(queries.some((query) => query.includes('language:TypeScript')))
  assert.ok(queries.length <= 6)
})

test('personalized ranking excludes starred repos and prefers matching little-known repos', () => {
  const repos = [
    { id: 1, stargazers_count: 900, forks_count: 180, topics: ['docker'], language: 'TypeScript', pushed_at: '2026-08-20T00:00:00Z', archived: false, fork: false },
    { id: 2, stargazers_count: 700, forks_count: 120, topics: ['unrelated'], language: 'Ruby', pushed_at: '2026-08-20T00:00:00Z', archived: false, fork: false },
    { id: 3, stargazers_count: 450, forks_count: 80, topics: ['docker', 'privacy'], language: 'Go', pushed_at: '2026-08-20T00:00:00Z', archived: false, fork: false },
  ]
  const ranked = rankPersonalizedRepos(repos, new Set([3]), [
    { kind: 'topic', value: 'docker', count: 2 },
    { kind: 'topic', value: 'privacy', count: 1 },
  ])
  assert.deepEqual(ranked.map((repo) => repo.id), [1, 2])
})

test('little-known ranking stays active, bounded, and community-signaled', () => {
  const ranked = rankLittleKnownRepos([
    { id: 1, stargazers_count: 50, forks_count: 30, topics: [], language: 'Go', pushed_at: '2026-08-20T00:00:00Z', archived: false, fork: false },
    { id: 2, stargazers_count: 800, forks_count: 250, topics: [], language: 'Go', pushed_at: '2026-08-20T00:00:00Z', archived: false, fork: false },
    { id: 3, stargazers_count: 900, forks_count: 20, topics: [], language: 'Go', pushed_at: '2026-08-20T00:00:00Z', archived: true, fork: false },
  ])
  assert.deepEqual(ranked.map((repo) => repo.id), [2])
})
