import { spawn } from 'child_process';

import {
  CUSTOM_HOOKS_FILE,
  MELODYSYNC_APP_ROOT,
  OBSIDIAN_VAULT_DIR,
} from '../../../lib/config.mjs';
import { readJson } from '../../fs-utils.mjs';
import { createHookDefinition } from '../hook-contract.mjs';
import { registerHook } from './registry.mjs';

let customHooksRegistered = false;

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeShellHookSpec(spec = {}, index = 0) {
  const id = normalizeText(spec.id) || `custom.hook.${index + 1}`;
  const eventPattern = normalizeText(spec.eventPattern);
  const shellCommand = normalizeText(spec.shellCommand || spec.command);
  if (!eventPattern || !shellCommand) return null;
  return {
    id,
    eventPattern,
    label: normalizeText(spec.label) || id,
    description: normalizeText(spec.description),
    layer: normalizeText(spec.layer) || 'other',
    enabledByDefault: spec.enabledByDefault !== false,
    shellCommand,
    runInBackground: spec.runInBackground !== false,
    cwd: normalizeText(spec.cwd),
  };
}

async function readCustomHookSpecs() {
  const payload = await readJson(CUSTOM_HOOKS_FILE, []);
  const rawHooks = Array.isArray(payload)
    ? payload
    : (Array.isArray(payload?.hooks) ? payload.hooks : []);
  return rawHooks
    .map((spec, index) => normalizeShellHookSpec(spec, index))
    .filter(Boolean);
}

function buildHookEnv(ctx, spec) {
  const session = ctx?.session && typeof ctx.session === 'object' ? ctx.session : null;
  const manifest = ctx?.manifest && typeof ctx.manifest === 'object' ? ctx.manifest : null;
  return {
    ...process.env,
    MELODYSYNC_HOOK_ID: spec.id,
    MELODYSYNC_HOOK_EVENT: normalizeText(ctx?.event),
    MELODYSYNC_SESSION_ID: normalizeText(ctx?.sessionId || session?.id),
    MELODYSYNC_SESSION_LABEL: normalizeText(session?.label || session?.title),
    MELODYSYNC_RUN_ID: normalizeText(manifest?.id || manifest?.runId),
    MELODYSYNC_STORAGE_ROOT: normalizeText(OBSIDIAN_VAULT_DIR),
    MELODYSYNC_APP_ROOT: normalizeText(MELODYSYNC_APP_ROOT),
    MELODYSYNC_OBSIDIAN_PATH: normalizeText(OBSIDIAN_VAULT_DIR),
  };
}

function createShellHookRunner(spec) {
  return async function customShellHook(ctx = {}) {
    const env = buildHookEnv(ctx, spec);
    const cwd = spec.cwd || process.cwd();
    if (spec.runInBackground) {
      const child = spawn('/bin/sh', ['-lc', spec.shellCommand], {
        cwd,
        env,
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      return;
    }
    await new Promise((resolve, reject) => {
      const child = spawn('/bin/sh', ['-lc', spec.shellCommand], {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      child.stderr?.setEncoding?.('utf8');
      child.stderr?.on?.('data', (chunk) => {
        stderr += String(chunk || '');
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(stderr.trim() || `Custom hook exited with code ${code}`));
      });
    });
  };
}

export async function registerCustomHooks() {
  if (customHooksRegistered) return;
  customHooksRegistered = true;

  const specs = await readCustomHookSpecs();
  for (const spec of specs) {
    const definition = createHookDefinition({
      id: spec.id,
      eventPattern: spec.eventPattern,
      label: spec.label,
      description: spec.description,
      layer: spec.layer,
      builtIn: false,
      owner: 'custom-hooks',
      enabledByDefault: spec.enabledByDefault,
      sourceModule: CUSTOM_HOOKS_FILE,
    });
    registerHook(definition.eventPattern, createShellHookRunner(spec), {
      ...definition,
      enabled: definition.enabledByDefault !== false,
    });
  }
}
