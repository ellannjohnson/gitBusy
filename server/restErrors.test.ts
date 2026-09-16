import assert from 'node:assert/strict'
import { test } from 'node:test'
import { summarizeRestGithubError } from './restErrors.ts'

// REST upstream error sanitization — APPSEC-007 / DC-010.
// Maps GitHub REST API status codes to stable user-facing strings.
// The original upstream message is captured server-side (see
// server/audit.ts, DC-001) and never returned to the client.

test('summarizeRestGithubError(401, …) returns the auth-expired copy', () => {
  assert.deepEqual(
    summarizeRestGithubError(401, 'Bad credentials token expired'),
    { status: 401, message: 'GitHub sign-in has expired or was revoked. Sign in again.' },
  )
})

test('summarizeRestGithubError(403, …) returns the generic-denied copy', () => {
  assert.deepEqual(
    summarizeRestGithubError(403, 'Resource not accessible by integration'),
    { status: 403, message: 'GitHub denied this request.' },
  )
})

test('summarizeRestGithubError(404, …) returns the not-found copy', () => {
  assert.deepEqual(
    summarizeRestGithubError(404, 'Not Found'),
    { status: 404, message: 'GitHub did not find the requested resource.' },
  )
})

test('summarizeRestGithubError(409, …) returns the conflict copy', () => {
  assert.deepEqual(
    summarizeRestGithubError(409, 'Conflict'),
    { status: 409, message: 'GitHub reported a conflict with the existing resource.' },
  )
})

test('summarizeRestGithubError(422, …) returns the rejected-payload copy', () => {
  assert.deepEqual(
    summarizeRestGithubError(422, 'Name already exists on this account'),
    { status: 422, message: 'GitHub rejected the request payload.' },
  )
})

test('summarizeRestGithubError(429, …) returns the rate-limit copy', () => {
  assert.deepEqual(
    summarizeRestGithubError(429, 'API rate limit exceeded for user ID 1234'),
    { status: 429, message: 'GitHub rate-limited this request. Try again later.' },
  )
})

test('summarizeRestGithubError(500, …) returns the upstream-unavailable copy', () => {
  assert.deepEqual(
    summarizeRestGithubError(500, 'Internal Server Error'),
    { status: 500, message: 'GitHub service is unavailable. Try again later.' },
  )
})

test('summarizeRestGithubError(502, …) returns the upstream-unavailable copy', () => {
  assert.deepEqual(
    summarizeRestGithubError(502, 'Bad Gateway'),
    { status: 502, message: 'GitHub service is unavailable. Try again later.' },
  )
})

test('summarizeRestGithubError returns the unmapped fallback for unrecognized status codes', () => {
  // An unmapped 4xx that is not 401/403/404/409/422/429 falls through to
  // the default "GitHub API returned <status>" copy.
  assert.deepEqual(
    summarizeRestGithubError(418, 'I am a teapot'),
    { status: 418, message: 'GitHub API returned 418' },
  )
})

test('summarizeRestGithubError does NOT echo the upstream message in any mapped branch', () => {
  // The summary must never contain the per-case upstream message
  // substring. This is a defense-in-depth check: even if a future
  // edit accidentally adds a `<status>: ${upstreamMessage}` shape, this
  // assertion will fail loudly. We use distinct substrings so unrelated
  // mapping words don't false-positive.
  const cases: Array<[number, string, string]> = [
    [401, 'Bad credentials token expired', 'Bad credentials'],
    [403, 'Resource not accessible by integration', 'not accessible by integration'],
    [404, 'Not Found', 'Not Found'],
    [409, 'Conflict', 'Conflict'],
    [422, 'Name already exists on this account', 'already exists on this account'],
    [429, 'API rate limit exceeded for user ID 1234', 'API rate limit exceeded'],
    [500, 'Internal Server Error', 'Internal Server Error'],
  ]
  for (const [status, upstream, leak] of cases) {
    const summary = summarizeRestGithubError(status, upstream)
    assert.equal(
      summary.message.includes(leak),
      false,
      `summary for status ${status} leaked upstream substring "${leak}": ${summary.message}`,
    )
  }
})

test('summarizeRestGithubError status field is preserved on the unmapped fallback', () => {
  const summary = summarizeRestGithubError(418, 'I am a teapot')
  assert.equal(summary.status, 418)
})