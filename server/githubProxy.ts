import { spawn } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import https from 'node:https'
import { URL } from 'node:url'
import type { Plugin } from 'vite'
import { BASE_PATH_PREFIX } from './basePath.ts'
import { buildDeviceCodeRequest, classifyDeviceTokenResponse, nextDevicePollDelay, type DeviceTokenResult } from './githubAuth.ts'
import { readGithubOAuthCredential as readPlatformGithubOAuthCredential, saveGithubOAuthCredential as savePlatformGithubOAuthCredential, deleteGithubOAuthCredential as deletePlatformGithubOAuthCredential, type GithubOAuthCredential } from './platform/credential.ts'
import { tailscaleBinary as resolveTailscaleBinary } from './platform/tailscaleBinary.ts'
import { buildExploreQueries, getPreferenceSignals, rankLittleKnownRepos, rankPersonalizedRepos, type ExploreKind, type PreferenceSignal } from './exploreRanking.ts'
import { summarizeGithubGraphqlError } from './githubListErrors.ts'
import { summarizeRestGithubError } from './restErrors.ts'
import { fetchStarHistoryGrowth, type GithubStarHistoryFetcher } from './githubProxyStarHistory.ts'
import { gitignoreTemplates, type GitignoreTemplate } from '../src/gitignore-templates.ts'
import { applySecurityHeaders } from './securityHeaders.ts'
import { checkMutationOrigin } from './requestSecurity.ts'
import { extractReadmeLines } from './readmeExtractor.ts'
import { PairingGate } from './pairing.ts'
import { canonicalizePublishPath } from './publishPaths.ts'
import { audit } from './audit.ts'

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

type GithubListRemote = {
  id: string
  name: string
  description: string
  isPrivate: boolean
  repos: Array<{ id: string; fullName: string }>
}

type GithubListDraftInput = {
  remoteId?: string
  name: string
  description: string
  isPrivate: boolean
  repos: string[]
}

type GithubListsPushBody = {
  lists: GithubListDraftInput[]
  deletedRemoteIds: string[]
}

type GithubDeviceFlow = {
  deviceCode: string
  intervalSeconds: number
  expiresAt: number
  nextPollAt: number
}

const GITHUB_OAUTH_CLIENT_ID = process.env.GITBUSY_GITHUB_CLIENT_ID?.trim() || ''
const GITHUB_DEVICE_FLOW_DEFAULT_INTERVAL = 5
const GITHUB_DEVICE_FLOW_DEFAULT_TTL_SECONDS = 900
const githubDeviceFlows = new Map<string, GithubDeviceFlow>()
let githubOAuthRefresh: Promise<GithubOAuthCredential | null> | null = null

function finitePositiveNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

async function readGithubOAuthCredential(): Promise<GithubOAuthCredential | null> {
  return readPlatformGithubOAuthCredential()
}

async function saveGithubOAuthCredential(credential: GithubOAuthCredential) {
  return savePlatformGithubOAuthCredential(credential)
}

async function deleteGithubOAuthCredential() {
  return deletePlatformGithubOAuthCredential()
}

function githubOAuthPost(path: string, body: URLSearchParams): Promise<{ status: number; data: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const bodyText = body.toString()
    const request = https.request(new URL(path, 'https://github.com'), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(bodyText),
        'User-Agent': 'gitbusy-local',
      },
    }, (response) => {
      let responseBody = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { responseBody += chunk })
      response.on('end', () => {
        let data: Record<string, unknown> = {}
        try {
          const parsed = JSON.parse(responseBody)
          if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>
        } catch {
          // The caller receives a safe invalid-response error.
        }
        resolve({ status: response.statusCode ?? 500, data })
      })
    })
    request.on('error', () => reject(new Error('GitHub sign-in service could not be reached')))
    request.end(bodyText)
  })
}

function bearerAuthorization(credential: GithubOAuthCredential) {
  return `Bearer ${credential.accessToken}`
}

async function refreshGithubOAuthCredential(current: GithubOAuthCredential) {
  if (!GITHUB_OAUTH_CLIENT_ID || !current.refreshToken) return null
  try {
    const body = new URLSearchParams({
      client_id: GITHUB_OAUTH_CLIENT_ID,
      refresh_token: current.refreshToken,
      grant_type: 'refresh_token',
    })
    const response = await githubOAuthPost('/login/oauth/access_token', body)
    const result = classifyDeviceTokenResponse(response.data)
    if (result.status !== 'authorized') return null
    const expiresIn = finitePositiveNumber(response.data.expires_in)
    const refreshExpiresIn = finitePositiveNumber(response.data.refresh_token_expires_in)
    const refreshed: GithubOAuthCredential = {
      accessToken: result.accessToken,
      tokenType: result.tokenType,
      scope: result.scope || current.scope,
      expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
      refreshToken: typeof response.data.refresh_token === 'string' && response.data.refresh_token ? response.data.refresh_token : current.refreshToken,
      refreshTokenExpiresAt: refreshExpiresIn ? Date.now() + refreshExpiresIn * 1000 : current.refreshTokenExpiresAt,
    }
    await saveGithubOAuthCredential(refreshed)
    return refreshed
  } catch {
    return null
  }
}

async function githubOAuthAuthorization() {
  const current = await readGithubOAuthCredential()
  if (!current) return ''
  const shouldRefresh = current.expiresAt !== undefined && current.expiresAt <= Date.now() + 60_000
  if (shouldRefresh && current.refreshToken) {
    githubOAuthRefresh ??= refreshGithubOAuthCredential(current).finally(() => { githubOAuthRefresh = null })
    const refreshed = await githubOAuthRefresh
    if (refreshed) return bearerAuthorization(refreshed)
  }
  return bearerAuthorization(current)
}

function removeExpiredGithubDeviceFlows() {
  const now = Date.now()
  for (const [flowId, flow] of githubDeviceFlows) {
    if (flow.expiresAt <= now) githubDeviceFlows.delete(flowId)
  }
}

