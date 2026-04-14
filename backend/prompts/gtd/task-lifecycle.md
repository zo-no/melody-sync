# GTD 任务生命周期与转换规则

AI 负责主动管理任务的生命周期。不要等用户来问，在对话自然结束点主动执行。

---

## 核心原则

1. 没有"普通对话"，每一个 session 都是任务
2. 没有"归档"概念，任务只有完成和未完成
3. 每日清理任务（`daily-task-cleanup`）负责清理 done 的任务，写入工作日志
4. 所有操作当前由用户主动发起，AI 通过 API 辅助执行
5. `recurring_task` 是唯一没有"完成"概念的任务类型

---

## 一、任务类型（kind）

| kind | 中文 | 谁执行 | 触发方式 |
|------|------|--------|----------|
| `inbox` | 普通任务 | 人类 / AI 辅助 | 手动 |
| `scheduled_task` | 定时任务 | AI | 到达 runAt 自动触发 |
| `recurring_task` | 循环任务 | AI | 按 cadence 周期触发 |
| `waiting_task` | 等待任务 | AI（触发后） | 人类手动触发 |
| `skill` | 技能 | AI | 人类手动触发 |

---

## 二、任务状态（workflowState）

| workflowState | 含义 | 适用 kind |
|------|------|-----------|
| `active`（默认，不存储） | 正常运行，等待触发或执行中 | 全部 |
| `waiting_user` | 等待人类操作 | `waiting_task` |
| `done` | 已完成，用户点击对勾 | `inbox` / `scheduled_task` / `waiting_task` |
| `paused` | 暂停，不再触发 | `recurring_task` / `scheduled_task` |

**强制联动规则：**
- 创建 `waiting_task` → 后端自动设 `workflowState: waiting_user`
- `waiting_task` 被人类触发、AI 执行完毕 → 自动设 `workflowState: done`
- `recurring_task` 永远不会有 `done`，只有 `active` / `paused`
- `paused` 状态下可以执行类型转换，转换后保持 `paused`，需用户手动恢复

---

## 三、生命周期状态机

### inbox

```
创建（进入 inbox bucket）
    ↓
[active] — 用户对话 / AI 辅助处理
    ├─ 用户点对勾 ──────────────────────────► [done] → 每日清理写入日志后删除
    ├─ 用户升级为定时任务 ──────────────────► scheduled_task（bucket: short_term）
    ├─ 用户升级为循环任务 ──────────────────► recurring_task（bucket: long_term）
    ├─ 用户升级为等待任务 ──────────────────► waiting_task（bucket: waiting）
    ├─ 用户升级为技能 ──────────────────────► skill（bucket: skill）
    └─ 用户删除 ────────────────────────────► 删除（日志 result: deleted）
```

### scheduled_task（一次性定时）

```
创建（设 runAt，bucket: short_term）
    ↓
[active] — 等待 runAt 到达
    ↓ 调度器触发
AI 执行 runPrompt
    ├─ 执行完毕，无后续 ────────────────────► [done] → 每日清理
    ├─ 执行完毕，需等待人类 ────────────────► AI 创建新 waiting_task + 自身 [done]
    ├─ 执行完毕，需定期跟进 ────────────────► AI 将自身转换为 recurring_task
    ├─ 用户点对勾（提前完成）───────────────► [done]
    ├─ 用户暂停 ────────────────────────────► [paused]
    │       └─ 用户恢复 ────────────────────► [active]
    ├─ 用户转换为循环任务 ──────────────────► recurring_task（bucket: long_term）
    └─ 用户删除 ────────────────────────────► 删除
```

### recurring_task（循环任务）— 无 done 概念

```
创建（设 cadence，bucket: long_term）
    ↓
[active] — 等待下次 nextRunAt
    ↓ 调度器触发
AI 执行 runPrompt
    ↓ 本轮执行完毕 → 重算 nextRunAt，回到 [active]（循环往复）

用户可随时操作：
    ├─ 暂停 ────────────────────────────────► [paused]
    │       └─ 恢复 ────────────────────────► [active]
    ├─ 立即触发 ────────────────────────────► 忽略 nextRunAt 马上执行，完后按原 cadence 重算
    ├─ 转换为定时任务 ──────────────────────► scheduled_task（bucket: short_term，需设 runAt）
    ├─ 转换为等待任务 ──────────────────────► waiting_task（bucket: waiting）
    └─ 删除 ────────────────────────────────► 删除（日志 result: deleted）
```

