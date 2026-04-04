#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "$0")/.." && pwd)"
WAKE_PHRASE="${REMOTELAB_VOICE_WAKE_WORD:-${VOICE_WAKE_PHRASE:-小罗小罗}}"
ACK_SOUND="${VOICE_ACK_SOUND_PATH:-/System/Library/Sounds/Glass.aiff}"

cd "$ROOT_DIR"
exec swift scripts/voice-wake-phrase.swift \
  --phrase "$WAKE_PHRASE" \
  --locale "${VOICE_LOCALE:-zh-CN}" \
  --cooldown-ms "${VOICE_WAKE_COOLDOWN_MS:-2500}" \
  --restart-delay-ms "${VOICE_WAKE_RESTART_DELAY_MS:-1200}" \
  --on-device true \
  --allow-server-fallback true \
  --ack-sound-path "$ACK_SOUND" \
  "$@"
