# MelodySync 任务系统设计文档

---

## 1. 任务类型总览

| 维度 | `recurring_task` | `scheduled_task` | `waiting_task` | `skill` | inbox（普通 session） |
|---|---|---|---|---|---|
| **bucket** | `long_term` | `short_term` | `waiting` | `skill` | `inbox` |
| **有无 persistent** | 有 | 有 | 有 | 有 | 无 |
| **触发者** | 调度器（自动） | 调度器（自动，一次性） | 用户手动 | 用户手动 | 不触发，用户直接对话 |
| **时间配置** | `recurring`（cadence + timeOfDay + timezone + weekdays） | `scheduled.runAt`（ISO 时间戳） | 无 | 无 | 无 |
| **触发频率** | 周期性重复 | 到点触发一次即止 | 按需 | 按需 | N/A |
| **shellCommand** | 无 | 无 | 无 | 可选（AI 前执行） | 无 |
| **maxTurns 默认** | 40（自动触发） | 40（自动触发） | 无上限 | 无上限 | 无上限 |
| **可暂停（paused）** | 是，暂停后调度器跳过 | 是 | 是（无实际效果） | 是（无实际效果） | N/A |
| **loop 流水线** | 支持（collect→organize→use→prune） | 不支持 | 不支持 | 不支持 | N/A |
| **典型场景** | 每日晨会摘要、GTD 每周回顾 | 限时提醒、定点生成报告 | 等人反馈后继续的任务 | 一键执行固定工作流 | 即兴对话、一次性分析 |

---

## 2. 数据结构完整图谱

### 2.1 Session 顶层字段（含 persistent 的任务）

```js
{
  // ── 基础身份 ──────────────────────────────────────
  id: string,                     // session UUID
  name: string,                   // 展示名称
  builtinName?: string,           // 内置系统任务专用（如 'daily-tasks'）

  // ── 生命周期状态 ───────────────────────────────────
  workflowState: '' | 'parked' | 'waiting_user' | 'done',
  archived?: true,                // 存在且为 true 即为已归档

  // ── 项目归属 ───────────────────────────────────────
  taskPoolMembership: {
    longTerm: {
      role: 'project' | 'member',
      projectSessionId: string,   // 归属项目的 session ID
      fixedNode: boolean,         // true → 项目根节点，不可移出
      bucket: 'long_term' | 'short_term' | 'waiting' | 'inbox' | 'skill'
    }
  },

  // ── 自动化核心（仅 persistent 任务） ──────────────
  persistent: {
    kind: 'recurring_task' | 'scheduled_task' | 'waiting_task' | 'skill',
    state: 'active' | 'paused',   // paused 时调度器跳过自动触发

    // ── 执行配置 ───────────────────────────────────
    execution: {
      mode: 'in_place' | 'spawn_session',
      runPrompt: string,          // 每次触发时传给 AI 的指令
      shellCommand?: string,      // 仅 skill 使用，AI 运行前执行的 shell 脚本
      maxTurns?: number,          // 安全上限（自动触发默认 40，手动不限）
      lastTriggerAt?: ISO,        // 上次触发时间
      lastTriggerKind: 'recurring' | 'schedule' | 'manual' | ''
    },

    // ── 运行时策略 ─────────────────────────────────
    runtimePolicy: {
      manual: {
        mode: 'follow_current' | 'session_default' | 'pinned',
        runtime?: { tool, model, effort, thinking }
      },
      schedule: {
        mode: 'session_default' | 'pinned',
        runtime?: { tool, model, effort, thinking }
      }
    },

    // ── recurring_task 专用 ────────────────────────
    recurring?: {
      cadence: 'hourly' | 'daily' | 'weekly',
      timeOfDay: string,          // 'HH:MM' 格式，本地时间
      timezone: string,           // IANA tz，如 'Asia/Shanghai'
      weekdays?: number[],        // 仅 weekly 时有效，0=周日
      nextRunAt: ISO              // 调度器预计算的下次触发时间
    },

    // ── scheduled_task 专用 ────────────────────────
    scheduled?: {
      runAt: ISO,                 // 目标触发时间（必填）
      nextRunAt: ISO,             // 同 runAt，统一接口查询用
      ranAt?: ISO                 // 已运行则记录，防止重复触发
    },

    // ── recurring_task 专用：GTD 流水线 ───────────
    loop?: {
      collect:  { sources: string[], instruction: string },
      organize: { instruction: string },
      use:      { instruction: string },
      prune:    { instruction: string }
    },

    // ── skill 专用 ─────────────────────────────────
    skill?: {
      lastUsedAt: ISO             // 最近一次手动触发时间
    }
  }
}
```

