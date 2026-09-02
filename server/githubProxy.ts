import { spawn } from 'node:child_process'
import { Buffer } from 'node:buffer'
import https from 'node:https'
import { URL } from 'node:url'
import type { Plugin } from 'vite'
import { gitignoreTemplates, type GitignoreTemplate } from '../src/gitignore-templates.js'

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
        'User-Agent': 'gitbusy-local',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => {
        const status = response.statusCode ?? 500
        if (status < 200 || status >= 300) {
          const error = new Error(`GitHub API returned ${status}`) as Error & { status: number }
          error.status = status
          reject(error)
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

function githubJsonWrite(path: string, method: 'POST' | 'PATCH', authorization: string, payload: unknown): Promise<GithubResponse> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload)
    const request = https.request(new URL(path, 'https://api.github.com'), {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: authorization,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'gitbusy-local',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }, (response) => {
      let responseBody = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { responseBody += chunk })
      response.on('end', () => {
        const status = response.statusCode ?? 500
        let data: any = null
        try {
          data = responseBody ? JSON.parse(responseBody) : null
        } catch {
          data = null
        }
        if (status < 200 || status >= 300) {
          const error = new Error(data?.message || `GitHub API returned ${status}`) as Error & { status: number }
          error.status = status
          reject(error)
          return
        }
        resolve({ data, headers: response.headers as Record<string, string | string[] | undefined> })
      })
    })
    request.on('error', reject)
    request.end(body)
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

type PublishBody = {
  name: string
  description: string
  isPrivate: boolean
  addGitignore: GitignoreTemplate
  commitMessage: string
  files: Array<{ path: unknown; content: unknown }>
}

type PublishFile = {
  path: string
  content: string
}

const MAX_PUBLISH_FILE_BYTES = 95 * 1024 * 1024
const MAX_PUBLISH_REQUEST_BYTES = 120 * 1024 * 1024

function httpError(status: number, message: string) {
  const error = new Error(message) as Error & { status: number }
  error.status = status
  return error
}

function errorStatus(error: unknown) {
  return typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : 502
}

function readRequestBody(request: any) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    let totalBytes = 0
    let tooLarge = false
    request.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.from(chunk)
      totalBytes += buffer.length
      if (totalBytes <= MAX_PUBLISH_REQUEST_BYTES) chunks.push(buffer)
      else tooLarge = true
    })
    request.on('end', () => {
      if (tooLarge) {
        reject(httpError(413, 'Publish payload is too large'))
        return
      }
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    request.on('error', reject)
  })
}

function parsePublishBody(value: unknown): PublishBody {
  if (!value || typeof value !== 'object') throw httpError(400, 'A JSON publish request is required')
  const body = value as Record<string, unknown>
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!/^[a-zA-Z0-9._-]{1,100}$/.test(name) || name === '..' || name === '.git') {
    throw httpError(400, 'Repository name must use 1–100 letters, numbers, dots, underscores, or hyphens')
  }
  if (typeof body.isPrivate !== 'boolean') throw httpError(400, 'Repository visibility must be public or private')
  if (!Array.isArray(body.files)) throw httpError(400, 'A files array is required')
  const addGitignore = body.addGitignore
  if (typeof addGitignore !== 'string' || !Object.prototype.hasOwnProperty.call(gitignoreTemplates, addGitignore)) {
    throw httpError(400, 'A valid gitignore template is required')
  }
  const commitMessage = typeof body.commitMessage === 'string' && body.commitMessage.trim() ? body.commitMessage.trim() : `Add ${name} from gitBusy`
  if (/co-authored-by\s*:/i.test(commitMessage)) throw httpError(400, 'Commit messages cannot add co-authors')
  return {
    name,
    description: typeof body.description === 'string' ? body.description.trim() : '',
    isPrivate: body.isPrivate,
    addGitignore: addGitignore as GitignoreTemplate,
    commitMessage,
    files: body.files as Array<{ path: unknown; content: unknown }>,
  }
}

function validPublishPath(path: string) {
  return path.length > 0 && path.length <= 240 && !path.startsWith('/') && !path.includes('\\0') && !path.includes('\\') && !path.split('/').some((part) => part === '..' || part === '')
}

function preparePublishFiles(body: PublishBody) {
  const files: PublishFile[] = []
  const filesSkipped: Array<{ path: string; reason: string }> = []
  const seen = new Set<string>()
  for (const rawFile of body.files) {
    const path = typeof rawFile?.path === 'string' ? rawFile.path.trim() : ''
    if (!validPublishPath(path)) {
      filesSkipped.push({ path: path || '(unnamed file)', reason: 'Invalid or unsafe relative path' })
      continue
    }
    if (seen.has(path)) {
      filesSkipped.push({ path, reason: 'Duplicate path' })
      continue
    }
    if (typeof rawFile.content !== 'string') {
      filesSkipped.push({ path, reason: 'File content is not UTF-8 text' })
      continue
    }
    if (Buffer.byteLength(rawFile.content, 'utf8') > MAX_PUBLISH_FILE_BYTES) {
      filesSkipped.push({ path, reason: 'Larger than the 95 MB safety limit' })
      continue
    }
    seen.add(path)
    files.push({ path, content: rawFile.content })
  }
  const addGeneratedFile = (path: string, content: string) => {
    if (seen.has(path)) return
    seen.add(path)
    files.push({ path, content })
  }
  addGeneratedFile('.gitignore', gitignoreTemplates[body.addGitignore])
  if (!files.some((file) => file.path.toLowerCase() === 'readme.md')) {
    const description = body.description ? `\n\n${body.description}` : ''
    addGeneratedFile('README.md', `# ${body.name}${description}\n\nImported from gitBusy on ${new Date().toISOString().slice(0, 10)}.\n`)
  }
  files.sort((a, b) => a.path.localeCompare(b.path))
  filesSkipped.sort((a, b) => a.path.localeCompare(b.path))
  return { files, filesSkipped }
}

