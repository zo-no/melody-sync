# SQLite Session Store 设计文档

> 状态：设计中，待实现
> 关联文件：`backend/session/meta-store.mjs`、`lib/config.mjs`

---

## 背景

### 现有问题

`chat-sessions.json` 是单个 JSON 文件，所有 session 元数据存在一起。当前读写模式：

1. 任何写操作（改一个字段）都要：读整个文件 → 修改内存 → 写整个文件
2. 查询是内存线性扫描，无索引
3. 并发写通过 `createSerialTaskQueue()` 串行化，高并发时有等待

当前规模：66 sessions = 151KB。随着使用增长，1000+ sessions 时读写开销线性增大。

### 设计原则

- **不做全 schema 迁移**：`persistent`、`digest`、`execution` 等多态嵌套对象继续存 JSON 列，避免频繁 schema migration
- **只给查询字段建索引列**：稳定的、用于 WHERE/ORDER BY 的字段提取为独立列
- **迁移成本低**：加新字段只需 `ALTER TABLE ADD COLUMN`（SQLite 向后兼容），不需要重写 `data` 列
- **单文件 SQLite**：零依赖，本地优先，支持 WAL 并发

---

## Schema 设计

### sessions 表

```sql
CREATE TABLE sessions (
  -- 主键
  id TEXT PRIMARY KEY NOT NULL,

  -- 任务池归属（核心查询字段）
  task_list_origin     TEXT,    -- 'user' | 'system' | null
  task_list_visibility TEXT,    -- 'primary' | 'secondary' | null
  project_session_id   TEXT,    -- taskPoolMembership.longTerm.projectSessionId
  lt_role              TEXT,    -- taskPoolMembership.longTerm.role: 'member' | 'project'
  lt_bucket            TEXT,    -- taskPoolMembership.longTerm.bucket: inbox/short_term/long_term/waiting/skill

  -- 工作流状态
  workflow_state       TEXT,    -- '' | 'done' | 'waiting_user' | 'paused'

  -- 持久任务
  persistent_kind      TEXT,    -- null | 'skill' | 'recurring_task' | 'scheduled_task' | 'waiting_task'
  builtin_name         TEXT,    -- null | 'melodysync-daily-review' | ...

  -- 排序和显示
  pinned               INTEGER DEFAULT 0,  -- 0 | 1
  created_at           TEXT NOT NULL,      -- ISO 8601
  updated_at           TEXT NOT NULL,      -- ISO 8601

  -- 外部集成（低频查询）
  source_id            TEXT,    -- 外部来源 ID
  external_trigger_id  TEXT,    -- 外部触发器 ID

  -- 完整对象（JSON 列，多态结构存这里）
  data                 TEXT NOT NULL  -- JSON，完整 session meta 对象
);
```

### 索引

```sql
-- 主查询：列表 + 分组
CREATE INDEX idx_sessions_list
  ON sessions (task_list_visibility, workflow_state, updated_at DESC);

-- 项目成员查询：按项目 ID 找所有任务
CREATE INDEX idx_sessions_project
  ON sessions (project_session_id, lt_bucket);

-- 持久任务查询：找所有 recurring/scheduled/skill
CREATE INDEX idx_sessions_persistent
  ON sessions (persistent_kind, task_list_origin);

-- 置顶排序
CREATE INDEX idx_sessions_pinned
  ON sessions (pinned DESC, updated_at DESC);

-- 外部触发器（低频，但需要精确查找）
CREATE INDEX idx_sessions_external_trigger
  ON sessions (external_trigger_id)
  WHERE external_trigger_id IS NOT NULL;

-- 来源过滤
CREATE INDEX idx_sessions_source
  ON sessions (source_id)
  WHERE source_id IS NOT NULL;
```

---

## 字段映射

| SQLite 列 | 原 JSON 路径 | 说明 |
|-----------|-------------|------|
| `id` | `session.id` | 主键 |
| `task_list_origin` | `session.taskListOrigin` | |
| `task_list_visibility` | `session.taskListVisibility` | |
| `project_session_id` | `session.taskPoolMembership.longTerm.projectSessionId` | 提取嵌套字段 |
| `lt_role` | `session.taskPoolMembership.longTerm.role` | |
| `lt_bucket` | `session.taskPoolMembership.longTerm.bucket` | |
| `workflow_state` | `session.workflowState` | missing → 空字符串 |
| `persistent_kind` | `session.persistent.kind` | |
| `builtin_name` | `session.builtinName` | |
| `pinned` | `session.pinned` | bool → 0/1 |
| `created_at` | `session.createdAt` 或 `session.created` | 两个字段兼容 |
| `updated_at` | `session.updatedAt` | |
| `source_id` | `session.sourceId` | |
| `external_trigger_id` | `session.externalTriggerId` | |
| `data` | 完整 session 对象 | `JSON.stringify(session)` |

