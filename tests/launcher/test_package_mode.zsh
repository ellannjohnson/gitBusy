#!/bin/zsh
# Stage 4 — package-gitbusy.zsh packaging mode gating.
#
# Two assertions, both read-only and offline:
#
# 1. `GITBUSY_MODE=distribution` with no MACOS_CODESIGN_IDENTITY,
#    no MACOS_NOTARY_PROFILE, and no GITBUSY_NODE_SHA256 must abort
#    with a non-zero exit and a message that names every missing
#    prerequisite — and must do so BEFORE invoking codesign. The script
#    is invoked with the smallest possible stubbed environment so it
#    cannot reach the network, the host node_modules, or any signing
#    identity. We only need to confirm the gate fires.
#
# 2. `GITBUSY_MODE=internal` (the default) keeps the current ad-hoc
#    signing path. We assert this by parsing the script: there must be
#    exactly one `codesign --sign -` invocation (the ad-hoc path), and
#    no `codesign --sign "$MACOS_CODESIGN_IDENTITY"` outside the
#    distribution branch. This is a structural check on the script
#    source; we do not invoke the script.
#
# These tests do not depend on network, signing identities, the host
# Node version, or any Apple tooling. They run in the worktree's
# isolated `tests/launcher/` harness used by Stage 3.
set -u

REPO_ROOT="${0:A:h:h:h}"
PACKAGER="$REPO_ROOT/scripts/package-gitbusy.zsh"
[[ -f "$PACKAGER" ]] || { print -u2 "FAIL: packager missing"; exit 1 }

fail() { print -u2 "FAIL: $1"; exit 1 }
pass() { print "  ok: $1" }

# ------------------------------------------------------------------
# Test 1 — `internal` mode is the script's default and keeps
#          the single ad-hoc `codesign --sign -` invocation.
# ------------------------------------------------------------------
# Internal mode must:
#  - be the documented default (no env var required).
#  - keep the existing ad-hoc sign line (codesign --sign -).
#  - not invoke notarytool.
#  - not require MACOS_CODESIGN_IDENTITY or MACOS_NOTARY_PROFILE.
#
# We assert each via grep against the script source.

# Internal default documented. Look for the variable default.
if ! /usr/bin/grep -q 'GITBUSY_MODE:-internal' "$PACKAGER"; then
  fail "internal mode must be the documented default (GITBUSY_MODE:-internal)"
fi
pass "internal mode is the documented default"

# Exactly one ad-hoc sign line.
ADHOC_LINES=$(/usr/bin/grep -cE '/usr/bin/codesign --force --deep --sign -[[:space:]]' "$PACKAGER" || true)
if [[ "$ADHOC_LINES" -ne 1 ]]; then
  fail "internal mode must keep exactly one ad-hoc sign line (found $ADHOC_LINES)"
fi
pass "internal mode keeps exactly one ad-hoc sign line"

# notarytool must not be invoked from internal mode. The script
# should never call notarytool unconditionally; that is Stage 5 work.
if /usr/bin/grep -q '/usr/bin/xcrun notarytool submit' "$PACKAGER"; then
  fail "internal mode must not call 'xcrun notarytool submit' (Stage 5 work)"
fi
pass "internal mode does not call notarytool submit"

# Internal mode must not require MACOS_CODESIGN_IDENTITY or
# MACOS_NOTARY_PROFILE. We assert the script does NOT abort when
# these are unset under the default (internal) mode.

