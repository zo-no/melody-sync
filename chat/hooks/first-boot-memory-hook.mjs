import { join } from 'path';

import { MEMORY_DIR } from '../../lib/config.mjs';
import { ensureDir, pathExists, writeTextAtomic } from '../fs-utils.mjs';

const BOOTSTRAP_MD = join(MEMORY_DIR, 'bootstrap.md');
const PROJECTS_MD = join(MEMORY_DIR, 'projects.md');
const SKILLS_MD = join(MEMORY_DIR, 'skills.md');
const TASKS_DIR = join(MEMORY_DIR, 'tasks');

function buildBootstrapSeed() {
  return `# MelodySync Bootstrap

- 这是当前机器的最小启动索引，不是长期知识堆栈。
- 这里只保留：关键目录、协作默认值、需要优先读取的项目入口。
- 详细任务笔记请进入 tasks/，项目指针请进入 projects.md。
`;
}

function buildProjectsSeed() {
  return `# Project Pointers

- 把常用项目、仓库路径、短摘要记录在这里。
- 保持轻量；详细上下文应进入对应任务笔记或仓库文档。
`;
}

function buildSkillsSeed() {
  return `# Skills Index

- 在这里登记本机可复用的 workflow / SOP / skill 入口。
- 保持索引化，不要把完整细节都塞进启动层。
`;
}

export async function isFirstBootMemoryState() {
  const [hasBootstrap, hasProjects, hasSkills] = await Promise.all([
    pathExists(BOOTSTRAP_MD),
    pathExists(PROJECTS_MD),
    pathExists(SKILLS_MD),
  ]);
  return !hasBootstrap && !hasProjects && !hasSkills;
}

export async function firstBootMemoryHook() {
  await ensureDir(MEMORY_DIR);
  await ensureDir(TASKS_DIR);

  if (!await pathExists(BOOTSTRAP_MD)) {
    await writeTextAtomic(BOOTSTRAP_MD, buildBootstrapSeed());
  }
  if (!await pathExists(PROJECTS_MD)) {
    await writeTextAtomic(PROJECTS_MD, buildProjectsSeed());
  }
  if (!await pathExists(SKILLS_MD)) {
    await writeTextAtomic(SKILLS_MD, buildSkillsSeed());
  }
}

