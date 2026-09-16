#!/bin/zsh
# Shared launcher helpers. Sourced by both gitbusy-toggle.zsh (dev)
# and gitbusy-bundle-toggle.zsh (production bundle). Pure functions;
# no process control happens at source time.

# PROD-BL-002 — Check the stored PID file: returns 0 iff the file
# points at a live process whose command line contains the supplied
# owner marker. Use this before overwriting or unlinking the file.
# Args:
#   $1 = PID_FILE path
#   $2 = owner marker substring (the path the launcher's child process
#        inherits — e.g. the project path for the bundle launcher, or
#        the Vite command line for the dev launcher)
pid_file_is_alive_and_ours() {
  local pid_file="$1"
  local owner_marker="$2"
  [[ -f "$pid_file" ]] || return 1
  local stored
  IFS= read -r stored < "$pid_file" || return 1
  [[ -n "$stored" ]] || return 1
  kill -0 "$stored" 2>/dev/null || return 1
  local command_line
  command_line=$(/bin/ps -p "$stored" -o command= 2>/dev/null || true)
  [[ "$command_line" == *"$owner_marker"* ]]
}

# PROD-BL-001 — rotate server.log once it reaches the cap, keeping at
# most two generations (server.log, server.log.1). Triggered pre-launch
# so the diagnostic surface is bounded.
# Args:
#   $1 = LOG_FILE path
#   $2 = max bytes before rotation (default 5 MiB)
rotate_log_if_needed() {
  local log_file="$1"
  local max_bytes="${2:-5242880}"
  [[ -f "$log_file" ]] || return 0
  local size
  size=$(/usr/bin/stat -f '%z' "$log_file" 2>/dev/null || echo 0)
  (( size >= max_bytes )) || return 0
  /bin/rm -f "${log_file}.1"
  /bin/mv "$log_file" "${log_file}.1"
  : > "$log_file"
}
