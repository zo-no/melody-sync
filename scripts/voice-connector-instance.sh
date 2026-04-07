#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "$0")/.." && pwd)"
ACTION="${1:-start}"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
START_MODE="${VOICE_CONNECTOR_START_MODE:-auto}"

resolve_voice_dir() {
  "$NODE_BIN" --input-type=module <<'NODE'
import { homedir } from 'os';
import { join, resolve } from 'path';
import { readFileSync } from 'fs';

const bootstrapPath = join(homedir(), '.config', 'melody-sync', 'general-settings.json');
let runtimeRoot = join(homedir(), '.melodysync', 'runtime');

try {
  const payload = JSON.parse(readFileSync(bootstrapPath, 'utf8'));
  const raw = typeof payload?.runtimeRoot === 'string' ? payload.runtimeRoot.trim() : '';
  if (raw) {
    if (raw === '~') {
      runtimeRoot = homedir();
    } else if (raw.startsWith('~/')) {
      runtimeRoot = join(homedir(), raw.slice(2));
    } else {
      runtimeRoot = resolve(raw);
    }
  }
} catch {}

process.stdout.write(join(runtimeRoot, 'voice'));
NODE
}

CONFIG_DIR="${VOICE_CONNECTOR_DIR:-$(resolve_voice_dir)}"
CONFIG_PATH="${VOICE_CONNECTOR_CONFIG_PATH:-$CONFIG_DIR/config.json}"
PID_FILE="${VOICE_CONNECTOR_PID_FILE:-$CONFIG_DIR/connector.pid}"
LOG_PATH="${VOICE_CONNECTOR_LOG_PATH:-$CONFIG_DIR/logs/connector.log}"
LAUNCHER_PATH="${VOICE_CONNECTOR_LAUNCHER_PATH:-$CONFIG_DIR/start-connector-terminal.sh}"
TERMINAL_PROXY_PATH="${VOICE_CONNECTOR_TERMINAL_PROXY_PATH:-/tmp/melodysync-voice-start.sh}"

mkdir -p "$CONFIG_DIR" "$(dirname -- "$LOG_PATH")"

running_pid() {
  if [[ ! -f "$PID_FILE" ]]; then
    return 1
  fi

  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -z "$pid" ]]; then
    return 1
  fi

  if kill -0 "$pid" 2>/dev/null; then
    printf '%s\n' "$pid"
    return 0
  fi

  rm -f "$PID_FILE"
  return 1
}

resolved_start_mode() {
  case "$START_MODE" in
    auto)
      if [[ "$(uname -s)" == "Darwin" ]] && command -v osascript >/dev/null 2>&1; then
        printf '%s\n' 'bootstrap'
      else
        printf '%s\n' 'nohup'
      fi
      ;;
    bootstrap|terminal|nohup)
      printf '%s\n' "$START_MODE"
      ;;
    *)
      printf '%s\n' 'nohup'
      ;;
  esac
}

start_instance_nohup() {
  (
    cd "$ROOT_DIR"
    nohup env \
      PATH="$PATH" \
      HOME="$HOME" \
      USER="${USER:-}" \
      SHELL="${SHELL:-/bin/bash}" \
      "$NODE_BIN" scripts/voice-connector.mjs --config "$CONFIG_PATH" >> "$LOG_PATH" 2>&1 < /dev/null &
    echo $! > "$PID_FILE"
  )
}

start_instance_terminal() {
  cat > "$LAUNCHER_PATH" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cd "$ROOT_DIR"
echo \$\$ > "$PID_FILE"
exec env \
  PATH="$PATH" \
  HOME="$HOME" \
  USER="${USER:-}" \
  SHELL="${SHELL:-/bin/bash}" \
  "$NODE_BIN" scripts/voice-connector.mjs --config "$CONFIG_PATH" >> "$LOG_PATH" 2>&1
EOF
  chmod +x "$LAUNCHER_PATH"

  cat > "$TERMINAL_PROXY_PATH" <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec bash "$LAUNCHER_PATH"
EOF
  chmod +x "$TERMINAL_PROXY_PATH"

  VOICE_CONNECTOR_TERMINAL_LAUNCHER="$TERMINAL_PROXY_PATH" osascript <<'APPLESCRIPT' >/dev/null
set launcherPath to system attribute "VOICE_CONNECTOR_TERMINAL_LAUNCHER"
tell application "Terminal"
  activate
  do script "bash " & quoted form of launcherPath
end tell
APPLESCRIPT
}

