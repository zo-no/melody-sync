# MelodySync 数据存储设计

> 本文档是 MelodySync 持久化层的权威设计参考。
> 描述每类数据存什么、怎么存、存在哪、保留多久，以及各层之间的边界规则。
>
> 关联文档：
> - `application-storage-architecture.md` — 存储价值模型与分类原则
> - `session-history-storage-layout.md` — Session history 物理布局目标
> - `task-system-design.md` — 任务系统数据结构

---

## 一、存储根目录体系

MelodySync 把数据分成三个根，职责严格分离：

```
~/.config/melody-sync/          ← 设备级配置根（machineConfigRoot）
~/.melodysync/                  ← 大脑根（brainRoot）
~/.melodysync/runtime/          ← 运行时根（runtimeRoot）
```

| 根 | 变量 | 职责 | 可否跨设备同步 |
|---|---|---|---|
| `machineConfigRoot` | `BOOTSTRAP_CONFIG_DIR` | 设备身份：auth、工具目录、运行时选择、push 订阅 | ❌ 设备私有 |
| `brainRoot` | `MELODYSYNC_BRAIN_ROOT` | 可迁移长期知识：AGENTS.md、memory/ | ✅ 可同步 |
| `runtimeRoot` | `MELODYSYNC_RUNTIME_ROOT` | 机器本地运行态：sessions、runs、logs、workbench | ❌ 机器本地 |

环境变量覆盖顺序（优先级从高到低）：

```
MELODYSYNC_INSTANCE_ROOT  → 完全隔离实例（覆盖所有三根）
MELODYSYNC_CONFIG_DIR     → 仅覆盖 machineConfigRoot
MELODYSYNC_MEMORY_DIR     → 仅覆盖 memory/ 目录
MELODYSYNC_RUNTIME_ROOT   → 仅覆盖 runtimeRoot
```

---

## 二、存储分类

所有写入必须归属以下五类之一，类别决定保留策略：

| 类别 | 定义 | 默认保留 |
|---|---|---|
| `canonical` | 用户可见的产品真相 | 永久，直到用户主动删除/归档 |
| `operational` | 完成或恢复进行中工作所需的状态 | 活跃期间保留；终止后有界保留 |
| `projection` | 可从 canonical 重建的派生视图 | 短期或按需重建 |
| `cache` | 可重新获取或重新计算的加速层 | 大小/TTL 有界 |
| `diagnostic` | 调试用的原始追踪和日志 | 严格 TTL + 大小上限 |

---

## 三、各数据域详细设计

### 3.1 设备配置（machineConfigRoot）

**路径：** `~/.config/melody-sync/`

**存储类别：** `canonical`

**存储内容：**

| 文件 | 内容 | 格式 |
|---|---|---|
| `auth.json` | owner 密码 hash / token | JSON |
| `auth-sessions.json` | 活跃登录会话列表 | JSON 数组 |
| `tools.json` | 工具目录（claude/codex 路径等） | JSON |
| `ui-runtime-selection.json` | 最近一次 UI 选择的 tool/model/effort | JSON |
| `vapid-keys.json` | Web Push VAPID 密钥对 | JSON |
| `push-subscriptions.json` | 浏览器 push 订阅端点列表 | JSON 数组 |
| `general-settings.json` | bootstrap 设置（brainRoot/runtimeRoot 指针） | JSON |

**写入规则：**
- 所有文件原子写入（先写临时文件，再 rename）
- `auth-sessions.json` 是唯一频繁写入的文件（登录/登出时）
- 这个目录应保持小巧可审查，严禁写入日志或运行态数据

---

### 3.2 大脑根（brainRoot）

**路径：** `~/.melodysync/`（或用户配置的 brainRoot）

**存储类别：** `canonical`

**存储内容：**

```
brainRoot/
  AGENTS.md                  ← 用户编辑的 agent 协作说明
  README.md                  ← 自动生成的目录说明
  memory/
    bootstrap.md             ← 启动记忆（首次 boot 写入）
    projects.md              ← 项目索引（AI 维护）
    skills.md                ← 人类技能摘要（每日清理写入）
    tasks/                   ← 任务级记忆文件（按项目/任务分目录）
    worklog/
      YYYY/MM/YYYY-MM-DD.jsonl  ← 任务操作日志（append-only，按日分文件）
```

