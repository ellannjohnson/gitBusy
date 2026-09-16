export type ExploreKind = 'trending' | 'top' | 'opensource' | 'selfhosted' | 'learning' | 'littleknown' | 'personalized' | 'growth-7' | 'growth-14' | 'growth-30'

export type PreferenceSignal = {
  kind: 'topic' | 'language'
  value: string
  count: number
}

type ExploreSignalRepo = {
  topics?: string[]
  language?: string | null
}

type RankedRepo = ExploreSignalRepo & {
  id: number
  stargazers_count: number
  forks_count: number
  pushed_at: string | null
  archived: boolean
  fork?: boolean
}

const searchBase = 'archived:false fork:false'
const ignoredTopics = new Set(['github', 'open-source', 'software', 'programming', 'library', 'tool'])

function normalizedTopic(value: string) {
  const normalized = value.trim().toLowerCase()
  return /^[a-z0-9][a-z0-9-]*$/.test(normalized) ? normalized : ''
}

function normalizedLanguage(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9+#.-]/g, '')
}

function dateDaysAgo(days: number, now: number) {
  return new Date(now - days * 86_400_000).toISOString().slice(0, 10)
}

export function getPreferenceSignals(repos: ExploreSignalRepo[]): PreferenceSignal[] {
  const topicCounts = new Map<string, number>()
  const languageCounts = new Map<string, number>()
  for (const repo of repos) {
    const topics = new Set((repo.topics ?? []).map(normalizedTopic).filter(Boolean))
    for (const topic of topics) {
      if (!ignoredTopics.has(topic)) topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1)
    }
    const language = repo.language ? normalizedLanguage(repo.language) : ''
    if (language) languageCounts.set(language, (languageCounts.get(language) ?? 0) + 1)
  }
  const topics = Array.from(topicCounts, ([value, count]) => ({ kind: 'topic' as const, value, count }))
    .sort((a, b) => b.count - a.count)
  const languages = Array.from(languageCounts, ([value, count]) => ({ kind: 'language' as const, value, count }))
    .sort((a, b) => b.count - a.count)
  return [...topics, ...languages].slice(0, 12)
}

export function buildExploreQueries(kind: ExploreKind, signals: PreferenceSignal[] = [], now = Date.now()) {
  if (kind === 'trending') {
    return [`stars:>100 pushed:>${dateDaysAgo(30, now)} ${searchBase}`]
  }
  if (kind === 'top') {
    return ['stars:>0 archived:false fork:false']
  }
  if (kind === 'opensource') {
    return [
      `license:mit stars:>100 ${searchBase}`,
      `license:apache-2.0 stars:>100 ${searchBase}`,
      `license:bsd-3-clause stars:>100 ${searchBase}`,
    ]
  }
  if (kind === 'selfhosted') {
    return [`topic:self-hosted stars:>50 ${searchBase}`]
  }
  if (kind === 'learning') {
    return [
      `topic:learning stars:>50 ${searchBase}`,
      `topic:education stars:>50 ${searchBase}`,
      `topic:developer-education stars:>50 ${searchBase}`,
      `topic:awesome-list stars:>50 ${searchBase}`,
    ]
  }
  if (kind === 'littleknown') {
    return [`stars:200..10000 pushed:>${dateDaysAgo(365, now)} ${searchBase}`]
  }
  const preferenceQueries = signals
    .filter((signal) => signal.kind === 'topic')
    .slice(0, 4)
    .map((signal) => `topic:${normalizedTopic(signal.value)} stars:50..10000 ${searchBase}`)
  const languageQueries = signals
    .filter((signal) => signal.kind === 'language')
    .slice(0, 2)
    .map((signal) => `language:${normalizedLanguage(signal.value)} stars:50..10000 ${searchBase}`)
  return preferenceQueries.length + languageQueries.length > 0
    ? [...preferenceQueries, ...languageQueries]
    : [`stars:50..10000 pushed:>${dateDaysAgo(365, now)} ${searchBase}`]
}

function recencyScore(value: string | null) {
  if (!value) return 0
  const ageDays = Math.max(0, (Date.now() - new Date(value).getTime()) / 86_400_000)
  return Math.max(0, 1 - ageDays / 365)
}

function communityScore(repo: RankedRepo) {
  const stars = Math.max(1, repo.stargazers_count)
  return Math.log10(repo.forks_count + 1) + Math.min(1, (repo.forks_count / stars) * 8) + recencyScore(repo.pushed_at)
}

export function rankLittleKnownRepos<T extends RankedRepo>(repos: T[]) {
  return repos
    .filter((repo) => !repo.archived && !repo.fork && repo.stargazers_count >= 200 && repo.stargazers_count <= 10_000)
    .sort((a, b) => communityScore(b) - communityScore(a) || b.stargazers_count - a.stargazers_count)
    .slice(0, 100)
}

export function rankPersonalizedRepos<T extends RankedRepo>(repos: T[], starredIds: Set<number>, signals: PreferenceSignal[]) {
  const topicSignals = new Set(signals.filter((signal) => signal.kind === 'topic').map((signal) => normalizedTopic(signal.value)))
  const languageSignals = new Set(signals.filter((signal) => signal.kind === 'language').map((signal) => normalizedLanguage(signal.value).toLowerCase()))
  return repos
    .filter((repo) => !starredIds.has(repo.id) && !repo.archived && !repo.fork && repo.stargazers_count >= 50 && repo.stargazers_count <= 10_000)
    .sort((a, b) => {
      const score = (repo: T) => {
        const topicMatches = (repo.topics ?? []).map(normalizedTopic).filter((topic) => topicSignals.has(topic)).length
        const languageMatch = repo.language && languageSignals.has(normalizedLanguage(repo.language).toLowerCase()) ? 1 : 0
        return topicMatches * 4 + languageMatch * 3
      }
      return score(b) - score(a) || communityScore(b) - communityScore(a) || a.stargazers_count - b.stargazers_count
    })
    .slice(0, 100)
}
