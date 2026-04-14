# MelodySync 任务系统剩余需求文档

> 供 Codex 实现用。本文档描述已设计但尚未完成的功能。
> 已完成的部分见 `backend/prompts/gtd/task-lifecycle.md`。

---

## 背景：已完成的部分

以下已在代码中实现，不需要再做：

- 5 种任务类型（kind）：inbox / scheduled_task / recurring_task / waiting_task / skill
- 4 种 workflowState：active（空字符串）/ waiting_user / done / paused
- `waiting_task` 创建时后端强制设 `workflowState: waiting_user`
- `recurring_task` UI 隐藏对勾按钮（无完成概念）
- 任务事件 worklog（`backend/session/task-worklog.mjs`）：7 种事件全量记录
- 长期项目 tab 结构重构：系统项目完全隔离，增加"其他任务"分组，每个项目有独立的已完成 bucket
- 完成音效只在 AI run 完成时触发，用户手动点对勾不触发
- scheduled_task / waiting_task 完成后出现在"已完成"区域

---

## 一、任务类型转换 UI（Phase 3）

### 需求描述

用户可以在任务操作菜单里把一个任务转换为其他类型。转换时 bucket 随 kind 自动变化，不需要用户单独设置。

### 转换路径

```
inbox       → scheduled_task  （bucket → short_term，需设 runAt）
            → recurring_task  （bucket → long_term，需设 cadence）
            → waiting_task    （bucket → waiting）
            → skill           （bucket → skill）

scheduled   → recurring_task  （bucket → long_term，需设 cadence）
            → waiting_task    （bucket → waiting）

recurring   → scheduled_task  （bucket → short_term，需设 runAt）
            → waiting_task    （bucket → waiting）

waiting     → scheduled_task  （bucket → short_term，需设 runAt）
            → recurring_task  （bucket → long_term，需设 cadence）

skill       → 不支持转换
```

### UI 交互

- 入口：任务卡右侧的 `...` 操作菜单，新增"转换类型"选项
- 点击后弹出类型选择器，只显示当前 kind 允许转换的目标类型
- 如果目标类型需要额外参数（scheduled_task 需要 runAt，recurring_task 需要 cadence），弹出一个简单表单填写
- 转换完成后 bucket 自动更新，任务在 sidebar 里移动到对应分组

### 后端 API

转换操作通过现有的 `PATCH /api/sessions/:id` 实现，同时更新 `persistent.kind` 和 `taskPoolMembership.longTerm.bucket`：

```javascript
// 示例：inbox → scheduled_task
PATCH /api/sessions/:id
{
  "persistent": {
    "kind": "scheduled_task",
    "scheduled": { "runAt": "2026-04-20T09:00:00.000Z", "timezone": "Asia/Shanghai" }
  },
  "taskPoolMembership": {
    "longTerm": { "role": "member", "projectSessionId": "<PROJECT_ID>", "bucket": "short_term" }
  }
}
```

---

## 二、每日清理任务 runPrompt（Phase 2）

### 需求描述

内置 `recurring_task`（`builtinName: melodysync-daily-cleanup`，每天 22:00）需要一个可执行的 runPrompt，实现：
1. 读取当天的 JSONL worklog
2. 为每条记录生成紧凑单行格式
3. 写入 Obsidian 日记

### JSONL worklog 位置

```
$MELODYSYNC_MEMORY_DIR/worklog/YYYY/MM/YYYY-MM-DD.jsonl
```

实际路径示例：`/Users/kual/Desktop/diary/diary/00-🤖agent/memory/worklog/2026/04/2026-04-14.jsonl`

### JSONL 字段说明

每行一个 JSON 对象，字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `event` | string | 事件类型：triggered / completed / failed / done / deleted / timeout / kind_changed / waiting_created |
| `ts` | ISO string | 事件发生时间 |
| `sessionId` | string | 任务 ID |
| `name` | string | 任务名称 |
| `kind` | string | 任务类型 |
| `bucket` | string | 所属 bucket |
| `projectName` | string \| null | 所属长期项目名，无项目为 null |
| `createdAt` | ISO string \| null | 任务创建时间 |
| `completedAt` | ISO string \| null | 完成时间（done/deleted 事件有值） |
| `conclusions` | string[] \| null | 任务结论列表 |
| `goal` | string \| null | 任务目标 |
| `summary` | string \| null | 任务摘要 |

### Obsidian 日记写入格式