**写入规则：**
- `AGENTS.md` 由用户直接编辑，AI 不覆盖
- `memory/*.md` 由 AI 在任务执行中维护，每次原子写入
- `worklog/` 是 append-only JSONL，每天一个文件，AI 每日清理任务读取
- `brainRoot` 可以放在 Obsidian vault 或 iCloud 同步目录里，但运行态数据绝对不能写进来

**worklog 事件格式：**

```json
{
  "ts": "2026-04-15T10:30:00.000Z",
  "event": "completed",
  "sessionId": "sess_abc123",
  "name": "整理本周任务",
  "kind": "recurring_task",
  "bucket": "long_term",
  "projectName": "MelodySync 系统管理",
  "createdAt": "2026-04-15T09:00:00.000Z",
  "conclusions": ["完成了 X", "发现了 Y"]
}
```

事件类型：`triggered` / `completed` / `failed` / `done` / `deleted` / `timeout` / `kind_changed` / `waiting_created`

**保留策略：** worklog 文件不自动删除（是用户的工作记录）；`memory/tasks/` 下的任务记忆文件由 AI 任务主动维护和清理。

---

### 3.3 Session 元数据（sessions.db）

**路径：** `runtimeRoot/sessions/sessions.db`

**存储类别：** `canonical`

**技术选型：** SQLite（WAL 模式），2026-04 从 chat-sessions.json 迁移

**Schema：**

```sql
CREATE TABLE sessions (
  id                   TEXT PRIMARY KEY NOT NULL,

  -- 快速查询列（从 data JSON 中提取，保持同步）
  task_list_origin     TEXT,            -- 'system' | null
  task_list_visibility TEXT,            -- 'primary' | null
  project_session_id   TEXT,            -- 归属项目的 session ID
  lt_role              TEXT,            -- 'project' | 'member'
  lt_bucket            TEXT,            -- 'long_term' | 'short_term' | 'waiting' | 'inbox' | 'skill'
  workflow_state       TEXT,            -- '' | 'parked' | 'waiting_user' | 'done'
  persistent_kind      TEXT,            -- 'recurring_task' | 'scheduled_task' | 'waiting_task' | 'skill'
  builtin_name         TEXT,            -- 内置任务名（如 'daily-tasks'）
  pinned               INTEGER DEFAULT 0,
  created_at           TEXT,
  updated_at           TEXT,
  source_id            TEXT,
  external_trigger_id  TEXT,

  -- 完整对象（JSON）
  data                 TEXT NOT NULL
) STRICT;
```

**索引：**
- `idx_sessions_list`：`(task_list_visibility, workflow_state, updated_at DESC)` — 侧边栏列表查询
- `idx_sessions_project`：`(project_session_id, lt_bucket)` — 项目内任务查询
- `idx_sessions_persistent`：`(persistent_kind, task_list_origin)` — 调度器扫描
- `idx_sessions_pinned`：`(pinned DESC, updated_at DESC)` — 置顶排序
- `idx_sessions_external_trigger`：`(external_trigger_id)` — 连接器路由

**Session 对象完整字段（见 `docs/data-structures.md` L1 章节获取完整定义和维护层标注）：**

