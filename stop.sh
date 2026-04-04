#!/bin/bash
echo "Stopping MelodySync services..."

if [[ "$(uname)" == "Darwin" ]]; then
  launchctl unload ~/Library/LaunchAgents/com.melodysync.chat.plist 2>/dev/null || echo "chat-server not loaded"
else
  systemctl --user stop melodysync-chat.service 2>/dev/null || echo "chat-server not running"
fi

echo "Services stopped!"