async function startGithubDeviceFlow() {
  if (!GITHUB_OAUTH_CLIENT_ID) throw httpError(503, 'Browser sign-in is not configured for this build')
  removeExpiredGithubDeviceFlows()
  let response: { status: number; data: Record<string, unknown> }
  try {
    response = await githubOAuthPost('/login/device/code', buildDeviceCodeRequest(GITHUB_OAUTH_CLIENT_ID))
  } catch {
    throw httpError(502, 'GitHub sign-in service could not be reached')
  }
  if (response.status < 200 || response.status >= 300) throw httpError(502, 'GitHub sign-in could not start')
  const deviceCode = typeof response.data.device_code === 'string' ? response.data.device_code : ''
  const userCode = typeof response.data.user_code === 'string' ? response.data.user_code : ''
  const verificationUri = typeof response.data.verification_uri === 'string' ? response.data.verification_uri : 'https://github.com/login/device'
  const expiresIn = finitePositiveNumber(response.data.expires_in) ?? GITHUB_DEVICE_FLOW_DEFAULT_TTL_SECONDS
  const intervalSeconds = finitePositiveNumber(response.data.interval) ?? GITHUB_DEVICE_FLOW_DEFAULT_INTERVAL
  if (!deviceCode || !userCode) throw httpError(502, 'GitHub returned an invalid sign-in response')
  const flowId = randomBytes(24).toString('hex')
  githubDeviceFlows.set(flowId, {
    deviceCode,
    intervalSeconds: Math.max(1, Math.floor(intervalSeconds)),
    expiresAt: Date.now() + expiresIn * 1000,
    nextPollAt: Date.now(),
  })
  return {
    flowId,
    userCode,
    verificationUri,
    expiresIn: Math.floor(expiresIn),
    interval: Math.max(1, Math.floor(intervalSeconds)),
  }
}

function deviceErrorMessage(message: string) {
  if (message.includes('expired_token')) return 'The GitHub sign-in code expired. Start again.'
  if (message.includes('access_denied')) return 'GitHub sign-in was cancelled.'
  return message
}

async function pollGithubDeviceFlow(flowId: string) {
  removeExpiredGithubDeviceFlows()
  const flow = githubDeviceFlows.get(flowId)
  if (!flow) throw httpError(410, 'This GitHub sign-in session expired. Start again.')
  if (flow.nextPollAt > Date.now()) {
    return { status: 'pending' as const, retryAfter: Math.max(1, Math.ceil((flow.nextPollAt - Date.now()) / 1000)) }
  }
  flow.nextPollAt = Date.now() + flow.intervalSeconds * 1000
  let response: { status: number; data: Record<string, unknown> }
  try {
    response = await githubOAuthPost('/login/oauth/access_token', new URLSearchParams({
      client_id: GITHUB_OAUTH_CLIENT_ID,
      device_code: flow.deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }))
  } catch {
    return { status: 'error' as const, message: 'GitHub sign-in service could not be reached' }
  }
  const result: DeviceTokenResult = classifyDeviceTokenResponse(response.data)
  if (result.status === 'pending') return { status: 'pending' as const, retryAfter: flow.intervalSeconds }
  if (result.status === 'slow_down') {
    flow.intervalSeconds = nextDevicePollDelay(result, flow.intervalSeconds)
    flow.nextPollAt = Date.now() + flow.intervalSeconds * 1000
    return { status: 'slow_down' as const, retryAfter: flow.intervalSeconds }
  }
  if (result.status === 'error') {
    githubDeviceFlows.delete(flowId)
    return { status: 'error' as const, message: deviceErrorMessage(result.message) }
  }
  try {
    const authorization = bearerAuthorization({ accessToken: result.accessToken, tokenType: result.tokenType, scope: result.scope })
    const { data: user } = await githubGet('/user', authorization)
    const login = typeof user.login === 'string' ? user.login : ''
    if (!login) throw new Error('GitHub did not return an account identity')
    const expiresIn = finitePositiveNumber(response.data.expires_in)
    const refreshExpiresIn = finitePositiveNumber(response.data.refresh_token_expires_in)
    await saveGithubOAuthCredential({
      accessToken: result.accessToken,
      tokenType: result.tokenType,
      scope: result.scope,
      expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
      refreshToken: typeof response.data.refresh_token === 'string' && response.data.refresh_token ? response.data.refresh_token : undefined,
      refreshTokenExpiresAt: refreshExpiresIn ? Date.now() + refreshExpiresIn * 1000 : undefined,
    })
    githubDeviceFlows.delete(flowId)
    return {
      status: 'authorized' as const,
      user: { login, name: typeof user.name === 'string' ? user.name : null, avatarUrl: typeof user.avatar_url === 'string' ? user.avatar_url : '' },
    }
  } catch {
    githubDeviceFlows.delete(flowId)
    return { status: 'error' as const, message: 'GitHub sign-in could not be saved to this Mac' }
  }
}

async function githubAuthStatus() {
  const authorization = await githubOAuthAuthorization()
  if (!authorization) {
    return { configured: Boolean(GITHUB_OAUTH_CLIENT_ID), connected: false, login: '', error: '' }
  }
  try {
    const { data: user } = await githubGet('/user', authorization)
    return {
      configured: Boolean(GITHUB_OAUTH_CLIENT_ID),
      connected: true,
      login: typeof user.login === 'string' ? user.login : '',
      name: typeof user.name === 'string' ? user.name : null,
      avatarUrl: typeof user.avatar_url === 'string' ? user.avatar_url : '',
      error: '',
    }
  } catch {
    return {
      configured: Boolean(GITHUB_OAUTH_CLIENT_ID),
      connected: false,
      login: '',
      error: 'GitHub sign-in has expired or was revoked. Sign in again.',
    }
  }
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
  const oauthAuthorization = await githubOAuthAuthorization()
  if (oauthAuthorization) return oauthAuthorization
  const credential = await readCredential()
  return `Basic ${Buffer.from(`${credential.username}:${credential.password}`).toString('base64')}`
}

