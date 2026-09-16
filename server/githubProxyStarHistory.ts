import {
  type RankedGrowthRepo,
  type StarHistoryBucket,
  rankStarHistoryGrowth,
} from './exploreStarHistory.ts'

// Adapters between GitHub /repos search results and the pure star-history
// aggregator. The fetcher is injected so the route handler can pass the real
// githubGet (with credentials, API version, etc.) and the unit tests can pass a
// deterministic mock without monkey-patching the network.

export type ExploreGrowthKind = 'growth-7' | 'growth-14' | 'growth-30'

// Shape of a candidate as produced by GitHub's /search/repositories response.
export type StarHistoryCandidate = {
  id: number
  owner: { login: string }
  name: string
  full_name: string
  stargazers_count: number
}

export type GithubStarHistoryFetcher = (
  owner: string,
  name: string,
  authorization: string,
  apiVersion: string,
) => Promise<StarHistoryBucket[]>

export type FetchStarHistoryGrowthOptions = {
  kind: ExploreGrowthKind
  candidates: StarHistoryCandidate[]
  fetcher: GithubStarHistoryFetcher
  authorization?: string
  apiVersion: string
  concurrency?: number
  now?: number
}

export type FetchStarHistoryGrowthResult = {
  kind: ExploreGrowthKind
  status: 'ready' | 'unavailable'
  periodDays: 7 | 14 | 30
  note: string
  repos: Array<{
    id: number
    owner: string
    name: string
    full_name: string
    description: string | null
    language: string | null
    topics: string[]
    archived: boolean
    githubUrl: string
    updatedAt: string
    pushedAt: string | null
    defaultBranch: string
    starsCount: number
    forksCount: number
    license?: string
    visibility: 'Public' | 'Private'
    starGrowth: number
  }>
  meta: {
    candidatesConsidered: number
    unavailableCount: number
    source: string
    apiVersion: string
  }
  error?: string
}

const DEFAULT_CONCURRENCY = 6

function periodDaysForKind(kind: ExploreGrowthKind): 7 | 14 | 30 {
  if (kind === 'growth-7') return 7
  if (kind === 'growth-14') return 14
  return 30
}

function safeRepoPathSegment(value: string): string {
  // The route handler has already validated these via safeRepoPart; this is a
  // tight belt-and-braces guard for the fetcher.
  if (!/^[a-zA-Z0-9_.-]+$/.test(value)) throw new Error(`Unsafe repo segment: ${value}`)
  return value
}

function sanitizeNote(text: string): string {
  // Defensive: the note is author-controlled prose. Strip any field that could
  // accidentally expose an identity or credential token.
  return text.replace(/(Bearer\s+[A-Za-z0-9._-]+|ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+)/g, '[redacted]')
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0
  const runOne = async (): Promise<void> => {
    while (true) {
      const current = nextIndex
      nextIndex += 1
      if (current >= items.length) return
      results[current] = await worker(items[current]!, current)
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => runOne())
  await Promise.all(workers)
  return results
}

export async function fetchStarHistoryGrowth(
  options: FetchStarHistoryGrowthOptions,
): Promise<FetchStarHistoryGrowthResult> {
  const periodDays = periodDaysForKind(options.kind)
  const now = options.now ?? Date.now()
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY)
  const authorization = options.authorization ?? ''
  const fetcher = options.fetcher
  const apiVersion = options.apiVersion

  const candidateGrowthInput = options.candidates.map((candidate) => ({
    id: candidate.id,
    owner: candidate.owner.login,
    name: candidate.name,
    full_name: candidate.full_name,
    stargazers_count: candidate.stargazers_count,
  }))

  const histories = await runWithConcurrency(
    options.candidates,
    concurrency,
    async (candidate) => {
      const owner = safeRepoPathSegment(candidate.owner.login)
      const name = safeRepoPathSegment(candidate.name)
      try {
        const history = await fetcher(owner, name, authorization, apiVersion)
        // Defensive: strip any identity-bearing fields that might leak from a
        // misconfigured fetcher or a future API change.
        const safe = Array.isArray(history)
          ? history.map((bucket) => ({
              week: bucket.week,
              total: bucket.total,
              days: bucket.days,
            }))
          : []
        return { id: candidate.id, history: safe, error: null as string | null }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'GitHub star history request failed'
        return { id: candidate.id, history: [] as StarHistoryBucket[], error: message }
      }
    },
  )

  const historyById = new Map<number, StarHistoryBucket[]>()
  let unavailableCount = 0
  let lastError = ''
  for (const entry of histories) {
    if (entry.error) {
      unavailableCount += 1
      lastError = entry.error
      continue
    }
    if (entry.history.length === 0) {
      unavailableCount += 1
      continue
    }
    historyById.set(entry.id, entry.history)
  }

  const ranked: RankedGrowthRepo[] & { unavailableCount: number } = rankStarHistoryGrowth(
    candidateGrowthInput,
    historyById,
    periodDays,
    now,
  )
  // The pure ranker counts each candidate whose history is missing or
  // malformed; the fetcher-failure path is also missing in `historyById`, so
  // the ranker already counted those. `unavailableCount` here is total.

  const repos = ranked.map((entry) => ({
    id: entry.id,
    owner: entry.owner,
    name: entry.name,
    full_name: entry.full_name,
    description: null,
    language: null,
    topics: [],
    archived: false,
    githubUrl: `https://github.com/${entry.owner}/${entry.name}`,
    updatedAt: new Date(now).toISOString(),
    pushedAt: null,
    defaultBranch: 'main',
    starsCount: entry.stargazers_count,
    forksCount: 0,
    license: undefined,
    visibility: 'Public' as const,
    starGrowth: entry.starGrowth,
  }))

  const status: 'ready' | 'unavailable' = repos.length > 0 ? 'ready' : 'unavailable'
  const note = sanitizeNote(
    status === 'ready'
      ? `Showing fastest star growth in the last ${periodDays} days among the evaluated Explore candidate pool, sourced from GitHub's /stargazers/history endpoint. ${ranked.unavailableCount} of ${options.candidates.length} repositories had no history available this refresh.`
      : `GitHub star history was unavailable for every evaluated repository${lastError ? ` (${lastError})` : ''}. Try again in a few minutes; growth shelves will return to ready as soon as GitHub's history endpoint responds.`,
  )

  return {
    kind: options.kind,
    status,
    periodDays,
    note,
    repos,
    meta: {
      candidatesConsidered: options.candidates.length,
      unavailableCount: ranked.unavailableCount,
      source: 'github:/repos/{owner}/{repo}/stargazers/history',
      apiVersion,
    },
    error: status === 'unavailable' ? (lastError || 'GitHub star history is unavailable for every evaluated repository') : undefined,
  }
}