### 2.2 字段存在性矩阵

| 字段 | recurring_task | scheduled_task | waiting_task | skill |
|---|:---:|:---:|:---:|:---:|
| `persistent.recurring` | **必须** | — | — | — |
| `persistent.scheduled` | — | **必须** | — | — |
| `persistent.loop` | 可选 | — | — | — |
| `persistent.skill` | — | — | — | 可选 |
| `execution.shellCommand` | — | — | — | 可选 |
| `execution.maxTurns` | 建议设 | 建议设 | 不限 | 不限 |

---

## 3. 触发机制

### 3.1 调度器主循环

调度器（`scheduler.mjs`）每 30 秒轮询所有 persistent session：

```
每 30 秒:
  for each session:
    1. 跳过条件（任一满足则跳过）:
       - session.archived === true
       - workflowState in ['done', 'complete', 'completed']
       - session 当前正在运行（busy）
       - persistent.state === 'paused'（仅对 schedule/recurring 有效）

    2. 解析触发类型: resolvePersistentDueTriggerKind(persistent, now)
       → 'schedule' : scheduled.nextRunAt <= now && !scheduled.ranAt
       → 'recurring': recurring.nextRunAt <= now
       → null       : 无需触发

    3. 若有触发类型:
       - 写入 execution.lastTriggerAt / lastTriggerKind
       - 根据 execution.mode 执行任务
```

### 3.2 触发决策树

```
resolvePersistentDueTriggerKind(persistent, now):

  if kind === 'scheduled_task':
    if scheduled.nextRunAt <= now AND scheduled.ranAt 不存在:
      return 'schedule'   ← 一次性，触发后写 ranAt 防重复
    return null

  if kind === 'recurring_task':
    if recurring.nextRunAt <= now:
      return 'recurring'  ← 触发后重新计算 nextRunAt
    return null

  // waiting_task / skill: 调度器不处理
  return null
```

### 3.3 maxTurns 安全阀

| 触发方式 | maxTurns 默认值 | 目的 |
|---|---|---|
| 自动触发（schedule/recurring） | **40** | 防止 AI 无限循环耗费资源 |
| 手动触发（manual） | **无上限** | 用户在场可随时干预 |
| 显式配置 `execution.maxTurns` | 以配置值为准 | 精细控制特定任务 |

建议值参考：
- 简单任务（查询、整理）：10–20
- 中等任务（分析、报告）：30–50
- 复杂任务（代码修改、多步调研）：80–120

---

## 4. 项目归属系统

### 4.1 taskPoolMembership 结构语义

| role | fixedNode | 含义 |
|---|---|---|
| `'project'` | `true` | **项目根节点**。通常是 `recurring_task`，拥有独立子任务空间，不可移入其他项目 |
| `'member'` | `false` | **普通成员任务**。归属于某个项目，可在项目内 bucket 之间移动 |
| `'member'` | `true` | **固定成员任务**。归属项目但不可移出，通常是系统内置任务 |

### 4.2 Session 成为项目根的条件

同时满足以下四点：
1. `persistent.kind === 'recurring_task'`
2. `taskPoolMembership.longTerm.role === 'project'`
3. `taskPoolMembership.longTerm.fixedNode === true`
4. `taskPoolMembership.longTerm.projectSessionId === self.id`（指向自身）

### 4.3 Bucket 与 Kind 的默认映射

```
KIND_TO_BUCKET = {
  recurring_task  → 'long_term'   // 项目根所在层
  scheduled_task  → 'short_term'  // 有时效的短期任务
  waiting_task    → 'waiting'     // 等待外部条件
  skill           → 'skill'       // 快捷工具层
}
// 无 persistent 的普通 session → 'inbox'
```