```js
{
  // ── 身份（创建时写入，不变） ───────────────────────
  id: string,          // 'sess_' + hex，不可变
  created: ISO,        // 创建时间
  ordinal: number,     // 侧边栏全局排序序号
  builtinName?: string,

  // ── 用户可编辑展示字段 ─────────────────────────────
  name: string,
  autoRenamePending?: true,
  folder: string,      // 默认 '~'
  group?: string,
  description?: string,
  sidebarOrder?: number,
  pinned?: true,
  archived?: true,
  archivedAt?: ISO,
  lastReviewedAt?: ISO,
  activeAgreements?: string[],

  // ── 运行时偏好 ─────────────────────────────────────
  tool?: string,
  model?: string,
  effort?: string,
  thinking?: boolean,
  systemPrompt?: string,

  // ── 工作流状态 ─────────────────────────────────────
  workflowState?: '' | 'waiting_user' | 'done' | 'paused',
  workflowPriority?: 'high' | 'medium' | 'low',
  workflowCompletedAt?: ISO,
  suppressedBranchTitles?: string[],

  // ── Run 生命周期状态 ───────────────────────────────
  activeRunId?: string,
  followUpQueue?: FollowUpEntry[],
  recentFollowUpRequestIds?: string[],
  claudeSessionId?: string,
  codexThreadId?: string,
  compactionSessionId?: string,

  // ── 工作流监控信号 ─────────────────────────────────
  workflowSignals?: WorkflowSignals,

  // ── 任务结构子对象 ─────────────────────────────────
  taskCard?: TaskCard,
  taskCardManagedBindings?: string[],
  sessionState?: SessionState,
  persistent?: PersistentConfig,
  taskPoolMembership?: TaskPoolMembership,

  // ── 可见性分类 ─────────────────────────────────────
  taskListOrigin?: 'user' | 'assistant' | 'system',
  taskListVisibility?: 'primary' | 'secondary' | 'hidden',

  // ── Fork 血缘 ──────────────────────────────────────
  forkedFromSessionId?: string,
  forkedFromSeq?: number,
  rootSessionId?: string,

  // ── 来源元数据（连接器） ───────────────────────────
  sourceId?: string,
  sourceName?: string,
  externalTriggerId?: string,
  sourceContext?: object,
  completionTargets?: CompletionTarget[],

  // ── 系统内部字段 ───────────────────────────────────
  internalRole?: string,
  compactsSessionId?: string,

  // ── 时间戳 ─────────────────────────────────────────
  updatedAt: ISO,
}
```

**读写规则：**
- 所有写入必须通过 `withSessionsMetaMutation()` 或 `mutateSessionMeta()`，保证串行化
- 禁止直接操作 SQLite，必须走 `session-db.mjs` 导出的函数
- 每次写入后同步更新 `SESSIONS.md`（projection，可重建）
- `data` 列存完整 JSON 对象；查询列从 `data` 中提取并保持同步

**SESSIONS.md：**

```
runtimeRoot/sessions/SESSIONS.md
```

- 存储类别：`projection`
- 人类可读的 session 索引，由 `buildSessionsIndexMarkdown()` 生成
- 每次 sessions.db 写入后原子覆盖
- 可随时从 sessions.db 重建，删除不影响产品

---

### 3.4 Session 事件历史（history/）

**路径：** `runtimeRoot/sessions/history/<sessionId>/`

**存储类别：** `canonical`

**当前布局（已实现）：**

```
history/<sessionId>/
  meta.json              ← transcript 控制文件
  context.json           ← 最新 context head（prompt 构建用）
  fork-context.json      ← fork 时的 context 快照
  events/
    000000001.json       ← 每事件一文件（当前实现，待迁移）
  bodies/
    <ref>.txt            ← 外部化大 body（当前实现，待迁移）
```

**目标布局（设计中，见 session-history-storage-layout.md）：**

```
history/<sessionId>/
  meta.json
  context.json
  fork-context.json
  segments/
    000001.events.jsonl  ← 主 transcript 段（dense，append-only）
    000001.blobs.jsonl   ← 可选：外部化大 body（dense，append-only）
```

**meta.json 结构：**

```json
{
  "latestSeq": 128,
  "lastEventAt": "2026-04-15T10:30:00.000Z",
  "size": 128,
  "counts": {
    "message": 40,
    "tool_use": 30,
    "tool_result": 30,
    "reasoning": 20,
    "status": 8
  }
}
```

**事件对象字段：**

