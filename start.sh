#!/bin/bash
echo "Starting MelodySync services..."

if [[ "$(uname)" == "Darwin" ]]; then
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
      if [ -n "$val" ]; then
        launchctl setenv "$var" "$val" >/dev/null 2>&1 || true
      fi
    done
  }

  sync_chatserver_proxy_env
  set_proxy_env

  if [ -f "$PLIST_PATH" ]; then
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
  systemctl --user start melodysync-chat.service
  echo "Services started!"
  echo ""
  echo "Check status with:"
  echo "  systemctl --user status melodysync-chat"
  echo ""
  echo "View logs:"
  echo "  journalctl --user -u melodysync-chat -f"
fi
