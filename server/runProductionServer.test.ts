import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatLogLine, logLevels } from './logging.ts'

// PROD-BL-001 — log lines must carry an ISO timestamp and a level prefix
// so operators can grep without parsing raw output.

test('formatLogLine writes ISO timestamp + level + message + trailing newline', () => {
  const fixed = new Date('2026-09-15T18:00:00.000Z')
  const line = formatLogLine(fixed, 'info', 'gitBusy production server listening on http://127.0.0.1:5174')
  assert.equal(line, '2026-09-15T18:00:00.000Z info gitBusy production server listening on http://127.0.0.1:5174\n')
})

test('logLevels enumerates exactly info|warn|error', () => {
  assert.deepEqual([...logLevels].sort(), ['error', 'info', 'warn'])
})

test('formatLogLine preserves message newlines and trailing whitespace unchanged', () => {
  const fixed = new Date('2026-09-15T18:00:00.000Z')
  const line = formatLogLine(fixed, 'warn', '  surrounded  by  spaces  ')
  assert.equal(line, '2026-09-15T18:00:00.000Z warn   surrounded  by  spaces  \n')
})

test('formatLogLine emits a parseable UTC timestamp at the start of the line', () => {
  const line = formatLogLine(new Date('2026-01-02T03:04:05.678Z'), 'error', 'boom')
  // The first whitespace-separated field is the ISO timestamp; assert
  // it round-trips through Date.parse (Date.parse returns NaN on bad input).
  const isoField = line.split(' ')[0]
  assert.equal(Number.isNaN(Date.parse(isoField)), false, 'ISO field must be parseable')
  assert.equal(new Date(isoField).toISOString(), '2026-01-02T03:04:05.678Z')
})
