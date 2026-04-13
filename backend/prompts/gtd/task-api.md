# GTD API 操作手册

API base: `$MELODYSYNC_CHAT_BASE_URL` (default: `http://127.0.0.1:{{CHAT_PORT}}`)

---

## 查询任务

```bash
# 列出所有任务（精简视图）
curl -s "$MELODYSYNC_CHAT_BASE_URL/api/sessions?view=refs"

# 按 persistent.kind 过滤
curl -s "$MELODYSYNC_CHAT_BASE_URL/api/sessions?limit=100" | \
  jq '[.sessions[] | select(.persistent.kind == "recurring_task")]'
```

---

## 创建任务

必填字段：`folder`（绝对路径），`tool`（使用当前会话的 tool，如 `claude`）

**`execution` 字段说明：**

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `mode` | `"in_place"`（在原 session 执行）或 `"spawn_session"`（派生子 session） | `"in_place"` |
| `runPrompt` | 触发时发送给 AI 的指令 | 自动生成 |
| `shellCommand` | 在 AI 执行前先运行的 Shell 脚本（仅 skill 类型） | 无 |
| `maxTurns` | 单次运行最大轮次上限（安全阀）。自动触发任务默认 40，手动触发默认不限 | 见默认值 |

`maxTurns` 建议值：
- 简单任务（查询、整理）：10–20
- 中等任务（分析、生成报告）：30–50
- 复杂任务（代码修改、多步骤调研）：80–120
- 不设限（仅手动触发的探索性任务）：省略此字段

### 创建长期任务（循环执行）

```bash
curl -s -X POST "$MELODYSYNC_CHAT_BASE_URL/api/sessions" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "任务名称",
    "folder": "~/.melodysync/runtime",
    "tool": "claude",
    "persistent": {
      "kind": "recurring_task",
      "digest": { "title": "任务名称", "summary": "任务摘要" },
      "execution": { "mode": "spawn_session", "runPrompt": "执行时做什么" },
      "recurring": {
        "cadence": "weekly",
        "timeOfDay": "09:00",
        "weekdays": [1],
        "timezone": "Asia/Shanghai"
      },
      "knowledgeBasePath": "/path/to/knowledge"
    }
  }'
```

### 创建短期任务（必须有时间点）

```bash
curl -s -X POST "$MELODYSYNC_CHAT_BASE_URL/api/sessions" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "任务名称",
    "folder": "~/.melodysync/runtime",
    "tool": "claude",
    "persistent": {
      "kind": "scheduled_task",
      "digest": { "title": "任务名称", "summary": "任务摘要" },
      "execution": { "mode": "in_place", "runPrompt": "执行时做什么" },
      "scheduled": {
        "runAt": "2026-04-19T09:00:00.000Z",
        "timezone": "Asia/Shanghai"
      }
    }
  }'
```

### 创建等待任务（无时间点）

```bash
curl -s -X POST "$MELODYSYNC_CHAT_BASE_URL/api/sessions" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "等待：[描述]",
    "folder": "~/.melodysync/runtime",
    "tool": "claude",
    "persistent": {
      "kind": "waiting_task",
      "digest": { "title": "等待：[描述]", "summary": "[等待原因]" },
      "execution": { "mode": "in_place", "runPrompt": "人类触发后做什么" }
    }
  }'
```

### 创建技能（快捷按钮）

```bash
curl -s -X POST "$MELODYSYNC_CHAT_BASE_URL/api/sessions" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "技能名称",
    "folder": "~/.melodysync/runtime",
    "tool": "claude",
    "persistent": {
      "kind": "skill",
      "digest": { "title": "技能名称", "summary": "技能描述" },
      "execution": { "mode": "in_place", "runPrompt": "触发时做什么" }
    }
  }'
```

---

## 更新任务

### 标记任务完成

```bash
curl -s -X PATCH "$MELODYSYNC_CHAT_BASE_URL/api/sessions/<SESSION_ID>" \
  -H "Content-Type: application/json" \
  -d '{"workflowState":"done"}'
```

### 挂到项目的指定 bucket

```bash
curl -s -X PATCH "$MELODYSYNC_CHAT_BASE_URL/api/sessions/<SESSION_ID>" \
  -H "Content-Type: application/json" \
  -d '{
    "taskPoolMembership": {
      "longTerm": {
        "role": "member",
        "projectSessionId": "<PROJECT_ID>",
        "bucket": "short_term"
      }
    }
  }'
```

