import { spawn } from 'node:child_process'
import { Buffer } from 'node:buffer'
import https from 'node:https'
import { URL } from 'node:url'
import type { Plugin } from 'vite'

type GithubResponse = { data: any; headers: Record<string, string | string[] | undefined> }

type GithubStar = {
  id: number
  name: string
  full_name: string
  html_url: string
  description: string | null
  language: string | null
  topics?: string[]
  archived: boolean
  stargazers_count: number
  forks_count: number
  license?: { spdx_id: string | null } | null
  private?: boolean
  updated_at: string
  pushed_at: string | null
  default_branch: string
  owner: { login: string }
}

function readCredential(): Promise<{ username: string; password: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['credential', 'fill'], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || 'Git credential helper failed'))
        return
      }
      const fields = Object.fromEntries(stdout.split(/\r?\n/).filter(Boolean).map((line) => {
        const separator = line.indexOf('=')
        return separator === -1 ? [line, ''] : [line.slice(0, separator), line.slice(separator + 1)]
      }))
      if (!fields.username || !fields.password) {
        reject(new Error('No GitHub credential is available from the macOS credential helper'))
        return
      }
      resolve({ username: fields.username, password: fields.password })
    })
    child.stdin.end('protocol=https\nhost=github.com\n\n')
  })
}

async function authHeader() {
  const credential = await readCredential()
  return `Basic ${Buffer.from(`${credential.username}:${credential.password}`).toString('base64')}`
}

function githubGet(path: string, authorization: string, accept = 'application/vnd.github+json'): Promise<GithubResponse> {
  return new Promise((resolve, reject) => {
    const request = https.request(new URL(path, 'https://api.github.com'), {
      method: 'GET',
      headers: {
        Accept: accept,
        Authorization: authorization,
        'User-Agent': 'starboard-local',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => {
        const status = response.statusCode ?? 500
        if (status < 200 || status >= 300) {
          reject(new Error(`GitHub API returned ${status}`))
          return
        }
        try {
          resolve({ data: JSON.parse(body), headers: response.headers as Record<string, string | string[] | undefined> })
        } catch {
          reject(new Error('GitHub returned invalid JSON'))
        }
      })
    })
    request.on('error', reject)
    request.end()
  })
}

async function fetchStarred(authorization: string) {
  const starred: GithubStar[] = []
  for (let page = 1; page <= 100; page += 1) {
    const { data } = await githubGet(`/user/starred?per_page=100&page=${page}`, authorization)
    if (!Array.isArray(data) || data.length === 0) break
    starred.push(...data)
    if (data.length < 100) break
  }
  return starred
}

async function fetchOwnedRepos(authorization: string) {
  const owned: GithubStar[] = []
  for (let page = 1; page <= 100; page += 1) {
    const { data } = await githubGet(`/user/repos?visibility=all&affiliation=owner,collaborator,organization_member&sort=updated&per_page=100&page=${page}`, authorization)
    if (!Array.isArray(data) || data.length === 0) break
    owned.push(...data)
    if (data.length < 100) break
  }
  return owned
}

function mapStar(repo: GithubStar) {
  return {
    id: repo.id,
    owner: repo.owner.login,
    name: repo.name,
    description: repo.description,
    language: repo.language,
    topics: repo.topics ?? [],
    archived: repo.archived,
    updatedAt: repo.updated_at,
    pushedAt: repo.pushed_at,
    defaultBranch: repo.default_branch,
    githubUrl: repo.html_url,
    starsCount: repo.stargazers_count,
    forksCount: repo.forks_count,
    license: repo.license?.spdx_id ?? undefined,
    visibility: repo.private ? 'Private' : 'Public',
  }
}

async function fetchSnapshot() {
  const authorization = await authHeader()
  const [{ data: user }, starred] = await Promise.all([
    githubGet('/user', authorization),
    fetchStarred(authorization),
  ])
  return {
    user: { login: user.login, name: user.name, avatarUrl: user.avatar_url },
    repos: starred.map(mapStar),
  }
}

type ExploreKind = 'trending' | 'top' | 'opensource' | 'selfhosted'

function exploreQuery(kind: ExploreKind) {
  if (kind === 'trending') {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
    return `stars:>100 pushed:>${since}`
  }
  if (kind === 'opensource') return 'license:mit OR license:apache-2.0 OR license:bsd-3-clause stars:>100'
  if (kind === 'selfhosted') return 'topic:self-hosted stars:>50'
  return 'stars:>0'
}

