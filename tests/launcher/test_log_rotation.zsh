#!/bin/zsh
# PROD-BL-001 — rotate_log_if_needed rotates a log file once it
# crosses the byte threshold and keeps exactly two generations.
set -u

REPO_ROOT="${0:A:h:h:h}"
HELPERS="$REPO_ROOT/scripts/gitbusy-launcher-helpers.zsh"
[[ -f "$HELPERS" ]] || { print -u2 "FAIL: helpers missing at $HELPERS"; exit 1 }
source "$HELPERS"

fail() { print -u2 "FAIL: $1"; exit 1 }
pass() { print "  ok: $1" }

WORK="$(mktemp -d /tmp/gitbusy-logrot.XXXXXX)"
trap "rm -rf '$WORK'" EXIT

LOG="$WORK/server.log"

# (a) Below threshold: no rotation.
echo "small log line" > "$LOG"
rotate_log_if_needed "$LOG" 1048576
[[ -f "$LOG" ]] || fail "small log file was deleted"
[[ ! -f "${LOG}.1" ]] || fail "small log file rotated unexpectedly"
pass "below-threshold log is left alone"

# (b) At threshold: rotate. We write 2 MiB so a 1 MiB cap triggers.
dd if=/dev/zero of="$LOG" bs=1024 count=2048 2>/dev/null
rotate_log_if_needed "$LOG" 1048576
[[ -f "${LOG}.1" ]] || fail "rotation did not produce server.log.1"
[[ ! -s "$LOG" ]] || fail "rotated server.log is not empty"
pass "above-threshold log rotates to .1 and is truncated"

# (c) Two rotations in a row keep exactly one generation.
dd if=/dev/zero of="$LOG" bs=1024 count=2048 2>/dev/null
rotate_log_if_needed "$LOG" 1048576
[[ -f "${LOG}.1" ]] || fail "second rotation did not produce server.log.1"
[[ ! -f "${LOG}.2" ]] || fail "third generation appeared (should not exist)"
pass "second rotation does not create a third generation"

# (d) Missing log file: no error.
LOG_MISSING="$WORK/missing.log"
rotate_log_if_needed "$LOG_MISSING" 1048576
[[ ! -f "$LOG_MISSING" ]] || fail "missing log file was created"
pass "missing log file is a no-op"

print "all log rotation assertions passed"