function githubGet(path: string, authorization: string, accept = 'application/vnd.github+json', apiVersion = '2022-11-28'): Promise<GithubResponse> {
  return new Promise((resolve, reject) => {
    const request = https.request(new URL(path, 'https://api.github.com'), {
      method: 'GET',
      headers: {
        Accept: accept,
        Authorization: authorization,
        'User-Agent': 'gitbusy-local',
        'X-GitHub-Api-Version': apiVersion,
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

function githubJsonWrite(path: string, method: 'POST' | 'PATCH' | 'PUT', authorization: string, payload: unknown): Promise<GithubResponse> {
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
          // APPSEC-007 / DC-010: sanitize the upstream message before
          // it reaches the client. The original message is captured
          // server-side via the audit logger so debugging is
          // unaffected. The status code is preserved unchanged so the
          // existing 422→409 mapping in publishFolderToGithub still
          // fires correctly.
          const upstreamMessage = typeof data?.message === 'string' ? data.message : ''
          if (upstreamMessage) {
            audit('github_rest_upstream_error', {
              method,
              path,
              status,
              upstream_message_length: upstreamMessage.length,
            })
          }
          const summary = summarizeRestGithubError(status, upstreamMessage)
          const error = new Error(summary.message) as Error & { status: number }
          error.status = summary.status
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

type GithubGraphqlResult = {
  data?: any
  errors?: Array<{ message?: unknown }>
}

class GithubGraphqlPartialDataError extends Error {
  readonly data: unknown
  readonly messages: string[]

  constructor(data: unknown, messages: string[]) {
    super('GitHub returned partial GraphQL data')
    this.name = 'GithubGraphqlPartialDataError'
    this.data = data
    this.messages = messages
  }
}

type GithubGraphqlOptions = {
  allowPartial?: boolean
}

function githubGraphql<T>(query: string, variables: Record<string, unknown>, authorization: string, options: GithubGraphqlOptions = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables })
    const request = https.request(new URL('/graphql', 'https://api.github.com'), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
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
        let payload: GithubGraphqlResult = {}
        try {
          payload = responseBody ? JSON.parse(responseBody) as GithubGraphqlResult : {}
        } catch {
          reject(httpError(502, 'GitHub returned invalid GraphQL JSON'))
          return
        }
        if (status < 200 || status >= 300) {
          reject(httpError(status, `GitHub GraphQL returned ${status}`))
          return
        }
        const messages = Array.isArray(payload.errors)
          ? payload.errors.map((item) => typeof item?.message === 'string' ? item.message : '').filter(Boolean)
          : []
        if (messages.length > 0) {
          if (options.allowPartial && payload.data) {
            reject(new GithubGraphqlPartialDataError(payload.data, messages))
            return
          }
          const summary = summarizeGithubGraphqlError(messages.join('; '))
          reject(httpError(summary.status, summary.message))
          return
        }
        if (!payload.data) {
          reject(httpError(502, 'GitHub returned no GraphQL data'))
          return
        }
        resolve(payload.data as T)
      })
    })
    request.on('error', () => reject(httpError(502, 'GitHub GraphQL service could not be reached')))
    request.end(body)
  })
}

const GITHUB_LISTS_QUERY = `
query($cursor: String) {
  viewer {
    lists(first: 100, after: $cursor) {
      nodes { id name description isPrivate }
      pageInfo { hasNextPage endCursor }
    }
  }
}`

const GITHUB_LIST_ITEMS_QUERY = `
query($listId: ID!, $cursor: String) {
  node(id: $listId) {
    ... on UserList {
      items(first: 100, after: $cursor) {
        nodes { ... on Repository { id nameWithOwner } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`

const GITHUB_REPOSITORY_ID_QUERY = `
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) { id nameWithOwner }
}`

const GITHUB_CREATE_LIST_MUTATION = `
mutation($name: String!, $description: String, $isPrivate: Boolean!) {
  createUserList(input: { name: $name, description: $description, isPrivate: $isPrivate }) {
    list { id name description isPrivate }
  }
}`

const GITHUB_UPDATE_LIST_MUTATION = `
mutation($listId: ID!, $name: String!, $description: String, $isPrivate: Boolean!) {
  updateUserList(input: { listId: $listId, name: $name, description: $description, isPrivate: $isPrivate }) {
    list { id name description isPrivate }
  }
}`

const GITHUB_DELETE_LIST_MUTATION = `
mutation($listId: ID!) {
  deleteUserList(input: { listId: $listId }) { clientMutationId }
}`

const GITHUB_UPDATE_ITEM_LISTS_MUTATION = `
mutation($itemId: ID!, $listIds: [ID!]!) {
  updateUserListsForItem(input: { itemId: $itemId, listIds: $listIds }) {
    lists { id }
  }
}`

type GithubListMetadataData = {
  viewer?: {
    lists?: {
      nodes?: Array<{ id: string; name: string; description?: string | null; isPrivate: boolean } | null>
      pageInfo?: { hasNextPage: boolean; endCursor?: string | null }
    }
  }
}

type GithubListItemsData = {
  node?: {
    items?: {
      nodes?: Array<{ id: string; nameWithOwner: string } | null>
      pageInfo?: { hasNextPage: boolean; endCursor?: string | null }
    } | null
  } | null
}

async function fetchGithubListMetadata(authorization: string) {
  const lists: Array<{ id: string; name: string; description: string; isPrivate: boolean }> = []
  let cursor: string | null = null
  for (let page = 0; page < 100; page += 1) {
    const data: GithubListMetadataData = await githubGraphql<GithubListMetadataData>(GITHUB_LISTS_QUERY, { cursor }, authorization)
    const connection = data.viewer?.lists
    if (!connection) throw httpError(502, 'GitHub did not return your lists')
    for (const list of connection.nodes ?? []) {
      if (list?.id && list.name) lists.push({ id: list.id, name: list.name, description: list.description ?? '', isPrivate: Boolean(list.isPrivate) })
    }
    if (!connection.pageInfo?.hasNextPage) return lists
    cursor = connection.pageInfo.endCursor ?? null
    if (!cursor) throw httpError(502, 'GitHub returned an invalid list cursor')
  }
  throw httpError(502, 'GitHub returned too many lists to load safely')
}

type GithubListItemsRead = {
  repos: Array<{ id: string; fullName: string }>
  complete: boolean
  warnings: string[]
}

function readGithubListItemsPage(data: GithubListItemsData) {
  const connection = data.node?.items
  const repos: Array<{ id: string; fullName: string }> = []
  for (const repo of connection?.nodes ?? []) {
    if (repo?.id && repo.nameWithOwner) repos.push({ id: repo.id, fullName: repo.nameWithOwner })
  }
  return { connection, repos }
}

async function fetchGithubListItems(listId: string, authorization: string): Promise<GithubListItemsRead> {
  const repos: Array<{ id: string; fullName: string }> = []
  let cursor: string | null = null
  for (let page = 0; page < 100; page += 1) {
    try {
      const data: GithubListItemsData = await githubGraphql<GithubListItemsData>(GITHUB_LIST_ITEMS_QUERY, { listId, cursor }, authorization, { allowPartial: true })
      const result = readGithubListItemsPage(data)
      repos.push(...result.repos)
      if (!result.connection) return { repos, complete: true, warnings: [] }
      if (!result.connection.pageInfo?.hasNextPage) return { repos, complete: true, warnings: [] }
      cursor = result.connection.pageInfo.endCursor ?? null
      if (!cursor) throw httpError(502, 'GitHub returned an invalid list item cursor')
    } catch (error) {
      if (!(error instanceof GithubGraphqlPartialDataError)) throw error
      const result = readGithubListItemsPage(error.data as GithubListItemsData)
      repos.push(...result.repos)
      const summary = summarizeGithubGraphqlError(error.messages.join('; '))
      return { repos, complete: false, warnings: [summary.message] }
    }
  }
  throw httpError(502, 'GitHub returned too many repositories in one list to load safely')
}

type GithubListsRead = {
  lists: GithubListRemote[]
  complete: boolean
  warnings: string[]
}

