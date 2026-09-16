import type { Repo } from './types'

export function matchesRepoQuery(repo: Pick<Repo, 'owner' | 'name' | 'description' | 'summary' | 'note' | 'project' | 'tags'>, query: string): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  const haystack = [repo.owner, repo.name, repo.description, repo.summary, repo.note, repo.project, ...repo.tags].join(' ').toLowerCase()
  return haystack.includes(normalized)
}
