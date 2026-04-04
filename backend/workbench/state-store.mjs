import {
  WORKBENCH_BRANCH_CONTEXTS_FILE,
  WORKBENCH_CAPTURE_ITEMS_FILE,
  WORKBENCH_NODES_FILE,
  WORKBENCH_PROJECTS_FILE,
  WORKBENCH_SKILLS_FILE,
  WORKBENCH_SUMMARIES_FILE,
} from '../../lib/config.mjs';
import { readJson, writeJsonAtomic } from '../fs-utils.mjs';
import { persistTaskMapPlans, readTaskMapPlans } from './task-map-plans.mjs';

async function loadArrayStore(filePath) {
  const data = await readJson(filePath, []);
  return Array.isArray(data) ? data : [];
}

export async function loadWorkbenchState() {
  const [captureItems, projects, nodes, branchContexts, taskMapPlans, skills, summaries] = await Promise.all([
    loadArrayStore(WORKBENCH_CAPTURE_ITEMS_FILE),
    loadArrayStore(WORKBENCH_PROJECTS_FILE),
    loadArrayStore(WORKBENCH_NODES_FILE),
    loadArrayStore(WORKBENCH_BRANCH_CONTEXTS_FILE),
    readTaskMapPlans(),
    loadArrayStore(WORKBENCH_SKILLS_FILE),
    loadArrayStore(WORKBENCH_SUMMARIES_FILE),
  ]);
  return {
    captureItems,
    projects,
    nodes,
    branchContexts,
    taskMapPlans,
    skills,
    summaries,
  };
}

export async function saveWorkbenchState(state) {
  await Promise.all([
    writeJsonAtomic(WORKBENCH_CAPTURE_ITEMS_FILE, state.captureItems || []),
    writeJsonAtomic(WORKBENCH_PROJECTS_FILE, state.projects || []),
    writeJsonAtomic(WORKBENCH_NODES_FILE, state.nodes || []),
    writeJsonAtomic(WORKBENCH_BRANCH_CONTEXTS_FILE, state.branchContexts || []),
    persistTaskMapPlans(state.taskMapPlans || []),
    writeJsonAtomic(WORKBENCH_SKILLS_FILE, state.skills || []),
    writeJsonAtomic(WORKBENCH_SUMMARIES_FILE, state.summaries || []),
  ]);
}
