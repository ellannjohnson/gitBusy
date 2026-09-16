import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('front page GitHub setup banner renders the active device flow', async () => {
  const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const cardSource = await readFile(new URL('../src/components/GithubConnection.tsx', import.meta.url), 'utf8')
  const bannerStart = appSource.indexOf('github-setup-banner')
  const settingsStart = appSource.indexOf('className="settings-panel"')

  assert.notEqual(bannerStart, -1)
  assert.notEqual(settingsStart, -1)
  assert.match(appSource.slice(bannerStart, settingsStart), /GithubDeviceFlowCard flow=\{githubAuthFlow\}/)
  assert.match(cardSource, /flow\.verificationUri/)
  assert.match(cardSource, /flow\.userCode/)
  assert.match(cardSource, /GitHub one-time code/)
  assert.match(cardSource, /Copy code/)
  assert.match(cardSource, /writeText\(flow\.userCode\)/)
})
