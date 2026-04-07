#!/usr/bin/env node

import { appendFile, mkdir } from 'fs/promises'
import { createInterface } from 'readline'
import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { homedir } from 'os'
import { dirname, join, resolve } from 'path'
import { pathToFileURL } from 'url'

import {
  DEFAULT_APP_ID,
  DEFAULT_APP_NAME,
  DEFAULT_CHAT_BASE_URL,
  DEFAULT_CONFIG_PATH,
  DEFAULT_SESSION_MODE,
  DEFAULT_SESSION_SYSTEM_PROMPT,
  DEFAULT_SESSION_TOOL,
  DEFAULT_TTS_RATE,
  loadConfig,
  normalizeConfig,
  resolveHomePath,
} from '../lib/voice-connector-config.mjs'
import {
  buildExternalTriggerId,
  buildMelodySyncMessage,
  ensureAuthCookie,
  generateMelodySyncReply,
  loginWithToken,
  normalizeSpokenReplyText,
  readOwnerToken,
} from './voice-connector-melodysync.mjs'
import {
  parseCommandPayload,
  runSay,
  runShellCommand,
} from './voice-connector-shell.mjs'

function trimString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

const CAPTURE_RECOVERABLE_ERROR_PATTERNS = [
  /no speech/i,
  /speech.*(start.*timeout|detected.*timeout|start timeout|start timeout|silence)/i,
  /recognition.*failed/i,
  /recognition canceled|recognition cancelled/i,
  /kaf(?:ail|assistant(?:error)?domain)/i,
  /1107/i,
  /timed out/i,
]
const MAX_CAPTURE_ATTEMPTS = 2
const MAX_STT_ATTEMPTS = 2

function isRecoverableCaptureError(error) {
  const message = trimString(error?.message || error)
  if (!message) return false
  return CAPTURE_RECOVERABLE_ERROR_PATTERNS.some((pattern) => pattern.test(message))
}

function parseBooleanish(value) {
  if (typeof value === 'boolean') return value
  const normalized = trimString(value).toLowerCase()
  if (!normalized) return undefined
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return undefined
}

function isCaptureExplicitlyOptional(summary) {
  const captureNeeded = parseBooleanish(summary?.metadata?.captureNeeded)
  const hasTranscript = Boolean(normalizeMultilineText(summary?.transcript))
  return captureNeeded === false && !hasTranscript
}

function isCaptureNeeded(summary) {
  const hasWakeTranscript = Boolean(normalizeMultilineText(summary?.transcript))
  if (hasWakeTranscript) return false
  return !isCaptureExplicitlyOptional(summary)
}

function nowIso() {
  return new Date().toISOString()
}

function playAudioCue(audioPath) {
  const normalizedPath = trimString(audioPath)
  if (!normalizedPath || process.platform !== 'darwin') return
  const child = spawn('/usr/bin/afplay', [normalizedPath], {
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })
  child.on('close', (code, signal) => {
    if (code === 0) return
    console.warn(`[voice-connector] cue failed (${code}${signal ? `/${signal}` : ''}): ${trimString(stderr) || normalizedPath}`)
  })
}

function trackActiveSpeech(runtime, child) {
  if (!runtime || !child) return
  runtime.activeSpeechChild = child
  child.on('close', () => {
    if (runtime.activeSpeechChild === child) {
      runtime.activeSpeechChild = null
    }
  })
}

function cancelActiveSpeech(runtime, reason = '') {
  const child = runtime?.activeSpeechChild
  if (!child) return false
  runtime.activeSpeechChild = null
  try {
    child.kill('SIGTERM')
  } catch {}
  if (reason) {
    console.log(`[voice-connector] speech interrupted (${reason})`)
  }
  return true
}

