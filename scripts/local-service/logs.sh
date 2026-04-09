#!/bin/bash
# MelodySync 服务诊断脚本
# Usage:
#   logs.sh          — 显示 chat-server 状态 + 最近日志
#   logs.sh chat     — 实时跟踪 chat-server 日志
#   logs.sh status   — 只看服务状态

CMD="${1:-all}"

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

show_status() {
  echo -e "${BOLD}=== 服务状态 (${OS_TYPE}) ===${RESET}"

  if [[ "$OS_TYPE" == "macos" ]]; then
    info=$(launchctl list 2>/dev/null | grep "com.melodysync.chat")
    if [[ -n "$info" ]]; then
      pid=$(echo "$info" | awk '{print $1}')
      exit_code=$(echo "$info" | awk '{print $2}')
      if [[ "$pid" != "-" && -n "$pid" ]]; then
        echo -e "  ${GREEN}●${RESET} com.melodysync.chat  (pid=$pid)"
      else
        echo -e "  ${RED}✗${RESET} com.melodysync.chat  (not running, last exit=$exit_code)"
      fi
    else
      echo -e "  ${YELLOW}?${RESET} com.melodysync.chat  (not loaded)"
    fi
  else
    if systemctl --user list-unit-files "melodysync-chat.service" &>/dev/null 2>&1; then
      if systemctl --user is-active --quiet "melodysync-chat.service" 2>/dev/null; then
        pid=$(systemctl --user show -p MainPID --value "melodysync-chat.service" 2>/dev/null || echo "?")
        echo -e "  ${GREEN}●${RESET} melodysync-chat.service  (pid=${pid})"
      else
        status=$(systemctl --user is-active "melodysync-chat.service" 2>/dev/null || echo "unknown")
        echo -e "  ${RED}✗${RESET} melodysync-chat.service  (${status})"
      fi
    else
      echo -e "  ${YELLOW}?${RESET} melodysync-chat.service  (not installed)"
    fi
  fi
  echo ""
}

show_recent_logs() {
  local lines="${1:-30}"

  echo -e "${CYAN}── chat-server stdout ($LOG_DIR/chat-server.log) ──${RESET}"
  if [[ -f "$LOG_DIR/chat-server.log" ]]; then
    tail -n "$lines" "$LOG_DIR/chat-server.log"
  else
    echo "  (文件不存在)"
  fi
  echo ""

  echo -e "${RED}── chat-server stderr ($LOG_DIR/chat-server.error.log) ──${RESET}"
  if [[ -f "$LOG_DIR/chat-server.error.log" ]]; then
    tail -n "$lines" "$LOG_DIR/chat-server.error.log"
  else
    echo "  (文件不存在)"
  fi
  echo ""
}

case "$CMD" in
  status)
    show_status
    ;;

  chat)
    echo -e "${BOLD}实时跟踪 chat-server 日志 (Ctrl+C 退出)${RESET}"
    if [[ "$OS_TYPE" == "linux" ]]; then
      echo -e "${CYAN}journalctl:${RESET} journalctl --user -u melodysync-chat -f"
      echo ""
      journalctl --user -u melodysync-chat -f 2>/dev/null || \
        tail -f "$LOG_DIR/chat-server.log" "$LOG_DIR/chat-server.error.log" 2>/dev/null
    else
      tail -f "$LOG_DIR/chat-server.log" "$LOG_DIR/chat-server.error.log" 2>/dev/null
    fi
    ;;

  all|*)
    show_status
    echo -e "${BOLD}=== 最近日志 (各 30 行) ===${RESET}"
    echo ""
    show_recent_logs
    echo -e "${BOLD}── 快速命令参考 ──${RESET}"
    echo "  logs.sh chat    # 实时跟踪 chat-server"
    echo "  logs.sh status  # 只看服务状态"
    echo ""
    echo "  外部反代 / Tunnel / VPN 日志不由 MelodySync 管理，请查看对应代理服务。"
    if [[ "$OS_TYPE" == "linux" ]]; then
      echo ""
      echo "  # systemd 日志 (更完整):"
      echo "  journalctl --user -u melodysync-chat -f"
    fi
    ;;
esac
