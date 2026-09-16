import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  tailscaleBinary,
  resolveTailscaleBinary,
} from './tailscaleBinary.ts'

// The platform module must:
// - keep the existing macOS candidates (`/Applications/Tailscale.app/...`
//   and `~/.local/bin/tailscale`);
// - add Linux distro locations (`/usr/bin/tailscale`,
//   `/usr/local/bin/tailscale`, `/opt/tailscale/bin/tailscale`);
// - walk `PATH` for a `tailscale` binary on every non-darwin platform;
// - never pick an absolute path that does not exist.
// All tests use `resolveTailscaleBinary(candidates, pathDirs)` so the
// production `tailscaleBinary()` closure can be tested without
// polluting the real filesystem or environment.

test('macOS keeps existing application-bundle candidate', () => {
  const candidates = resolveTailscaleBinary({
    home: '/Users/alice',
    pathDirs: [],
    platform: 'darwin',
    exists: (p) => p === '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  })
  assert.equal(candidates, '/Applications/Tailscale.app/Contents/MacOS/Tailscale')
})

test('macOS falls back to ~/.local/bin/tailscale', () => {
  const candidates = resolveTailscaleBinary({
    home: '/Users/alice',
    pathDirs: ['/usr/bin', '/usr/local/bin'],
    platform: 'darwin',
    exists: (p) => p === '/Users/alice/.local/bin/tailscale',
  })
  assert.equal(candidates, '/Users/alice/.local/bin/tailscale')
})

test('Linux finds /usr/bin/tailscale', () => {
  const candidates = resolveTailscaleBinary({
    home: '/home/bob',
    pathDirs: [],
    platform: 'linux',
    exists: (p) => p === '/usr/bin/tailscale',
  })
  assert.equal(candidates, '/usr/bin/tailscale')
})

test('Linux finds /usr/local/bin/tailscale', () => {
  const candidates = resolveTailscaleBinary({
    home: '/home/bob',
    pathDirs: [],
    platform: 'linux',
    exists: (p) => p === '/usr/local/bin/tailscale',
  })
  assert.equal(candidates, '/usr/local/bin/tailscale')
})

test('Linux finds /opt/tailscale/bin/tailscale', () => {
  const candidates = resolveTailscaleBinary({
    home: '/home/bob',
    pathDirs: [],
    platform: 'linux',
    exists: (p) => p === '/opt/tailscale/bin/tailscale',
  })
  assert.equal(candidates, '/opt/tailscale/bin/tailscale')
})

test('Linux walks PATH for tailscale', () => {
  const candidates = resolveTailscaleBinary({
    home: '/home/bob',
    pathDirs: ['/usr/local/sbin', '/opt/custom/bin', '/usr/bin'],
    platform: 'linux',
    exists: (p) => p === '/opt/custom/bin/tailscale',
  })
  assert.equal(candidates, '/opt/custom/bin/tailscale')
})

test('Linux does not match a non-existent PATH entry', () => {
  const candidates = resolveTailscaleBinary({
    home: '/home/bob',
    pathDirs: ['/opt/missing/bin'],
    platform: 'linux',
    exists: () => false,
  })
  assert.equal(candidates, '')
})

test('Linux returns empty when nothing matches', () => {
  const candidates = resolveTailscaleBinary({
    home: '/home/bob',
    pathDirs: ['/usr/bin'],
    platform: 'linux',
    exists: () => false,
  })
  assert.equal(candidates, '')
})

test('macOS does not look at /usr/bin/tailscale', () => {
  // Guard against macOS picking up an unrelated binary the user has
  // installed for other tooling. macOS candidates are the .app bundle
  // and ~/.local/bin/tailscale only.
  const candidates = resolveTailscaleBinary({
    home: '/Users/alice',
    pathDirs: ['/usr/bin', '/usr/local/bin'],
    platform: 'darwin',
    exists: (p) => p === '/usr/bin/tailscale' || p === '/usr/local/bin/tailscale',
  })
  assert.equal(candidates, '')
})

test('PATH walk ignores empty entries', () => {
  const candidates = resolveTailscaleBinary({
    home: '/home/bob',
    pathDirs: ['', '/usr/local/bin', '   '],
    platform: 'linux',
    exists: (p) => p === '/usr/local/bin/tailscale',
  })
  assert.equal(candidates, '/usr/local/bin/tailscale')
})

test('tailscaleBinary() returns a string and never throws', () => {
  // On this host (macOS, no Tailscale installed at the candidates)
  // the function must return '' rather than throw.
  const result = tailscaleBinary()
  assert.ok(typeof result === 'string')
})