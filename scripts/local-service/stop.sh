#!/bin/bash
echo "Stopping MelodySync services..."

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

if [[ "$OS_TYPE" == "macos" ]]; then
  launchd_unload_service "com.melodysync.chat" "$PLIST_PATH" || echo "chat-server not loaded"
else
  systemctl --user stop melodysync-chat.service 2>/dev/null || echo "chat-server not running"
fi

echo "Services stopped!"