async function playTranscriptAck(runtime, summary) {
  const ackText = trimString(
    runtime?.config?.capture?.env?.VOICE_RECEIVED_ACK_TEXT
      || runtime?.config?.capture?.env?.MELODYSYNC_VOICE_RECEIVED_ACK_TEXT
      || ''
  )
  if (ackText) {
    if (runtime.config.tts.mode === 'say') {
      await runSay(ackText, runtime.config.tts, {
        allowInterrupt: true,
        onSpawn: (child) => trackActiveSpeech(runtime, child),
      })
      return
    }
    if (runtime.config.tts.mode === 'command') {
      await runShellCommand(runtime.config.tts.command, {
        env: {
          ...runtime.config.tts.env,
          ...buildProcessEnv(runtime, summary, { replyText: ackText }),
        },
        stdin: ackText,
        timeoutMs: runtime.config.tts.timeoutMs,
      })
      return
    }
  }

  const cuePath = trimString(
    runtime?.config?.capture?.env?.VOICE_RECEIVED_SOUND_PATH
      || runtime?.config?.capture?.env?.MELODYSYNC_VOICE_RECEIVED_SOUND_PATH
      || ''
  )
  if (!cuePath) return
  playAudioCue(cuePath)
}


function printUsage(exitCode) {
  const output = exitCode === 0 ? console.log : console.error
  output(`Usage:
  node scripts/voice-connector.mjs [options]

Options:
  --config <path>        Config file path (default: ${DEFAULT_CONFIG_PATH})
  --text <text>          Submit one direct transcript and exit
  --stdin                Read one transcript per stdin line
  --no-speak             Skip TTS playback
  -h, --help             Show this help

Wake command contract:
  - The wake command should emit one line per activation on stdout.
  - Each line may be plain text (treated as a transcript) or JSON.
  - JSON may include: eventId, wakeWord, transcript, audioPath, detectedAt, connectorId, roomName, metadata.

Stage command contract:
  - capture.command is optional. It receives MELODYSYNC_VOICE_* env vars and may output either a plain audio path or JSON with { audioPath, transcript }.
  - stt.command is optional. It receives MELODYSYNC_VOICE_AUDIO_PATH and should output either plain transcript text or JSON with { text } / { transcript }.
  - tts.command receives MELODYSYNC_VOICE_REPLY_TEXT and also gets the reply on stdin.

Config shape:
  {
    "connectorId": "living-room-speaker",
    "roomName": "Living Room",
    "chatBaseUrl": "${DEFAULT_CHAT_BASE_URL}",
    "sessionFolder": "${homedir()}",
    "sessionTool": "${DEFAULT_SESSION_TOOL}",
    "model": "",
    "effort": "",
    "thinking": false,
    "sessionMode": "${DEFAULT_SESSION_MODE}",
    "systemPrompt": "${DEFAULT_SESSION_SYSTEM_PROMPT.replace(/"/g, '\\"')}",
    "wake": {
      "mode": "command",
      "command": "python3 your-wake-loop.py --phrase \"Hello World\" --transcript-mode full",
      "keyword": "Hello World"
    },
    "tts": {
      "mode": "say",
      "voice": "Tingting",
      "rate": ${DEFAULT_TTS_RATE}
    }
  }
`)
  process.exit(exitCode)
}