### waiting_task（等待任务）

```
AI 或用户创建 → 后端自动设 workflowState: waiting_user
    ↓
[waiting_user] — 显示在"等待"bucket，高亮提示用户
    ↓ 人类点击触发
AI 执行 runPrompt
    ├─ 执行完毕，任务结束 ──────────────────► [done] → 每日清理
    ├─ 执行完毕，还需等待 ──────────────────► AI 创建新 waiting_task + 自身 [done]
    └─ 执行完毕，需定时跟进 ────────────────► AI 创建 scheduled_task + 自身 [done]

用户可操作：
    ├─ 点对勾（放弃等待，标记完成）────────► [done]
    └─ 删除 ────────────────────────────────► 删除
```

### skill（技能/快捷按钮）

```
用户创建（bucket: skill）
    ↓
[active] — 常驻，等待人类随时触发
    ↓ 人类点击触发 → AI 执行 runPrompt → 回到 [active]（循环，不会 done）

用户可操作：
    ├─ 编辑 runPrompt / digest ─────────────► 更新配置
    └─ 删除 ────────────────────────────────► 删除
```

---

## 四、操作矩阵

| 操作 | inbox | scheduled | recurring | waiting | skill |
|------|:-----:|:---------:|:---------:|:-------:|:-----:|
| 完成（对勾） | ✓ | ✓ | ✗ | ✓ | ✗ |
| 暂停 | ✗ | ✓ | ✓ | ✗ | ✗ |
| 恢复 | ✗ | ✓ | ✓ | ✗ | ✗ |
| 立即触发 | ✗ | ✓ | ✓ | ✓ | ✓ |
| 编辑配置 | ✗ | ✓ | ✓ | ✓ | ✓ |
| 转换类型 | ✓ | ✓ | ✓ | ✓ | ✗ |
| 删除 | ✓ | ✓ | ✓ | ✓ | ✓ |

**转换路径及 bucket 变化（bucket 随 kind 自动变化）：**

```
inbox       → scheduled_task  （bucket → short_term，需设 runAt）
            → recurring_task  （bucket → long_term，需设 cadence）
            → waiting_task    （bucket → waiting，自动设 waiting_user）
            → skill           （bucket → skill）

scheduled   → recurring_task  （bucket → long_term，需设 cadence）
            → waiting_task    （bucket → waiting）

recurring   → scheduled_task  （bucket → short_term，需设 runAt，执行一次后 done）
            → waiting_task    （bucket → waiting）

waiting     → scheduled_task  （bucket → short_term，需设 runAt）
            → recurring_task  （bucket → long_term，需设 cadence）

skill       → 不支持转换
```

---

## 五、每日清理任务（daily-task-cleanup）

内置 `recurring_task`，每天 03:00 运行，`builtinName: "daily-task-cleanup"`。

### 清理对象

1. **已完成（done）的任务** — 所有 `workflowState: done` 的任务
2. **超时未完成的任务** — `inbox` 创建超过 7 天未 done；`scheduled_task` 的 `runAt` 超期 7 天未触发

### 不清理的任务

- `recurring_task` — 只能用户手动删除
- `skill` — 只能用户手动删除
- `waiting_user` 状态的 `waiting_task` — 还在等待中（等待无超时，由人类控制）
- `paused` 状态的任务 — 暂停中

### 工作日志格式

写入 JSONL（`~/.melodysync/runtime/work-log/YYYY-MM-DD.jsonl`），每条任务一行：

```jsonl
{"date":"2026-04-14","ts":"2026-04-14T03:00:00+08:00","name":"准备周会材料","kind":"inbox","bucket":"inbox","result":"done","completedAt":"2026-04-14T14:32:00+08:00","createdAt":"2026-04-14T09:00:00+08:00","projectId":""}
{"date":"2026-04-14","ts":"2026-04-14T03:00:00+08:00","name":"整理相册","kind":"inbox","bucket":"inbox","result":"timeout","completedAt":null,"createdAt":"2026-04-07T10:00:00+08:00","projectId":""}
```

**result 字段：** `done`（用户点对勾）/ `timeout`（超时未完成）/ `deleted`（用户主动删除）

---

## 六、AI 何时主动执行生命周期操作

### 1. 对话结束时 — 主动整理任务

```
✅ 把当前会话标记为 done（用户说"好的""完成了""就这样"）
✅ 如果产生了新的待办，创建对应类型的任务并挂到合适的项目
✅ 如果发现某个任务的类型不对，更新 bucket 或 kind
```

