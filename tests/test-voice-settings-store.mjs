#!/usr/bin/env node
import assert from 'assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const tempHome = mkdtempSync(join(tmpdir(), 'melodysync-voice-settings-store-'));
const brainRoot = join(tempHome, 'vault', '00-🤖agent');
const runtimeRoot = join(tempHome, '.melodysync', 'runtime');
const configDir = join(tempHome, '.config', 'melody-sync');

process.env.HOME = tempHome;
delete process.env.MELODYSYNC_CONFIG_DIR;
delete process.env.MELODYSYNC_MEMORY_DIR;
delete process.env.MELODYSYNC_INSTANCE_ROOT;
delete process.env.MELODYSYNC_OBSIDIAN_VAULT_DIR;
delete process.env.MELODYSYNC_OBSIDIAN_PATH;

mkdirSync(configDir, { recursive: true });
writeFileSync(join(configDir, 'general-settings.json'), JSON.stringify({
  brainRoot,
  runtimeRoot,
}, null, 2), 'utf8');

try {
  const { readVoiceSettings, persistVoiceSettings } = await import(
    pathToFileURL(join(repoRoot, 'backend/settings/voice-store.mjs')).href
  );

  const initial = await readVoiceSettings();
  assert.equal(initial.voiceRoot, join(runtimeRoot, 'voice'));
  assert.equal(initial.paths.configFile, join(runtimeRoot, 'voice', 'config.json'));
  assert.equal(initial.paths.runtimeLogFile, join(runtimeRoot, 'voice', 'logs', 'connector.log'));
  assert.equal(initial.config.connectorId, 'voice-main');
  assert.equal(initial.config.chatBaseUrl, 'http://127.0.0.1:7760');
  assert.equal(initial.config.sessionMode, 'stable');
  assert.equal(initial.simpleConfig.mode, 'wake');
  assert.equal(initial.status.running, false);

  const saved = await persistVoiceSettings({
    mode: 'passive',
    ttsEnabled: false,
  });

  assert.equal(saved.simpleConfig.mode, 'passive');
  assert.equal(saved.config.wake.mode, 'command');
  assert.equal(saved.config.wake.command, 'bash scripts/voice/voice-managed-passive.sh');
  assert.equal(saved.config.wake.keyword, '');
  assert.equal(saved.config.capture.command, '');
  assert.equal(saved.config.stt.command, '');
  assert.equal(saved.config.tts.enabled, false);
  assert.equal(saved.config.tts.mode, 'disabled');
  assert.equal(saved.commands.start, './scripts/voice/voice-connector-instance.sh start');

  const wakeSaved = await persistVoiceSettings({
    mode: 'wake',
    wakePhrase: '嘿 Melody',
    ttsEnabled: true,
  });
  assert.equal(wakeSaved.simpleConfig.mode, 'wake');
  assert.equal(wakeSaved.simpleConfig.wakePhrase, '嘿 Melody');
  assert.equal(wakeSaved.config.wake.command, 'bash scripts/voice/voice-managed-wake.sh');
  assert.equal(wakeSaved.config.wake.keyword, '嘿 Melody');
  assert.equal(wakeSaved.config.capture.command, 'bash scripts/voice/voice-managed-capture.sh');
  assert.equal(wakeSaved.config.stt.command, '');
  assert.equal(wakeSaved.config.tts.enabled, true);
  assert.equal(wakeSaved.config.tts.mode, 'say');

  console.log('test-voice-settings-store: ok');
} finally {
  rmSync(tempHome, { recursive: true, force: true });
}
