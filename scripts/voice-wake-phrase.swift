#!/usr/bin/env swift

import Foundation
import AVFoundation
import Speech

struct Options {
    let phrase: String
    let localeId: String
    let cooldownMs: Int
    let restartDelayMs: Int
    let trailingDebounceMs: Int
    let onDevice: Bool
    let allowServerFallback: Bool
    let connectorId: String
    let roomName: String
    let ackSoundPath: String
}

struct WakeMetadata: Codable {
    let rawTranscript: String
    let locale: String
    let captureNeeded: Bool
    let recognitionMode: String
}

struct WakeEvent: Codable {
    let eventId: String
    let wakeWord: String
    let transcript: String
    let detectedAt: String
    let connectorId: String
    let roomName: String
    let source: String
    let metadata: WakeMetadata
}

func usage() -> Never {
    fputs("Usage: voice-wake-phrase.swift [--phrase <text>] [--locale <id>] [--cooldown-ms <ms>] [--restart-delay-ms <ms>] [--trailing-debounce-ms <ms>] [--on-device <true|false>] [--allow-server-fallback <true|false>] [--ack-sound-path <path>] [--test-trigger] [--test-transcript <text>] [--test-recognition-error <text>]\n", stderr)
    exit(1)
}

func trim(_ value: String) -> String {
    value.trimmingCharacters(in: .whitespacesAndNewlines)
}

func envString(_ key: String) -> String {
    trim(ProcessInfo.processInfo.environment[key] ?? "")
}

func parseBool(_ value: String?) -> Bool? {
    guard let value else { return nil }
    switch trim(value).lowercased() {
    case "1", "true", "yes", "on":
        return true
    case "0", "false", "no", "off":
        return false
    default:
        return nil
    }
}

func normalizeForMatch(_ value: String) -> String {
    trim(value)
        .lowercased()
        .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
}

func nowIso() -> String {
    ISO8601DateFormatter().string(from: Date())
}

func playAckSound(path: String) {
    let normalizedPath = trim(path)
    guard !normalizedPath.isEmpty else { return }

    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/afplay")
    process.arguments = [normalizedPath]
    do {
        try process.run()
        process.waitUntilExit()
        if process.terminationStatus != 0 {
            fputs("[voice-wake] ack sound failed with status \(process.terminationStatus) for \(normalizedPath)\n", stderr)
        }
    } catch {
        fputs("[voice-wake] ack sound failed: \(error.localizedDescription)\n", stderr)
    }
}

let edgeTrimCharacters = CharacterSet.whitespacesAndNewlines
    .union(.punctuationCharacters)
    .union(CharacterSet(charactersIn: "，。！？；：、“”‘’（）【】《》<>「」『』—-…"))

func trimEdgePunctuation(_ value: String) -> String {
    value.trimmingCharacters(in: edgeTrimCharacters)
}

func extractTrailingText(original: String, phrase: String) -> String {
    guard let range = original.range(of: phrase, options: [.caseInsensitive, .backwards]) else {
        return ""
    }
    let suffix = String(original[range.upperBound...])
    return trimEdgePunctuation(suffix)
}

func emitWakeEvent(phrase: String, transcript: String, localeId: String, connectorId: String, roomName: String, source: String, recognitionMode: String, ackSoundPath: String) {
    playAckSound(path: ackSoundPath)

    let payload = WakeEvent(
        eventId: "voice-\(UUID().uuidString.lowercased())",
        wakeWord: phrase,
        transcript: transcript,
        detectedAt: nowIso(),
        connectorId: connectorId,
        roomName: roomName,
        source: source,
        metadata: WakeMetadata(
            rawTranscript: phrase + (transcript.isEmpty ? "" : " \(transcript)"),
            locale: localeId,
            captureNeeded: transcript.isEmpty,
            recognitionMode: recognitionMode
        )
    )

    let encoder = JSONEncoder()
    do {
        let data = try encoder.encode(payload)
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
    } catch {
        fputs("[voice-wake] failed to encode wake event: \(error.localizedDescription)\n", stderr)
    }
}

func normalizeRecognitionError(_ value: String) -> String {
    trim(value).lowercased()
}

