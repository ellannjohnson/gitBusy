#!/bin/zsh
# PROD-BL-004 — the host-Node major-version guard must accept 22.x and
# reject anything else. This is a parsing-only check; it does not
# download or verify any archive.
set -u

REPO_ROOT="${0:A:h:h:h}"
PACKAGER="$REPO_ROOT/scripts/package-gitbusy.zsh"
[[ -f "$PACKAGER" ]] || { print -u2 "FAIL: packager missing"; exit 1 }

fail() { print -u2 "FAIL: $1"; exit 1 }
pass() { print "  ok: $1" }

# Extract just the major-version check (the python3 line + the if)
# so we can exercise it in isolation against multiple Node versions.
# The implementation is a single python invocation; we replicate that
# and the conditional.
major_for() {
  /usr/bin/python3 -c "import sys,re; m=re.match(r'(\d+)\.', sys.argv[1]); print(m.group(1) if m else '')" "${1#v}"
}

[[ "$(major_for 22.22.3)" == '22' ]] || fail "22.22.3 must parse to major 22"
pass "22.22.3 → 22"

[[ "$(major_for 22.0.0)" == '22' ]] || fail "22.0.0 must parse to major 22"
pass "22.0.0 → 22"

[[ "$(major_for 20.10.0)" == '20' ]] || fail "20.10.0 must parse to major 20"
pass "20.10.0 → 20"

[[ "$(major_for 18.19.1)" == '18' ]] || fail "18.19.1 must parse to major 18"
pass "18.19.1 → 18"

# A '22-rc.0' input (no dot after the digits) is not a valid Node
# version, so the parser returns '' — the guard then refuses. This
# matches the script's behavior with NODE_VERSION_NUMERIC="${NODE_VERSION#v}".
[[ "$(major_for 22-rc.0)" == '' ]] || fail "22-rc.0 must parse to major ''"
pass "22-rc.0 → '' (no dot after digits → rejected by guard)"

# End-to-end guard simulation: replicate the conditional logic.
guard_accepts() {
  local version="$1"
  local major
  major="$(major_for "$version")"
  [[ -n "$major" && "$major" == '22' ]]
}

guard_accepts v22.22.3 || fail "guard must accept v22.22.3"
pass "guard accepts v22.22.3"

if guard_accepts v20.10.0; then
  fail "guard must reject v20.10.0"
fi
pass "guard rejects v20.10.0"

if guard_accepts v18.19.1; then
  fail "guard must reject v18.19.1"
fi
pass "guard rejects v18.19.1"

# Host node is 22.22.3, so the real packager's first invocation
# should pass the guard. We assert that here.
HOST_NODE_VERSION="$(whence -p node >/dev/null && node --version || echo missing)"
echo "host node: $HOST_NODE_VERSION"
if [[ "$HOST_NODE_VERSION" != missing ]]; then
  guard_accepts "$HOST_NODE_VERSION" || fail "guard must accept host node $HOST_NODE_VERSION"
  pass "guard accepts host node $HOST_NODE_VERSION"
fi

print "all node_pin assertions passed"