**不放入索引列的字段**（存在 `data` JSON 列里）：
- `persistent`（多态嵌套，频繁加字段）
- `taskCard`（AI 推断，结构变化大）
- `sessionState`（运行时推断）
- `name`、`folder`、`description`（显示用，不做查询条件）
- `archived`（由 `workflowState === 'done'` 推断，不需要单独列）
- `internalRole`（前端推断，不存 meta）
- `model`、`tool`、`effort`（session 偏好，不做过滤条件）

---

## 读写接口变更

### `meta-store.mjs` 主要改动

```javascript
// 现在
async function loadSessionsMeta() {
  return readJson(CHAT_SESSIONS_FILE, []);
}

// 改后
function loadSessionsMeta() {
  return db.prepare('SELECT data FROM sessions ORDER BY pinned DESC, updated_at DESC').all()
    .map(row => JSON.parse(row.data));
}
```

```javascript
// 现在（全量写）
async function saveSessionsMeta(sessions) {
  await writeJsonAtomic(CHAT_SESSIONS_FILE, sessions);
}

// 改后（单条 upsert）
function upsertSession(session) {
  const stmt = db.prepare(`
    INSERT INTO sessions (id, task_list_origin, task_list_visibility, ...)
    VALUES (?, ?, ?, ...)
    ON CONFLICT(id) DO UPDATE SET ...
  `);
  stmt.run(extractColumns(session), JSON.stringify(session));
}
```

```javascript
// 新增：按条件查询（现在是内存过滤）
function queryActiveSessions({ projectId, bucket, kind } = {}) {
  return db.prepare(`
    SELECT data FROM sessions
    WHERE workflow_state != 'done'
      AND (? IS NULL OR project_session_id = ?)
      AND (? IS NULL OR lt_bucket = ?)
      AND (? IS NULL OR persistent_kind = ?)
    ORDER BY pinned DESC, updated_at DESC
  `).all(projectId, projectId, bucket, bucket, kind, kind)
    .map(row => JSON.parse(row.data));
}
```

### `withSessionsMetaMutation` 改动

现在是：读 JSON → 修改数组 → 写 JSON

改后：直接操作 SQLite，天然支持事务，不需要序列化队列：

```javascript
async function withSessionsMetaMutation(fn) {
  return db.transaction(() => {
    const metas = loadSessionsMeta();
    const result = fn(metas, (updatedMetas) => {
      // 批量 upsert
      for (const session of updatedMetas) upsertSession(session);
    });
    return result;
  })();
}
```

---

## 迁移策略

### 一次性迁移脚本

```javascript
// scripts/migrate-sessions-to-sqlite.mjs
import { readJson } from '../backend/fs-utils.mjs';
import Database from 'better-sqlite3';

const sessions = await readJson(CHAT_SESSIONS_FILE, []);
const db = new Database(SESSIONS_DB_FILE);

db.exec(CREATE_TABLE_SQL);

const insert = db.prepare(`INSERT OR REPLACE INTO sessions (...) VALUES (...)`);
const insertMany = db.transaction((sessions) => {
  for (const s of sessions) insert.run(extractColumns(s), JSON.stringify(s));
});

insertMany(sessions);
console.log(`Migrated ${sessions.length} sessions to SQLite`);
```

### 启动时自动迁移

在 `meta-store.mjs` 初始化时检测：

```javascript
function initSessionStore() {
  // 如果 SQLite 文件不存在但 JSON 文件存在，自动迁移
  if (!existsSync(SESSIONS_DB_FILE) && existsSync(CHAT_SESSIONS_FILE)) {
    migrateFromJson();
  }
  db = new Database(SESSIONS_DB_FILE);
  db.pragma('journal_mode = WAL');
  db.exec(CREATE_TABLE_SQL);
}
```

### 保留 JSON 备份

迁移后保留 `chat-sessions.json` 作为只读备份，命名为 `chat-sessions.json.bak`。

---

## 依赖

- **`better-sqlite3`**：同步 SQLite 驱动，Node.js，零异步开销
  - 当前项目是纯 callback/async，better-sqlite3 的同步 API 实际上更简单
  - 备选：`node:sqlite`（Node 22+ 内置，但 API 较新，兼容性待确认）

---

## 实现顺序

1. 安装 `better-sqlite3`，确认 Node 版本兼容
2. 新增 `backend/session/session-db.mjs`：封装 SQLite 初始化、schema、CRUD
3. 修改 `meta-store.mjs`：把所有读写替换为 SQLite 操作
4. 写迁移脚本 `scripts/migrate-sessions-to-sqlite.mjs`
5. 启动时自动迁移检测
6. 测试：现有 `tests/test-session-api-shapes.mjs` 等继续通过

---

## 暂不迁移

- `history/` 事件：文件爆炸问题真实，但改动范围更大，单独设计
- `runs/` spool：生命周期短，结构复杂，暂不动
- `worklog/` JSONL：append-only，AI 按日读取，不需要索引