```js
{
  seq: number,           // 单调递增序号，从 1 开始
  timestamp: number,     // Unix ms
  type: 'message' | 'reasoning' | 'tool_use' | 'tool_result' | 'template_context' | 'status',
  role?: 'user' | 'assistant',

  // body 存储元数据
  bodyPersistence?: 'externalized' | 'preview_only',  // 磁盘存储模式
  bodyBytes?: number,    // 原始 body 字节数
  bodyRef?: string,      // 外部化时的 ref（指向 bodies/ 下的文件）
  bodyAvailable?: boolean,
  bodyLoaded?: boolean,
  bodyTruncated?: boolean,

  // 按 type 不同有不同的 body 字段
  content?: string,      // message / reasoning / template_context
  toolInput?: string,    // tool_use
  output?: string,       // tool_result
}
```

**body 存储决策规则（inline 上限）：**

| 事件类型 | inline 上限 | 超出后 |
|---|---|---|
| `message` | 64 KB | externalize |
| `reasoning` | 0（始终外部化或 preview_only） | externalize |
| `template_context` | 4 KB | externalize |
| `tool_use` | 2 KB | externalize |
| `tool_result` | 4 KB | externalize |

**preview 截断上限：**

| 事件类型 | preview 上限 |
|---|---|
| `message` | 1600 字符 |
| `reasoning` | 1600 字符 |
| `tool_use` | 800 字符 |
| `tool_result` | 1200 字符 |
| `status` | 800 字符 |

**写入规则：**
- 所有写入通过 `runSessionMutation(sessionId, ...)` 串行化（per-session 锁）
- 事件追加后必须更新 `meta.json`（原子写入）
- `context.json` 和 `fork-context.json` 独立写入，生命周期不同于 transcript

**读取规则：**
- 列表视图：读 meta + 尾部事件，body 字段留空（`bodyLoaded: false`）
- 详情视图：按需加载 body（通过 bodyRef 读 bodies/ 文件）
- prompt 构建：读 `context.json` 作为 context head

---

### 3.5 Run 状态（runs/）

**路径：** `runtimeRoot/sessions/runs/<runId>/`

**存储类别：** 控制面（`operational`）+ 捕获面（`diagnostic`）

**物理布局：**

```
runs/<runId>/
  status.json      ← 运行状态（operational）
  manifest.json    ← 运行参数快照（operational）
  result.json      ← 最终结果信封（operational）
  spool.jsonl      ← provider 原始输出流（diagnostic）
  artifacts/       ← 大 body 外部化文件（operational，finalize 后降级为 diagnostic）
    <ref>.txt
```

**status.json 字段：**

```js
{
  id: string,              // 'run_' + hex
  sessionId: string,
  requestId: string,       // 对应 session 中用户消息的 requestId

  state: 'accepted' | 'running' | 'completed' | 'failed' | 'cancelled',
  tool: string,
  model: string,
  effort?: string,
  thinking: boolean,

  createdAt: ISO,
  startedAt: ISO | null,
  updatedAt: ISO,
  completedAt: ISO | null,
  finalizedAt: ISO | null,  // 写入 canonical history 完成的时间
  lastNormalizedAt: ISO | null,

  cancelRequested: boolean,
  cancelRequestedAt: ISO | null,

  // provider 恢复 ID
  providerResumeId?: string,
  claudeSessionId?: string,
  codexThreadId?: string,

  // 进程 ID（用于 kill）
  runnerProcessId?: number,
  toolProcessId?: number,

  // spool 消费进度
  normalizedLineCount: number,
  normalizedByteOffset: number,
  normalizedEventCount: number,

  // token 统计
  contextInputTokens?: number,
  contextWindowTokens?: number,

  result?: string,          // 'success' | 'error' | 'cancelled'
  failureReason?: string,
}
```

**manifest.json 字段：**

```js
{
  id: string,
  sessionId: string,
  // 运行时快照：prompt、工具配置、上下文大小等
  // 用于调试和 resume，不是产品真相
}
```

**spool.jsonl：**

- provider 原始输出的逐行 JSON 记录
- 用于 finalize 时规范化为 canonical history events
- finalize 完成后即降级为 `diagnostic`（可按保留策略删除）
- 每行最大 2 MB（超出截断）

**生命周期：**