async function fetchExplore(kind: ExploreKind) {
  const authorization = await authHeader()
  const queries = kind === 'opensource'
    ? ['license:mit stars:>100', 'license:apache-2.0 stars:>100', 'license:bsd-3-clause stars:>100']
    : [exploreQuery(kind)]
  const responses = await Promise.all(queries.map((query) => githubGet(`/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=20`, authorization)))
  const uniqueRepos = new Map<number, GithubStar>()
  responses.forEach(({ data }) => {
    if (Array.isArray(data.items)) data.items.forEach((repo: GithubStar) => uniqueRepos.set(repo.id, repo))
  })
  const repos = Array.from(uniqueRepos.values()).sort((a, b) => b.stargazers_count - a.stargazers_count).slice(0, 20)
  return { kind, repos: repos.map(mapStar) }
}

function safeRepoPart(value: string | null) {
  return Boolean(value && /^[a-zA-Z0-9_.-]+$/.test(value))
}

async function fetchRepoDetail(owner: string, name: string) {
  const authorization = await authHeader()
  const encodedOwner = encodeURIComponent(owner)
  const encodedName = encodeURIComponent(name)
  const { data: repo } = await githubGet(`/repos/${encodedOwner}/${encodedName}`, authorization)
  const treePath = `/repos/${encodedOwner}/${encodedName}/git/trees/${encodeURIComponent(repo.default_branch)}?recursive=1`
  const [readmeResult, treeResult, releaseResult] = await Promise.all([
    githubGet(`/repos/${encodedOwner}/${encodedName}/readme`, authorization).catch(() => ({ data: null, headers: {} })),
    githubGet(treePath, authorization).catch(() => ({ data: { tree: [] }, headers: {} })),
    githubGet(`/repos/${encodedOwner}/${encodedName}/releases/latest`, authorization).catch(() => ({ data: null, headers: {} })),
  ])
  const readmeContent = readmeResult.data?.content ? Buffer.from(readmeResult.data.content, 'base64').toString('utf8') : ''
  const readmeLines = readmeContent.split(/\r?\n/).map((line: string) => line.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()).filter(Boolean)
  const headingIndex = readmeLines.findIndex((line: string) => /^#\s+/.test(line))
  const heading = headingIndex === -1 ? repo.name : readmeLines[headingIndex].replace(/^#\s+/, '')
  const body = readmeLines.filter((_: string, index: number) => index !== headingIndex).slice(0, 7)
  const tree = Array.isArray(treeResult.data?.tree) ? treeResult.data.tree : []
  return {
    id: repo.id,
    owner: repo.owner.login,
    name: repo.name,
    description: repo.description,
    language: repo.language,
    githubUrl: repo.html_url,
    updatedAt: repo.updated_at,
    pushedAt: repo.pushed_at,
    defaultBranch: repo.default_branch,
    archived: repo.archived,
    starsCount: repo.stargazers_count,
    forksCount: repo.forks_count,
    license: repo.license?.spdx_id ?? undefined,
    visibility: repo.private ? 'Private' : 'Public',
    readme: [heading, ...body],
    files: tree.slice(0, 32).map((item: { path: string }) => item.path),
    lastRelease: releaseResult.data?.tag_name ?? 'No releases',
  }
}

function sendJson(response: any, status: number, payload: unknown) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(payload))
}

export function githubProxy(): Plugin {
  return {
    name: 'starboard-github-local-proxy',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://starboard.local')
        if (!url.pathname.startsWith('/api/github/')) {
          next()
          return
        }
        try {
          if (url.pathname === '/api/github/snapshot') {
            sendJson(response, 200, await fetchSnapshot())
            return
          }
          if (url.pathname === '/api/github/repos') {
            const authorization = await authHeader()
            const repos = await fetchOwnedRepos(authorization)
            sendJson(response, 200, { repos: repos.map(mapStar) })
            return
          }
          if (url.pathname === '/api/github/explore') {
            const kind = url.searchParams.get('kind')
            if (!kind || !['trending', 'top', 'opensource', 'selfhosted'].includes(kind)) {
              sendJson(response, 400, { error: 'A valid Explore category is required' })
              return
            }
            sendJson(response, 200, await fetchExplore(kind as ExploreKind))
            return
          }
          if (url.pathname === '/api/github/repo') {
            const owner = url.searchParams.get('owner')
            const name = url.searchParams.get('name')
            if (!safeRepoPart(owner) || !safeRepoPart(name)) {
              sendJson(response, 400, { error: 'A valid GitHub owner and repository name are required' })
              return
            }
            sendJson(response, 200, await fetchRepoDetail(owner as string, name as string))
            return
          }
          sendJson(response, 404, { error: 'Unknown GitHub endpoint' })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'GitHub request failed'
          sendJson(response, 502, { error: message })
        }
      })
    },
  }
}
