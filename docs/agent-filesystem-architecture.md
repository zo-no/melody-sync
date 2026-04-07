# Agent Filesystem Architecture

状态：current

目的：把 MelodySync 当前“给 agent 看的文件系统”梳理成一张清晰的图，区分：

- 仓库内的代码与 contract
- 实例根里的运行态真值
- agent 可读写的 memory 工作区

这份文档不是未来方向稿，而是当前主线实现的文件系统真相。

---

## 1. 顶层分层

MelodySync 当前有三层文件系统：

### A. Repo filesystem

位置：

- `<repo-root>/`

职责：

- 存放代码、模板、静态资源、测试、文档
- 定义 agent 如何运行系统
- 定义 hooks / node / session list 等 contract

这层是**源码层**，不是运行态真值层。

### B. Instance filesystem

位置：

- `<instance-root>/`

职责：

- 存放当前这台实例的 config、chat history、runs、workbench state、hooks 设置
- 这是实例运行态 durable truth 的主目录

这层是**实例真值层**。

### C. Agent memory filesystem

位置：

- `<instance-root>/memory/`

职责：

- 给 agent 提供“长期但可编辑”的协作记忆入口
- 包括 bootstrap、projects、skills、tasks

这层是**agent 工作记忆层**，与 `config/` 下的 session/run 真值分开。

---

## 2. 当前 repo 目录结构

当前和 agent 最相关的源码目录：

```text
backend/
  hooks/         生命周期 hook contract、catalog、handler、settings store
  routes/        HTTP route
  workbench/     workbench / continuity / operation record projection
  ...            session manager、history、runs、prompt、runtime 等主流程

lib/
  config.mjs     实例根、config、memory 等路径定义

static/frontend/
  session-list/  任务列表 contract、排序 contract、model、UI
  workbench/     任务地图、tracker、操作记录、支线动作 UI
  ...            其余前端 bootstrap/session/composer/runtime 模块

templates/
  chat.html      owner-facing 主页面

docs/
  ...            当前对外和可共享架构文档

notes/current/
  ...            当前内部结构与演进文档

memory/
  system.md      repo-shared system memory
```

和 agent 文件系统直接相关的关键文件：

- `lib/config.mjs`
- `backend/system-prompt.mjs`
- `backend/hooks/first-boot-memory-hook.mjs`
- `backend/history.mjs`
- `backend/runs.mjs`
- `backend/session-meta-store.mjs`

---

## 3. Instance root 结构

当前实例根：

- `<instance-root>/`

当前已存在的主要目录：

```text
melody-sync-instance/
  config/
    api-logs/
    chat-history/
    chat-runs/
    provider-runtime-homes/
  memory/
    tasks/
```

### 3.1 `config/`

职责：

- 存放当前实例的运行态 durable truth

来自：

- `lib/config.mjs`

主要文件/目录：

- `auth.json`
- `tools.json`
- `auth-sessions.json`
- `chat-sessions.json`
- `hooks.json`
- `chat-history/`
- `chat-runs/`
- `images/`
- `file-assets/`
- `file-assets-cache/`
- `api-logs/`
- `workbench-*.json`
- `ui-runtime-selection.json`
- `provider-runtime-homes/`

其中最重要的几类：

#### `chat-sessions.json`

用途：

- session metadata 真值

包括：

- `name`
- `group`
- `workflowState`
- `workflowPriority`
- `taskCard`
- `followUpQueue`
- `archived`

这是任务列表和 session 主数据的真值层。

#### `chat-history/`

用途：

- 每个 session 的事件流

结构来自：

- `backend/history.mjs`

每个 session 目录下通常有：

- `meta.json`
- `context.json`
- `fork-context.json`
- `events/`
- `bodies/`

这层是会话事件 durable store，不应由 hooks 直接拥有真值。

#### `chat-runs/`

用途：

- 每个 detached run 的运行状态与 manifest

结构来自：

- `backend/runs.mjs`

每个 run 目录下至少有：

- `status.json`
- `manifest.json`

#### `hooks.json`

用途：

- hook 启停配置持久化

实现：

- `backend/hooks/hook-settings-store.mjs`

当前只持久化：

- `enabledById`

也就是说：

- hooks 现在已经支持 durable on/off
- 但还没有完整 manifest/config 模型

#### `workbench-*.json`

用途：

- workbench 持久化对象

当前包括：

- `workbench-capture-items.json`
- `workbench-projects.json`
- `workbench-nodes.json`
- `workbench-branch-contexts.json`
- `workbench-skills.json`
- `workbench-summaries.json`

这批文件是 workbench state 真值，不是 frontend task-map node 真值。

#### `provider-runtime-homes/`

用途：

- provider/runtime 的隔离 home 目录

当前已定义：

- `provider-runtime-homes/codex`

这是 runtime 隔离层，不应与 agent memory 混在一起。

