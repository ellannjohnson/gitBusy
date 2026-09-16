import assert from 'node:assert/strict'
import { test } from 'node:test'
import { summarizeGithubGraphqlError } from './githubListErrors.ts'
import { listDraftsFromGithub, suggestListDrafts } from '../src/starredLists.ts'

type TestRepo = {
  owner: string
  name: string
  description: string
  language: string
  tags: string[]
}

const repos: TestRepo[] = [
  {
    owner: 'example',
    name: 'local-ai-runner',
    description: 'Run large language models locally from a small CLI.',
    language: 'Python',
    tags: ['llm', 'one-off-tag'],
  },
  {
    owner: 'example',
    name: 'home-box',
    description: 'A self-hosted home server for a private homelab.',
    language: 'Go',
    tags: ['homelab'],
  },
  {
    owner: 'example',
    name: 'typescript-course',
    description: 'A beginner tutorial and course for learning TypeScript.',
    language: 'TypeScript',
    tags: ['tutorial'],
  },
]

test('suggestions use a small semantic taxonomy, not one list per GitHub tag', () => {
  const suggestions = suggestListDrafts(repos)
  assert.deepEqual(suggestions.map((list) => list.name), ['AI & agents', 'Self-hosted', 'Learning & reference', 'Web & frontend', 'Developer tools'])
  assert.equal(suggestions.some((list) => list.name === 'one-off-tag'), false)
  assert.ok(suggestions.find((list) => list.name === 'AI & agents')?.repos.includes('example/local-ai-runner'))
  assert.ok(suggestions.find((list) => list.name === 'Learning & reference')?.repos.includes('example/typescript-course'))
})

test('remote GitHub lists become editable local drafts without losing membership', () => {
  const drafts = listDraftsFromGithub([
    { id: 'UL_1', name: 'Keep close', description: 'Useful tools', isPrivate: true, repos: [{ id: 'R_1', fullName: 'example/tool' }] },
  ])
  assert.deepEqual(drafts, [{ localId: 'UL_1', remoteId: 'UL_1', name: 'Keep close', description: 'Useful tools', isPrivate: true, repos: ['example/tool'] }])
})

test('organization OAuth restrictions become an actionable, non-auth error', () => {
  const summary = summarizeGithubGraphqlError("Although you appear to have the correct authorization credentials, the `eigent-ai` organization has enabled OAuth App access restrictions, meaning that data access to third-parties is limited.")
  assert.equal(summary.status, 403)
  assert.match(summary.message, /eigent-ai organization restricts OAuth apps/)
  assert.match(summary.message, /Third-party access → OAuth app policy/)
  assert.doesNotMatch(summary.message, /sign in again|user permission/)
})
