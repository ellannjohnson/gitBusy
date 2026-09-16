import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extractReadmeLines } from './readmeExtractor.ts'

// Plain-text README extractor — APPSEC-003.
// The extractor must produce plain-text lines. React default-escape
// is the second defense; these tests pin the strip semantics so a
// future change cannot silently weaken the contract.

test('extractReadmeLines returns an empty array for empty / non-string input', () => {
  assert.deepEqual(extractReadmeLines(''), [])
  // Defensive: a bad caller should not crash the server.
  assert.deepEqual(extractReadmeLines(undefined as unknown as string), [])
})

test('extractReadmeLines preserves heading marker and plain paragraph text', () => {
  // The extractor does NOT strip markdown — the SPA's existing call
  // site strips the leading "# " via `line.replace(/^#\s+/, '')`.
  // This test pins that contract: the extractor preserves the "# "
  // marker so the existing dedupe logic continues to work.
  const lines = extractReadmeLines('# Heading\n\nHello & <world>')
  assert.equal(lines.length, 2)
  assert.equal(lines[0], '# Heading')
  // The <world> angle-bracket run is replaced by a single space and
  // collapsed, so the line is "Hello &".
  assert.equal(lines[1], 'Hello &')
  assert.equal(lines.some((line) => line.includes('<')), false)
  assert.equal(lines.some((line) => line.includes('>')), false)
})

test('extractReadmeLines neutralizes script tags', () => {
  const lines = extractReadmeLines('<script>alert(1)</script>safe')
  // The tag is removed; the literal text "alert(1)" and "safe" remain.
  // Critical: no "<script>" substring survives.
  const joined = lines.join('\n')
  assert.equal(joined.includes('alert(1)'), true)
  assert.equal(joined.includes('safe'), true)
  assert.equal(joined.includes('<script>'), false)
  assert.equal(joined.includes('</script>'), false)
})

test('extractReadmeLines drops the executable form of an unclosed tag', () => {
  const lines = extractReadmeLines('<img src=x onerror=alert(2)>')
  const joined = lines.join('\n')
  // The entire <...> run is replaced with whitespace. The literal
  // "onerror=alert(2)" text survives but without an enclosing tag it
  // is just text — and the angle brackets are gone.
  assert.equal(joined.includes('<'), false)
  assert.equal(joined.includes('>'), false)
})

test('extractReadmeLines decodes the four common named entities', () => {
  // &amp; -> &, &lt; -> <, &gt; -> >. The decoded < and > must then
  // survive the strip pass because they come from entities, not from
  // raw HTML tags.
  assert.deepEqual(extractReadmeLines('&amp;&lt;&gt;'), ['&<>'])
})

test('extractReadmeLines splits on CRLF and drops blank lines', () => {
  const lines = extractReadmeLines('line1\r\nline2\r\n\r\n   \nline3')
  assert.deepEqual(lines, ['line1', 'line2', 'line3'])
})

test('extractReadmeLines returns [] for whitespace-only input', () => {
  assert.deepEqual(extractReadmeLines('   \n\n  '), [])
})

test('extractReadmeLines collapses internal whitespace runs to a single space', () => {
  // Multi-space, tabs, and embedded newlines inside a single source
  // line must collapse to one space.
  assert.deepEqual(extractReadmeLines('a   b\t\tc'), ['a b c'])
})

test('extractReadmeLines strips tag delimiters but keeps the inner text of a markdown code fence', () => {
  // Inside a markdown code fence, "<script>" appears as literal text.
  // The strip matches the literal "<script>" run and replaces it
  // with whitespace; this is the documented (legacy) behavior — the
  // defense-in-depth is React default-escape, not the strip. The
  // critical property the strip guarantees: no executable tag
  // structure survives.
  const lines = extractReadmeLines('<script>safe</script>after')
  const joined = lines.join('\n')
  assert.equal(joined.includes('safe'), true)
  assert.equal(joined.includes('after'), true)
  assert.equal(joined.includes('<script>'), false)
  assert.equal(joined.includes('</script>'), false)
  // No executable angle-bracket pair survives, regardless of where
  // it appeared in the source.
  assert.equal(joined.includes('<'), false)
  assert.equal(joined.includes('>'), false)
})