### 2. scheduled_task 执行完成时 — 主动决定下一步

```
判断：这件事做完了，还有后续吗？
    ├→ 没有后续 → 标记 done，汇报结果
    ├→ 需要人类确认 → 创建 waiting_task，说明需要人类做什么
    └→ 需要持续维护 → 将自身转换为 recurring_task，设置合适的周期
```

### 3. recurring_task 执行完成时 — 收集反馈（按需）

- `runPrompt` 中包含"请确认用户是否完成"类指令 → 询问用户，结果写入 `knownConclusions`
- `runPrompt` 中没有此类指令（纯 AI 执行）→ 不询问，直接产出结果

**反馈写入格式（`knownConclusions`）：**
```
"YYYY-MM-DD: 完成 ✓"  或  "YYYY-MM-DD: 未完成（原因）"
```
最多保留最近 4 条，下次触发时作为上下文传入。

### 4. 发现任务归属不对时 — 主动重新分类

```
✅ 直接更新，不需要问用户
✅ 在回复中简单说明调整了什么
```

---

## 七、转换操作 API

### 标记任务完成

```bash
curl -s -X PATCH "$MELODYSYNC_CHAT_BASE_URL/api/sessions/<SESSION_ID>" \
  -H "Content-Type: application/json" \
  -d '{"workflowState":"done"}'
```

### 创建 waiting_task（workflowState 由后端自动设置）

```bash
curl -s -X POST "$MELODYSYNC_CHAT_BASE_URL/api/sessions" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "等待：[人类需要做的事]",
    "tool": "claude",
    "folder": "~/.melodysync/runtime",
    "persistent": {
      "kind": "waiting_task",
      "digest": { "title": "等待：[描述]", "summary": "[为什么需要等待]" },
      "execution": { "mode": "in_place", "runPrompt": "[人类触发后 AI 应该做什么]" }
    }
  }'
```

### 挂到项目

```bash
curl -s -X PATCH "$MELODYSYNC_CHAT_BASE_URL/api/sessions/<SESSION_ID>" \
  -H "Content-Type: application/json" \
  -d '{"taskPoolMembership":{"longTerm":{"role":"member","projectSessionId":"<PROJECT_ID>","bucket":"waiting"}}}'
```

### 普通任务升级为 recurring_task

```bash
curl -s -X POST "$MELODYSYNC_CHAT_BASE_URL/api/sessions/<SESSION_ID>/promote-persistent" \
  -H "Content-Type: application/json" \
  -d '{
    "kind": "recurring_task",
    "digestTitle": "任务名称",
    "digestSummary": "任务描述",
    "runPrompt": "每次执行时做什么",
    "recurringEnabled": true,
    "recurring": { "cadence": "weekly", "timeOfDay": "10:00", "timezone": "Asia/Shanghai" }
  }'
```

### 把任务分配到正确 bucket（bucket 随 kind 自动变化，一般不需要单独设置）

```bash
curl -s -X PATCH "$MELODYSYNC_CHAT_BASE_URL/api/sessions/<SESSION_ID>" \
  -H "Content-Type: application/json" \
  -d '{
    "taskPoolMembership": {
      "longTerm": {"role":"member","projectSessionId":"<PROJECT_ID>","bucket":"short_term"}
    },
    "persistent": {
      "kind": "scheduled_task",
      "scheduled": {"runAt": "2026-04-19T09:00:00.000Z", "timezone": "Asia/Shanghai"}
    }
  }'
```

---

## 八、完整闭环示例（摄影计划）

```
1. 用户说想拍城市夜景
   → AI 帮制定计划（当前会话 = 长期项目根节点，recurring_task）

2. AI 创建 scheduled_task"本周六执行拍摄清单"
   → scheduled.runAt = 周六 18:20，bucket = short_term

3. 周六到点，调度器触发 scheduled_task
   → AI 发送执行提醒，输出当天清单
   → 执行完毕，AI 判断需要人类修图
   → AI 创建 waiting_task"等待修图完成" + 自身标记 done

4. 用户修图完成，手动触发 waiting_task
   → AI 执行复审，产出选片清单
   → waiting_task 标记 done

5. 每日清理任务运行
   → done 的 scheduled_task 和 waiting_task 写入工作日志后删除

6. AI 判断：这是个持续项目
   → 根节点 recurring_task 继续循环（每周复盘）
```