async function publishFolderToGithub(value: unknown) {
  const body = parsePublishBody(value)
  const { files, filesSkipped } = preparePublishFiles(body)
  const authorization = await authHeader()
  const { data: user } = await githubGet('/user', authorization)
  const login = typeof user.login === 'string' ? user.login : ''
  const authorName = typeof user.name === 'string' && user.name.trim() ? user.name.trim() : login
  const authorEmail = typeof user.email === 'string' && user.email.trim()
    ? user.email.trim()
    : user.id !== undefined && user.id !== null && login
      ? `${user.id}+${login}@users.noreply.github.com`
      : ''
  if (!login || !authorEmail) throw httpError(502, 'GitHub did not return the authenticated author identity')
  let created: GithubResponse
  try {
    created = await githubJsonWrite('/user/repos', 'POST', authorization, {
      name: body.name,
      description: body.description,
      private: body.isPrivate,
      auto_init: false,
    })
  } catch (error) {
    if (errorStatus(error) === 422) throw httpError(409, 'Repository name already exists. Choose a different name.')
    throw error
  }

  const repository = created.data ?? {}
  const owner = typeof repository.owner?.login === 'string' ? repository.owner.login : user.login
  const name = typeof repository.name === 'string' ? repository.name : body.name
  if (owner !== user.login) throw httpError(502, 'GitHub returned a repository outside the authenticated account')
  const branch = typeof repository.default_branch === 'string' ? repository.default_branch : 'main'
  if (!authorEmail) throw httpError(502, 'GitHub did not return an author identity')

  const treeEntries: Array<{ path: string; mode: '100644'; type: 'blob'; sha: string }> = []
  for (const file of files) {
    const blobPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/blobs`
    const blob = await githubJsonWrite(blobPath, 'POST', authorization, { content: file.content, encoding: 'utf-8' })
    const sha = blob.data?.sha
    if (typeof sha !== 'string') throw new Error(`GitHub returned no blob SHA for ${file.path}`)
    treeEntries.push({ path: file.path, mode: '100644', type: 'blob', sha })
  }
  const treePath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/trees`
  const tree = await githubJsonWrite(treePath, 'POST', authorization, { tree: treeEntries })
  const newTreeSha = tree.data?.sha
  if (typeof newTreeSha !== 'string') throw new Error('GitHub returned no tree SHA for the publish commit')
  const newCommit = await githubJsonWrite(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/commits`, 'POST', authorization, {
    message: body.commitMessage,
    tree: newTreeSha,
    parents: [],
    author: { name: authorName, email: authorEmail },
    committer: { name: authorName, email: authorEmail },
  })
  const newCommitSha = newCommit.data?.sha
  if (typeof newCommitSha !== 'string') throw new Error('GitHub returned no commit SHA for the published files')
  const refPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/refs`
  await githubJsonWrite(refPath, 'POST', authorization, { ref: `refs/heads/${branch}`, sha: newCommitSha })
  const verifiedRef = await githubGet(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/ref/heads/${encodeURIComponent(branch)}`, authorization)
  if (verifiedRef.data?.object?.sha !== newCommitSha) throw new Error('GitHub did not point the new branch at the publish commit')

  return {
    html_url: repository.html_url,
    full_name: repository.full_name || `${owner}/${name}`,
    default_branch: branch,
    filesUploaded: files.length,
    filesSkipped,
    warnings: filesSkipped.length > 0 ? ['Some files were skipped and were not uploaded.'] : [],
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
    name: 'gitbusy-github-local-proxy',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://gitbusy.local')
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
          if (url.pathname === '/api/github/publish-folder') {
            if (request.method !== 'POST') {
              sendJson(response, 405, { error: 'Publish folder requires POST' })
              return
            }
            try {
              const rawBody = await readRequestBody(request)
              let parsedBody: unknown
              try {
                parsedBody = JSON.parse(rawBody)
              } catch {
                throw httpError(400, 'Publish request must contain valid JSON')
              }
              sendJson(response, 200, await publishFolderToGithub(parsedBody))
            } catch (error) {
              const message = error instanceof Error ? error.message : 'GitHub folder publish failed'
              sendJson(response, errorStatus(error), { error: message })
            }
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
