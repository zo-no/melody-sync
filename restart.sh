#!/bin/bash
# Restart one or all MelodySync services.
# Usage:
#   restart.sh          — restart all services
#   restart.sh chat     — restart only chat-server
#   restart.sh tunnel   — restart only cloudflared

set -e

SERVICE="${1:-all}"

# Detect OS
if [[ "$(uname)" == "Darwin" ]]; then
    OS_TYPE="macos"
else
    OS_TYPE="linux"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST_PATH="$HOME/Library/LaunchAgents/com.melodysync.chat.plist"

sync_chatserver_proxy_env() {
  local plist="$PLIST_PATH"
  local vars="HTTPS_PROXY HTTP_PROXY ALL_PROXY https_proxy http_proxy all_proxy"
  local var val
  local node_modules_path="$SCRIPT_DIR/node_modules"

  if [ ! -f "$plist" ]; then
    return
  fi

  if ! plutil -extract EnvironmentVariables raw "$plist" >/dev/null 2>&1; then
    plutil -replace EnvironmentVariables -xml '<dict/>' "$plist" >/dev/null 2>&1 || true
  fi

  if [ -d "$node_modules_path" ]; then
    plutil -replace EnvironmentVariables.NODE_PATH -string "$node_modules_path" "$plist" >/dev/null 2>&1 || true
  fi

  for var in $vars; do
    val="${!var:-}"
    if [ -n "$val" ]; then
      plutil -replace "EnvironmentVariables.${var}" -string "$val" "$plist" >/dev/null 2>&1 || true
    else
      plutil -remove "EnvironmentVariables.${var}" "$plist" >/dev/null 2>&1 || true
    fi
  done
}

set_proxy_env() {
  local vars="HTTPS_PROXY HTTP_PROXY ALL_PROXY https_proxy http_proxy all_proxy"
  local var val

  for var in $vars; do
    val="${!var:-}"
    if [ -z "$val" ]; then
      continue
    fi

    if [[ "$OS_TYPE" == "macos" ]] && command -v launchctl >/dev/null 2>&1; then
      launchctl setenv "$var" "$val" >/dev/null 2>&1 || true
    elif [[ "$OS_TYPE" == "linux" ]] && command -v systemctl >/dev/null 2>&1; then
      systemctl --user set-environment "$var=$val" >/dev/null 2>&1 || true
    fi
  done
}

# ── macOS: launchctl ──────────────────────────────────────────────────────────
restart_launchd() {
  local label="$1"
  local plist="$HOME/Library/LaunchAgents/${label}.plist"
  local name="$2"

  if [ ! -f "$plist" ]; then
    echo "  $name: plist not found, skipping"
    return
  fi

  if launchctl list | grep -q "$label"; then
    launchctl stop "$label" 2>/dev/null || true
    sleep 1
    echo "  $name: restarted ($(launchctl list | grep "$label" | awk '{print "pid="$1}'))"
  else
    launchctl load "$plist" 2>/dev/null
    echo "  $name: loaded"
  fi
}

sync_chatserver_proxy_env
set_proxy_env

# ── Linux: systemd --user ─────────────────────────────────────────────────────
restart_systemd() {
  local unit="$1"
  local name="$2"

  if ! systemctl --user list-unit-files "${unit}.service" &>/dev/null; then
    echo "  $name: unit not found, skipping"
    return
  fi

  systemctl --user restart "${unit}.service" 2>/dev/null && \
    echo "  $name: restarted" || \
    echo "  $name: failed to restart (check: journalctl --user -u ${unit})"
}

# ── Dispatch ──────────────────────────────────────────────────────────────────
restart_service() {
  local name="$1"
  local launchd_label="$2"
  local systemd_unit="$3"

  if [[ "$OS_TYPE" == "macos" ]]; then
    restart_launchd "$launchd_label" "$name"
  else
    restart_systemd "$systemd_unit" "$name"
  fi
}

case "$SERVICE" in
  chat)
    echo "Restarting chat-server..."
    restart_service "chat-server" "com.melodysync.chat" "melodysync-chat"
    ;;
  tunnel)
    echo "Restarting cloudflared..."
    restart_service "cloudflared" "com.melodysync.tunnel" "melodysync-tunnel"
    ;;
  all)
    echo "Restarting all services..."
    restart_service "chat-server" "com.melodysync.chat"  "melodysync-chat"
    restart_service "cloudflared" "com.melodysync.tunnel" "melodysync-tunnel"
    ;;
  *)
    echo "Unknown service: $SERVICE"
    echo "Usage: restart.sh [chat|tunnel|all]"
    exit 1
    ;;
esac

echo "Done!"