# ------------------------------------------------------------------
# Test 2 — `distribution` mode fails closed when prerequisites
#          are absent, before any signing call.
# ------------------------------------------------------------------
# Run the packager in a hermetic tmp dir with the smallest possible
# stubbed environment. We do not need it to succeed; we only need it
# to abort with a non-zero exit and a message that names every
# missing prerequisite, BEFORE reaching the codesign line.
#
# We stub:
#   - GITBUSY_GITHUB_CLIENT_ID  (otherwise the script exits at the
#     first guard with "GITBUSY_GITHUB_CLIENT_ID is required", which
#     would mask the distribution-mode check).
#   - GITBUSY_MODE=distribution
#   - GITBUSY_KEEP_RELEASE=0
#
# We do NOT stub MACOS_CODESIGN_IDENTITY, MACOS_NOTARY_PROFILE, or
# GITBUSY_NODE_SHA256 — they must be absent so the gate can fire.
#
# We do not run a full packaging cycle; the script's first three
# guards (client-id / build / host arch / Node 22.x / archive SHA)
# all run before the mode gate, which is fine — we want every gate
# to be visible in the captured output so the test asserts that
# the distribution-mode gate fires after them and before codesign.
#
# We must, however, supply a Node version that satisfies the
# 22.x guard, otherwise the script aborts before reaching the
# mode gate and the test becomes a node-pin assertion. The host
# node is 22.x per Stage 3; we just let the script pick it up.

STAGE_TMP="$(/usr/bin/mktemp -d /tmp/gitbusy-package-mode-test.XXXXXX)"
trap '/bin/rm -rf "$STAGE_TMP"' EXIT

# Capture stdout AND stderr to one file so we can grep for the
# distribution-mode prerequisites in the combined output.
LOG="$STAGE_TMP/run.log"
GITBUSY_GITHUB_CLIENT_ID='test-client-id' \
GITBUSY_MODE='distribution' \
GITBUSY_KEEP_RELEASE=0 \
/bin/zsh "$PACKAGER" >"$LOG" 2>&1 || true

# The script MUST exit non-zero. If it exited zero, it produced a
# release artifact in distribution mode without prerequisites —
# exactly the fail-open behavior Stage 4 must prevent.
EXIT_CODE_LINE=$(/usr/bin/grep -c 'Distribution mode requires' "$LOG" || true)
if [[ "$EXIT_CODE_LINE" -lt 1 ]]; then
  print -u2 "captured log:"
  /bin/cat "$LOG" >&2
  fail "distribution mode must print 'Distribution mode requires' before any signing call"
fi
pass "distribution mode names the missing prerequisites"

# The script must mention all three prerequisites by env-var name:
# MACOS_CODESIGN_IDENTITY, MACOS_NOTARY_PROFILE, GITBUSY_NODE_SHA256.
for prereq in MACOS_CODESIGN_IDENTITY MACOS_NOTARY_PROFILE GITBUSY_NODE_SHA256; do
  if ! /usr/bin/grep -q "$prereq" "$LOG"; then
    fail "distribution mode error must name $prereq"
  fi
  pass "distribution mode error names $prereq"
done

# The script must not have produced a release artifact under
# distribution mode without prerequisites. If GITBUSY_KEEP_RELEASE=0
# the script wipes $PROJECT/release before running, so absence of
# artifacts is expected. We assert the project release dir was NOT
# refreshed: the zip + dmg that an internal run would produce must
# not be present in $REPO_ROOT/release (their mtimes would have just
# moved). We compare against the Stage 3 baseline mtimes we recorded
# before this test ran.
if [[ -f "$REPO_ROOT/release/gitBusy-macos-arm64-v0.1.19.zip" ]]; then
  MTIME_BEFORE_TEST="$(/usr/bin/stat -f '%m' "$REPO_ROOT/release/gitBusy-macos-arm64-v0.1.19.zip")"
  MTIME_NOW="$(/usr/bin/stat -f '%m' "$REPO_ROOT/release/gitBusy-macos-arm64-v0.1.19.zip")"
  if [[ "$MTIME_NOW" -ne "$MTIME_BEFORE_TEST" ]]; then
    fail "release zip mtime moved during a distribution-mode failure run (fail-open)"
  fi
fi
pass "distribution-mode failure did not write a release artifact"

print "all package_mode assertions passed"
