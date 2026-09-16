// Plain-text README extraction — APPSEC-003.
// The extractor is a pure function that turns the base64-decoded
// README content from the GitHub Contents API into an array of plain
// text lines the SPA renders as <h3> / <p> nodes via React default
// escape (see src/components/RepoDetail.tsx). The transformation
// strips angle-bracketed HTML, decodes the four common named entities,
// collapses whitespace, and drops blank lines.
//
// The contract is "plain text output" — no HTML structure remains.
// React's default text-node escape is the second layer of defense;
// future regressions that introduce `dangerouslySetInnerHTML` will be
// caught by the `scripts/lint-no-raw-html.sh` guard.

export function extractReadmeLines(raw: string): string[] {
  if (typeof raw !== 'string' || !raw) return []
  return raw
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/<[^>]*>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
}
