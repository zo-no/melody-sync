#!/bin/bash

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ "$(uname)" == "Darwin" ]]; then
  OS_TYPE="macos"
  LOG_DIR="$HOME/Library/Logs"
else
  OS_TYPE="linux"
  LOG_DIR="$HOME/.local/share/melody-sync/logs"
fi

PLIST_PATH="$HOME/Library/LaunchAgents/com.melodysync.chat.plist"

chat_base_url() {
  local port="${CHAT_PORT:-7760}"
  echo "http://127.0.0.1:${port}"
}

wait_for_chat_service_health() {
  local base_url="${1:-$(chat_base_url)}"
  local timeout_secs="${2:-30}"
  local deadline=$((SECONDS + timeout_secs))
  local status=""

  while (( SECONDS < deadline )); do
    status="$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' "${base_url}/api/build-info" 2>/dev/null || true)"
    if [[ "$status" == "200" ]]; then
      return 0
    fi
    sleep 1
  done

  return 1
}

launchd_domain() {
  echo "gui/$(id -u)"
}

launchd_service_target() {
  local label="$1"
  echo "$(launchd_domain)/${label}"
}

launchd_service_loaded() {
  local label="$1"
  launchctl print "$(launchd_service_target "$label")" >/dev/null 2>&1
}

launchd_get_service_pid() {
  local label="$1"
  launchctl print "$(launchd_service_target "$label")" 2>/dev/null | awk '/^[[:space:]]+pid = / {print $3; exit}'
}

wait_for_process_exit() {
  local pid="$1"
  local timeout_secs="${2:-10}"
  local deadline=$((SECONDS + timeout_secs))

  if [[ -z "$pid" || "$pid" == "0" ]]; then
    return 0
  fi

  while (( SECONDS < deadline )); do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  return 1
}

launchd_bootstrap_service() {
  local label="$1"
  local plist="${2:-$HOME/Library/LaunchAgents/${label}.plist}"

  if [[ ! -f "$plist" ]]; then
    return 1
  fi

  if launchd_service_loaded "$label"; then
    return 0
  fi

  launchctl bootstrap "$(launchd_domain)" "$plist"
}

launchd_unload_service() {
  local label="$1"
  local plist="${2:-$HOME/Library/LaunchAgents/${label}.plist}"
  local pid=""

  if ! launchd_service_loaded "$label"; then
    return 0
  fi

  pid="$(launchd_get_service_pid "$label")"

  launchctl bootout "$(launchd_domain)" "$plist" >/dev/null 2>&1 || \
    launchctl bootout "$(launchd_service_target "$label")" >/dev/null 2>&1 || true

  wait_for_process_exit "$pid" 10 || true
}

launchd_restart_service() {
  local label="$1"
  local plist="${2:-$HOME/Library/LaunchAgents/${label}.plist}"

  if launchd_service_loaded "$label"; then
    launchctl kickstart -k "$(launchd_service_target "$label")"
    return 0
  fi

  launchd_bootstrap_service "$label" "$plist"
}

launchd_reload_service() {
  local label="$1"
  local plist="${2:-$HOME/Library/LaunchAgents/${label}.plist}"

  launchd_unload_service "$label" "$plist"
  launchd_bootstrap_service "$label" "$plist"
}

sync_chatserver_proxy_env() {
  local plist="${1:-$PLIST_PATH}"
  local vars="HTTPS_PROXY HTTP_PROXY ALL_PROXY https_proxy http_proxy all_proxy"
  local var val
  local node_modules_path="$PROJECT_ROOT/node_modules"

  if [[ ! -f "$plist" ]]; then
    return
  fi

  if ! plutil -extract EnvironmentVariables raw "$plist" >/dev/null 2>&1; then
    plutil -replace EnvironmentVariables -xml '<dict/>' "$plist" >/dev/null 2>&1 || true
  fi

  if [[ -d "$node_modules_path" ]]; then
    plutil -replace EnvironmentVariables.NODE_PATH -string "$node_modules_path" "$plist" >/dev/null 2>&1 || true
  fi

  for var in $vars; do
    val="${!var:-}"
    if [[ -n "$val" ]]; then
      plutil -replace "EnvironmentVariables.${var}" -string "$val" "$plist" >/dev/null 2>&1 || true
    else
      plutil -remove "EnvironmentVariables.${var}" "$plist" >/dev/null 2>&1 || true
    fi
  done
}

set_service_proxy_env() {
  local vars="HTTPS_PROXY HTTP_PROXY ALL_PROXY https_proxy http_proxy all_proxy"
  local var val

  for var in $vars; do
    val="${!var:-}"
    if [[ -z "$val" ]]; then
      continue
    fi

    if [[ "$OS_TYPE" == "macos" ]] && command -v launchctl >/dev/null 2>&1; then
      launchctl setenv "$var" "$val" >/dev/null 2>&1 || true
    elif [[ "$OS_TYPE" == "linux" ]] && command -v systemctl >/dev/null 2>&1; then
      systemctl --user set-environment "$var=$val" >/dev/null 2>&1 || true
    fi
  done
}
