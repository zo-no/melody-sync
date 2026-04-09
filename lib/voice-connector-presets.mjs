import { homedir } from 'os';
import { join } from 'path';

export const VOICE_SIMPLE_MODE_DISABLED = 'disabled';
export const VOICE_SIMPLE_MODE_PASSIVE = 'passive';
export const VOICE_SIMPLE_MODE_WAKE = 'wake';
export const DEFAULT_SIMPLE_VOICE_MODE = process.platform === 'darwin'
  ? VOICE_SIMPLE_MODE_WAKE
  : VOICE_SIMPLE_MODE_PASSIVE;
export const DEFAULT_WAKE_PHRASE = '小罗小罗';

export const VOICE_SIMPLE_MODE_OPTIONS = Object.freeze([
  { value: VOICE_SIMPLE_MODE_DISABLED, label: '关闭' },
  { value: VOICE_SIMPLE_MODE_PASSIVE, label: '持续聆听' },
  { value: VOICE_SIMPLE_MODE_WAKE, label: '唤醒词模式' },
]);

export function inferSimpleVoiceMode(config = {}) {
  const managedMode = String(config?.managedMode || '').trim();
  if (managedMode === VOICE_SIMPLE_MODE_DISABLED || managedMode === VOICE_SIMPLE_MODE_PASSIVE || managedMode === VOICE_SIMPLE_MODE_WAKE) {
    return managedMode;
  }
  const command = String(config?.wake?.command || '').trim();
  if (!command && String(config?.wake?.mode || '').trim() === 'stdin') {
    return DEFAULT_SIMPLE_VOICE_MODE;
  }
  if (command.includes('voice-managed-passive.sh') || command.includes('voice-utterance-loop.py')) {
    return VOICE_SIMPLE_MODE_PASSIVE;
  }
  if (command.includes('voice-managed-wake.sh') || command.includes('voice-wake-phrase.swift') || command.includes('voice-wake-loop.py')) {
    return VOICE_SIMPLE_MODE_WAKE;
  }
  return DEFAULT_SIMPLE_VOICE_MODE;
}

export function inferWakePhrase(config = {}) {
  return String(config?.wake?.keyword || '').trim() || DEFAULT_WAKE_PHRASE;
}

export function buildManagedVoiceConfigPatch({ mode, wakePhrase, ttsEnabled } = {}) {
  const normalizedMode = typeof mode === 'string' && mode.trim()
    ? mode.trim()
    : DEFAULT_SIMPLE_VOICE_MODE;
  const normalizedWakePhrase = typeof wakePhrase === 'string' && wakePhrase.trim()
    ? wakePhrase.trim()
    : DEFAULT_WAKE_PHRASE;
  const speakReplies = ttsEnabled !== false;

  if (normalizedMode === VOICE_SIMPLE_MODE_DISABLED) {
    return {
      managedMode: VOICE_SIMPLE_MODE_DISABLED,
      wake: {
        mode: 'stdin',
        command: '',
        keyword: '',
      },
      capture: {
        command: '',
      },
      stt: {
        command: '',
      },
      tts: {
        enabled: speakReplies,
        mode: speakReplies && process.platform === 'darwin' ? 'say' : 'disabled',
      },
    };
  }

  if (normalizedMode === VOICE_SIMPLE_MODE_PASSIVE) {
    return {
      managedMode: VOICE_SIMPLE_MODE_PASSIVE,
      wake: {
        mode: 'command',
        command: 'bash scripts/voice/voice-managed-passive.sh',
        keyword: '',
      },
      capture: {
        command: '',
      },
      stt: {
        command: '',
      },
      tts: {
        enabled: speakReplies,
        mode: speakReplies && process.platform === 'darwin' ? 'say' : 'disabled',
      },
    };
  }

  return {
    managedMode: VOICE_SIMPLE_MODE_WAKE,
    wake: {
      mode: 'command',
      command: 'bash scripts/voice/voice-managed-wake.sh',
      keyword: normalizedWakePhrase,
    },
    capture: {
      command: 'bash scripts/voice/voice-managed-capture.sh',
    },
    stt: {
      command: '',
    },
    tts: {
      enabled: speakReplies,
      mode: speakReplies && process.platform === 'darwin' ? 'say' : 'disabled',
    },
  };
}

export function buildVoiceModeHints() {
  return {
    passive: {
      title: '持续聆听',
      description: '一直监听，任何一句完整说话都会发进 MelodySync。',
      requirements: [
        `需要本机 ASR Python 环境：${join(homedir(), '.tmp', 'asr-venv', 'bin', 'python')}`,
        '首次使用时，请通过 Terminal 启动监听以完成麦克风与语音识别授权。',
      ],
    },
    wake: {
      title: '唤醒词模式',
      description: '一直监听，但只有听到唤醒词后才会提交消息。',
      requirements: [
        '需要 macOS 麦克风和语音识别权限',
        '首次使用时，请通过 Terminal 启动监听以完成系统授权。',
      ],
    },
  };
}