Bucket 可选值：`long_term` / `short_term` / `waiting` / `inbox` / `skill`

### 更新调度时间

```bash
# 更新循环任务周期
curl -s -X PATCH "$MELODYSYNC_CHAT_BASE_URL/api/sessions/<SESSION_ID>" \
  -H "Content-Type: application/json" \
  -d '{"persistent":{"recurring":{"cadence":"daily","timeOfDay":"08:00","timezone":"Asia/Shanghai"}}}'

# 更新短期任务执行时间
curl -s -X PATCH "$MELODYSYNC_CHAT_BASE_URL/api/sessions/<SESSION_ID>" \
  -H "Content-Type: application/json" \
  -d '{"persistent":{"scheduled":{"runAt":"2026-04-20T09:00:00.000Z","timezone":"Asia/Shanghai"}}}'
```

### 调整侧边栏排序（数字越小越靠前）

```bash
curl -s -X PATCH "$MELODYSYNC_CHAT_BASE_URL/api/sessions/<SESSION_ID>" \
  -H "Content-Type: application/json" \
  -d '{"sidebarOrder":1}'
```

---

## 升级普通会话为长期项目

```bash
curl -s -X POST "$MELODYSYNC_CHAT_BASE_URL/api/sessions/<SESSION_ID>/promote-persistent" \
  -H "Content-Type: application/json" \
  -d '{
    "kind": "recurring_task",
    "digestTitle": "项目名称",
    "digestSummary": "项目描述",
    "runPrompt": "每次执行时做什么",
    "recurringEnabled": true,
    "recurring": {
      "cadence": "weekly",
      "timeOfDay": "10:00",
      "timezone": "Asia/Shanghai"
    }
  }'
```

---

## 手动触发任务立即执行

```bash
curl -s -X POST "$MELODYSYNC_CHAT_BASE_URL/api/sessions/<SESSION_ID>/run-persistent" \
  -H "Content-Type: application/json" -d '{}'
```

---

## 清理操作

```bash
# 归档任务
curl -s -X PATCH "$MELODYSYNC_CHAT_BASE_URL/api/sessions/<SESSION_ID>" \
  -H "Content-Type: application/json" \
  -d '{"archived":true}'

# 移出项目（清除 membership）
curl -s -X PATCH "$MELODYSYNC_CHAT_BASE_URL/api/sessions/<SESSION_ID>" \
  -H "Content-Type: application/json" \
  -d '{"taskPoolMembership":{"longTerm":null}}'

# 降级为普通会话（清除 persistent 配置）
curl -s -X PATCH "$MELODYSYNC_CHAT_BASE_URL/api/sessions/<SESSION_ID>" \
  -H "Content-Type: application/json" \
  -d '{"persistent":null}'
```

---

## 工作区绑定

每个长期项目可以绑定一个本地目录，AI 执行任务时以该目录为工作根：

```bash
# 绑定工作区
curl -s -X PATCH "$MELODYSYNC_CHAT_BASE_URL/api/sessions/<PROJECT_SESSION_ID>" \
  -H "Content-Type: application/json" \
  -d '{"persistent":{"workspace":{"path":"/Users/kual/projects/investing","label":"理财工作区"}}}'

# 清除工作区绑定
curl -s -X PATCH "$MELODYSYNC_CHAT_BASE_URL/api/sessions/<PROJECT_SESSION_ID>" \
  -H "Content-Type: application/json" \
  -d '{"persistent":{"workspace":null}}'
```

---

## 操作规则

- 会话目标明确完成时，立即标记 done，不需要询问用户
- 新会话明显属于某个项目时，直接挂到正确的 bucket
- 用户要求整理任务列表时，一次性完成所有操作
- 批量操作前先用 `GET /api/sessions?view=refs` 获取列表
- bucket 改变时，同时更新 `taskPoolMembership.longTerm.bucket`
- 执行长期项目任务时，如项目有 workspace 绑定，以该目录为工作根读写文件

## ⚠️ 禁止操作

- **严禁归档长期项目中的任务**：凡是 `taskPoolMembership.longTerm.projectSessionId` 不为空的 session，不得执行 `archived: true` 操作，除非用户明确指示。
- **整理任务时只允许**：修改 bucket、修改 group、修改 sidebarOrder。不得归档、不得删除。
- **需要删除时必须走审批流程**：创建一个 `waiting_task` 类型的审批任务，列出待删除项，等待用户确认后再执行。
