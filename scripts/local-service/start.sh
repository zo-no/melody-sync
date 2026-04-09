#!/bin/bash
echo "Starting MelodySync services..."

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

if [[ "$OS_TYPE" == "macos" ]]; then
  sync_chatserver_proxy_env
  set_service_proxy_env

  if [[ -f "$PLIST_PATH" ]]; then
    launchctl load "$PLIST_PATH" 2>/dev/null || echo "chat-server already loaded"
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
  echo "Services started!"
  echo ""
  echo "Check status with:"
  echo "  systemctl --user status melodysync-chat"
  echo ""
  echo "View logs:"
  echo "  journalctl --user -u melodysync-chat -f"
fi
