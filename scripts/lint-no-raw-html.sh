#!/bin/zsh
# scripts/lint-no-raw-html.sh — fail if any raw HTML sink is introduced
# in src/. The plain-text README extractor (server/readmeExtractor.ts)
# relies on React's default-escape. Adding dangerouslySetInnerHTML or
# document.write to the SPA would turn README text into an XSS vector.
#
# Defense in depth: this guard runs in CI alongside oxlint so the
# build fails before a reviewer would see the PR. The matchers
# intentionally cover the exact sink set enumerated by APPSEC-003.

set -u

if [[ ! -d src ]]; then
  print -u2 "scripts/lint-no-raw-html.sh: src/ directory not found"
  exit 0
fi

if /usr/bin/grep -rnE 'dangerouslySetInnerHTML|innerHTML\s*=|document\.write\b|\beval\s*\(|new[[:space:]]+Function\s*\(' src ; then
  print -u2 "Raw HTML sink detected in src/. Use a vetted sanitizer (DOMPurify) or JSX text."
  exit 1
fi

exit 0