```
accepted → running → completed/failed/cancelled
                            ↓
                      finalize（写入 canonical history）
                            ↓
                      finalizedAt 写入 status.json
                            ↓
                      spool.jsonl + artifacts/ 降级为 diagnostic
                            ↓
                      超过保留期（默认 7 天）后清理
```

**保留策略：**

| 文件 | 保留策略 |
|---|---|
| `status.json` | finalize 后保留 7 天（默认），用于短期审计 |
| `manifest.json` | 同上 |
| `result.json` | 同上 |
| `spool.jsonl` | finalize 后保留 7 天，然后删除 |
| `artifacts/` | finalize 后保留 7 天，然后删除 |

清理由 `lib/storage-maintenance.mjs` 执行（CLI 命令 + 未来自动触发）。

---

### 3.6 文件资产（file-assets/）

**路径：** `runtimeRoot/sessions/file-assets/`

**存储类别：** `canonical`（被引用的）/ `cache`（未引用的临时上传）

**物理布局：**

```
sessions/
  images/              ← 图片上传（历史路径，新上传走 file-assets/）
  file-assets/         ← 所有文件资产的规范存储
    <assetId>/
      meta.json        ← 资产元数据（名称、类型、大小、上传时间）
      data             ← 文件内容
  file-assets-cache/   ← 缓存（纯 cache，可随时删除）
```

**资产元数据（meta.json）：**

```js
{
  id: string,
  name: string,
  mimeType: string,
  size: number,
  uploadedAt: ISO,
  sessionId?: string,   // 首次上传时关联的 session
  savedAt?: ISO,        // 用户主动"保存"后设置，保存的资产不 GC
}
```

**保留规则：**
- 被 session history 或 workbench 引用的资产：`canonical`，永久保留
- 用户主动 saved（`savedAt` 存在）：`canonical`，永久保留
- 未被引用且超过 7 天：GC 候选（待实现 reachability GC）
- `file-assets-cache/`：大小上限 + TTL，可随时删除

---

### 3.7 Workbench 状态

**路径：** `runtimeRoot/workbench/`

**存储类别：** `canonical`（用户工作流状态）

**文件清单：**

| 文件 | 内容 | 格式 |
|---|---|---|
| `projects.json` | 长期项目列表 | JSON 数组 |
| `nodes.json` | 任务图节点 | JSON 数组 |
| `branch-contexts.json` | 分支上下文快照 | JSON 数组 |
| `task-map-plans.json` | 任务地图计划（图 + 边） | JSON 数组 |
| `node-settings.json` | 节点级运行时偏好 | JSON 对象 |
| `capture-items.json` | 收集箱临时条目 | JSON 数组 |
| `summaries.json` | 项目摘要（AI 生成） | JSON 数组 |
| `skills.json` | 快捷按钮定义 | JSON 数组 |
| `memory-candidates.json` | AI 建议写入 memory 的候选 | JSON 数组 |

**写入规则：**
- 所有写入通过 `workbenchQueue()` 串行化（全局 workbench 写锁）
- 每次原子写入（临时文件 + rename）
- `summaries.json` 是 AI 生成的，可从项目数据重建，偏向 `projection`
- `memory-candidates.json` 是临时候选，AI 任务处理后清空

**task-map-plans 结构（关键）：**

```js
{
  id: string,
  rootSessionId: string,
  nodes: [{
    id: string,
    sessionId: string,
    sourceSessionId?: string,
    label: string,
    state: 'active' | 'done' | 'waiting' | 'failed',
    bucket?: string,
  }],
  edges: [{
    fromNodeId: string,
    toNodeId: string,
    kind: 'fork' | 'delegate' | 'merge',
  }],
  activeNodeId: string,
}
```

---

### 3.8 Hooks 配置

**路径：** `runtimeRoot/hooks/`

**存储类别：** `canonical`

| 文件 | 内容 |
|---|---|
| `settings.json` | 内置 hook 启停状态（`{ hookId: boolean }` 映射） |
| `custom-hooks.json` | 自定义 hook 定义数组 |

**自定义 hook 结构：**

```js
{
  id: string,             // 'custom.<name>'
  eventPattern: string,   // 'instance.startup' 等
  label: string,
  shellCommand: string,
  runInBackground?: boolean,
  enabled?: boolean,
}
```

