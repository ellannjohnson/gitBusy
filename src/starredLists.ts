export type GithubListDraft = {
  localId: string
  remoteId?: string
  name: string
  description: string
  isPrivate: boolean
  repos: string[]
}

export type GithubListRemote = {
  id: string
  name: string
  description: string
  isPrivate: boolean
  repos: Array<{ id: string; fullName: string }>
}

type SuggestableRepo = {
  owner: string
  name: string
  description: string
  language: string
}

type ListRule = {
  name: string
  description: string
  terms: string[]
}

const listRules: ListRule[] = [
  { name: 'AI & agents', description: 'Models, agents, prompts, and local inference.', terms: ['ai', 'agent', 'llm', 'language model', 'machine learning', 'inference', 'prompt'] },
  { name: 'Self-hosted', description: 'Private infrastructure, homelabs, and services you can run yourself.', terms: ['self hosted', 'selfhosted', 'homelab', 'on premise', 'docker', 'home server', 'privacy'] },
  { name: 'Learning & reference', description: 'Courses, tutorials, documentation, guides, and reference shelves.', terms: ['learn', 'tutorial', 'course', 'documentation', 'reference', 'guide', 'cheatsheet', 'beginner', 'book', 'awesome list'] },
  { name: 'Web & frontend', description: 'Browser, JavaScript, TypeScript, and frontend building blocks.', terms: ['javascript', 'typescript', 'react', 'vue', 'svelte', 'frontend', 'browser', 'web app'] },
  { name: 'Developer tools', description: 'CLI, terminal, Git, editors, and developer workflow tools.', terms: ['cli', 'tui', 'terminal', 'developer tool', 'git', 'editor', 'command line'] },
  { name: 'Data & databases', description: 'Databases, search, data pipelines, and vector tooling.', terms: ['database', 'sqlite', 'sql', 'data pipeline', 'vector', 'search'] },
  { name: 'Automation', description: 'Bots, integrations, workflows, crawlers, and repeatable tasks.', terms: ['automation', 'workflow', 'integration', 'bot', 'crawler'] },
  { name: 'Design & creative', description: 'Design systems, UI, UX, CSS, and creative tooling.', terms: ['design', 'ui', 'ux', 'css', 'figma', 'component'] },
  { name: 'Mobile', description: 'iOS, Android, and mobile application development.', terms: ['ios', 'android', 'mobile', 'swift', 'kotlin'] },
]

function normalizedText(repo: SuggestableRepo) {
  return [repo.name, repo.description, repo.language]
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function matchesTerm(text: string, term: string) {
  const normalizedTerm = term.toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').replace(/\s+/g, ' ').trim()
  return ` ${text} `.includes(` ${normalizedTerm} `)
}

function draftId(name: string) {
  return `suggested-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
}

export function repoFullName(repo: Pick<SuggestableRepo, 'owner' | 'name'>) {
  return `${repo.owner}/${repo.name}`
}

export function suggestListDrafts(repos: SuggestableRepo[]): GithubListDraft[] {
  return listRules.flatMap((rule) => {
    const matchingRepos = repos
      .filter((repo) => {
        const text = normalizedText(repo)
        return rule.terms.some((term) => matchesTerm(text, term))
      })
      .map(repoFullName)
    if (matchingRepos.length === 0) return []
    return [{
      localId: draftId(rule.name),
      name: rule.name,
      description: rule.description,
      isPrivate: true,
      repos: Array.from(new Set(matchingRepos)),
    }]
  })
}

export function listDraftsFromGithub(lists: GithubListRemote[]): GithubListDraft[] {
  return lists.map((list) => ({
    localId: list.id,
    remoteId: list.id,
    name: list.name,
    description: list.description,
    isPrivate: list.isPrivate,
    repos: Array.from(new Set(list.repos.map((repo) => repo.fullName))),
  }))
}

export function newGithubListId() {
  const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `local-${suffix}`
}