function parseArgs(argv) {
  const options = {
    configPath: DEFAULT_CONFIG_PATH,
    text: '',
    stdin: false,
    noSpeak: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--config') {
      options.configPath = argv[index + 1]
      index += 1
      continue
    }
    if (arg === '--text') {
      options.text = argv[index + 1] || ''
      index += 1
      continue
    }
    if (arg === '--stdin') {
      options.stdin = true
      continue
    }
    if (arg === '--no-speak') {
      options.noSpeak = true
      continue
    }
    if (arg === '-h' || arg === '--help') {
      printUsage(0)
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  return options
}

function isMainModule() {
  if (!process.argv[1]) return false
  return import.meta.url === pathToFileURL(resolve(process.argv[1])).href
}

function parseJsonIfPossible(text) {
  const normalized = trimString(text)
  if (!normalized) return null
  if (!/^[\[{]/.test(normalized)) return null
  try {
    return JSON.parse(normalized)
  } catch {
    return null
  }
}

function normalizeMultilineText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .trim()
}

function normalizeIngressEvent(value, defaults = {}) {
  let normalized = value
  if (typeof normalized === 'string') {
    const parsed = parseJsonIfPossible(normalized)
    normalized = parsed || { transcript: normalized }
  }
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    return null
  }
  const eventId = trimString(normalized.eventId || normalized.id) || `voice-${randomUUID()}`
  const transcript = normalizeMultilineText(normalized.transcript || normalized.text)
  const audioPath = resolveHomePath(normalized.audioPath)
  const metadata = normalized.metadata && typeof normalized.metadata === 'object' && !Array.isArray(normalized.metadata)
    ? normalized.metadata
    : {}
  return {
    eventId,
    detectedAt: trimString(normalized.detectedAt || normalized.timestamp) || nowIso(),
    wakeWord: trimString(normalized.wakeWord || normalized.keyword || defaults.wakeWord),
    transcript,
    audioPath,
    connectorId: trimString(normalized.connectorId || normalized.deviceId || defaults.connectorId),
    roomName: trimString(normalized.roomName || normalized.room || defaults.roomName),
    source: trimString(normalized.source || defaults.source || 'voice'),
    metadata,
  }
}

function buildProcessEnv(runtime, summary, extra = {}) {
  return {
    MELODYSYNC_VOICE_CONNECTOR_ID: trimString(summary?.connectorId || runtime.config.connectorId),
    MELODYSYNC_VOICE_ROOM_NAME: trimString(summary?.roomName || runtime.config.roomName),
    MELODYSYNC_VOICE_WAKE_WORD: trimString(summary?.wakeWord || runtime.config.wake.keyword),
    MELODYSYNC_VOICE_EVENT_ID: trimString(summary?.eventId),
    MELODYSYNC_VOICE_DETECTED_AT: trimString(summary?.detectedAt),
    MELODYSYNC_VOICE_AUDIO_PATH: trimString(summary?.audioPath),
    MELODYSYNC_VOICE_TRANSCRIPT: trimString(summary?.transcript),
    MELODYSYNC_VOICE_REPLY_TEXT: trimString(extra.replyText),
    MELODYSYNC_VOICE_METADATA_JSON: JSON.stringify(summary?.metadata || {}),
    ...Object.fromEntries(Object.entries(extra).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => [key, String(value)])),
  }
}

async function appendJsonLine(pathname, payload) {
  await mkdir(dirname(pathname), { recursive: true })
  await appendFile(pathname, `${JSON.stringify(payload)}\n`, 'utf8')
}

function createRuntimeContext(config, storagePaths = null) {
  return {
    config,
    storagePaths: storagePaths || {
      eventsLogPath: join(config.storageDir, 'events.jsonl'),
    },
    authToken: '',
    authCookie: '',
    processing: false,
    queue: Promise.resolve(),
    wakeProcess: null,
    activeSpeechChild: null,
    shuttingDown: false,
    readOwnerToken,
    loginWithToken,
  }
}

async function logConnectorEvent(runtime, type, payload = {}) {
  await appendJsonLine(runtime.storagePaths.eventsLogPath, {
    ts: nowIso(),
    type,
    connectorId: runtime.config.connectorId,
    roomName: runtime.config.roomName,
    ...payload,
  })
}

async function captureAudio(runtime, summary) {
  if (!runtime.config.capture.command) {
    return {
      audioPath: trimString(summary.audioPath),
      transcript: '',
    }
  }
  const result = await runShellCommand(runtime.config.capture.command, {
    env: {
      ...runtime.config.wake.env,
      ...runtime.config.capture.env,
      ...buildProcessEnv(runtime, summary),
    },
    timeoutMs: runtime.config.capture.timeoutMs,
  })
  const payload = parseCommandPayload(result.stdout)
  if (payload) {
    return {
      audioPath: resolveHomePath(payload.audioPath),
      transcript: normalizeMultilineText(payload.transcript || payload.text),
    }
  }
  return {
    audioPath: resolveHomePath(result.stdout),
    transcript: '',
  }
}

async function transcribeAudio(runtime, audioPath, summary) {
  if (!trimString(audioPath)) return ''
  if (!runtime.config.stt.command) {
    throw new Error('stt.command is required when no transcript is provided by the wake/capture pipeline')
  }
  const result = await runShellCommand(runtime.config.stt.command, {
    env: {
      ...runtime.config.stt.env,
      ...buildProcessEnv(runtime, { ...summary, audioPath }),
    },
    timeoutMs: runtime.config.stt.timeoutMs,
  })
  const payload = parseCommandPayload(result.stdout)
  if (payload) {
    return normalizeMultilineText(payload.transcript || payload.text)
  }
  return normalizeMultilineText(result.stdout)
}