### 4.4 系统项目

系统首次启动时自动创建：

```js
{
  name: '日常任务',
  builtinName: 'daily-tasks',
  taskListOrigin: 'system',
  // 所有未显式指定归属的新 session 自动进入其 inbox bucket
  // 不可删除、不参与每日自动归档
}
```

---

## 5. 执行模式

### 5.1 in_place vs spawn_session

| 模式 | 行为 | 适用场景 |
|---|---|---|
| `in_place` | 在当前 session 的消息历史中追加新一轮对话 | 需要保留完整上下文的周期任务；GTD 回顾类 |
| `spawn_session` | 创建子 session，继承配置但独立消息历史 | 每次运行相互独立；避免历史噪声 |

### 5.2 runtimePolicy 三种 mode

```js
// manual.mode（手动触发时使用）
'follow_current'   // 使用用户当前界面选中的模型
'session_default'  // 使用该 session 的默认模型
'pinned'           // 固定使用指定 runtime（需配合 runtime 字段）

// schedule.mode（自动触发时使用，无 follow_current）
'session_default'
'pinned'
```

### 5.3 shellCommand 执行时序（skill 专用）

```
用户点击 skill 按钮
  │
  ▼
执行 shellCommand（若存在）
  │  在 session 工作目录下运行
  │  输出结果注入到 AI 上下文
  ▼
执行 runPrompt（AI 指令）
  │  AI 可访问 shellCommand 的输出
  ▼
返回结果给用户
```

这使 skill 可以先采集实时数据（git diff、文件列表、API 响应），再让 AI 基于真实数据执行操作。

---

## 6. Loop 流水线（recurring_task 专用）

### 6.1 GTD 四阶段模型

```
collect → organize → use → prune
```

```js
loop: {
  collect: {
    sources: ['inbox', 'email', 'notes'],
    instruction: '从以上来源收集所有新条目，原样记录'
  },
  organize: {
    instruction: '将收集到的条目分类，移入对应项目'
  },
  use: {
    instruction: '处理今日到期任务，生成行动清单'
  },
  prune: {
    instruction: '归档已完成任务，删除过期提醒'
  }
}
```

### 6.2 阶段职责

| 阶段 | GTD 对应 | 职责 |
|---|---|---|
| `collect` | Capture | 无脑收集，清空输入端 |
| `organize` | Clarify + Organize | 判断每条条目的下一步，归入正确 bucket |
| `use` | Engage | 实际执行或生成今日行动清单 |
| `prune` | Review（清理） | 删除无效项，防止系统熵增 |

**何时启用 loop：** 任务性质是周期性信息处理（日报、周报、知识整理），需要有状态的四段式 AI 工作流。普通的"每天发一条提醒"只需要 `runPrompt`，不需要 loop。

---

## 7. 生命周期状态机

### 7.1 双轴状态

```
persistent.state      → 控制调度器是否触发
session.workflowState → 控制 session 是否可用
```

### 7.2 persistent.state 转换

```
         用户手动暂停
  active ──────────────► paused
    ▲                       │
    │    用户手动恢复         │
    └───────────────────────┘

- active: 调度器正常检查触发条件
- paused: 调度器跳过 schedule/recurring，手动触发不受影响
```

### 7.3 workflowState 转换

```
''（新建/运行中）
  │
  ├──► 'parked'       // AI 主动暂存，等待用户稍后继续
  ├──► 'waiting_user' // AI 等待用户输入后继续
  └──► 'done'         // 本轮任务完成
         │
         │  下次调度器触发前（persistent 任务）
         ▼
       ''（清空，重新激活）
```

### 7.4 done 清除机制（关键设计）

对于 persistent 任务，`workflowState: done` 是**临时状态**（本轮完成），不是终态（永久关闭）：

```
调度器触发 recurring_task 前:
  if session.workflowState in ['done', 'complete', 'completed']:
    session.workflowState = ''   // 重置，允许本轮重新运行
```

