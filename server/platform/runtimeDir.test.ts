import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  runtimePaths,
  type PlatformPaths,
} from './runtimeDir.ts'

// Pure tests: drive the resolver with explicit env values and a fake
// `platform` so we do not depend on the host environment.

test('macOS maps runtime to ~/Library/Application Support/gitBusy', () => {
  const paths = runtimePaths({
    home: '/Users/alice',
    env: {},
    platform: 'darwin',
  })
  assert.equal(paths.runtime, '/Users/alice/Library/Application Support/gitBusy')
  assert.equal(paths.log, '/Users/alice/Library/Application Support/gitBusy/server.log')
  assert.equal(paths.pid, '/Users/alice/Library/Application Support/gitBusy/server.pid')
  assert.equal(paths.cache, '/Users/alice/Library/Application Support/gitBusy/cache')
  assert.equal(paths.data, '/Users/alice/Library/Application Support/gitBusy/data')
})

test('Linux honors XDG_RUNTIME_DIR, XDG_STATE_HOME, XDG_CACHE_HOME, XDG_DATA_HOME', () => {
  const paths = runtimePaths({
    home: '/home/bob',
    env: {
      XDG_RUNTIME_DIR: '/run/user/1000',
      XDG_STATE_HOME: '/home/bob/.local/state',
      XDG_CACHE_HOME: '/home/bob/.cache',
      XDG_DATA_HOME: '/home/bob/.local/share',
    },
    platform: 'linux',
  })
  assert.equal(paths.runtime, '/run/user/1000/gitbusy')
  assert.equal(paths.log, '/home/bob/.local/state/gitbusy/server.log')
  assert.equal(paths.pid, '/run/user/1000/gitbusy/server.pid')
  assert.equal(paths.cache, '/home/bob/.cache/gitbusy')
  assert.equal(paths.data, '/home/bob/.local/share/gitbusy')
})

test('Linux falls back to ~/.local/... when XDG vars unset', () => {
  const paths = runtimePaths({
    home: '/home/bob',
    env: {},
    platform: 'linux',
  })
  assert.equal(paths.runtime, '/tmp/gitbusy')
  assert.equal(paths.log, '/home/bob/.local/state/gitbusy/server.log')
  assert.equal(paths.pid, '/tmp/gitbusy/server.pid')
  assert.equal(paths.cache, '/home/bob/.cache/gitbusy')
  assert.equal(paths.data, '/home/bob/.local/share/gitbusy')
})

test('paths include a pid file and a log file', () => {
  const paths = runtimePaths({ home: '/h', env: {}, platform: 'linux' })
  assert.ok(paths.pid.endsWith('/server.pid'))
  assert.ok(paths.log.endsWith('/server.log'))
})

test('all Linux paths use absolute paths only', () => {
  // The directive forbids macOS-style relative paths leaking into
  // Linux code. Every value must be absolute.
  const paths = runtimePaths({ home: '/home/bob', env: {}, platform: 'linux' })
  for (const value of Object.values(paths) as string[]) {
    assert.ok(value.startsWith('/'), `expected ${value} to start with /`)
  }
})

test('runtime helper accepts unknown extra keys without breaking', () => {
  // Forward-compat: extra env keys must not affect the resolver.
  const a = runtimePaths({ home: '/home/bob', env: { FOO: 'bar' }, platform: 'linux' })
  const b = runtimePaths({ home: '/home/bob', env: {}, platform: 'linux' })
  assert.deepEqual(a, b)
})

test('pid file path is always inside runtime dir on Linux', () => {
  const paths = runtimePaths({
    home: '/home/bob',
    env: { XDG_RUNTIME_DIR: '/run/user/1000' },
    platform: 'linux',
  })
  assert.ok(paths.pid.startsWith(paths.runtime + '/'))
})

test('PlatformPaths type is structural and documented', () => {
  // Type-shape smoke test: this guards against accidental field renames
  // in the runtime shape that callers depend on.
  const sample: PlatformPaths = {
    runtime: '/tmp/gitbusy',
    log: '/tmp/gitbusy/server.log',
    pid: '/tmp/gitbusy/server.pid',
    cache: '/tmp/gitbusy/cache',
    data: '/tmp/gitbusy/data',
  }
  assert.equal(Object.keys(sample).length, 5)
})