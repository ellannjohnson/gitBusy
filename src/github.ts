import type { Repo } from './types'

export type GithubRemoteRepo = {
  id: number
  owner: string
  name: string
  description: string | null
  language: string | null
  topics: string[]
  archived: boolean
  updatedAt: string
  pushedAt: string | null
  defaultBranch: string
  githubUrl: string
  starsCount?: number
  forksCount?: number
  license?: string
}

export type GithubSnapshot = {
  user: { login: string; name: string | null; avatarUrl: string }
  repos: GithubRemoteRepo[]
}

export type ExploreKind = 'trending' | 'top' | 'opensource' | 'selfhosted'

export type GithubExploreResponse = {
  kind: ExploreKind
  repos: GithubRemoteRepo[]
}

const languageColors: Record<string, string> = {
  C: '#555555',
  'C++': '#f34b7d',
  CSS: '#563d7c',
  Go: '#00add8',
  HTML: '#e34c26',
  Java: '#b07219',
  JavaScript: '#f1e05a',
  Kotlin: '#a97bff',
  Markdown: '#6f42c1',
  PHP: '#777bb4',
  Python: '#3572a5',
  Ruby: '#701516',
  Rust: '#dea584',
  Swift: '#f05138',
  TypeScript: '#3178c6',
}

function formatRelative(dateValue: string) {
  const days = Math.max(0, Math.floor((Date.now() - new Date(dateValue).getTime()) / 86_400_000))
  if (days === 0) return 'today'
  if (days === 1) return '1d ago'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

export async function fetchGithubSnapshot(): Promise<GithubSnapshot> {
  const response = await fetch('/api/github/snapshot')
  const payload = await response.json() as GithubSnapshot & { error?: string }
  if (!response.ok) throw new Error(payload.error || 'GitHub snapshot failed')
  return payload
}

export async function fetchGithubRepos(): Promise<{ repos: GithubRemoteRepo[] }> {
  const response = await fetch('/api/github/repos')
  const payload = await response.json() as { repos: GithubRemoteRepo[]; error?: string }
  if (!response.ok) throw new Error(payload.error || 'GitHub repositories request failed')
  return payload
}

export async function fetchGithubExplore(kind: ExploreKind): Promise<GithubExploreResponse> {
  const response = await fetch(`/api/github/explore?kind=${kind}`)
  const payload = await response.json() as GithubExploreResponse & { error?: string }
  if (!response.ok) throw new Error(payload.error || 'GitHub Explore request failed')
  return payload
}

export async function fetchGithubRepo(owner: string, name: string): Promise<Partial<Repo>> {
  const params = new URLSearchParams({ owner, name })
  const response = await fetch(`/api/github/repo?${params.toString()}`)
  const payload = await response.json() as Partial<Repo> & { error?: string }
  if (!response.ok) throw new Error(payload.error || 'GitHub repo fetch failed')
  return payload
}

export function mapGithubRepo(remote: GithubRemoteRepo, local?: Repo): Repo {
  const description = remote.description || 'No description provided on GitHub.'
  return {
    id: String(remote.id),
    owner: remote.owner,
    name: remote.name,
    description,
    summary: description,
    language: remote.language || 'Unknown',
    languageColor: languageColors[remote.language || ''] || '#8b877d',
    tags: remote.topics.slice(0, 5),
    status: remote.archived ? 'Archived' : local?.status === 'Needs review' ? 'Needs review' : 'Active',
    updated: formatRelative(remote.updatedAt),
    updatedAt: new Date(remote.updatedAt).getTime(),
    project: local?.project || 'Inbox',
    note: local?.note || '',
    isPinned: local?.isPinned || false,
    githubUrl: remote.githubUrl,
    readme: ['README not loaded yet', 'Select this repo to fetch its README from GitHub.'],
    files: [],
    lastRelease: 'Not loaded',
    starsCount: remote.starsCount,
    forksCount: remote.forksCount,
    license: remote.license,
    inLibrary: Boolean(local),
  }
}

export function mergeGithubRepos(remoteRepos: GithubRemoteRepo[], current: Repo[]) {
  const currentByName = new Map(current.map((repo) => [`${repo.owner}/${repo.name}`, repo]))
  return remoteRepos.map((repo) => mapGithubRepo(repo, currentByName.get(`${repo.owner}/${repo.name}`)))
}

const subjectRules = [
  { label: 'AI & agents', terms: ['ai', 'agent', 'llm', 'model', 'prompt', 'inference', 'rag', 'machine learning'] },
  { label: 'Developer tools', terms: ['cli', 'tui', 'developer', 'devtool', 'terminal', 'git', 'editor', 'workflow'] },
  { label: 'Self-hosted', terms: ['self-hosted', 'selfhosted', 'homelab', 'docker', 'server', 'privacy'] },
  { label: 'Web & frontend', terms: ['web', 'frontend', 'browser', 'javascript', 'typescript', 'react', 'vue', 'svelte'] },
  { label: 'Data & databases', terms: ['database', 'sqlite', 'sql', 'data', 'graph', 'search', 'vector'] },
  { label: 'Design systems', terms: ['design', 'ui', 'ux', 'css', 'figma', 'component'] },
  { label: 'Automation', terms: ['automation', 'workflow', 'integration', 'api', 'bot', 'crawler'] },
  { label: 'Mobile', terms: ['ios', 'android', 'mobile', 'swift', 'kotlin'] },
  { label: 'Reference', terms: ['awesome', 'curated', 'reference', 'documentation', 'learning', 'list'] },
] as const

export function subjectsForRepo(repo: Pick<Repo, 'name' | 'description' | 'tags' | 'language'>) {
  const haystack = [repo.name, repo.description, repo.language, ...repo.tags].join(' ').toLowerCase()
  const subjects = subjectRules.filter((rule) => rule.terms.some((term) => haystack.includes(term))).map((rule) => rule.label)
  return subjects.length > 0 ? subjects.slice(0, 3) : ['Unsorted']
}