**紧凑单行格式：**
```
- 09:30-11:44 (2h14m) [🔍 melody-sync] 排查发送报错，根因是 folder 路径问题，应改用 projectId + relPath
```

**生成规则：**
- 时间段 = `createdAt` → `completedAt`（HH:MM-HH:MM），加总时长（分钟取整）
- emoji 从 name/conclusions 推断：
  - 排查|报错|错误|bug|debug|修复|fix → 🔍
  - 设计|ui|ux|界面|样式|布局 → 🎨
  - 讨论|分享|会议|头脑风暴|review → 💬
  - 重构|优化|清理|整理|迁移|refactor → 🔧
  - 部署|发布|上线|deploy|release → 🚀
  - 测试|test|spec → 🧪
  - 文档|doc|readme → 📄
  - 新增|添加|实现|开发|feature → ✨
  - 其他 → 💻
- `[emoji 项目名]`：有 projectName 则显示，无则只显示 emoji
- 正文 = name + conclusions 拼接（逗号分隔）；无 conclusions 降级到 summary；再降级到 goal；再降级到 name

**写入位置：** Obsidian 日记文件的 `## Agent Notes` → `### MelodySync 工作记录` 区块
- 日记文件路径格式：`YYYY_MM_DD.md`，在日记目录年份子目录下
- 每条记录用 HTML 注释包裹，支持幂等更新：
  ```
  <!-- melodysync:session:{sessionId}:start -->
  - HH:MM-HH:MM (时长) [emoji 项目名] 正文
  <!-- melodysync:session:{sessionId}:end -->
  ```

**只处理的事件类型：** `done`、`deleted`（其他事件如 triggered/completed 不写入日记）

### 实现位置

`backend/session/system-project.mjs` 中 `BUILTIN_TASKS` 数组里 `melodysync-daily-cleanup` 的 `runPrompt` 字段。

现有 runPrompt 框架已有，需要完善为可执行的完整指令。

---

## 三、每日回顾任务 runPrompt

### 需求描述

内置 `recurring_task`（`builtinName: melodysync-daily-review`，每天 09:00）读取当天 worklog，整理今日任务优先级，输出给用户。

### 输出内容

1. **今日已完成**：从 worklog 中读取当天 `done`/`deleted` 事件，列出完成的任务
2. **今日待处理**：读取当前活跃任务（通过 API 查询），按优先级排列
3. **需要关注**：`waiting_user` 状态的任务（等待人类操作的）
4. **建议**：如果有超时未完成的任务（timeout 事件），提示用户

### 数据来源

- 已完成：`$MELODYSYNC_MEMORY_DIR/worklog/YYYY/MM/YYYY-MM-DD.jsonl`（当天文件）
- 待处理：`GET $MELODYSYNC_CHAT_BASE_URL/api/sessions`（查询 active 任务）
- 等待中：同上，过滤 `workflowState: waiting_user`

---

## ~~四、完成音效抑制（已删除）~~

> **已删除**：整个完成音效系统（音频、attention banner、title 闪烁、震动、browser notification、`userInitiatedDoneIds`）已在 2026-04 全部移除。此需求不再适用。

---

## 五、任务自迭代（未来，暂不实现）

读取 worklog 数据，分析任务完成率、超时率、常见阻塞点，反向优化任务流水线。

数据来源：`$MELODYSYNC_MEMORY_DIR/worklog/` 目录下的所有 JSONL 文件。

分析维度：
- 哪类任务（kind/bucket）完成率最高/最低
- 哪些任务经常超时（timeout 事件）
- waiting_task 平均等待时长
- 任务从创建到完成的平均时长

这个功能等 worklog 积累足够数据后再设计。

---

## 关键文件位置

| 功能 | 文件 |
|------|------|
| 任务类型转换后端 | `backend/services/session/persistent-service.mjs` |
| 任务类型转换前端入口 | `frontend-src/session/surface-ui.js`（操作菜单） |
| 内置任务定义 | `backend/session/system-project.mjs`（BUILTIN_TASKS 数组） |
| Obsidian 日记写入 | `backend/session/deletion-journal.mjs`（writeObsidianJournalEntry） |
| worklog 写入 | `backend/session/task-worklog.mjs`（appendTaskWorklogEvent） |
| 完成音效抑制 | `frontend-src/session/http.js`（userInitiatedDoneIds） |
| 完成按钮处理 | `frontend-src/core/realtime.js`（complete_pending case） |
| 任务生命周期文档 | `backend/prompts/gtd/task-lifecycle.md` |