func isFatalRecognitionError(_ value: String) -> Bool {
    let normalized = normalizeRecognitionError(value)
    return normalized.contains("siri and dictation are disabled")
        || normalized.contains("speech recognition is not available")
        || normalized.contains("not authorized")
}

final class WakeListener {
    private let options: Options
    private let recognizer: SFSpeechRecognizer
    private let normalizedPhrase: String
    private var audioEngine = AVAudioEngine()
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var restartScheduled = false
    private var shuttingDown = false
    private var lastTriggerAt = Date.distantPast
    private var pendingWakeTranscript: String?
    private var pendingWakeUsingOnDevice = false
    private var pendingWakeWorkItem: DispatchWorkItem?

    init(options: Options, recognizer: SFSpeechRecognizer) {
        self.options = options
        self.recognizer = recognizer
        self.normalizedPhrase = normalizeForMatch(options.phrase)
    }

    func start() {
        fputs("[voice-wake] listening for \(options.phrase) (locale=\(options.localeId))\n", stderr)
        startRecognition()
    }

    func shutdown() {
        shuttingDown = true
        stopRecognition()
        CFRunLoopStop(CFRunLoopGetMain())
    }

    private func startRecognition() {
        guard !shuttingDown else { return }
        stopRecognition()

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true

        let usingOnDevice: Bool
        if options.onDevice && recognizer.supportsOnDeviceRecognition {
            request.requiresOnDeviceRecognition = true
            usingOnDevice = true
        } else if options.onDevice && !options.allowServerFallback {
            fputs("[voice-wake] on-device recognition is unavailable for locale \(options.localeId)\n", stderr)
            exit(5)
        } else {
            request.requiresOnDeviceRecognition = false
            usingOnDevice = false
            if options.onDevice {
                fputs("[voice-wake] on-device recognition unavailable; falling back for locale \(options.localeId)\n", stderr)
            }
        }

        recognitionRequest = request
        audioEngine = AVAudioEngine()

        let inputNode = audioEngine.inputNode
        let format = inputNode.outputFormat(forBus: 0)
        inputNode.removeTap(onBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.recognitionRequest?.append(buffer)
        }

        do {
            audioEngine.prepare()
            try audioEngine.start()
        } catch {
            fputs("[voice-wake] failed to start audio engine: \(error.localizedDescription)\n", stderr)
            scheduleRestart(afterMs: options.restartDelayMs)
            return
        }

        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let self else { return }

            if let result {
                let transcript = trim(result.bestTranscription.formattedString)
                if !transcript.isEmpty {
                    self.handleTranscript(transcript, isFinal: result.isFinal, usingOnDevice: usingOnDevice)
                }
                if result.isFinal {
                    if self.pendingWakeTranscript != nil {
                        self.emitPendingWakeIfNeeded()
                    } else {
                        self.scheduleRestart(afterMs: self.options.restartDelayMs)
                    }
                    return
                }
            }

            if let error {
                let message = trim(error.localizedDescription)
                if !message.isEmpty {
                    fputs("[voice-wake] recognition error: \(message)\n", stderr)
                }
                if isFatalRecognitionError(message) {
                    fputs("[voice-wake] voice wake requires macOS Siri / Dictation and speech recognition support to be enabled for this machine.\n", stderr)
                    self.shutdown()
                    return
                }
                self.scheduleRestart(afterMs: self.options.restartDelayMs)
            }
        }
    }

    private func handleTranscript(_ transcript: String, isFinal: Bool, usingOnDevice: Bool) {
        let normalizedTranscript = normalizeForMatch(transcript)
        guard normalizedTranscript.contains(normalizedPhrase) else { return }

        pendingWakeTranscript = transcript
        pendingWakeUsingOnDevice = usingOnDevice

        if isFinal {
            emitPendingWakeIfNeeded()
            return
        }

        schedulePendingWakeEmit(afterMs: options.trailingDebounceMs)
    }

    private func schedulePendingWakeEmit(afterMs: Int) {
        pendingWakeWorkItem?.cancel()

        let workItem = DispatchWorkItem { [weak self] in
            self?.emitPendingWakeIfNeeded()
        }
        pendingWakeWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(afterMs), execute: workItem)
    }

    private func clearPendingWake() {
        pendingWakeWorkItem?.cancel()
        pendingWakeWorkItem = nil
        pendingWakeTranscript = nil
        pendingWakeUsingOnDevice = false
    }

    private func emitPendingWakeIfNeeded() {
        guard !shuttingDown else { return }
        guard let transcript = pendingWakeTranscript else { return }

        let now = Date()
        guard now.timeIntervalSince(lastTriggerAt) * 1000 >= Double(options.cooldownMs) else {
            clearPendingWake()
            return
        }
        lastTriggerAt = now
        let usingOnDevice = pendingWakeUsingOnDevice
        clearPendingWake()

        let trailingText = extractTrailingText(original: transcript, phrase: options.phrase)
        playAckSound(path: options.ackSoundPath)
        let payload = WakeEvent(
            eventId: "voice-\(UUID().uuidString.lowercased())",
            wakeWord: options.phrase,
            transcript: trailingText,
            detectedAt: nowIso(),
            connectorId: options.connectorId,
            roomName: options.roomName,
            source: "macos_speech_wake",
            metadata: WakeMetadata(
                rawTranscript: transcript,
                locale: options.localeId,
                captureNeeded: trailingText.isEmpty,
                recognitionMode: usingOnDevice ? "on-device" : "fallback"
            )
        )

        let encoder = JSONEncoder()
        do {
            let data = try encoder.encode(payload)
            FileHandle.standardOutput.write(data)
            FileHandle.standardOutput.write(Data("\n".utf8))
        } catch {
            fputs("[voice-wake] failed to encode wake event: \(error.localizedDescription)\n", stderr)
        }

        scheduleRestart(afterMs: options.restartDelayMs)
    }

    private func stopRecognition() {
        clearPendingWake()
        recognitionTask?.cancel()
        recognitionTask = nil
        recognitionRequest?.endAudio()
        recognitionRequest = nil
        if audioEngine.isRunning {
            audioEngine.stop()
        }
        audioEngine.inputNode.removeTap(onBus: 0)
    }

    private func scheduleRestart(afterMs: Int) {
        guard !shuttingDown else { return }
        guard !restartScheduled else { return }
        restartScheduled = true
        stopRecognition()
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(afterMs)) { [weak self] in
            guard let self else { return }
            self.restartScheduled = false
            self.startRecognition()
        }
    }
}

