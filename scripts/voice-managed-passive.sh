#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "$0")/.." && pwd)"
PYTHON_BIN="${VOICE_ASR_PYTHON:-$HOME/.tmp/asr-venv/bin/python}"

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "voice passive mode requires Python ASR env: $PYTHON_BIN" >&2
  exit 1
fi

cd "$ROOT_DIR"
exec "$PYTHON_BIN" scripts/voice-utterance-loop.py \
  --language "${VOICE_LANGUAGE:-zh}" \
  --cooldown-ms "${VOICE_PASSIVE_COOLDOWN_MS:-1200}" \
  --speech-start-timeout-ms "${VOICE_PASSIVE_SPEECH_START_TIMEOUT_MS:-5000}" \
  --silence-ms "${VOICE_PASSIVE_SILENCE_MS:-1800}" \
  "$@"
