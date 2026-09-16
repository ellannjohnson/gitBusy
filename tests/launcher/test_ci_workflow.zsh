#!/bin/zsh
# Stage 4 — CI workflow presence and shape assertions.
#
# The CI workflow cannot be activated from this lane (Actions
# must be enabled on the repo and four repo secrets populated).
# What we CAN do is verify the workflow file is committed, parses
# as valid YAML, declares both the PR-only job and the tag-only
# job, and references the same fail-closed prerequisites the
# package script enforces.
set -u

REPO_ROOT="${0:A:h:h:h}"
WF="$REPO_ROOT/.github/workflows/release-mac.yml"
[[ -f "$WF" ]] || { print -u2 "FAIL: workflow file missing at $WF"; exit 1 }

fail() { print -u2 "FAIL: $1"; exit 1 }
pass() { print "  ok: $1" }

# Structural assertions on the file's source — we do not execute
# it; Actions is an external gate.

# 1. Both pr-checks and tag-release jobs must be declared.
/usr/bin/grep -q '^  pr-checks:' "$WF" || fail "pr-checks job missing"
pass "pr-checks job declared"
/usr/bin/grep -q '^  tag-release:' "$WF" || fail "tag-release job missing"
pass "tag-release job declared"

# 2. PR job must run on every PR and tag job must gate on tag pushes.
#    PRs must NEVER reach the tag-release job.
if ! /usr/bin/grep -q 'github.event_name == .push. && startsWith(github.ref, .refs/tags/v.)' "$WF"; then
  fail "tag-release must gate on tag pushes only"
fi
pass "tag-release is gated on tag pushes"
if /usr/bin/grep -q 'github.event_name == .pull_request.' "$WF" && /usr/bin/grep -A2 'github.event_name == .pull_request.' "$WF" | /usr/bin/grep -q 'tag-release'; then
  # Tag-release must not appear inside any PR-only conditional.
  fail "tag-release must not be reachable from pull_request events"
fi
pass "tag-release is not reachable from PR events"

# 3. macOS runner is pinned (not 'latest').
if /usr/bin/grep -q 'runs-on:.*latest' "$WF"; then
  fail "macOS runner must be pinned (no 'latest')"
fi
/usr/bin/grep -q 'runs-on: macos-15' "$WF" || fail "macOS runner must be a pinned version (macos-15)"
pass "macOS runner pinned"

# 4. Node version pinned via setup-node (not just 'latest').
/usr/bin/grep -q 'node-version: .22.12.0.' "$WF" || fail "Node must be pinned via setup-node"
pass "Node version pinned (22.12.0)"

# 5. Strict install is used (engines.node enforced).
/usr/bin/grep -q '\-\-engine-strict' "$WF" || fail "npm ci must use --engine-strict"
pass "npm ci uses --engine-strict"

# 6. Quality gates: test, lint, build, audit, lockfile, gitleaks.
for step in 'npm test' 'npm run lint' 'npm run build' 'npm audit' 'npm ls --package-lock-only' 'gitleaks/gitleaks-action'; do
  /usr/bin/grep -q "$step" "$WF" || fail "quality gate missing: $step"
done
pass "all quality gates present"

# 7. Distribution packaging references the fail-closed prereqs.
for prereq in MACOS_CODESIGN_IDENTITY MACOS_NOTARY_PROFILE GITBUSY_NODE_SHA256; do
  /usr/bin/grep -q "$prereq" "$WF" || fail "distribution packaging must reference $prereq"
done
pass "distribution packaging references all three prereqs"

# 8. Distribution mode is set on the tag job.
/usr/bin/grep -q 'GITBUSY_MODE: distribution' "$WF" || fail "tag-release must set GITBUSY_MODE=distribution"
pass "tag-release uses GITBUSY_MODE=distribution"

# 9. Verification step checks Info.plist, architecture, production
#    entrypoint, absence of Vite/HMR markers, SHA256SUMS.txt,
#    MANIFEST.txt.
for marker in CFBundleIdentifier CFBundleShortVersionString CFBundleVersion 'runProductionServer.ts' '@vite/client' 'SHA256SUMS.txt' 'MANIFEST.txt' 'codesign_authority'; do
  /usr/bin/grep -q "$marker" "$WF" || fail "verification step must check $marker"
done
pass "verification step covers Info.plist, entrypoint, HMR, sums, manifest, codesign authority"

# 10. Upload-artifact step exists and uploads the sums + manifest.
/usr/bin/grep -q 'actions/upload-artifact' "$WF" || fail "upload-artifact step missing"
pass "upload-artifact step present"

# 11. No public release creation in this workflow (no `gh release create`,
#     no `softprops/action-gh-release`). Those are a separate gate.
if /usr/bin/grep -qE 'gh release create|softprops/action-gh-release' "$WF"; then
  fail "workflow must not create a public release (separate EJ/Amae gate)"
fi
pass "no public release creation in workflow"

# 12. External-gate comment must be present so the operator knows
#     which secrets to populate before activation.
for secret in MACOS_CODESIGN_IDENTITY MACOS_NOTARY_PROFILE GITBUSY_NODE_SHA256; do
  /usr/bin/grep -q "$secret" "$WF" || fail "external-gate note missing $secret"
done
pass "external-gate note present"

print "all ci_workflow assertions passed"