func installSignalHandlers(onSignal: @escaping () -> Void) -> [DispatchSourceSignal] {
    signal(SIGINT, SIG_IGN)
    signal(SIGTERM, SIG_IGN)

    let sigintSource = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
    sigintSource.setEventHandler(handler: onSignal)
    sigintSource.resume()

    let sigtermSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
    sigtermSource.setEventHandler(handler: onSignal)
    sigtermSource.resume()

    return [sigintSource, sigtermSource]
}

var phrase = envString("MELODYSYNC_VOICE_WAKE_WORD")
var localeId = "en-US"
var cooldownMs = 3000
var restartDelayMs = 1200
var trailingDebounceMs = 650
var onDevice = true
var allowServerFallback = true
var connectorId = envString("MELODYSYNC_VOICE_CONNECTOR_ID")
var roomName = envString("MELODYSYNC_VOICE_ROOM_NAME")
var ackSoundPath = envString("MELODYSYNC_VOICE_WAKE_ACK_SOUND_PATH")
var testTrigger = false
var testTranscript = ""
var testRecognitionError = ""

var index = 1
while index < CommandLine.arguments.count {
    let arg = CommandLine.arguments[index]
    switch arg {
    case "--phrase":
        guard index + 1 < CommandLine.arguments.count else { usage() }
        phrase = trim(CommandLine.arguments[index + 1])
        index += 2
    case "--locale":
        guard index + 1 < CommandLine.arguments.count else { usage() }
        localeId = trim(CommandLine.arguments[index + 1])
        index += 2
    case "--cooldown-ms":
        guard index + 1 < CommandLine.arguments.count else { usage() }
        cooldownMs = Int(CommandLine.arguments[index + 1]) ?? cooldownMs
        index += 2
    case "--restart-delay-ms":
        guard index + 1 < CommandLine.arguments.count else { usage() }
        restartDelayMs = Int(CommandLine.arguments[index + 1]) ?? restartDelayMs
        index += 2
    case "--trailing-debounce-ms":
        guard index + 1 < CommandLine.arguments.count else { usage() }
        trailingDebounceMs = Int(CommandLine.arguments[index + 1]) ?? trailingDebounceMs
        index += 2
    case "--on-device":
        guard index + 1 < CommandLine.arguments.count else { usage() }
        onDevice = parseBool(CommandLine.arguments[index + 1]) ?? onDevice
        index += 2
    case "--allow-server-fallback":
        guard index + 1 < CommandLine.arguments.count else { usage() }
        allowServerFallback = parseBool(CommandLine.arguments[index + 1]) ?? allowServerFallback
        index += 2
    case "--ack-sound-path":
        guard index + 1 < CommandLine.arguments.count else { usage() }
        ackSoundPath = trim(CommandLine.arguments[index + 1])
        index += 2
    case "--test-trigger":
        testTrigger = true
        index += 1
    case "--test-transcript":
        guard index + 1 < CommandLine.arguments.count else { usage() }
        testTranscript = CommandLine.arguments[index + 1]
        index += 2
    case "--test-recognition-error":
        guard index + 1 < CommandLine.arguments.count else { usage() }
        testRecognitionError = CommandLine.arguments[index + 1]
        index += 2
    case "--help", "-h":
        usage()
    default:
        usage()
    }
}

