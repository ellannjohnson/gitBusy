#!/bin/zsh
# Exercise the launcher scripts' start_server PID-file guard against
# real fake PID files. The helper that the launchers source is the
# same one tested in test_pid_lifecycle.zsh.
set -u

REPO_ROOT="${0:A:h:h:h}"
HELPERS="$REPO_ROOT/scripts/gitbusy-launcher-helpers.zsh"
source "$HELPERS"

fail() { print -u2 "FAIL: $1"; exit 1 }
pass() { print "  ok: $1" }

WORK="$(mktemp -d /tmp/gitbusy-launcher-int.XXXXXX)"
SCRATCH_DIR="$(mktemp -d /tmp/gitbusy-launcher-int-scratch.XXXXXX)"
trap "rm -rf '$WORK' '$SCRATCH_DIR'; pkill -f 'gitBusy-int-unowned' 2>/dev/null || true" EXIT

# Helper: build a Node child whose argv contains (or does not contain)
# the marker. The launcher's PID-file guard checks the marker to
# decide whether to overwrite.
spawn_holder() {
  local marker="$1"
  local script="$SCRATCH_DIR/holder.mjs"
  cat > "$script" <<'JS'
const t = setInterval(() => {}, 60000);
process.on('SIGTERM', () => { clearInterval(t); process.exit(0); });
process.on('SIGINT', () => { clearInterval(t); process.exit(0); });
JS
  node "$script" "$marker" >/dev/null 2>&1 &
  local pid=$!
  echo "$pid"
}

# (a) Live unowned PID: launcher's helper must refuse to mark it alive-and-ours.
LIVE_PID="$(spawn_holder gitBusy-int-unowned)"
sleep 0.5
echo "$LIVE_PID" > "$WORK/server.pid"
if pid_file_is_alive_and_ours "$WORK/server.pid" "gitBusy-bundle-marker"; then
  kill "$LIVE_PID" 2>/dev/null || true
  fail "helper accepted an unowned PID"
fi
pass "helper refuses live unowned PID"
kill "$LIVE_PID" 2>/dev/null || true
wait "$LIVE_PID" 2>/dev/null || true

# (b) Stale PID: 999999 doesn't exist. Helper must refuse (which is
# the trigger for the launcher's start_server path to unlink the file).
echo 999999 > "$WORK/stale.pid"
if pid_file_is_alive_and_ours "$WORK/stale.pid" "gitBusy-bundle-marker"; then
  fail "helper accepted a stale PID"
fi
pass "helper refuses stale PID"

# (c) Owner-marker present: helper must accept.
OWNED_PID="$(spawn_holder gitBusy-bundle-marker)"
sleep 0.5
echo "$OWNED_PID" > "$WORK/owned.pid"
if ! pid_file_is_alive_and_ours "$WORK/owned.pid" "gitBusy-bundle-marker"; then
  kill "$OWNED_PID" 2>/dev/null || true
  fail "helper refused an owned PID"
fi
pass "helper accepts live owned PID"
kill "$OWNED_PID" 2>/dev/null || true
wait "$OWNED_PID" 2>/dev/null || true

print "all launcher integration assertions passed"
