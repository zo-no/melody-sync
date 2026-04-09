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

  if [[ ! -f "$plist" ]]; then
    echo "  $name: plist not found, skipping"
    return
  fi

  launchd_reload_service "$label" "$plist"

  if wait_for_chat_service_health "$(chat_base_url)" 30; then
    local pid
    pid="$(launchd_get_service_pid "$label")"
    echo "  $name: healthy${pid:+ (pid=${pid})}"
  else
    echo "  $name: failed health check (check: $LOG_DIR/chat-server.error.log)"
    return 1
  fi
}

restart_systemd() {
  local unit="$1"
  local name="$2"

  if ! systemctl --user list-unit-files "${unit}.service" &>/dev/null; then
    echo "  $name: unit not found, skipping"
    return
  fi

  if systemctl --user restart "${unit}.service" 2>/dev/null && \
     wait_for_chat_service_health "$(chat_base_url)" 30; then
    echo "  $name: healthy"
  else
    echo "  $name: failed to restart (check: journalctl --user -u ${unit})"
    return 1
  fi
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
