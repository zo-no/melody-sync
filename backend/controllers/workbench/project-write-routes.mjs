import { buildWorkbenchSnapshotResponse } from '../../services/workbench/http-service.mjs';
import {
  createWorkbenchCaptureForWrite,
  createWorkbenchNodeForWrite,
  createWorkbenchProjectForWrite,
  createWorkbenchProjectSummaryForWrite,
  promoteWorkbenchCaptureForWrite,
  writeWorkbenchProjectToObsidianForWrite,
} from '../../services/workbench/write-service.mjs';

export async function handleWorkbenchProjectWriteRoutes({
  parts,
  payload,
  res,
  writeJson,
}) {
  if (parts.length === 3 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'captures') {
    const captureItem = await createWorkbenchCaptureForWrite(payload);
    writeJson(res, 201, await buildWorkbenchSnapshotResponse({
      captureItem,
    }));
    return true;
  }

  if (parts.length === 3 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'projects') {
    const project = await createWorkbenchProjectForWrite(payload);
    writeJson(res, 201, await buildWorkbenchSnapshotResponse({
      project,
    }));
    return true;
  }

  if (parts.length === 3 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'nodes') {
    const node = await createWorkbenchNodeForWrite(payload);
    writeJson(res, 201, await buildWorkbenchSnapshotResponse({
      node,
    }));
    return true;
  }

  if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'captures' && parts[4] === 'promote') {
    const captureId = parts[3];
    const outcome = await promoteWorkbenchCaptureForWrite(captureId, payload);
    writeJson(res, 201, await buildWorkbenchSnapshotResponse({
      ...outcome,
    }));
    return true;
  }

  if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'projects' && parts[4] === 'summaries') {
    const projectId = parts[3];
    const summary = await createWorkbenchProjectSummaryForWrite(projectId);
    writeJson(res, 201, await buildWorkbenchSnapshotResponse({
      summary,
    }));
    return true;
  }

  if (parts.length === 5 && parts[0] === 'api' && parts[1] === 'workbench' && parts[2] === 'projects' && parts[4] === 'writeback') {
    const projectId = parts[3];
    const outcome = await writeWorkbenchProjectToObsidianForWrite(projectId, payload);
    writeJson(res, 200, await buildWorkbenchSnapshotResponse({
      ...outcome,
    }));
    return true;
  }

  return false;
}
