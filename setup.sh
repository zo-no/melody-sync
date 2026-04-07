#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_header() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}\n"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

if [[ "$OSTYPE" == "darwin"* ]]; then
    OS_TYPE="macos"
elif [[ "$OSTYPE" == "linux-gnu"* ]] || [[ "$(uname)" == "Linux" ]]; then
    OS_TYPE="linux"
else
    print_error "Unsupported OS: $OSTYPE. Only macOS and Linux are supported."
    exit 1
fi

CURRENT_USER=$(whoami)
USER_HOME="$HOME"

if [[ "$OS_TYPE" == "macos" ]]; then
    LOG_DIR="$HOME/Library/Logs"
else
    LOG_DIR="$HOME/.local/share/melodysync/logs"
fi

print_header "MelodySync Local Setup (${OS_TYPE})"

echo "This script installs MelodySync as a local service on this machine."
echo ""
echo "Current user: $CURRENT_USER"
echo "Home directory: $USER_HOME"
echo "Repo path: $SCRIPT_DIR"
echo ""
read -p "Press Enter to continue..."

print_header "Step 1: Checking Dependencies"

MISSING_DEPS=()

if ! command -v node >/dev/null 2>&1; then
    print_error "Node.js not found"
    MISSING_DEPS+=("node")
else
    print_success "Node.js installed at: $(which node)"
fi

if [[ "$OS_TYPE" == "macos" ]]; then
    if ! command -v brew >/dev/null 2>&1; then
        print_error "Homebrew not found (required on macOS)"
        MISSING_DEPS+=("homebrew")
    else
        print_success "Homebrew installed"
    fi
fi

if command -v codex >/dev/null 2>&1; then
    print_success "Codex CLI found: $(which codex)"
elif command -v claude >/dev/null 2>&1; then
    print_success "Claude CLI found: $(which claude)"
elif command -v cline >/dev/null 2>&1; then
    print_success "Cline CLI found: $(which cline)"
else
    print_warning "No supported AI CLI found (codex / claude / cline). Install one before creating sessions."
fi