async function captureWithRetry(runtime, summary) {
  let lastError
  for (let attempt = 1; attempt <= MAX_CAPTURE_ATTEMPTS; attempt += 1) {
    try {
      if (attempt > 1) {
        await logConnectorEvent(runtime, 'capture_retry', {
          eventId: summary.eventId,
          attempt,
        })
      }
      return await captureAudio(runtime, summary)
    } catch (error) {
      lastError = error
      const errorMessage = trimString(error?.message || String(error || ''))
      await logConnectorEvent(runtime, 'capture_failed', {
        eventId: summary.eventId,
        attempt,
        error: errorMessage,
      })
      if (!isRecoverableCaptureError(error) || attempt === MAX_CAPTURE_ATTEMPTS) {
        throw error
      }
    }
  }
  throw lastError || new Error('capture failed')
}

async function transcribeWithRetry(runtime, audioPath, summary) {
  let lastError
  for (let attempt = 1; attempt <= MAX_STT_ATTEMPTS; attempt += 1) {
    try {
      if (attempt > 1) {
        await logConnectorEvent(runtime, 'stt_retry', {
          eventId: summary.eventId,
          attempt,
          audioPath,
        })
      }
      return await transcribeAudio(runtime, audioPath, summary)
    } catch (error) {
      lastError = error
      const errorMessage = trimString(error?.message || String(error || ''))
      await logConnectorEvent(runtime, 'transcription_failed', {
        eventId: summary.eventId,
        audioPath,
        attempt,
        error: errorMessage,
      })
      if (!isRecoverableCaptureError(error) || attempt === MAX_STT_ATTEMPTS) {
        throw error
      }
    }
  }
  throw lastError || new Error('transcription failed')
}

async function resolveTranscript(runtime, summary) {
  const directTranscript = normalizeMultilineText(summary.transcript)
  if (directTranscript) {
    await logConnectorEvent(runtime, 'transcript_ready_stage', {
      eventId: summary.eventId,
      stage: 'wake_transcript',
      transcriptSource: 'wake',
    })
    return {
      transcript: directTranscript,
      audioPath: trimString(summary.audioPath),
    }
  }

  let audioPath = trimString(summary.audioPath)
  let transcript = ''

  const shouldCapture = Boolean(runtime.config.capture.command) && !isCaptureExplicitlyOptional(summary)
  if (!audioPath && !shouldCapture) {
    await logConnectorEvent(runtime, 'transcript_ready_stage', {
      eventId: summary.eventId,
      stage: 'empty_input',
      captureNeeded: isCaptureNeeded(summary),
      hasAudioPath: false,
    })
    return {
      transcript: '',
      audioPath: '',
    }
  }

  if (shouldCapture) {
    try {
      const captured = await captureWithRetry(runtime, summary)
      audioPath = trimString(captured.audioPath || audioPath)
      transcript = normalizeMultilineText(captured.transcript)
      await logConnectorEvent(runtime, 'transcript_ready_stage', {
        eventId: summary.eventId,
        stage: 'capture_complete',
        audioPath,
        transcriptPresent: Boolean(transcript),
      })
    } catch (error) {
      if (!isRecoverableCaptureError(error)) {
        throw error
      }
      await logConnectorEvent(runtime, 'transcript_ready_stage', {
        eventId: summary.eventId,
        stage: 'capture_gave_up',
        reason: 'recoverable',
      })
      return {
        transcript: '',
        audioPath: audioPath || '',
      }
    }
  }

  if (!transcript && audioPath) {
    try {
      transcript = await transcribeWithRetry(runtime, audioPath, summary)
    } catch (error) {
      await logConnectorEvent(runtime, 'transcript_ready_stage', {
        eventId: summary.eventId,
        stage: 'transcription_gave_up',
        reason: isRecoverableCaptureError(error) ? 'recoverable' : 'fatal',
        audioPath,
      })
      if (!isRecoverableCaptureError(error)) {
        throw error
      }
      transcript = ''
    }
  }

  return {
    transcript,
    audioPath,
  }
}