async function fetchGithubLists(authorization: string): Promise<GithubListsRead> {
  const metadata = await fetchGithubListMetadata(authorization)
  const lists: GithubListRemote[] = []
  const warnings: string[] = []
  let complete = true
  for (const list of metadata) {
    const items = await fetchGithubListItems(list.id, authorization)
    lists.push({ ...list, repos: items.repos })
    if (!items.complete) complete = false
    warnings.push(...items.warnings)
  }
  return { lists, complete, warnings: Array.from(new Set(warnings)) }
}

async function fetchGithubRepositoryId(fullName: string, authorization: string) {
  const [owner, name] = fullName.split('/')
  const data = await githubGraphql<{ repository?: { id?: string } | null }>(GITHUB_REPOSITORY_ID_QUERY, { owner, name }, authorization)
  const id = data.repository?.id
  if (!id) throw httpError(404, `GitHub repository ${fullName} could not be found`)
  return id
}

async function createGithubList(list: GithubListDraftInput, authorization: string) {
  const data = await githubGraphql<{ createUserList?: { list?: { id: string; name: string; description?: string | null; isPrivate: boolean } | null } }>(GITHUB_CREATE_LIST_MUTATION, { name: list.name, description: list.description || null, isPrivate: list.isPrivate }, authorization)
  const created = data.createUserList?.list
  if (!created?.id) throw httpError(502, 'GitHub did not return the created list')
  return created.id
}

async function updateGithubList(list: GithubListDraftInput, authorization: string) {
  if (!list.remoteId) throw httpError(400, 'An existing GitHub list is missing its ID')
  const data = await githubGraphql<{ updateUserList?: { list?: { id: string } | null } }>(GITHUB_UPDATE_LIST_MUTATION, { listId: list.remoteId, name: list.name, description: list.description || null, isPrivate: list.isPrivate }, authorization)
  if (!data.updateUserList?.list?.id) throw httpError(502, 'GitHub did not return the updated list')
  return data.updateUserList.list.id
}

async function deleteGithubList(listId: string, authorization: string) {
  await githubGraphql(GITHUB_DELETE_LIST_MUTATION, { listId }, authorization)
}

async function updateGithubItemLists(itemId: string, listIds: string[], authorization: string) {
  await githubGraphql(GITHUB_UPDATE_ITEM_LISTS_MUTATION, { itemId, listIds }, authorization)
}

function parseGithubListsBody(value: unknown): GithubListsPushBody {
  if (!value || typeof value !== 'object') throw httpError(400, 'A JSON GitHub lists request is required')
  const body = value as Record<string, unknown>
  if (!Array.isArray(body.lists) || body.lists.length > 100) throw httpError(400, 'The request must contain no more than 100 lists')
  const deletedRemoteIds = Array.isArray(body.deletedRemoteIds) ? body.deletedRemoteIds.map((value) => typeof value === 'string' ? value.trim() : '') : []
  if (deletedRemoteIds.length > 100 || deletedRemoteIds.some((value) => !/^[A-Za-z0-9_-]{1,200}$/.test(value))) throw httpError(400, 'The deleted GitHub list IDs are invalid')
  const deletedSet = new Set(deletedRemoteIds)
  const remoteIds = new Set<string>()
  const names = new Set<string>()
  let membershipCount = 0
  const lists = body.lists.map((raw, index) => {
    if (!raw || typeof raw !== 'object') throw httpError(400, `List ${index + 1} is invalid`)
    const item = raw as Record<string, unknown>
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    if (!name || name.length > 100 || /[\r\n]/.test(name)) throw httpError(400, `List ${index + 1} needs a name between 1 and 100 characters`)
    const nameKey = name.toLowerCase()
    if (names.has(nameKey)) throw httpError(400, `List names must be unique: ${name}`)
    names.add(nameKey)
    const remoteId = item.remoteId === undefined || item.remoteId === null ? undefined : typeof item.remoteId === 'string' ? item.remoteId.trim() : ''
    if (item.remoteId !== undefined && item.remoteId !== null && (!remoteId || !/^[A-Za-z0-9_-]{1,200}$/.test(remoteId))) throw httpError(400, `List ${name} has an invalid GitHub ID`)
    if (remoteId) {
      if (remoteIds.has(remoteId) || deletedSet.has(remoteId)) throw httpError(400, `GitHub list ID is repeated: ${remoteId}`)
      remoteIds.add(remoteId)
    }
    const description = typeof item.description === 'string' ? item.description.trim() : ''
    if (description.length > 500 || /[\r\n]/.test(description)) throw httpError(400, `Description for ${name} is too long`)
    if (typeof item.isPrivate !== 'boolean') throw httpError(400, `Privacy for ${name} must be boolean`)
    if (!Array.isArray(item.repos) || item.repos.length > 2_000) throw httpError(400, `List ${name} has too many repositories`)
    const seenRepos = new Set<string>()
    const repos = item.repos.map((rawRepo) => {
      const fullName = typeof rawRepo === 'string' ? rawRepo.trim() : ''
      const parts = fullName.split('/')
      if (parts.length !== 2 || !safeRepoPart(parts[0]) || !safeRepoPart(parts[1])) throw httpError(400, `List ${name} contains an invalid repository name`)
      const key = fullName.toLowerCase()
      if (seenRepos.has(key)) throw httpError(400, `List ${name} contains a duplicate repository`)
      seenRepos.add(key)
      membershipCount += 1
      if (membershipCount > 20_000) throw httpError(400, 'The request contains too many list memberships')
      return fullName
    })
    return { remoteId, name, description, isPrivate: item.isPrivate, repos }
  })
  return { lists, deletedRemoteIds }
}

function sameStringSet(left: Set<string>, right: Set<string>) {
  if (left.size !== right.size) return false
  for (const value of left) if (!right.has(value)) return false
  return true
}

