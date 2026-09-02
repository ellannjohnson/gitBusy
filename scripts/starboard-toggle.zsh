#!/bin/zsh
set -u

PROJECT='/Users/ellannjohnson/stargazer-local'
PORT='5174'
URL="http://127.0.0.1:${PORT}/"
RUNTIME_DIR="${PROJECT}/.starboard-runtime"
PID_FILE="${RUNTIME_DIR}/server.pid"
LOG_FILE="${RUNTIME_DIR}/server.log"

mkdir -p "$RUNTIME_DIR"

notify() {
  /usr/bin/osascript -e "display notification \"$1\" with title \"Starboard\"" >/dev/null 2>&1 || true
}

port_pid() {
  /usr/sbin/lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | /usr/bin/head -n 1
}

is_ours() {
  local candidate="$1"
  [[ -n "$candidate" ]] || return 1
  local command_line
  command_line=$(/bin/ps -p "$candidate" -o command= 2>/dev/null || true)
  [[ "$command_line" == *"${PROJECT}"* || "$command_line" == *"vite --host 127.0.0.1 --port ${PORT}"* ]]
}

close_browser_tabs() {
  /usr/bin/osascript <<'APPLESCRIPT' >/dev/null 2>&1 || true
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
}

stop_server() {
  local pid=''
  if [[ -f "$PID_FILE" ]]; then
    IFS= read -r pid < "$PID_FILE" || true
  fi
  if is_ours "$pid" && kill -0 "$pid" 2>/dev/null; then
    /bin/kill "$pid" 2>/dev/null || true
    for _ in {1..20}; do
      kill -0 "$pid" 2>/dev/null || break
      /bin/sleep 0.1
    done
  fi
  /bin/rm -f "$PID_FILE"
  close_browser_tabs
  notify 'Stopped the local app and server'
}

start_server() {
  local existing
  existing=$(port_pid)
  if [[ -n "$existing" ]]; then
    if is_ours "$existing"; then
      printf '%s\n' "$existing" > "$PID_FILE"
      /usr/bin/open "$URL"
      notify 'Starboard is already running'
      return 0
    fi
    notify "Port ${PORT} is already in use"
    /usr/bin/open "$URL"
    return 1
  fi

  /bin/zsh -lc "cd '$PROJECT' && exec ./node_modules/.bin/vite --host 127.0.0.1 --port ${PORT} --strictPort" > "$LOG_FILE" 2>&1 &
  local pid=$!
  printf '%s\n' "$pid" > "$PID_FILE"
  for _ in {1..40}; do
    if /usr/bin/curl -fsS --max-time 1 "$URL" >/dev/null 2>&1; then
      /usr/bin/open "$URL"
      notify 'Starboard is ready'
      return 0
    fi
    /bin/sleep 0.25
  done
  notify "Starboard did not start — see ${LOG_FILE}"
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