async function speakReply(runtime, replyText, summary) {
  if (!runtime.config.tts.enabled || !trimString(replyText)) return
  if (runtime.config.tts.mode === 'say') {
    await runSay(replyText, runtime.config.tts, {
      allowInterrupt: true,
      onSpawn: (child) => trackActiveSpeech(runtime, child),
    })
    return
  }
  if (runtime.config.tts.mode === 'command') {
    await runShellCommand(runtime.config.tts.command, {
      env: {
        ...runtime.config.tts.env,
        ...buildProcessEnv(runtime, summary, { replyText }),
      },
      stdin: replyText,
      timeoutMs: runtime.config.tts.timeoutMs,
    })
  }
}

async function processVoiceTurn(runtime, rawSummary, options = {}) {
  const summary = normalizeIngressEvent(rawSummary, {
    connectorId: runtime.config.connectorId,
    roomName: runtime.config.roomName,
    wakeWord: runtime.config.wake.keyword,
  })
  if (!summary) {
    return {
      ignored: true,
      reason: 'invalid_event',
    }
  }

  await logConnectorEvent(runtime, 'wake_detected', {
    eventId: summary.eventId,
    wakeWord: summary.wakeWord,
    transcriptPresent: Boolean(summary.transcript),
    audioPath: summary.audioPath,
  })

  try {
    const resolvedInput = await resolveTranscript(runtime, summary)
    const transcript = normalizeMultilineText(resolvedInput.transcript)
    if (!transcript) {
      await logConnectorEvent(runtime, 'empty_transcript', {
        eventId: summary.eventId,
      })
      return {
        eventId: summary.eventId,
        silent: true,
        reason: 'empty_transcript',
      }
    }

    const turn = {
      ...summary,
      transcript,
      audioPath: resolvedInput.audioPath,
    }

    await logConnectorEvent(runtime, 'transcript_ready', {
      eventId: turn.eventId,
      transcript,
      audioPath: turn.audioPath,
    })
    const replyPromise = generateMelodySyncReply(runtime, turn)
    try {
      await playTranscriptAck(runtime, turn)
    } catch (error) {
      console.warn('[voice-connector] transcript ack failed:', error?.message || error)
    }
    const reply = await replyPromise
    await logConnectorEvent(runtime, 'reply_ready', {
      eventId: turn.eventId,
      sessionId: reply.sessionId,
      runId: reply.runId,
      requestId: reply.requestId,
      silent: reply.silent,
      replyText: reply.replyText,
    })

    if (!options.noSpeak && reply.replyText) {
      await speakReply(runtime, reply.replyText, turn)
    }

    return {
      ...reply,
      eventId: turn.eventId,
      transcript,
      audioPath: turn.audioPath,
    }
  } catch (error) {
    await logConnectorEvent(runtime, 'turn_failed', {
      eventId: summary.eventId,
      error: error?.stack || error?.message || String(error),
    })
    if (!options.noSpeak && trimString(runtime.config.errorSpeech)) {
      try {
        await speakReply(runtime, runtime.config.errorSpeech, summary)
      } catch {}
    }
    throw error
  }
}

function enqueueVoiceTurn(runtime, rawSummary, options = {}) {
  const preview = normalizeIngressEvent(rawSummary, {
    connectorId: runtime.config.connectorId,
    roomName: runtime.config.roomName,
    wakeWord: runtime.config.wake.keyword,
  })
  if (!preview) {
    return Promise.resolve({ ignored: true, reason: 'invalid_event' })
  }

  if (runtime.config.queueMode === 'ignore' && runtime.processing) {
    return logConnectorEvent(runtime, 'wake_ignored_busy', {
      eventId: preview.eventId,
      transcriptPresent: Boolean(preview.transcript),
    }).then(() => ({ ignored: true, reason: 'busy' }))
  }

  const run = async () => {
    runtime.processing = true
    try {
      return await processVoiceTurn(runtime, preview, options)
    } finally {
      runtime.processing = false
    }
  }

  const queued = runtime.queue
    .catch(() => {})
    .then(run)

  runtime.queue = queued.catch(() => {})
  return queued
}

async function runStdinLoop(runtime, options = {}) {
  console.log('[voice-connector] stdin mode ready; send one transcript per line')
  const reader = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  })

  for await (const line of reader) {
    const transcript = normalizeMultilineText(line)
    if (!transcript) continue
    cancelActiveSpeech(runtime, 'stdin_input')
    try {
      const result = await enqueueVoiceTurn(runtime, {
        source: 'stdin',
        transcript,
      }, options)
      if (result.replyText) {
        console.log(`[voice-connector] reply: ${result.replyText}`)
      }
    } catch (error) {
      console.error('[voice-connector] turn failed:', error?.stack || error?.message || error)
    }
  }

  await runtime.queue.catch(() => {})
}