start_instance_bootstrap() {
  cat > "$LAUNCHER_PATH" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cd "$ROOT_DIR"
nohup env \
  PATH="$PATH" \
  HOME="$HOME" \
  USER="${USER:-}" \
  SHELL="${SHELL:-/bin/bash}" \
  "$NODE_BIN" scripts/voice-connector.mjs --config "$CONFIG_PATH" >> "$LOG_PATH" 2>&1 < /dev/null &
echo \$! > "$PID_FILE"
exit 0
EOF
  chmod +x "$LAUNCHER_PATH"

  cat > "$TERMINAL_PROXY_PATH" <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec bash "$LAUNCHER_PATH"
EOF
  chmod +x "$TERMINAL_PROXY_PATH"

  VOICE_CONNECTOR_TERMINAL_LAUNCHER="$TERMINAL_PROXY_PATH" osascript <<'APPLESCRIPT' >/dev/null
set launcherPath to system attribute "VOICE_CONNECTOR_TERMINAL_LAUNCHER"
tell application "Terminal"
  set bootstrapTab to do script "bash " & quoted form of launcherPath
  repeat 20 times
    delay 0.2
    try
      if not (busy of bootstrapTab) then exit repeat
    end try
  end repeat
  try
    set bootstrapWindow to first window whose selected tab is bootstrapTab
    close bootstrapWindow saving no
  end try
end tell
APPLESCRIPT
}

start_instance() {
  local pid mode
  if pid="$(running_pid)"; then
    echo "voice connector already running (pid $pid)"
    echo "config: $CONFIG_PATH"
    echo "log: $LOG_PATH"
    return 0
  fi

  if [[ ! -f "$CONFIG_PATH" ]]; then
    echo "voice connector config not found: $CONFIG_PATH" >&2
    exit 1
  fi

  printf '\n=== start %s ===\n' "$(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG_PATH"

  rm -f "$PID_FILE"
  mode="$(resolved_start_mode)"
  if [[ "$mode" == "bootstrap" ]]; then
    start_instance_bootstrap
  elif [[ "$mode" == "terminal" ]]; then
    start_instance_terminal
  else
    start_instance_nohup
  fi

  for _ in $(seq 1 60); do
    if [[ -f "$PID_FILE" ]]; then
      pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    else
      pid=""
    fi
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      echo "started voice connector (pid $pid)"
      echo "mode: $mode"
      echo "config: $CONFIG_PATH"
      echo "log: $LOG_PATH"
      return 0
    fi
    sleep 0.5
  done

  if [[ -f "$PID_FILE" ]]; then
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  fi
  if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
    echo "started voice connector (pid $pid)"
    echo "mode: $mode"
    echo "config: $CONFIG_PATH"
    echo "log: $LOG_PATH"
    return 0
  fi

  echo "failed to start voice connector" >&2
  tail -n 80 "$LOG_PATH" >&2 || true
  exit 1
}

stop_instance() {
  local pid
  if ! pid="$(running_pid)"; then
    rm -f "$PID_FILE"
    echo "voice connector is already stopped"
    return 0
  fi

  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 40); do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$PID_FILE"
      echo "stopped voice connector (pid $pid)"
      return 0
    fi
    sleep 0.25
  done

  kill -9 "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "force-stopped voice connector (pid $pid)"
}

show_status() {
  local pid
  if ! pid="$(running_pid)"; then
    echo "voice connector is not running"
    echo "config: $CONFIG_PATH"
    echo "log: $LOG_PATH"
    return 1
  fi

  echo "voice connector is running"
  echo "pid: $pid"
  echo "config: $CONFIG_PATH"
  echo "log: $LOG_PATH"
  ps -p "$pid" -o pid=,ppid=,user=,lstart=,command=
}

show_logs() {
  tail -n 80 "$LOG_PATH"
}

case "$ACTION" in
  start)
    start_instance
    ;;
  stop)
    stop_instance
    ;;
  restart)
    stop_instance
    start_instance
    ;;
  status)
    show_status
    ;;
  logs)
    show_logs
    ;;
  *)
    echo "usage: $0 {start|stop|restart|status|logs}" >&2
    exit 1
    ;;
esac
