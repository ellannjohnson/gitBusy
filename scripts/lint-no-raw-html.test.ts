import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

// Guard script: scripts/lint-no-raw-html.sh
// The guard fails CI if any raw HTML sink is introduced in src/.
// Tests drive the script against a temporary src/ fixture and assert
// the exit code in both pass and fail scenarios.

const SCRIPT = join(import.meta.dirname, '..', 'scripts', 'lint-no-raw-html.sh')

function runGuard(cwd: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('zsh', [SCRIPT], { cwd, encoding: 'utf8' })
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function makeFixture(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'gitbusy-lint-html-'))
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'src', 'Demo.tsx'), contents)
  return dir
}

test('lint-no-raw-html.sh exits 0 against a sink-free src/', () => {
  const dir = makeFixture('export const X = () => <div>Hello</div>\n')
  try {
    const { status } = runGuard(dir)
    assert.equal(status, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('lint-no-raw-html.sh exits 1 when dangerouslySetInnerHTML is present', () => {
  const dir = makeFixture('export const X = () => <div dangerouslySetInnerHTML={{ __html: "x" }} />\n')
  try {
    const { status, stderr } = runGuard(dir)
    assert.equal(status, 1)
    assert.match(stderr, /Raw HTML sink detected/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('lint-no-raw-html.sh exits 1 when innerHTML= is present', () => {
  const dir = makeFixture('element.innerHTML = "x"\n')
  try {
    const { status } = runGuard(dir)
    assert.equal(status, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('lint-no-raw-html.sh exits 1 when document.write is present', () => {
  const dir = makeFixture('document.write("<script>")\n')
  try {
    const { status } = runGuard(dir)
    assert.equal(status, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('lint-no-raw-html.sh exits 0 when src/ is absent (no false positive)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gitbusy-lint-html-'))
  try {
    const { status } = runGuard(dir)
    assert.equal(status, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
