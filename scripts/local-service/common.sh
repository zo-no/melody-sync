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
