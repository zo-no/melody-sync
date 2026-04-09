#!/bin/bash
# Restart MelodySync local services.
# Usage:
#   restart.sh        — restart chat-server
#   restart.sh chat   — restart chat-server
#   restart.sh all    — restart all MelodySync-managed services (currently same as chat)

set -e

SERVICE="${1:-chat}"

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

restart_launchd() {
  local label="$1"
  local plist="$HOME/Library/LaunchAgents/${label}.plist"
  local name="$2"
  local uid
  uid="$(id -u)"

  if [[ ! -f "$plist" ]]; then
    echo "  $name: plist not found, skipping"
    return
  fi

  if launchctl list | grep -q "$label"; then
    if launchctl kickstart -k "gui/${uid}/${label}" >/dev/null 2>&1; then
      echo "  $name: restarted"
    else
      launchctl stop "$label" 2>/dev/null || true
      sleep 1
      echo "  $name: restarted ($(launchctl list | grep "$label" | awk '{print "pid="$1}'))"
    fi
  else
    launchctl load "$plist" 2>/dev/null
    echo "  $name: loaded"
  fi
}

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

if [[ "$OS_TYPE" == "macos" ]]; then
  sync_chatserver_proxy_env
fi
set_service_proxy_env

case "$SERVICE" in
  chat|all)
    echo "Restarting chat-server..."
    restart_service "chat-server" "com.melodysync.chat" "melodysync-chat"
    ;;
  *)
    echo "Unknown service: $SERVICE"
    echo "Usage: restart.sh [chat|all]"
    exit 1
    ;;
esac

echo "Done!"
