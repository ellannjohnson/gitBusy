import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildDeviceCodeRequest,
  classifyDeviceTokenResponse,
  nextDevicePollDelay,
} from './githubAuth.ts'

test('device-code requests use the GitHub OAuth scope set', () => {
  assert.equal(
    buildDeviceCodeRequest('public-client-id').toString(),
    'client_id=public-client-id&scope=repo+read%3Auser+read%3Aorg+user+offline_access',
  )
})

test('authorization_pending remains pending without exposing a token', () => {
  assert.deepEqual(classifyDeviceTokenResponse({ error: 'authorization_pending' }), { status: 'pending' })
})

test('slow_down increases the next polling interval', () => {
  assert.deepEqual(classifyDeviceTokenResponse({ error: 'slow_down' }), { status: 'slow_down' })
  assert.equal(nextDevicePollDelay({ status: 'slow_down' }, 5), 10)
})

test('successful token responses are classified for server-side storage', () => {
  assert.deepEqual(
    classifyDeviceTokenResponse({ access_token: 'opaque-token', token_type: 'bearer', scope: 'repo' }),
    { status: 'authorized', accessToken: 'opaque-token', tokenType: 'bearer', scope: 'repo' },
  )
})

test('malformed token responses become safe errors', () => {
  assert.deepEqual(classifyDeviceTokenResponse({ error: 'mystery_error' }), {
    status: 'error',
    message: 'GitHub sign-in failed: mystery_error',
  })
  assert.deepEqual(classifyDeviceTokenResponse({}), {
    status: 'error',
    message: 'GitHub sign-in returned an invalid response',
  })
})