**永久关闭的正确方式：**
1. `persistent.state = 'paused'`（暂停自动触发）
2. `session.archived = true`（归档，调度器完全跳过）

### 7.5 调度器跳过条件汇总

```
跳过，若:
  session.archived === true                          → 已归档
  workflowState in ['done','complete','completed']   → 上轮未清除前不重复触发
  session 正在运行（busy lock）                      → 防并发
  persistent.state === 'paused'                      → 用户主动暂停（仅自动触发）
```

### 7.6 每日维护（daily-maintenance.mjs）

```
每天 00:00:
  B3: 归档 — 将 workflowState=done 且完成时间在昨日 00:00 之前的 session 归档
  B5: 清理 — 30 天无更新的 inbox session 标记为 done
  写入: worklog（人类可读）+ agent digest（AI 可读）
```

---

## 8. 设计原则

### 原则一：Kind 决定 Bucket，Bucket 决定 UI 层级

`kind → bucket` 是硬编码映射，保证任务视图的一致性：用户始终知道在哪里找到哪类任务。`long_term` 是项目根，`short_term` 是时效任务，`waiting` 是阻塞任务，`inbox` 是未分类输入，`skill` 是工具栏。这个层级设计直接来自 GTD 框架。

### 原则二：双轴状态分离关注点

`persistent.state`（active/paused）和 `workflowState`（done/parked/waiting_user）解决不同问题：前者是**运营控制**（这个任务应不应该继续跑），后者是**执行状态**（这一轮跑完了没有）。两者正交，避免了用单一字段同时表达"暂停"和"完成"导致的语义混乱。

### 原则三：done 是周期任务的临时态

对于 inbox session，`done` 是终态；对于 persistent 任务，`done` 仅表示"本轮执行完毕"。调度器在下次触发前清除该标志，使任务可以重新运行。永久关闭用 `paused` 或 `archived`。

### 原则四：手动触发绕过 paused 检查

`persistent.state === 'paused'` 只阻止**自动触发**，不阻止**手动触发**。用户可能暂停一个每日任务（不想让它自动跑），但仍希望某天手动执行一次。如果 paused 同时阻断手动触发，会让"暂停"变成"锁死"。

### 原则五：maxTurns 的不对称设计

自动触发设置 40 轮上限，手动触发不限。这反映了**资源托管与用户主权**的平衡：自动触发在用户离开时运行，必须有安全阀；手动触发时用户在场，可随时终止。

---

---

## 9. 用户路径与任务生成机制

### 9.1 完整用户路径

```
用户随机发起对话
  │
  ▼
inbox（收集箱）← 这是用户做的事：随手记录、即兴对话
  │
  │  对话过程中，AI 或用户发现有价值的模式
  │
  ├──► "这件事需要 AI 定期自动做"
  │       → AI 创建 recurring_task（长期任务）
  │         例：每天整理任务列表、每周复盘理财数据
  │
  ├──► "这件事需要 AI 在某个时间点做一次"
  │       → AI 创建 scheduled_task（短期任务）
  │         例：下周一发送会议提醒、明天整理本周素材
  │
  └──► "这个操作我以后会反复手动触发"
          → AI 创建 skill（快捷按钮）
            例：一键生成周报、一键整理收集箱

长期任务 / 短期任务执行过程中遇到卡点
  │  AI 无法独立推进，需要人类介入
  │
  ▼
AI 自动创建 waiting_task（等待任务）
  │
  ├──► 决策类：AI 列出选项，等人类选择
  │       例："请确认本次摄影地点：A 西湖 / B 鼓浪屿"
  │
  └──► 信息传递类：AI 需要人类提供数据/文件/输入
            例："请提供本月账单截图"、"请填写本周工作数据"
```

### 9.2 收集箱是用户的入口，等待任务是 AI 的出口

这是两个方向相反的机制：

| | 谁创建 | 谁执行 | 目的 |
|---|---|---|---|
| **inbox** | 用户（随机对话） | 用户 | 用户把想法/任务放进系统 |
| **waiting_task** | AI（执行中遇到卡点） | 用户触发 | AI 把需要人类介入的事交出去 |

