#!/bin/zsh
# Public-release packaging hygiene checks.
#
# These structural checks prevent a public artifact receipt from omitting the
# source archive checksum or leaking the local builder path/hostname.
set -u

REPO_ROOT="${0:A:h:h:h}"
PACKAGER="$REPO_ROOT/scripts/package-gitbusy.zsh"
[[ -f "$PACKAGER" ]] || { print -u2 "FAIL: packager missing"; exit 1 }

fail() { print -u2 "FAIL: $1"; exit 1 }
pass() { print "  ok: $1" }

if ! /usr/bin/grep -q '/usr/bin/shasum -a 256 "$OUT/${SOURCE_NAME}.zip"' "$PACKAGER"; then
  fail "SHA256SUMS.txt must include the standalone source ZIP"
fi
pass "checksum generation includes the source ZIP"

if /usr/bin/grep -q 'staging_dir=${STAGE}' "$PACKAGER"; then
  fail "public MANIFEST.txt must not expose the temporary staging path"
fi
pass "manifest does not expose the temporary staging path"

if /usr/bin/grep -q 'build_host=$(' "$PACKAGER"; then
  fail "public MANIFEST.txt must not expose the build host"
fi
pass "manifest does not expose the build host"

if ! /usr/bin/grep -q 'notary_run=not-run-ad-hoc-preview' "$PACKAGER"; then
  fail "ad-hoc public preview must identify notarization as not run"
fi
pass "manifest identifies the ad-hoc preview as not notarized"

print "all public_manifest assertions passed"
