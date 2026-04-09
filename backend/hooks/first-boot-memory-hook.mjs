import { join } from 'path';

import { MEMORY_DIR } from '../../lib/config.mjs';
import { ensureDir, pathExists, writeTextAtomic } from '../fs-utils.mjs';

const BOOTSTRAP_MD = join(MEMORY_DIR, 'bootstrap.md');
const PROJECTS_MD = join(MEMORY_DIR, 'projects.md');
const SKILLS_MD = join(MEMORY_DIR, 'skills.md');
const MEMORY_README = join(MEMORY_DIR, 'README.md');
const AGENT_PROFILE_MD = join(MEMORY_DIR, 'agent-profile.md');
const CONTEXT_DIGEST_MD = join(MEMORY_DIR, 'context-digest.md');
const TASKS_DIR = join(MEMORY_DIR, 'tasks');
const WORKLOG_DIR = join(MEMORY_DIR, 'worklog');

function buildMemoryReadmeSeed() {
  return `# memory

这里是 MelodySync 在当前 Obsidian brain root 下的主长期记忆区。

本文件只定义 \`memory/\` 内部文件职责、默认读取顺序和写回规则；作用域边界、禁止区、顶层目录语义由 \`AGENTS.md\` 定义。

## 记忆分层

- Conversation memory：单次回复内的即时上下文，不落长期文件
- Session memory：当前任务/会话状态，主要对应 \`tasks/\` 与 MelodySync 自身 continuity
- User/workspace memory：当前 Obsidian \`memory/\` 下的长期记忆
- Shared system memory：repo 内可跨部署复用的通用规律

默认检索顺序：先 user/workspace memory，再 session memory，最后才回看原始历史或日志材料。

## 默认快速读取

1. \`AGENTS.md\`
2. \`memory/agent-profile.md\`
3. \`memory/context-digest.md\`
4. \`memory/bootstrap.md\`
5. 需要定位项目时再读 \`memory/projects.md\`、\`memory/skills.md\`
6. 任务范围明确后，再进入 \`memory/tasks/\` 或 \`memory/worklog/\`

## 文件职责

- \`agent-profile.md\`：单一 profile 文档，存放长期稳定偏好、协作边界、工作方式
- \`context-digest.md\`：最近仍有持续影响的轻量摘要
- \`bootstrap.md\`：启动索引和关键路径，不承载长期偏好
- \`projects.md\`：项目入口与触发词
- \`skills.md\`：可复用 workflow / SOP 索引
- \`tasks/\`：任务级记忆与 checkpoint
- \`worklog/\`：按时间组织的工作记录与原始时间线材料
- \`global.md\`：更深的本地长期说明，避免默认启动读取

其中 \`agent-profile.md\` 属于 profile memory；其余大多属于 collection memory，按文档集合持续补充和整理。

## 写回规则

- 先 capture，再 promote；只把 durable 内容提升出当前会话
- 先判断是否 durable，再写长期记忆
- 先 merge/update，后 append
- 归属不清时先不写
- \`tasks/\` 是 session memory，任务结束后应压缩、归档或关闭
`;
}

function buildBootstrapSeed() {
  return `# MelodySync Bootstrap

- 这是当前机器的最小启动索引，不是长期知识堆栈，也不承载稳定偏好。
- 这里只保留：关键目录、机器事实、需要优先读取的项目入口。
- 长期偏好进入 agent-profile.md，近期摘要进入 context-digest.md。
- 详细任务笔记请进入 tasks/，时间线记录进入 worklog/，项目指针请进入 projects.md。
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

function buildAgentProfileSeed() {
  return `# Agent Profile

- 这里记录长期稳定的用户偏好、协作边界和工作方式。
- 只保留慢变化信息；近期变化请写到 context-digest.md。
`;
}

function buildContextDigestSeed() {
  return `# Context Digest

- 这里记录最近一段时间仍会影响后续协作的轻量摘要。
- 保持可刷新、可覆盖，不要把完整过程堆进来。
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
  await ensureDir(WORKLOG_DIR);

  if (!await pathExists(MEMORY_README)) {
    await writeTextAtomic(MEMORY_README, buildMemoryReadmeSeed());
  }
  if (!await pathExists(AGENT_PROFILE_MD)) {
    await writeTextAtomic(AGENT_PROFILE_MD, buildAgentProfileSeed());
  }
  if (!await pathExists(CONTEXT_DIGEST_MD)) {
    await writeTextAtomic(CONTEXT_DIGEST_MD, buildContextDigestSeed());
  }

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