### 9.3 等待任务的两种子类型

等待任务的本质是 **AI 给人类的一个任务单**，分为两类：

#### 决策任务（decision）

AI 已经准备好了选项，人类只需要选择，AI 继续执行。

**特征：**
- AI 在 `digest.summary` 或 `runPrompt` 里清楚列出选项
- 人类触发时可以不输入任何内容（直接点"触发"= 确认继续）
- 也可以在触发时附带选择（通过 `runPrompt` 传入，API 已支持）

**示例：**
```
等待任务：确认本次拍摄地点
───────────────────────────
AI 已分析备选地点：
A. 西湖（光线佳，人流多，建议 06:00 前到达）
B. 鼓浪屿（需提前预约，建议工作日）
C. 维持上次地点

请选择后触发此任务，AI 将据此安排后续行程。
```

#### 信息传递任务（input）

AI 需要人类提供某个数据或文件，才能继续推进。

**特征：**
- AI 在 `digest.summary` 里说明需要什么信息
- 人类触发时需要在对话里输入内容（当前 session 的对话框承载）
- AI 收到触发消息后，在对话里追问/等待用户输入

**示例：**
```
等待任务：填写本周工作数据
───────────────────────────
需要你提供：
1. 本周完成的任务数量
2. 下周优先级最高的 3 件事

触发后在对话框里填写即可，AI 将整合进周报。
```

### 9.4 信息传递的技术实现

等待任务触发时，`runPrompt` 字段会被拼接进 AI 收到的消息里（`buildPersistentRunMessage`）。

**API 调用方式：**

```bash
# 触发等待任务，附带用户的选择或信息
curl -X POST "$MELODYSYNC_CHAT_BASE_URL/api/sessions/<WAITING_TASK_ID>/run-persistent" \
  -H "Content-Type: application/json" \
  -d '{
    "runPrompt": "用户选择：B 鼓浪屿。请安排后续行程。"
  }'
```

**AI 收到的消息结构：**
```
[等待任务触发]
名称：确认本次拍摄地点
摘要：...
触发方式：一键触发
用户选择：B 鼓浪屿。请安排后续行程。   ← runPrompt 附加在此
```

### 9.5 等待任务的 UI 呈现要求

等待任务在侧边栏 `waiting` bucket 里展示，需要清楚传递：

1. **AI 在等什么** — `digest.summary` 里用一句话说清楚（AI 创建时写入）
2. **人类需要做什么** — `runPrompt` 里给出具体指引
3. **触发后会发生什么** — 触发后 AI 继续在该 session 的对话里推进

**当前实现：** 任务卡片点击"触发"即可，对话框承载信息输入。

**未来优化方向（`waitingType` 字段）：**
- `waitingType: "decision"` → UI 显示选项卡片，点选即触发
- `waitingType: "input"` → UI 显示输入框，填写后提交
- `waitingType: "general"` → 当前默认行为（纯对话触发）

### 9.6 AI 创建等待任务的规范

AI 在执行长期/短期任务遇到卡点时，应按以下规范创建等待任务：

```bash
# 创建决策类等待任务
curl -X POST "$MELODYSYNC_CHAT_BASE_URL/api/sessions" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "等待：[需要人类决策的事项]",
    "folder": "~/.melodysync/runtime",
    "tool": "claude",
    "persistent": {
      "kind": "waiting_task",
      "digest": {
        "title": "等待：确认拍摄地点",
        "summary": "AI 已分析三个备选地点，需要你选择后继续安排行程。"
      },
      "execution": {
        "mode": "in_place",
        "runPrompt": "用户已选择地点，请继续安排后续拍摄行程和准备清单。"
      }
    }
  }'
```

**命名规范：** 等待任务名称以"等待："开头，后接一句话描述人类需要做的事。

**创建时机：**
- 执行中需要人类决策 → 立即创建，在当前 session 告知用户
- 需要人类提供信息 → 立即创建，在当前 session 说明需要什么
- 不要因为"可能需要"就提前创建，等到真正卡点再创建

---

*文档版本：2026-04-13，更新：2026-04-13（补充用户路径与等待任务设计）。*
