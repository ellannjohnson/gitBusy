import assert from 'node:assert/strict'
import { test } from 'node:test'
import { matchesRepoQuery } from '../src/search.ts'

test('repo search matches repository names with hyphens', () => {
  const repo = {
    owner: 'Abdelrahman01wan',
    name: 'computer-science_Road_Map',
    description: 'A roadmap for learning computer science',
    summary: '',
    note: '',
    project: 'Inbox',
    tags: ['learning'],
  }
  assert.equal(matchesRepoQuery(repo, 'computer-science'), true)
})

test('repo search is case-insensitive and searches tags', () => {
  const repo = {
    owner: 'example',
    name: 'roadmap',
    description: '',
    summary: '',
    note: '',
    project: 'Inbox',
    tags: ['Computer-Science'],
  }
  assert.equal(matchesRepoQuery(repo, 'COMPUTER-SCIENCE'), true)
})
