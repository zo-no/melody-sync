#!/bin/bash
echo "Stopping MelodySync services..."
launchctl unload ~/Library/LaunchAgents/com.melodysync.chat.plist 2>/dev/null || echo "chat-server not loaded"
if [ -f ~/Library/LaunchAgents/com.melodysync.tunnel.plist ]; then
  launchctl unload ~/Library/LaunchAgents/com.melodysync.tunnel.plist 2>/dev/null || echo "cloudflared not loaded"
fi
echo "Services stopped!"
