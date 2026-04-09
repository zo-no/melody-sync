import {
  getWorkbenchSnapshot,
  getWorkbenchTrackerSnapshot,
} from '../../workbench/continuity-store.mjs';
import { getWorkbenchOutputMetrics } from '../../workbench/output-metrics-service.mjs';

export async function getWorkbenchSnapshotForRead() {
  return getWorkbenchSnapshot();
}

export async function getWorkbenchTrackerSnapshotForRead(sessionId) {
  return getWorkbenchTrackerSnapshot(sessionId);
}

export async function getWorkbenchOutputMetricsForRead() {
  return getWorkbenchOutputMetrics();
}