if [[ ${#MISSING_DEPS[@]} -gt 0 ]]; then
    print_error "Missing critical dependencies: ${MISSING_DEPS[*]}"
    echo ""
    for dep in "${MISSING_DEPS[@]}"; do
        case $dep in
            homebrew)
                echo "  Homebrew: /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
                ;;
            node)
                if [[ "$OS_TYPE" == "macos" ]]; then
                    echo "  Node.js: brew install node"
                else
                    echo "  Node.js: install Node.js 18+ with your package manager"
                fi
                ;;
        esac
    done
    exit 1
fi

print_header "Step 2: Generating Access Token"

print_info "Generating access token..."
TOKEN_OUTPUT=$(node "$SCRIPT_DIR/generate-token.mjs" 2>&1)
echo "$TOKEN_OUTPUT"
ACCESS_TOKEN=$(echo "$TOKEN_OUTPUT" | grep "Your access token:" | sed 's/.*Your access token: //')
echo ""
print_warning "Save this token now. It is required for login."
read -p "Press Enter to continue once you have saved it..."

print_header "Step 3: Creating Local Service Files"

mkdir -p "$HOME/.local/bin"
mkdir -p "$LOG_DIR"

if [[ "$OS_TYPE" == "macos" ]]; then
    mkdir -p "$HOME/Library/LaunchAgents"

    cat > "$HOME/Library/LaunchAgents/com.melodysync.chat.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.melodysync.chat</string>
    <key>ProgramArguments</key>
    <array>
        <string>$(which node)</string>
        <string>$SCRIPT_DIR/chat-server.mjs</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>MELODYSYNC_ENABLE_ACTIVE_RELEASE</key>
        <string>1</string>
        <key>SECURE_COOKIES</key>
        <string>0</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>$USER_HOME</string>
    <key>StandardOutPath</key>
    <string>$LOG_DIR/chat-server.log</string>
    <key>StandardErrorPath</key>
    <string>$LOG_DIR/chat-server.error.log</string>
</dict>
</plist>
EOF
    print_success "Created: ~/Library/LaunchAgents/com.melodysync.chat.plist"
else
    SYSTEMD_DIR="$HOME/.config/systemd/user"
    mkdir -p "$SYSTEMD_DIR"

    cat > "$SYSTEMD_DIR/melodysync-chat.service" << EOF
[Unit]
Description=MelodySync Chat Server
After=network.target

[Service]
Type=simple
WorkingDirectory=$USER_HOME
ExecStart=$(which node) $SCRIPT_DIR/chat-server.mjs
Restart=always
RestartSec=5
StandardOutput=append:$LOG_DIR/chat-server.log
StandardError=append:$LOG_DIR/chat-server.error.log
Environment=NODE_ENV=production
Environment=MELODYSYNC_ENABLE_ACTIVE_RELEASE=1
Environment=SECURE_COOKIES=0

[Install]
WantedBy=default.target
EOF
    systemctl --user daemon-reload
    print_success "Created: ~/.config/systemd/user/melodysync-chat.service"

    if command -v loginctl >/dev/null 2>&1; then
        print_info "Enabling systemd user lingering (services survive logout)..."
        loginctl enable-linger "$CURRENT_USER" 2>/dev/null && \
            print_success "Lingering enabled" || \
            print_warning "Could not enable lingering (may need sudo). Services will stop on logout."
    fi
fi

print_header "Step 4: Creating Local Credentials File"

cat > "$SCRIPT_DIR/credentials.txt" << EOF
# MelodySync Local Access Credentials
# Generated: $(date)
# OS: $OS_TYPE

Access URL: http://127.0.0.1:7760/?token=$ACCESS_TOKEN

# Management:
Start services: $SCRIPT_DIR/start.sh
Stop services:  $SCRIPT_DIR/stop.sh

# External access:
# KEEP THIS FILE SECURE!
EOF
chmod 600 "$SCRIPT_DIR/credentials.txt"
print_success "Created: credentials.txt"

print_header "Step 5: Starting Local Service"

print_info "Stopping any existing chat-server service..."
if [[ "$OS_TYPE" == "macos" ]]; then
    launchctl unload "$HOME/Library/LaunchAgents/com.melodysync.chat.plist" 2>/dev/null || true
else
    systemctl --user stop melodysync-chat.service 2>/dev/null || true
fi

pkill -f chat-server.mjs 2>/dev/null || true
lsof -ti :7760 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 2

print_info "Loading chat-server service..."
if [[ "$OS_TYPE" == "macos" ]]; then
    launchctl load "$HOME/Library/LaunchAgents/com.melodysync.chat.plist"
    sleep 3

    service_pid() { launchctl list | awk -v svc="$1" '$3 == svc && $1 ~ /^[0-9]+$/ {print $1}'; }
    CHATSERVER_PID=$(service_pid "com.melodysync.chat")
    if [[ -n "$CHATSERVER_PID" ]]; then
        print_success "chat-server running (PID $CHATSERVER_PID)"
    else
        print_error "chat-server failed to start — check $LOG_DIR/chat-server.error.log"
        exit 1
    fi
else
    systemctl --user enable melodysync-chat.service 2>/dev/null || true
    systemctl --user start melodysync-chat.service
    sleep 3

    if systemctl --user is-active --quiet melodysync-chat.service; then
        print_success "chat-server running"
    else
        print_error "chat-server failed to start — check $LOG_DIR/chat-server.error.log"
        exit 1
    fi
fi

print_header "Setup Complete"

echo -e "${GREEN}✓ MelodySync is now accessible locally.${NC}"
echo ""
echo "Access URL: ${BLUE}http://127.0.0.1:7760/?token=$ACCESS_TOKEN${NC}"
echo ""
echo "Logs:"
echo "  chat-server: $LOG_DIR/chat-server.log"
echo ""
echo "Management commands:"
echo "  Start: $SCRIPT_DIR/start.sh"
echo "  Stop:  $SCRIPT_DIR/stop.sh"
echo "  Logs:  $SCRIPT_DIR/logs.sh"
echo ""
print_success "Setup completed successfully!"