---

## 4. Agent memory 结构

当前 memory 根：

- `<instance-root>/memory/`

由：

- `lib/config.mjs`
- `backend/system-prompt.mjs`
- `backend/hooks/first-boot-memory-hook.mjs`

共同定义。

### 当前目标结构

```text
memory/
  bootstrap.md
  projects.md
  skills.md
  tasks/
```

### 各自职责

#### `bootstrap.md`

最小启动索引。

只放：

- 关键目录
- 协作默认值
- 启动时必须知道的极少量指针

不该放：

- 大量任务细节
- 项目长文
- 冗长全局经验

#### `projects.md`

项目指针层。

用途：

- repo 路径
- 项目短摘要
- 触发词
- scope routing

它是路由目录，不是项目百科。

#### `skills.md`

本机可复用 workflow / SOP / skill 的索引层。

它应该是：

- index
- 指针

而不是把完整 skill 正文都塞进去。

#### `tasks/`

详细任务笔记目录。

用途：

- 只在任务 scope 已清楚后按需打开
- 记录具体任务的持续上下文

这一层比 `bootstrap.md` 更深，不应在 session 一开始整体加载。

### 当前判断

`memory/` 才是“给 agent 的文件系统主工作区”。

而 `config/chat-history`、`config/chat-runs`、`config/workbench-*.json` 是系统运行态真值，不应该被当作 agent 日常写作区。

---

## 5. Repo-shared memory

仓库内还有一层：

- `<repo-root>/memory/`

当前主要是：

- `system.md`

这层来自：

- `SYSTEM_MEMORY_DIR`

职责：

- 跨实例共享的系统级经验
- 平台级 learnings

这层和 instance memory 的区别是：

- `instance memory`：这台机器、这个 owner、这个协作关系
- `repo memory/system.md`：所有 MelodySync 部署共享的系统经验

所以：

- `memory/system.md` 不应该在每次 session 启动时整体载入
- 只有在 shared platform learnings 真的相关时才按需读

---

## 6. Agent 文件系统应该怎么理解

对 agent 来说，最重要的是区分三类 surface：

### A. 可直接作为协作记忆读取/写入的

- `memory/bootstrap.md`
- `memory/projects.md`
- `memory/skills.md`
- `memory/tasks/`
- `memory/system.md`（按需）

### B. 可以通过系统 API / 主流程间接更新，但不应该手工当笔记系统写的

- `config/chat-sessions.json`
- `config/chat-history/`
- `config/chat-runs/`
- `config/workbench-*.json`
- `config/hooks.json`

### C. 运行时隔离目录，不应作为产品记忆面直接操作的

- `config/provider-runtime-homes/`
- `config/file-assets/`
- `config/file-assets-cache/`
- `config/images/`
- `config/api-logs/`

---

## 7. 当前主要问题

虽然结构已经能用，但还有几处不够干净：

### 7.1 公开命名和环境变量还有 legacy residue

例如：

- `MELODYSYNC_INSTANCE_ROOT`
- `MELODYSYNC_MEMORY_DIR`
- `legacyUserConfigDir`
- `legacyUserMemoryDir`

这意味着：

- MelodySync 的目录边界已经基本收口
- 环境变量与回退路径已经统一到 MelodySync 口径

### 7.2 agent memory 和 runtime truth 的边界还主要靠文档约束

现在系统已经区分了：

- `memory/`
- `config/chat-history/`
- `config/chat-runs/`

但很多地方仍然是“靠 prompt 告诉 agent 不要乱读/乱写”，而不是有更硬的 capability boundary。

### 7.3 hooks 还没有完整接入“agent 文件系统”这一层

当前只有：

- `instance.first_boot`
  - 初始化 `memory/bootstrap.md` / `projects.md` / `skills.md`

还没有：

- memory 写回策略的统一 hook 化
- task note writeback 的正式 contract

---

## 8. 当前最推荐的阅读顺序

如果后续开发者要理解“agent 文件系统”，我建议按这个顺序读：

1. `lib/config.mjs`
2. `backend/system-prompt.mjs`
3. `backend/hooks/first-boot-memory-hook.mjs`
4. `backend/history.mjs`
5. `backend/runs.mjs`
6. `docs/project-architecture.md`
7. `docs/hooks-node-architecture.md`
8. `notes/current/hooks-and-node-structure.md`

---

## 9. 当前结论

当前最重要的文件系统边界可以压成一句话：

> `memory/` 是给 agent 的协作记忆面。  
> `config/` 是实例运行真值面。  
> repo 里的 `memory/system.md` 是共享系统记忆面。

只要后续继续沿着这条边界推进：

- hooks 写生命周期事件和副作用
- node 只做 projection
- session/run/workbench 真值留在 `config/`
- agent 长期记忆留在 `memory/`

整个系统会越来越容易维护，也更容易让 AI 安全修改。
