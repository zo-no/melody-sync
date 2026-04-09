#!/bin/bash
echo "Starting MelodySync services..."

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

if [[ "$OS_TYPE" == "macos" ]]; then
  sync_chatserver_proxy_env
  set_service_proxy_env

  if [[ -f "$PLIST_PATH" ]]; then
    launchd_bootstrap_service "com.melodysync.chat" "$PLIST_PATH"
    if ! wait_for_chat_service_health "$(chat_base_url)" 10; then
      launchd_restart_service "com.melodysync.chat" "$PLIST_PATH"
    fi
    if wait_for_chat_service_health "$(chat_base_url)" 30; then
      pid="$(launchd_get_service_pid "com.melodysync.chat")"
      echo "chat-server healthy${pid:+ (pid=${pid})}"
    else
      echo "chat-server failed health check: $LOG_DIR/chat-server.error.log"
      exit 1
    fi
  else
    echo "chat-server plist not found: $PLIST_PATH"
    exit 1
  fi

  echo "Services started!"
  echo ""
  echo "Check status with:"
  echo "  launchctl list | grep melodysync"
else
  set_service_proxy_env
  systemctl --user start melodysync-chat.service
  if ! wait_for_chat_service_health "$(chat_base_url)" 30; then
    echo "chat-server failed health check: $LOG_DIR/chat-server.error.log"
    exit 1
  fi
  echo "Services started!"
  echo ""
  echo "Check status with:"
  echo "  systemctl --user status melodysync-chat"
  echo ""
  echo "View logs:"
  echo "  journalctl --user -u melodysync-chat -f"
fi