---

### 3.9 设置文件

**路径：** `runtimeRoot/config/`

**存储类别：** `canonical`

| 文件 | 内容 |
|---|---|
| `general-settings.json` | 通用设置（brainRoot/runtimeRoot 指针、语言、主题等） |
| `provider-runtime-homes/` | provider 隔离沙箱目录（codex 等） |

**general-settings.json 关键字段：**

```js
{
  brainRoot: string,        // 大脑目录路径
  runtimeRoot: string,      // 运行时目录路径
  language?: string,
  theme?: string,
  // ... 其他用户偏好
}
```

---

### 3.10 Email / Voice 配置

**路径：** `runtimeRoot/email/` 和 `runtimeRoot/voice/`

**存储类别：** 配置 JSON 是 `canonical`；运行时 pid/log 是 `operational`/`diagnostic`

| 路径 | 内容 | 类别 |
|---|---|---|
| `email/config.json` | 邮箱身份、allowlist、自动化规则 | canonical |
| `voice/config.json` | 语音入口配置 | canonical |
| `voice/connector.pid` | 语音连接器进程 ID | operational |
| `voice/events.jsonl` | 语音事件日志 | diagnostic |
| `voice/logs/connector.log` | 语音连接器运行日志 | diagnostic |
| `voice/start-connector-terminal.sh` | 启动脚本 | canonical |

---

### 3.11 日志（logs/）

**路径：** `runtimeRoot/logs/`

**存储类别：** `diagnostic`

| 路径 | 内容 | 保留策略 |
|---|---|---|
| `logs/api/YYYY-MM-DD.jsonl` | HTTP API 请求日志（按日分文件） | 7 天（默认） |
| `logs/task-ops.jsonl` | 任务操作日志（单文件 append-only） | 无自动清理（待加轮转） |

**API 请求日志格式（每行）：**

```json
{
  "type": "api_request",
  "seq": 1042,
  "pid": 12345,
  "port": 7760,
  "ts": "2026-04-15T10:30:00.000Z",
  "method": "POST",
  "pathname": "/api/sessions/sess_abc/messages",
  "route": "POST /api/sessions/:sessionId/messages",
  "requestBytes": 512,
  "responseBytes": 128,
  "statusCode": 200,
  "durationMs": 42.5,
  "cacheHit": false
}
```

**task-ops.jsonl 格式（每行）：**

```json
{
  "ts": "2026-04-15T10:30:00.000Z",
  "sessionId": "sess_abc123",
  "op": "workflow_state",
  "from": "",
  "to": "done",
  "meta": { "trigger": "run_end" }
}
```

`op` 枚举：`archive` / `pin` / `rename` / `workflow_state` / `workflow_priority` / `bucket` / `project` / `task_card` / `run_start` / `run_end`

---

## 四、保留策略汇总

| 数据域 | 类别 | 保留策略 | 清理机制 |
|---|---|---|---|
| Session 元数据（sessions.db） | canonical | 永久，直到用户删除 | 用户主动删除 |
| SESSIONS.md | projection | 每次写 sessions.db 时重建 | 自动覆盖 |
| Session history events | canonical | 永久，直到 session 删除 | 随 session 删除 |
| Session history bodies | canonical | 永久，直到 session 删除 | 随 session 删除 |
| Run status/manifest/result | operational | finalize 后 7 天 | storage-maintenance |
| Run spool.jsonl | diagnostic | finalize 后 7 天 | storage-maintenance |
| Run artifacts/ | operational→diagnostic | finalize 后 7 天 | storage-maintenance |
| File assets（被引用） | canonical | 永久 | 用户主动删除 |
| File assets（未引用） | cache | 7 天后 GC（待实现） | reachability GC |
| file-assets-cache/ | cache | TTL + 大小上限（待实现） | 待实现 |
| Workbench 状态 | canonical | 永久，直到项目删除 | 随项目/session 删除 |
| Memory 文件 | canonical | 永久（AI 主动维护） | AI 任务维护 |
| Worklog JSONL | canonical | 永久（用户工作记录） | 无自动清理 |
| API 日志 | diagnostic | 7 天 | storage-maintenance |
| task-ops.jsonl | diagnostic | 无自动清理（待加轮转） | 待实现 |
| Provider sessions | diagnostic | 7 天 | storage-maintenance |
| Provider shell snapshots | diagnostic | 7 天 | storage-maintenance |
| Voice 事件日志 | diagnostic | 无自动清理（待实现） | 待实现 |

