#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "$0")/.." && pwd)"

cd "$ROOT_DIR"
exec swift scripts/voice-capture-until-silence.swift \
  --timeout-ms "${VOICE_CAPTURE_TIMEOUT_MS:-20000}" \
  --speech-start-timeout-ms "${VOICE_CAPTURE_SPEECH_START_TIMEOUT_MS:-8000}" \
  --silence-ms "${VOICE_CAPTURE_SILENCE_MS:-1000}" \
  --locale "${VOICE_LOCALE:-zh-CN}" \
  --on-device true \
  --allow-server-fallback true \
  "$@"
