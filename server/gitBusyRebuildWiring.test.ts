// Regression tests for the gitBusy Mac rebuild wiring.
// These guard:
//   1. identity/metadata coherence (R-MAC-003, R-MAC-009)
//   2. shared UI integration at the style entry point (R-MAC-002)
//   3. ui-root applied to the application root (R-MAC-002)
//   4. production-server-as-bundled-launcher wiring (R-MAC-008)
//
// Source-only assertions: no network, no DOM, no fs writes.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(here, '..')

function readProject(relPath: string): string {
  return readFileSync(resolve(projectRoot, relPath), 'utf8')
}

test('package.json is named gitBusy (no stale stargazer-local identity)', () => {
  const pkg = JSON.parse(readProject('package.json')) as { name: string }
  assert.equal(pkg.name, 'gitBusy', `package.json name must be "gitBusy" (got "${pkg.name}")`)
})

test('package.json depends on the shared @tki/amae-ui-system package', () => {
  const pkg = JSON.parse(readProject('package.json')) as {
    dependencies?: Record<string, string>
  }
  const dep = pkg.dependencies?.['@tki/amae-ui-system']
  assert.ok(dep, 'gitBusy must declare @tki/amae-ui-system as a dependency')
  // The shared package lives outside the project, so npm records an absolute
  // file: path or a relative file: dep. Either is acceptable so long as the
  // dep is declared.
  assert.match(dep, /^file:/, '@tki/amae-ui-system must be resolved via a local file: dependency')
})

test('appMeta.ts exports the verified version/build pair', () => {
  const text = readProject('src/appMeta.ts')
  assert.match(text, /APP_NAME\s*=\s*'gitBusy'/, 'APP_NAME must remain "gitBusy"')
  assert.match(text, /APP_VERSION\s*=\s*'0\.1\.19'/, 'APP_VERSION must stay at 0.1.19')
  assert.match(text, /APP_BUILD\s*=\s*'25'/, 'APP_BUILD must stay at 25 (per the verified baseline)')
})

test('macos/Info.plist version and build agree with appMeta.ts', () => {
  const plist = readProject('macos/Info.plist')
  // CFBundleShortVersionString tracks APP_VERSION (0.1.19).
  assert.match(plist, /<string>0\.1\.19<\/string>/, 'CFBundleShortVersionString must match APP_VERSION=0.1.19')
  // CFBundleVersion tracks APP_BUILD (25). The pre-rebuild source plist
  // drifted to 22 and had to be corrected in source so the packager would
  // not silently re-stamp a stale build.
  assert.match(plist, /<string>25<\/string>/, 'CFBundleVersion must match APP_BUILD=25')
})

test('src/index.css imports the shared @tki/amae-ui-system foundation', () => {
  const css = readProject('src/index.css')
  assert.match(
    css,
    /@import\s+["']@tki\/amae-ui-system["']/,
    'src/index.css must import @tki/amae-ui-system once at the style entry point',
  )
  // The local tokens.css is intentionally still imported so the project can
  // keep its product-specific composition via aliases, but it must come
  // after the shared import so the --ui-* variables are defined first.
  const sharedIndex = css.search(/@import\s+["']@tki\/amae-ui-system["']/)
  const localIndex = css.search(/@import\s+["']\.\.\/tokens\.css["']/)
  assert.ok(sharedIndex >= 0 && localIndex >= 0, 'both shared and local imports must be present')
  assert.ok(sharedIndex < localIndex, '@tki/amae-ui-system must be imported before the local tokens.css')
})

test('tokens.css aliases semantic tokens to the shared --ui-* variables (no copied hex values)', () => {
  const tokens = readProject('tokens.css')
  // Aliases: --color-canvas → var(--ui-color-canvas), etc.
  assert.match(tokens, /--color-canvas:\s*var\(--ui-color-canvas\)/, '--color-canvas must alias --ui-color-canvas')
  assert.match(tokens, /--color-ink:\s*var\(--ui-color-ink\)/, '--color-ink must alias --ui-color-ink')
  assert.match(tokens, /--color-accent:\s*var\(--ui-color-accent\)/, '--color-accent must alias --ui-color-accent')
  assert.match(tokens, /--color-success:\s*var\(--ui-color-success\)/, '--color-success must alias --ui-color-success')
  assert.match(tokens, /--color-danger:\s*var\(--ui-color-danger\)/, '--color-danger must alias --ui-color-danger')
  // Belt-and-suspenders: the old literal oklch values for the canonical
  // semantic tokens must be gone. If they ever come back as literals we have
  // reintroduced a second source of truth for shared semantics.
  assert.doesNotMatch(
    tokens,
    /^--color-canvas:\s*oklch\(/m,
    '--color-canvas must not be a literal oklch (use --ui-color-canvas)',
  )
  assert.doesNotMatch(
    tokens,
    /^--color-ink:\s*oklch\(/m,
    '--color-ink must not be a literal oklch (use --ui-color-ink)',
  )
})

test('App.tsx root element has the ui-root class (shared foundation contract)', () => {
  const app = readProject('src/App.tsx')
  assert.match(
    app,
    /<div\s+className="app-shell ui-root">/,
    'App root must compose app-shell + ui-root so the shared foundation applies',
  )
})

test('bundle launcher invokes the production server entry, not vite', () => {
  const toggle = readProject('scripts/gitbusy-bundle-toggle.zsh')
  // The launcher should reference the production server entrypoint.
  assert.match(
    toggle,
    /PRODUCTION_SERVER_ENTRY="\$\{PROJECT\}\/server\/runProductionServer\.ts"/,
    'bundle toggle must define PRODUCTION_SERVER_ENTRY=server/runProductionServer.ts',
  )
  // And it should exec that entry with --host/--port arguments, NOT invoke
  // the vite CLI.
  assert.match(
    toggle,
    /exec "\$NODE" "\$PRODUCTION_SERVER_ENTRY"/,
    'bundle toggle must exec the production server entry directly',
  )
  assert.doesNotMatch(
    toggle,
    /VITE_ENTRY|node_modules\/vite\/bin\/vite\.js/,
    'bundle toggle must not reference the vite CLI anymore',
  )
})