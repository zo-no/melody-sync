import { readGeneralSettings } from '../settings/general-store.mjs';
import {
  ensureDir,
  pathExists,
  writeTextAtomic,
} from '../fs-utils.mjs';
import { workbenchQueue } from './queues.mjs';
import {
  createCaptureItemRecord,
  createNodeRecord,
  createProjectRecord,
  createProjectSummaryRecord,
  promoteCaptureItemRecord,
  writeProjectRecordToObsidian,
} from './project-records.mjs';
import {
  loadWorkbenchState as loadState,
  saveWorkbenchState as saveState,
} from './state-store.mjs';

async function getDefaultObsidianPath() {
  const settings = await readGeneralSettings();
  return settings?.brainRoot || settings?.appRoot || '';
}

export async function createCaptureItem(payload = {}) {
  return createCaptureItemRecord({ queue: workbenchQueue, loadState, saveState }, payload);
}

export async function createProject(payload = {}) {
  return createProjectRecord({
    queue: workbenchQueue,
    loadState,
    saveState,
    pathExists,
    getDefaultObsidianPath,
  }, payload);
}

export async function createNode(payload = {}) {
  return createNodeRecord({ queue: workbenchQueue, loadState, saveState }, payload);
}

export async function promoteCaptureItem(captureId, payload = {}) {
  return promoteCaptureItemRecord(
    { queue: workbenchQueue, loadState, saveState },
    captureId,
    payload,
  );
}

export async function createProjectSummary(projectId) {
  return createProjectSummaryRecord({ queue: workbenchQueue, loadState, saveState }, projectId);
}

export async function writeProjectToObsidian(projectId, payload = {}) {
  return writeProjectRecordToObsidian({
    queue: workbenchQueue,
    loadState,
    saveState,
    pathExists,
    ensureDir,
    writeTextAtomic,
    getDefaultObsidianPath,
  }, projectId, payload);
}