async function syncGithubLists(body: GithubListsPushBody) {
  const authorization = await authHeader()
  const beforeRead = await fetchGithubLists(authorization)
  if (!beforeRead.complete) throw httpError(409, beforeRead.warnings[0] || 'GitHub returned incomplete list data. Resolve organization access before pushing changes.')
  const before = beforeRead.lists
  const beforeById = new Map(before.map((list) => [list.id, list]))
  for (const list of body.lists) {
    if (list.remoteId && !beforeById.has(list.remoteId)) throw httpError(409, `GitHub list ${list.name} changed remotely. Pull the latest lists before pushing.`)
  }
  for (const listId of body.deletedRemoteIds) {
    if (!beforeById.has(listId)) throw httpError(409, 'A list marked for deletion no longer exists on GitHub. Pull the latest lists before pushing.')
  }

  let created = 0
  let updated = 0
  const resolvedLists: Array<{ draft: GithubListDraftInput; remoteId: string }> = []
  for (const list of body.lists) {
    const remoteId = list.remoteId ? await updateGithubList(list, authorization) : await createGithubList(list, authorization)
    resolvedLists.push({ draft: list, remoteId })
    if (list.remoteId) updated += 1
    else created += 1
  }
  for (const listId of body.deletedRemoteIds) await deleteGithubList(listId, authorization)

  const afterRead = await fetchGithubLists(authorization)
  if (!afterRead.complete) throw httpError(409, afterRead.warnings[0] || 'GitHub returned incomplete list data. Resolve organization access before pushing changes.')
  const after = afterRead.lists
  const currentByRepo = new Map<string, { id: string; listIds: Set<string>; fullName: string }>()
  for (const list of after) {
    for (const repo of list.repos) {
      const key = repo.fullName.toLowerCase()
      const membership = currentByRepo.get(key) ?? { id: repo.id, listIds: new Set<string>(), fullName: repo.fullName }
      membership.listIds.add(list.id)
      currentByRepo.set(key, membership)
    }
  }
  const desiredByRepo = new Map<string, { listIds: Set<string>; fullName: string }>()
  for (const { draft, remoteId } of resolvedLists) {
    for (const fullName of draft.repos) {
      const key = fullName.toLowerCase()
      const membership = desiredByRepo.get(key) ?? { listIds: new Set<string>(), fullName }
      membership.listIds.add(remoteId)
      desiredByRepo.set(key, membership)
    }
  }
  const allRepoKeys = new Set([...currentByRepo.keys(), ...desiredByRepo.keys()])
  let changedRepos = 0
  for (const key of allRepoKeys) {
    const current = currentByRepo.get(key)
    const desired = desiredByRepo.get(key)
    const currentIds = current?.listIds ?? new Set<string>()
    const desiredIds = desired?.listIds ?? new Set<string>()
    if (sameStringSet(currentIds, desiredIds)) continue
    const fullName = desired?.fullName ?? current?.fullName
    if (!fullName) continue
    const itemId = current?.id ?? await fetchGithubRepositoryId(fullName, authorization)
    await updateGithubItemLists(itemId, Array.from(desiredIds), authorization)
    changedRepos += 1
  }

  const verifiedRead = await fetchGithubLists(authorization)
  if (!verifiedRead.complete) throw httpError(409, verifiedRead.warnings[0] || 'GitHub returned incomplete list data. Resolve organization access before pushing changes.')
  return { lists: verifiedRead.lists, created, updated, deleted: body.deletedRemoteIds.length, changedRepos, verified: true, complete: true, warnings: [] }
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

async function starGithubRepo(owner: string, name: string) {
  const authorization = await authHeader()
  await githubJsonWrite(`/user/starred/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, 'PUT', authorization, {})
  return { owner, name, starred: true }
}

async function fetchExplore(kind: ExploreKind) {
  const authorization = await authHeader()
  const effectiveKind: ExploreKind =
    kind === 'growth-7' || kind === 'growth-14' || kind === 'growth-30' ? 'learning' : kind
  const starred = effectiveKind === 'personalized' ? await fetchStarred(authorization) : []
  const preferenceSignals: PreferenceSignal[] = effectiveKind === 'personalized' ? getPreferenceSignals(starred) : []
  const queries = buildExploreQueries(effectiveKind, preferenceSignals)
  const sort = effectiveKind === 'littleknown' ? 'forks' : 'stars'
  // Single-query perPage is GitHub's documented Search API cap (100). Every
  // Explore shelf returns up to 100; merged-query shelves dedup by stable
  // repo id before ranking, so the slice(0, 100) cap below holds.
  const perPage = 100
  const responses = await Promise.all(queries.map((query) => githubGet(`/search/repositories?q=${encodeURIComponent(query)}&sort=${sort}&order=desc&per_page=${perPage}`, authorization)))
  const uniqueRepos = new Map<number, GithubStar>()
  responses.forEach(({ data }) => {
    if (Array.isArray(data.items)) data.items.forEach((repo: GithubStar) => uniqueRepos.set(repo.id, repo))
  })
  let repos = Array.from(uniqueRepos.values())
  if (effectiveKind === 'littleknown') {
    repos = rankLittleKnownRepos(repos)
  } else if (effectiveKind === 'personalized') {
    repos = rankPersonalizedRepos(repos, new Set(starred.map((repo) => repo.id)), preferenceSignals)
  } else {
    repos = repos.sort((a, b) => b.stargazers_count - a.stargazers_count).slice(0, 100)
  }
  if (kind === 'growth-7' || kind === 'growth-14' || kind === 'growth-30') {
    return await fetchExploreGrowth(kind, repos)
  }
  return {
    kind,
    repos: repos.map(mapStar),
    ...(kind === 'personalized' ? { preferenceSignals } : {}),
  }
}

async function fetchExploreGrowth(kind: 'growth-7' | 'growth-14' | 'growth-30', rawRepos: GithubStar[]) {
  const authorization = await authHeader()
  const candidates = rawRepos.map((repo) => ({
    id: repo.id,
    owner: { login: repo.owner.login },
    name: repo.name,
    full_name: `${repo.owner.login}/${repo.name}`,
    stargazers_count: repo.stargazers_count,
  }))
  const fetcher: GithubStarHistoryFetcher = async (owner, name, authz, apiVersion) => {
    const { data } = await githubGet(`/repos/${owner}/${name}/stargazers/history`, authz, 'application/vnd.github+json', apiVersion)
    if (!Array.isArray(data)) {
      throw httpError(502, 'GitHub returned an unexpected star-history response shape')
    }
    return data
  }
  const result = await fetchStarHistoryGrowth({
    kind,
    candidates,
    fetcher,
    authorization,
    apiVersion: '2026-03-10',
    concurrency: 6,
  })
  // Layer the full search-result repo fields onto the additive star-history
  // ranking so the UI can render owner/name/description/language/stars with
  // `starGrowth` set. The mapping preserves every candidate's search metadata.
  const repoByFullName = new Map(rawRepos.map((repo) => [`${repo.owner.login}/${repo.name}`, repo]))
  const enrichedRepos = result.repos.map((entry) => {
    const search = repoByFullName.get(entry.full_name)
    if (!search) return entry
    return {
      ...entry,
      owner: search.owner.login,
      name: search.name,
      description: search.description,
      language: search.language,
      topics: search.topics ?? [],
      archived: search.archived,
      githubUrl: search.html_url,
      updatedAt: search.updated_at,
      pushedAt: search.pushed_at,
      defaultBranch: search.default_branch,
      starsCount: search.stargazers_count,
      forksCount: search.forks_count,
      license: search.license?.spdx_id ?? undefined,
      visibility: search.private ? 'Private' : 'Public',
    }
  })
  return {
    kind,
    status: result.status,
    periodDays: result.periodDays,
    note: result.note,
    repos: enrichedRepos,
    meta: result.meta,
    ...(result.error ? { error: result.error } : {}),
  }
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
  const readmeLines = extractReadmeLines(readmeContent)
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
    updatedAt: new Date(repo.updated_at).getTime(),
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

// APPSEC-006 / DC-011: the publish-path canonicalization rules
// (percent-decode, NFC normalize, reserved top-level list, segment
// length, NUL rejection) live in `server/publishPaths.ts`; callers use
// `canonicalizePublishPath` directly so the dedupe-on-canonical-form
// behavior in `preparePublishFiles` stays in one place.

function preparePublishFiles(body: PublishBody) {
  const files: PublishFile[] = []
  const filesSkipped: Array<{ path: string; reason: string }> = []
  const seen = new Set<string>()
  for (const rawFile of body.files) {
    const rawPath = typeof rawFile?.path === 'string' ? rawFile.path.trim() : ''
    // APPSEC-006 / DC-011: canonicalize FIRST, then dedupe on the
    // canonical form. Two paths that normalize to the same GitHub
    // path are a user bug, not a feature, so the second occurrence
    // is reported as a duplicate skip rather than overwriting the
    // first.
    const canon = canonicalizePublishPath(rawPath)
    if (!canon.ok) {
      filesSkipped.push({ path: rawPath || '(unnamed file)', reason: 'Invalid or unsafe relative path' })
      continue
    }
    const path = canon.canonical
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
    // Case-insensitive collision check so a user path of `.GITIGNORE`
    // (which `.gitignore.toLowerCase()` would not catch) does not
    // double-publish alongside the generated `.gitignore`.
    const collision = Array.from(seen.keys()).some((existing) => existing.toLowerCase() === path.toLowerCase())
    if (collision) return
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

const GITBUSY_TAILSCALE_PATH = BASE_PATH_PREFIX
const GITBUSY_LOCAL_TARGET = 'http://127.0.0.1:5174/gitbusy/'
const GITBUSY_SESSION_COOKIE = 'gitbusy_session'

// DC-003 — predicate used by handleApiRequest's unknown-route guard.
// Keeping the set explicit (rather than startsWith checks) makes it
// obvious which API surfaces the server owns.
function isKnownApiPath(pathname: string): boolean {
  return pathname === '/api/network/status'
    || pathname === '/api/network/tailscale'
    || pathname === '/api/network/pair'
    || pathname.startsWith('/api/github/')
}
let tailscaleEnabled = false
let tailscaleUrl = ''
// APPSEC-005 / DC-012: the pairing state machine replaces the
// former module-level string. `tailscalePairingCode` is preserved
// for the network-status payload — it reads `pairingGate.activeCode()`
// at the call site.
const pairingGate = new PairingGate()
const tailscaleSessions = new Set<string>()

// Module-scoped bind values for the Origin / CSRF guard. Derived
// from the same env as `parseListenOptions` (server/productionServer.ts)
// with the same defaults. The handler is unit-tested with fixed
// values via the requestSecurity helper, so this duplication is
// acceptable and keeps the test seam deterministic.
const LOCAL_BIND_HOST = (process.env.GITBUSY_HOST || '127.0.0.1').trim() || '127.0.0.1'
const LOCAL_BIND_PORT = (() => {
  const raw = (process.env.GITBUSY_PORT || '5174').trim()
  const parsed = Number.parseInt(raw, 10)
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : 5174
})()

// Deny cross-site POST/PUT requests on mutating endpoints — APPSEC-004.
// Returns true when the request should proceed (same-origin) and false
// when the response has already been written with a 403.
function enforceSameOrigin(request: any, response: any): boolean {
  const decision = checkMutationOrigin({
    request,
    port: LOCAL_BIND_PORT,
    host: LOCAL_BIND_HOST,
    tailscaleUrl,
  })
  if (decision.ok) return true
  sendJson(response, 403, { error: 'Cross-site requests are not allowed' })
  return false
}

type CommandResult = { stdout: string; stderr: string }

function runTailscale(args: string[], timeoutMs = 15_000): Promise<CommandResult> {
  const binary = resolveTailscaleBinary()
  if (!binary) return Promise.reject(httpError(503, 'Tailscale is not installed on this device'))
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGTERM')
      reject(httpError(504, 'Tailscale did not respond in time'))
    }, timeoutMs)
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => { stdout += chunk })
    child.stderr?.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code !== 0) {
        reject(httpError(502, stderr.trim() || `Tailscale command failed with status ${code ?? 'unknown'}`))
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

function trimDnsName(value: unknown) {
  return typeof value === 'string' ? value.replace(/\.$/, '') : ''
}

async function tailscaleIdentity() {
  try {
    const result = await runTailscale(['status', '--json'])
    const data = JSON.parse(result.stdout) as { BackendState?: string; Self?: { HostName?: string; DNSName?: string; TailscaleIPs?: string[] } }
    return {
      tailscaleAvailable: true,
      backendState: data.BackendState || 'Unknown',
      hostName: data.Self?.HostName || '',
      dnsName: trimDnsName(data.Self?.DNSName),
      error: '',
    }
  } catch (error) {
    return {
      tailscaleAvailable: false,
      backendState: 'Unavailable',
      hostName: '',
      dnsName: '',
      error: error instanceof Error ? error.message : 'Tailscale status failed',
    }
  }
}

async function serveStatusConfig() {
  const result = await runTailscale(['serve', 'status', '--json'])
  return result.stdout.trim() ? JSON.parse(result.stdout) as Record<string, any> : {}
}

async function enableGitBusyServe(dnsName: string) {
  if (!dnsName) throw httpError(502, 'Tailscale did not return a MagicDNS hostname')
  try {
    const config = await serveStatusConfig()
    const web = config.Web as Record<string, any> | undefined
    const existing = web
      ? Object.values(web).map((service) => service?.Handlers?.[GITBUSY_TAILSCALE_PATH]).find(Boolean)
      : undefined
    if (existing?.Proxy && existing.Proxy !== GITBUSY_LOCAL_TARGET) {
      throw httpError(409, `Tailscale path ${GITBUSY_TAILSCALE_PATH} is already used by another service`)
    }
  } catch (error) {
    if (errorStatus(error) === 409) throw error
  }
  // Omit the explicit HTTPS port: Tailscale 1.102.3 cannot update a
  // mixed TCP/Web Serve config when that redundant flag is supplied.
  await runTailscale(['serve', '--yes', '--bg', `--set-path=${GITBUSY_TAILSCALE_PATH}`, GITBUSY_LOCAL_TARGET])
  return `https://${dnsName}${GITBUSY_TAILSCALE_PATH}`
}

async function disableGitBusyServe() {
  await runTailscale(['serve', '--yes', `--set-path=${GITBUSY_TAILSCALE_PATH}`, 'off'])
}

// PROD-BL-007 — loopback trust boundary is the kernel-known TCP peer.
// The previous implementation read Host and X-Forwarded-Host to decide
// whether a request came from a local client. Both headers are fully
// client-controlled, so a non-loopback TCP peer could spoof
// X-Forwarded-Host: 127.0.0.1, pass isLocalRequest, set the
// gitbusy_session cookie, and reach the network-authenticated
// /api/github/* routes on a Tailscale-enabled install. The fix uses
// the kernel-known TCP peer (request.socket.remoteAddress) as the
// trust boundary. Headers are no longer consulted anywhere in the
// auth path; the requestHost helper that consumed them has been
// removed entirely.
//
// PROD-BL-007 — exported for the regression suite. Recognizes every
// shape the kernel reports for a localhost TCP connection (plain IPv4
// loopback, IPv6 ::1, IPv4-mapped IPv6 ::ffff:127.0.0.1, bracketed).
export function normalizeLoopbackPeer(remoteAddress: string | undefined): string {
  if (!remoteAddress) return ''
  let addr = String(remoteAddress).trim().toLowerCase()
  if (addr.startsWith('[') && addr.endsWith(']')) addr = addr.slice(1, -1)
  if (addr.startsWith('::ffff:')) addr = addr.slice('::ffff:'.length)
  return addr
}

// PROD-BL-007 — exported for the regression suite.
export function actualLoopbackRequest(request: any): boolean {
  const peer = request?.socket?.remoteAddress
  const normalized = normalizeLoopbackPeer(peer)
  if (!normalized) return false
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1'
}

function isLocalRequest(request: any) {
  // PROD-BL-007 — trust the kernel-known TCP peer for loopback
  // decisions. The previous implementation read Host / X-Forwarded-Host,
  // both of which a remote client can forge to claim loopback.
  return actualLoopbackRequest(request)
}

function requestCookie(request: any, name: string) {
  const cookieHeader = String(request.headers?.cookie || '')
  const pair = cookieHeader.split(';').map((part: string) => part.trim()).find((part: string) => part.startsWith(`${name}=`))
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : ''
}

function isNetworkAuthenticated(request: any) {
  return isLocalRequest(request) || (tailscaleEnabled && tailscaleSessions.has(requestCookie(request, GITBUSY_SESSION_COOKIE)))
}

function setNetworkCookie(response: any, request: any, token: string, clear = false) {
  const secure = String(request.headers?.['x-forwarded-proto'] || '').toLowerCase() === 'https' || !isLocalRequest(request)
  const attributes = [
    `${GITBUSY_SESSION_COOKIE}=${clear ? '' : encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${clear ? 0 : 60 * 60 * 24 * 30}`,
  ]
  if (secure) attributes.push('Secure')
  response.setHeader('Set-Cookie', attributes.join('; '))
}

async function networkStatus(request: any) {
  const identity = await tailscaleIdentity()
  const activeCode = pairingGate.activeCode()
  return {
    ...identity,
    tailscaleEnabled,
    authenticated: !tailscaleEnabled || isNetworkAuthenticated(request),
    url: tailscaleEnabled ? tailscaleUrl : '',
    pairingCode: isLocalRequest(request) && tailscaleEnabled && activeCode ? activeCode : undefined,
  }
}

async function clearStaleGitBusyServe() {
  try {
    await disableGitBusyServe()
  } catch {
    // Tailscale may be unavailable during local-only startup.
  }
}
function sendJson(response: any, status: number, payload: unknown) {
  applySecurityHeaders(response)
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(payload))
}

// Shared API request handler. The Vite plugin (`githubProxy()`) and the
// production HTTP server (`server/productionServer.ts`) both delegate to
// this function so they handle identical routes, errors, and copy. The
// `next` callback is invoked only when the path is not an API route;
// the caller decides what to do with non-API requests (serve static
// files in production, defer to Vite in dev).
export async function handleApiRequest(request: any, response: any, next: () => void): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://gitbusy.local')
  if (url.pathname === GITBUSY_TAILSCALE_PATH) url.pathname = '/'
  else if (url.pathname.startsWith(`${GITBUSY_TAILSCALE_PATH}/`)) url.pathname = url.pathname.slice(GITBUSY_TAILSCALE_PATH.length)
  // DC-003 — unknown /api/* paths return JSON 404 instead of the SPA shell.
  // Only the three /api/network/* routes and anything under /api/github/
  // are valid; every other /api/* short-circuits here. Must run AFTER the
  // /gitbusy/ prefix strip so both /api/foo and /gitbusy/api/foo resolve.
  if (url.pathname.startsWith('/api/') && !isKnownApiPath(url.pathname)) {
    sendJson(response, 404, { error: 'Unknown API route' })
    return
  }
  if (url.pathname === '/api/network/status') {
    try {
      sendJson(response, 200, await networkStatus(request))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Network status failed'
      sendJson(response, 502, { error: message })
    }
    return
  }
  if (url.pathname === '/api/network/tailscale') {
    if (!enforceSameOrigin(request, response)) return
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'Tailscale access requires POST' })
      return
    }
    if (!isLocalRequest(request)) {
      sendJson(response, 403, { error: 'Tailscale access can only be changed on the Mac running gitBusy' })
      return
    }
    try {
      const rawBody = await readRequestBody(request)
      const parsedBody = JSON.parse(rawBody) as { enabled?: unknown }
      if (typeof parsedBody.enabled !== 'boolean') throw httpError(400, 'Tailscale enabled must be boolean')
      if (parsedBody.enabled) {
        const identity = await tailscaleIdentity()
        if (!identity.tailscaleAvailable || identity.backendState !== 'Running') throw httpError(503, identity.error || 'Tailscale is not running')
        tailscaleUrl = await enableGitBusyServe(identity.dnsName)
        tailscaleEnabled = true
        // APPSEC-005 / DC-012: 64-bit pairing code with TTL and
        // failed-attempt lockout. The code itself is forwarded to
        // the SPA via the network-status payload.
        const { code } = pairingGate.issueCode()
        tailscaleSessions.clear()
        const session = randomBytes(24).toString('hex')
        tailscaleSessions.add(session)
        setNetworkCookie(response, request, session)
        sendJson(response, 200, { ...(await networkStatus(request)), pairingCode: code })
      } else {
        await disableGitBusyServe()
        tailscaleEnabled = false
        tailscaleUrl = ''
        pairingGate.reset()
        tailscaleSessions.clear()
        setNetworkCookie(response, request, '', true)
        sendJson(response, 200, await networkStatus(request))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tailscale access could not be changed'
      sendJson(response, errorStatus(error), { error: message })
    }
    return
  }
  if (url.pathname === '/api/network/pair') {
    if (!enforceSameOrigin(request, response)) return
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'Pairing requires POST' })
      return
    }
    try {
      if (!tailscaleEnabled) throw httpError(400, 'Tailscale mobile access is not enabled')
      const rawBody = await readRequestBody(request)
      const parsedBody = JSON.parse(rawBody) as { code?: unknown }
      const submitted = typeof parsedBody.code === 'string' ? parsedBody.code : ''
      // APPSEC-005 / DC-012: delegate to the pairing state machine.
      // Reasons map to HTTP as documented in design §4.3:
      //   no-code  -> 400 / pairing not enabled
      //   expired  -> 410 / pairing code expired
      //   locked   -> 429 / Retry-After
      //   wrong    -> 401 / Retry-After when the lockout just engaged
      //   ok       -> 200 / set the session cookie
      const decision = pairingGate.tryAccept(submitted)
      if (decision.ok) {
        const session = randomBytes(24).toString('hex')
        tailscaleSessions.add(session)
        setNetworkCookie(response, request, session)
        sendJson(response, 200, { ...(await networkStatus(request)), authenticated: true })
        return
      }
      if (decision.reason === 'no-code') {
        throw httpError(400, 'Tailscale mobile access is not enabled')
      }
      if (decision.reason === 'expired') {
        throw httpError(410, 'Pairing code expired. Re-enable Tailscale to get a new one.')
      }
      if (decision.reason === 'locked') {
        sendJson(response, 429, { error: 'Too many wrong codes. Try again later.' })
        response.setHeader('Retry-After', String(decision.retryAfterSeconds))
        return
      }
      // 'wrong' — Retry-After is set when the lockout just engaged.
      if (decision.retryAfterSeconds > 0) {
        sendJson(response, 401, { error: 'That pairing code is not valid' })
        response.setHeader('Retry-After', String(decision.retryAfterSeconds))
        return
      }
      throw httpError(401, 'That pairing code is not valid')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'This device could not be paired'
      sendJson(response, errorStatus(error), { error: message })
    }
    return
  }
  if (url.pathname.startsWith('/api/github/') && tailscaleEnabled && !isNetworkAuthenticated(request)) {
    sendJson(response, 401, { error: 'Pair this device with the code shown in gitBusy Settings on the Mac' })
    return
  }
  if (!url.pathname.startsWith('/api/github/')) {
    next()
    return
  }
  try {
    if (url.pathname === '/api/github/auth/status') {
      if (request.method !== 'GET') {
        sendJson(response, 405, { error: 'GitHub auth status requires GET' })
        return
      }
      sendJson(response, 200, await githubAuthStatus())
      return
    }
    if (url.pathname === '/api/github/auth/device/start') {
      if (!enforceSameOrigin(request, response)) return
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'GitHub sign-in requires POST' })
        return
      }
      if (!isLocalRequest(request)) {
        sendJson(response, 403, { error: 'GitHub sign-in must be completed on the Mac running gitBusy' })
        return
      }
      try {
        sendJson(response, 200, await startGithubDeviceFlow())
      } catch (error) {
        const message = error instanceof Error ? error.message : 'GitHub sign-in could not start'
        sendJson(response, errorStatus(error), { error: message })
      }
      return
    }
    if (url.pathname === '/api/github/auth/device/poll') {
      if (!enforceSameOrigin(request, response)) return
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'GitHub sign-in polling requires POST' })
        return
      }
      if (!isLocalRequest(request)) {
        sendJson(response, 403, { error: 'GitHub sign-in must be completed on the Mac running gitBusy' })
        return
      }
      try {
        const rawBody = await readRequestBody(request)
        const parsedBody = JSON.parse(rawBody) as { flowId?: unknown }
        const flowId = typeof parsedBody.flowId === 'string' ? parsedBody.flowId.trim() : ''
        if (!/^[a-f0-9]{48}$/.test(flowId)) throw httpError(400, 'A valid GitHub sign-in session is required')
        sendJson(response, 200, await pollGithubDeviceFlow(flowId))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'GitHub sign-in could not be completed'
        sendJson(response, errorStatus(error), { error: message })
      }
      return
    }
    if (url.pathname === '/api/github/auth/signout') {
      if (!enforceSameOrigin(request, response)) return
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'GitHub sign-out requires POST' })
        return
      }
      if (!isLocalRequest(request)) {
        sendJson(response, 403, { error: 'GitHub sign-out must be completed on the Mac running gitBusy' })
        return
      }
      await deleteGithubOAuthCredential()
      sendJson(response, 200, { configured: Boolean(GITHUB_OAUTH_CLIENT_ID), connected: false, login: '', error: '' })
      return
    }
    if (url.pathname === '/api/github/star') {
      if (!enforceSameOrigin(request, response)) return
      if (request.method !== 'PUT') {
        sendJson(response, 405, { error: 'Starring a repository requires PUT' })
        return
      }
      try {
        const rawBody = await readRequestBody(request)
        const parsedBody = JSON.parse(rawBody) as { owner?: unknown; name?: unknown }
        const owner = typeof parsedBody.owner === 'string' ? parsedBody.owner.trim() : ''
        const name = typeof parsedBody.name === 'string' ? parsedBody.name.trim() : ''
        if (!safeRepoPart(owner) || !safeRepoPart(name)) throw httpError(400, 'A valid GitHub owner and repository name is required')
        sendJson(response, 200, await starGithubRepo(owner, name))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'GitHub repository could not be starred'
        sendJson(response, errorStatus(error), { error: message })
      }
      return
    }
    if (url.pathname === '/api/github/snapshot') {
      sendJson(response, 200, await fetchSnapshot())
      return
    }
    if (url.pathname === '/api/github/lists') {
      if (request.method !== 'GET') {
        sendJson(response, 405, { error: 'GitHub lists require GET' })
        return
      }
      const authorization = await authHeader()
      sendJson(response, 200, await fetchGithubLists(authorization))
      return
    }
    if (url.pathname === '/api/github/lists/push') {
      if (!enforceSameOrigin(request, response)) return
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Pushing GitHub lists requires POST' })
        return
      }
      const rawBody = await readRequestBody(request)
      const body = parseGithubListsBody(JSON.parse(rawBody))
      sendJson(response, 200, await syncGithubLists(body))
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
      if (!kind || !['trending', 'top', 'opensource', 'selfhosted', 'learning', 'littleknown', 'personalized', 'growth-7', 'growth-14', 'growth-30'].includes(kind)) {
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
      if (!enforceSameOrigin(request, response)) return
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
    sendJson(response, errorStatus(error), { error: message })
  }
}

export function githubProxy(): Plugin {
  return {
    name: 'gitbusy-github-local-proxy',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        await handleApiRequest(request, response, next)
      })
      void clearStaleGitBusyServe()
    },
  }
}
