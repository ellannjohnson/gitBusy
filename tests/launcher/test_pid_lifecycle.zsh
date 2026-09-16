#!/bin/zsh
# PROD-BL-002 — launcher must refuse to overwrite a live PID file
# owned by another process, and must clear a stale PID file when the
# referenced process is gone. Sources the real helper from
# scripts/gitbusy-launcher-helpers.zsh so the test cannot drift from
# the implementation.
set -u

REPO_ROOT="${0:A:h:h:h}"
HELPERS="$REPO_ROOT/scripts/gitbusy-launcher-helpers.zsh"
[[ -f "$HELPERS" ]] || { print -u2 "FAIL: helpers missing at $HELPERS"; exit 1 }
source "$HELPERS"

fail() { print -u2 "FAIL: $1"; exit 1 }
pass() { print "  ok: $1" }

WORK="$(mktemp -d /tmp/gitbusy-pid-test.XXXXXX)"
trap "rm -rf '$WORK'; pkill -f 'gitBusy-test-marker-XYZ' 2>/dev/null || true" EXIT

# A Node child that holds a marker in its argv (visible to /bin/ps).
MARKER_HOLDER="$(mktemp /tmp/gitbusy-marker-holder.XXXXXX.mjs)"
cat > "$MARKER_HOLDER" <<'JS'
const marker = process.argv[2] ?? 'NOMARKER';
process.stdout.write(`alive marker=${marker}\n`);
const t = setInterval(() => {}, 60000);
process.on('SIGTERM', () => { clearInterval(t); process.exit(0); });
process.on('SIGINT', () => { clearInterval(t); process.exit(0); });
JS

OWNER_MARKER="gitBusy-test-marker-XYZ"

# (a) Stale PID: process gone → helper must return non-zero.
STALE="$WORK/stale.pid"
echo 999999 > "$STALE"
if pid_file_is_alive_and_ours "$STALE" "$OWNER_MARKER" ; then
  fail "stale PID (999999) should NOT be alive-and-ours"
fi
pass "stale PID is not alive-and-ours"

# (b) Live unowned PID: spawn a long sleep that does NOT contain the marker.
# We spawn a Node process whose argv does NOT include the marker so the
# command line visible to ps lacks the owner marker.
node "$MARKER_HOLDER" unowned-marker >/dev/null 2>&1 &
LIVE_PID=$!
sleep 0.5
LIVE_FILE="$WORK/live-unowned.pid"
echo "$LIVE_PID" > "$LIVE_FILE"
if pid_file_is_alive_and_ours "$LIVE_FILE" "$OWNER_MARKER" ; then
  kill "$LIVE_PID" 2>/dev/null || true
  fail "live unowned PID ($LIVE_PID) must NOT be alive-and-ours"
fi
pass "live unowned PID is refused by pid_file_is_alive_and_ours"
kill "$LIVE_PID" 2>/dev/null || true
wait "$LIVE_PID" 2>/dev/null || true

# (c) Live owned PID: spawn a Node process whose argv includes the marker.
node "$MARKER_HOLDER" "$OWNER_MARKER" >/dev/null 2>&1 &
OWNED_PID=$!
sleep 0.5
OWNED_FILE="$WORK/live-owned.pid"
echo "$OWNED_PID" > "$OWNED_FILE"
if ! pid_file_is_alive_and_ours "$OWNED_FILE" "$OWNER_MARKER" ; then
  kill "$OWNED_PID" 2>/dev/null || true
  fail "live owned PID ($OWNED_PID) MUST be alive-and-ours"
fi
pass "live owned PID is alive-and-ours"
kill "$OWNED_PID" 2>/dev/null || true
wait "$OWNED_PID" 2>/dev/null || true

rm -f "$MARKER_HOLDER"
print "all pid_lifecycle assertions passed"
