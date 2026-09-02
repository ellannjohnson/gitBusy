#!/bin/zsh
set -u

BUNDLE_ROOT="${0:A:h}"
PROJECT="${BUNDLE_ROOT}/project"
NODE="${BUNDLE_ROOT}/node"
VITE_ENTRY="${PROJECT}/node_modules/vite/bin/vite.js"
PORT='5174'
URL="http://127.0.0.1:${PORT}/"
RUNTIME_DIR="$HOME/Library/Application Support/gitBusy"
PID_FILE="${RUNTIME_DIR}/server.pid"
LOG_FILE="${RUNTIME_DIR}/server.log"

mkdir -p "$RUNTIME_DIR"

notify() {
  /usr/bin/osascript -e "display notification \"$1\" with title \"gitBusy\"" >/dev/null 2>&1 || true
}

port_pid() {
  /usr/sbin/lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | /usr/bin/head -n 1
}

is_ours() {
  local candidate="$1"
  [[ -n "$candidate" ]] || return 1
  local command_line
  command_line=$(/bin/ps -p "$candidate" -o command= 2>/dev/null || true)
  [[ "$command_line" == *"${PROJECT}"* || "$command_line" == *"gitBusy.app"* ]]
}

close_browser_tabs() {
  /usr/bin/osascript <<'APPLESCRIPT' >/dev/null 2>&1 &
set targetPrefix to "http://127.0.0.1:5174/"
try
  tell application "Safari"
    if it is running then
      repeat with currentWindow in windows
        repeat with currentTab in tabs of currentWindow
          if (URL of currentTab) starts with targetPrefix then close currentTab
        end repeat
      end repeat
    end if
  end tell
end try
try
  tell application "Google Chrome"
    if it is running then
      repeat with currentWindow in windows
        repeat with currentTab in tabs of currentWindow
          if (URL of currentTab) starts with targetPrefix then close currentTab
        end repeat
      end repeat
    end if
  end tell
end try
try
  tell application "Brave Browser"
    if it is running then
      repeat with currentWindow in windows
        repeat with currentTab in tabs of currentWindow
          if (URL of currentTab) starts with targetPrefix then close currentTab
        end repeat
      end repeat
    end if
  end tell
end try
APPLESCRIPT
  local browser_pid=$!
  for _ in {1..20}; do
    if ! kill -0 "$browser_pid" 2>/dev/null; then
      wait "$browser_pid" 2>/dev/null || true
      return 0
    fi
    /bin/sleep 0.1
  done
  /bin/kill "$browser_pid" 2>/dev/null || true
  wait "$browser_pid" 2>/dev/null || true
}

stop_server() {
  local pid=''
  if [[ -f "$PID_FILE" ]]; then
    IFS= read -r pid < "$PID_FILE" || true
  fi
  /usr/bin/curl -fsS --max-time 2 -X POST "$URL/api/network/tailscale" -H 'Content-Type: application/json' --data '{"enabled":false}' >/dev/null 2>&1 || true
  if is_ours "$pid" && kill -0 "$pid" 2>/dev/null; then
    /bin/kill "$pid" 2>/dev/null || true
    for _ in {1..20}; do
      kill -0 "$pid" 2>/dev/null || break
      /bin/sleep 0.1
    done
  fi
  /bin/rm -f "$PID_FILE"
  close_browser_tabs
  notify 'Stopped gitBusy and its local server'
}

start_server() {
  local existing
  existing=$(port_pid)
  if [[ -n "$existing" ]]; then
    if is_ours "$existing"; then
      printf '%s\n' "$existing" > "$PID_FILE"
      /usr/bin/open "$URL"
      notify 'gitBusy is already running'
      return 0
    fi
    notify "Port ${PORT} is already in use"
    return 1
  fi
  if [[ ! -x "$NODE" || ! -f "$VITE_ENTRY" ]]; then
    notify 'gitBusy bundle is incomplete — reinstall it'
    return 1
  fi

  (
    cd "$PROJECT"
    exec "$NODE" "$VITE_ENTRY" --config "$PROJECT/vite.config.ts" --host 127.0.0.1 --port "$PORT" --strictPort
  ) > "$LOG_FILE" 2>&1 &
  local pid=$!
  printf '%s\n' "$pid" > "$PID_FILE"
  for _ in {1..40}; do
    if /usr/bin/curl -fsS --max-time 1 "$URL" >/dev/null 2>&1; then
      /usr/bin/open "$URL"
      notify 'gitBusy is ready'
      return 0
    fi
    /bin/sleep 0.25
  done
  notify "gitBusy did not start — see ${LOG_FILE}"
  return 1
}

existing_pid=$(port_pid)
stored_pid=''
if [[ -f "$PID_FILE" ]]; then
  IFS= read -r stored_pid < "$PID_FILE" || true
fi
if [[ -n "$existing_pid" && "$existing_pid" == "$stored_pid" ]] && is_ours "$existing_pid"; then
  stop_server
else
  start_server
fi