async function runWakeLoop(runtime, options = {}) {
  const command = runtime.config.wake.command
  const child = spawn('bash', ['-lc', command], {
    env: {
      ...process.env,
      ...runtime.config.wake.env,
      MELODYSYNC_VOICE_CONNECTOR_ID: runtime.config.connectorId,
      MELODYSYNC_VOICE_ROOM_NAME: runtime.config.roomName,
      MELODYSYNC_VOICE_WAKE_WORD: runtime.config.wake.keyword,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  runtime.wakeProcess = child
  const stderrReader = createInterface({ input: child.stderr, crlfDelay: Infinity })
  const stdoutReader = createInterface({ input: child.stdout, crlfDelay: Infinity })

  const stderrTask = (async () => {
    for await (const line of stderrReader) {
      const normalized = trimString(line)
      if (!normalized) continue
      console.error(`[voice-connector:wake] ${normalized}`)
    }
  })()

  for await (const line of stdoutReader) {
    const normalized = trimString(line)
    if (!normalized) continue
    cancelActiveSpeech(runtime, 'wake_detected')
    try {
      const result = await enqueueVoiceTurn(runtime, normalized, options)
      if (result.replyText) {
        console.log(`[voice-connector] reply: ${result.replyText}`)
      }
    } catch (error) {
      console.error('[voice-connector] turn failed:', error?.stack || error?.message || error)
    }
  }

  await stderrTask.catch(() => {})
  const exitCode = await new Promise((resolvePromise) => {
    child.on('close', (code) => resolvePromise(code))
  })
  runtime.wakeProcess = null
  if (!runtime.shuttingDown && exitCode !== 0) {
    throw new Error(`wake command exited with code ${exitCode}`)
  }
}

function installSignalHandlers(runtime) {
  let closing = false
  const handleSignal = (signal) => {
    if (closing) return
    closing = true
    runtime.shuttingDown = true
    console.log(`[voice-connector] shutting down (${signal})`)
    if (runtime.wakeProcess) {
      runtime.wakeProcess.kill('SIGTERM')
    }
    Promise.resolve(runtime.queue)
      .catch(() => {})
      .finally(() => {
        process.exit(0)
      })
  }
  process.on('SIGINT', () => handleSignal('SIGINT'))
  process.on('SIGTERM', () => handleSignal('SIGTERM'))
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const config = await loadConfig(options.configPath)
  const runtime = createRuntimeContext(config)
  installSignalHandlers(runtime)

  console.log(`[voice-connector] MelodySync base URL: ${config.chatBaseUrl}`)
  console.log(`[voice-connector] connector id: ${config.connectorId}`)
  console.log(`[voice-connector] room: ${config.roomName || '(unspecified)'}`)
  console.log(`[voice-connector] wake mode: ${config.wake.mode}`)
  console.log(`[voice-connector] session tool: ${config.sessionTool}`)
  console.log(`[voice-connector] events log: ${runtime.storagePaths.eventsLogPath}`)

  if (trimString(options.text)) {
    const result = await enqueueVoiceTurn(runtime, {
      source: 'cli_text',
      transcript: options.text,
    }, options)
    if (result.replyText) {
      console.log(result.replyText)
    }
    return
  }

  if (options.stdin || config.wake.mode === 'stdin') {
    await runStdinLoop(runtime, options)
    return
  }

  await runWakeLoop(runtime, options)
}

export {
  DEFAULT_APP_ID,
  DEFAULT_APP_NAME,
  DEFAULT_SESSION_SYSTEM_PROMPT,
  buildExternalTriggerId,
  buildMelodySyncMessage,
  createRuntimeContext,
  enqueueVoiceTurn,
  ensureAuthCookie,
  generateMelodySyncReply,
  loadConfig,
  normalizeConfig,
  normalizeIngressEvent,
  normalizeSpokenReplyText,
  processVoiceTurn,
  speakReply,
}

if (isMainModule()) {
  main().catch((error) => {
    console.error('[voice-connector] failed to start:', error?.stack || error?.message || error)
    process.exit(1)
  })
}