---

## 五、In-Memory 缓存层

以下缓存存在于进程内存中，进程重启后重建：

| 模块 | 缓存变量 | 内容 | 当前问题 |
|---|---|---|---|
| `run-store.mjs` | `runStatusCache` | run status 对象 | 无 eviction，长期运行会增长 |
| `run-store.mjs` | `runManifestCache` | run manifest 对象 | 同上 |
| `run-store.mjs` | `runResultCache` | run result 对象 | 同上 |
| `run-store.mjs` | `runArtifactCache` | artifact 文本 | 同上 |
| `history.mjs` | `metaCache` | session transcript meta | 同上 |
| `history.mjs` | `contextCache` | session context head | 同上 |
| `history.mjs` | `forkContextCache` | session fork context | 同上 |
| `history.mjs` | `eventCache` | 单个事件对象 | 同上 |
| `history.mjs` | `bodyCache` | 外部化 body 文本 | 同上 |
| `session-db.mjs` | SQLite 内部缓存 | page cache（WAL 模式） | 由 SQLite 管理，无问题 |

**待改进：** 上述 Map 缓存应加 LRU 上限（建议 500-1000 条目），防止长时间运行的内存泄漏。

---

## 六、写入一致性保证

| 场景 | 机制 |
|---|---|
| Session 元数据并发写 | `createSerialTaskQueue()` 串行化 + SQLite BEGIN/COMMIT |
| Run 状态并发写 | `createKeyedTaskQueue(runId)` 按 run ID 串行化 |
| Session history 并发写 | `createKeyedTaskQueue(sessionId)` 按 session ID 串行化 |
| Workbench 状态并发写 | `workbenchQueue()` 全局串行化 |
| 所有文件写入 | `writeJsonAtomic()` / `writeTextAtomic()`（临时文件 + rename） |

---

## 七、存储维护（Maintenance）

**当前实现：** `lib/storage-maintenance.mjs` + `lib/storage-maintenance-command.mjs`

**清理范围：**
- `runs/<runId>/spool.jsonl`：terminal 状态且超过保留期
- `runs/<runId>/artifacts/`：同上
- `logs/api/YYYY-MM-DD.jsonl`：超过保留期的日志文件
- `config/provider-runtime-homes/codex/sessions/*.jsonl`：超过保留期
- `config/provider-runtime-homes/codex/shell_snapshots/*.sh`：超过保留期

**触发方式：**
- 手动：`melodysync storage-maintenance [--apply]`
- 自动：**尚未接入**（待在启动流程或定时任务中调用）

**默认保留天数：**
- API 日志：7 天
- Run 负载（spool/artifacts）：7 天
- Provider 会话：7 天

---

## 八、待实现项（按优先级）

| 优先级 | 项目 | 描述 |
|---|---|---|
| P1 | 自动存储维护 | 在 `instance.startup` hook 或 persistent 定时任务中自动调用 storage-maintenance |
| P1 | In-memory 缓存 LRU | 给 run-store 和 history 的 Map 缓存加上限（500-1000 条目） |
| P2 | file-assets-cache GC | 按大小上限 + TTL 清理缓存目录 |
| P2 | task-ops.jsonl 轮转 | 按日分文件，保留 30 天 |
| P2 | 未引用资产 GC | reachability 扫描，删除无 session/workbench 引用的旧上传 |
| P3 | history 段式布局迁移 | 从 events/*.json + bodies/*.txt 迁移到 segments/*.events.jsonl + segments/*.blobs.jsonl |
| P3 | voice 日志轮转 | voice/events.jsonl 和 voice/logs/connector.log 按大小/时间轮转 |