if testTrigger {
    emitWakeEvent(
        phrase: phrase,
        transcript: "",
        localeId: localeId,
        connectorId: connectorId,
        roomName: roomName,
        source: "voice_wake_test",
        recognitionMode: "test",
        ackSoundPath: ackSoundPath
    )
    exit(0)
}

if !testTranscript.isEmpty {
    guard !phrase.isEmpty else {
        fputs("Missing wake phrase\n", stderr)
        exit(1)
    }
    FileHandle.standardOutput.write(Data("\(extractTrailingText(original: testTranscript, phrase: phrase))\n".utf8))
    exit(0)
}

if !testRecognitionError.isEmpty {
    FileHandle.standardOutput.write(Data("\(isFatalRecognitionError(testRecognitionError) ? "fatal" : "retry")\n".utf8))
    exit(0)
}

guard !phrase.isEmpty else {
    fputs("Missing wake phrase\n", stderr)
    exit(1)
}

let locale = Locale(identifier: localeId)
guard let recognizer = SFSpeechRecognizer(locale: locale) else {
    fputs("Speech recognizer unavailable for locale \(localeId)\n", stderr)
    exit(2)
}

let authGroup = DispatchGroup()
var speechAuthorized = false
var micAuthorized = false

authGroup.enter()
SFSpeechRecognizer.requestAuthorization { status in
    speechAuthorized = (status == .authorized)
    authGroup.leave()
}

authGroup.enter()
AVCaptureDevice.requestAccess(for: .audio) { granted in
    micAuthorized = granted
    authGroup.leave()
}

authGroup.wait()

guard speechAuthorized else {
    fputs("Speech recognition permission denied\n", stderr)
    exit(3)
}

guard micAuthorized else {
    fputs("Microphone permission denied\n", stderr)
    exit(4)
}

let options = Options(
    phrase: phrase,
    localeId: localeId,
    cooldownMs: cooldownMs,
    restartDelayMs: restartDelayMs,
    trailingDebounceMs: trailingDebounceMs,
    onDevice: onDevice,
    allowServerFallback: allowServerFallback,
    connectorId: connectorId,
    roomName: roomName,
    ackSoundPath: ackSoundPath
)

let listener = WakeListener(options: options, recognizer: recognizer)
let signalSources = installSignalHandlers {
    listener.shutdown()
}
listener.start()
withExtendedLifetime(signalSources) {
    RunLoop.main.run()
}
