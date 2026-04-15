# MelodySync 数据结构全图

> 自顶向下的分层结构参考。每一层描述对象 shape、字段约束、枚举值、与相邻层的关系。
>
> 来源：代码扫描 2026-04，基于实际 normalize 函数和 schema 提取。
> 关联：`docs/data-storage-design.md`（存储位置与保留策略）

---

## 层次概览

```
┌─────────────────────────────────────────────────────┐
│  L1  Session          核心产品对象，持久工作线程       │
│       ├── L1a  SessionActivity    运行时活动状态       │
│       ├── L1b  TaskCard           AI 维护的任务卡      │
│       ├── L1c  PersistentConfig   自动化任务配置       │
│       ├── L1d  TaskPoolMembership 项目归属             │
│       └── L1e  SessionState       长期投影状态         │
├─────────────────────────────────────────────────────┤
│  L2  Run              Session 下的一次执行尝试         │
│       ├── L2a  RunManifest        执行参数快照          │
│       ├── L2b  RunResult          最终结果信封          │
│       └── L2c  SpoolRecord        provider 原始输出行  │
├─────────────────────────────────────────────────────┤
│  L3  History          Session 的事件流                 │
│       ├── L3a  HistoryMeta        transcript 控制文件  │
│       ├── L3b  HistoryEvent       单条事件              │
│       └── L3c  ContextHead        prompt 构建用快照    │
├─────────────────────────────────────────────────────┤
│  L4  Workbench        任务图与项目管理层               │
│       ├── L4a  Project            长期项目              │
│       ├── L4b  Node               任务图节点            │
│       ├── L4c  TaskMapPlan        图结构（节点+边）     │
│       ├── L4d  BranchContext      分支上下文            │
│       ├── L4e  Skill              快捷按钮              │
│       └── L4f  CaptureItem        收集箱条目            │
├─────────────────────────────────────────────────────┤
│  L5  Settings         配置与运行时偏好                 │
│       ├── L5a  GeneralSettings    全局路径与偏好        │
│       ├── L5b  HookSettings       hook 启停状态         │
│       └── L5c  CustomHook         自定义 hook 定义      │
└─────────────────────────────────────────────────────┘
```

---

## L1 Session

**持久化位置：** `sessions/sessions.db`（SQLite，`data` 列存完整 JSON）

> 字段按**维护层**分组，每个字段标注写入来源。
> `[U]` = 用户操作触发  `[R]` = Run 生命周期触发  `[S]` = 调度器/系统触发  `[C]` = 创建时写入

### 完整字段

```
Session {

  ── 身份（创建时写入，之后不变） ─────────────────────────────
  id              string    [C]  'sess_' + 24位 hex，不可变
  created         ISO8601   [C]  创建时间
  ordinal         number    [C]  侧边栏全局排序序号，正整数，唯一
  builtinName?    string    [C]  内置任务专用（'daily-tasks' 等）

  ── 用户可编辑的展示字段 ──────────────────────────────────────
  name            string    [U]  用户可见标题
  autoRenamePending? true   [U]  存在且为 true = 等待 AI 自动生成标题
  folder          string    [U]  侧边栏文件夹路径，默认 '~'
  group?          string    [U]  分组标签，≤32 字符
  description?    string    [U]  一句话描述，≤160 字符
  sidebarOrder?   number    [U]  组内手动排序（正整数）
  pinned?         true      [U]  置顶（archived 时不可设）
  archived?       true      [U]  存在且为 true = 已归档
  archivedAt?     ISO8601   [U]  归档时间（与 archived 联动）
  lastReviewedAt? ISO8601   [U]  用户最后标记为已读的时间
  activeAgreements? string[] [U] 工作协议，≤6 条，每条 ≤240 字符

  ── 运行时偏好（用户可配置） ──────────────────────────────────
  tool?           string    [U]  'claude' | 'codex' 等
  model?          string    [U]  模型 ID
  effort?         string    [U]  'low' | 'medium' | 'high'
  thinking?       boolean   [U]  是否启用扩展思考
  systemPrompt?   string    [U]  自定义系统提示

  ── 工作流状态 ────────────────────────────────────────────────
  workflowState?  WorkflowState  [U/S]  见下方枚举
  workflowPriority? WorkflowPriority [U] 见下方枚举
  workflowCompletedAt? ISO8601  [U/S]  workflowState→done 时写入，清除时删除
  suppressedBranchTitles? string[] [U]  用户手动压制的分支候选标题列表

  ── Run 生命周期状态（跨重启恢复用） ─────────────────────────
  activeRunId?      string    [R]  当前活跃 run 的 ID
  followUpQueue?    FollowUpEntry[]  [R]  排队中的跟进消息
  recentFollowUpRequestIds? string[] [R]  最近跟进请求 ID（去重用）
  claudeSessionId?  string    [R]  Claude provider 的会话 ID（resume 用）
  codexThreadId?    string    [R]  Codex provider 的 thread ID（resume 用）
  compactionSessionId? string [R]  正在压缩此 session 的 compactor session ID

  ── 工作流监控信号（workbench 指标用） ───────────────────────
  workflowSignals?  WorkflowSignals  [R]  见下方结构

  ── 任务结构子对象 ────────────────────────────────────────────
  taskCard?             TaskCard          [R/U]  见 L1b
  taskCardManagedBindings? string[]       [R]    taskCard 中由系统管理的字段名列表
  sessionState?         SessionState      [R]    见 L1e
  persistent?           PersistentConfig  [S/U]  见 L1c
  taskPoolMembership?   TaskPoolMembership [C/U] 见 L1d

  ── 可见性分类（创建时写入，偶尔更新） ───────────────────────
  taskListOrigin?     'user'|'assistant'|'system'  [C]
  taskListVisibility? 'primary'|'secondary'|'hidden' [C]

  ── Fork 血缘（创建时写入，不变） ────────────────────────────
  forkedFromSessionId? string    [C]  fork 来源 session ID
  forkedFromSeq?       number    [C]  fork 时来源 session 的最新 seq
  rootSessionId?       string    [C]  整个 fork 树的根 session ID

  ── 来源元数据（连接器写入，创建时） ─────────────────────────
  sourceId?           string    [C]  连接器标识（'email'|'voice'|'github' 等）
  sourceName?         string    [C]  连接器显示名称
  externalTriggerId?  string    [C]  外部触发 ID（email thread ID 等，用于去重）
  sourceContext?      object    [C/S]  来源上下文（parentSessionId、nodeId 等）
  completionTargets?  CompletionTarget[]  [C]  任务完成后的邮件通知目标

  ── 系统内部字段（创建时写入，不对外） ───────────────────────
  internalRole?       string    [C]  内部 session 标记，见下方枚举
  compactsSessionId?  string    [C]  此 session 是哪个 session 的 compactor

  ── 时间戳（各层更新） ───────────────────────────────────────
  updatedAt           ISO8601   [*]  最后任意字段更新时间
}
```

### WorkflowState 枚举

```
''             → active（默认，正常运行中）
'waiting_user' → 等待用户输入后继续
'done'         → 本轮完成（persistent 任务的临时态，非终态）
'paused'       → 暂停（原 'parked'/'backlog'/'todo' 均规范化到此）

别名输入（normalize 时自动转换）：
  pause / parked / backlog / todo    → 'paused'
  waiting / waiting_for_user / ...   → 'waiting_user'
  complete / completed / finished    → 'done'

注意：persistent 任务的 done 是临时态，调度器下次触发前会清除。
      普通 session 的 done 是终态。
```

### WorkflowPriority 枚举

```
'high'   → urgent / asap / important / critical / p1
'medium' → normal / default / soon / p2
'low'    → later / backlog / deferred / p3
''       → 未设置
```

### InternalRole 枚举

```
'agent_delegate'      → AI 委托的子 session（由 branching-service 写入）
'context_compactor'   → 上下文压缩专用 session（由 compaction-service 写入）
'session_list_organizer' → session 列表整理 session（由 organizer 写入）

internalRole 存在 → taskListOrigin='system', taskListVisibility='hidden'
```

### WorkflowSignals 结构

```
WorkflowSignals {
  repeatedClarificationCount?  number   AI 反复要求澄清的次数
  lastRepeatedClarificationAt? ISO8601  最后一次反复澄清的时间
  lastRepeatedClarificationSignal? string  触发信号内容
  lastFailureReason?           string   最后一次失败原因
  branchDispatch?: {
    attempts:        number   总尝试次数
    successes:       number   成功次数
    failures:        number   失败次数
    dayStart:        ISO8601  当天统计起始时间
    dayAttempts:     number   当天尝试次数
    daySuccesses:    number   当天成功次数
    dayFailures:     number   当天失败次数
    lastAttemptAt:   ISO8601 | ''
    lastSuccessAt:   ISO8601 | ''
    lastFailureAt:   ISO8601 | ''
    lastOutcomeAt:   ISO8601 | ''
    lastFailureReason: string
    lastOutcome:     'success' | 'failure' | ''
    lastBranchTitle: string
    lastAttemptSource: string
  }
}

写入来源：
  repeatedClarification* → finalization.mjs（run 完成后检测反复澄清模式）
  branchDispatch         → branch-dispatch-signals.mjs（分支派发时记录）
读取方：output-metrics-service（workbench 指标）、read-routes（output panel API）
```

### CompletionTarget 结构

```
CompletionTarget {
  id:        string   目标 ID
  type:      'email'  目标类型（当前只有 email）
  requestId: string   关联的请求 ID
  to:        string   收件人地址
}

写入来源：creation-service（创建 session 时传入）
读取方：email-completion-hook（run 完成后触发邮件通知）
```

### FollowUpEntry 结构

```
FollowUpEntry {
  requestId:  string   跟进请求 ID（去重用）
  text:       string   跟进消息文本
  attachments?: any[]  附件
  queuedAt:   ISO8601  入队时间
}

写入来源：message-submission-service（session 忙时入队）
读取方：follow-up-queue-service（run 完成后自动重放）
```

### 可见性规则（派生，不存储）

```
taskListOrigin 推导顺序：
  1. 显式 taskListOrigin 字段
  2. internalRole 存在 → 'system'
  3. name = 'sort session list' 或 systemPrompt 含 organizer 标记 → 'system'
  4. forkedFromSessionId 存在 / parentSessionId 存在 / name 匹配 delegate 模式 → 'assistant'
  5. 默认 → 'user'

taskListVisibility 推导顺序：
  1. 显式 taskListVisibility 字段
  2. internal → 'hidden'
  3. organizer → 'hidden'
  4. assistant child → 'secondary'
  5. 默认 → 'primary'
```

---

## L1a SessionActivity（运行时活动，不持久化）

```
SessionActivity {
  run: {
    state:           'running' | 'idle'
    phase:           string | null
    startedAt:       ISO8601 | null
    runId:           string | null
    cancelRequested: boolean
  }
  queue: {
    state: 'queued' | 'idle'
    count: number
  }
  rename: {
    state: 'pending' | 'failed' | 'idle'
    error: string | null
  }
  compact: {
    state: 'pending' | 'idle'
  }
}
```

---

## L1b TaskCard（AI 维护的任务卡）

**持久化位置：** 嵌套在 Session 的 `data` JSON 列中

```
TaskCard {
  version:           1
  mode:              'project' | 'task'
  summary:           string    ≤2400 字符，短标题
  goal:              string    ≤2400 字符，当前目标
  mainGoal:          string    ≤2400 字符，主线目标
  lineRole:          'main' | 'branch'
  branchFrom?:       string    ≤420 字符，分支来源
  branchReason?:     string    ≤420 字符，分支原因
  checkpoint:        string    ≤2400 字符，恢复提示
  candidateBranches: string[]  ≤3 条，每条 ≤220 字符
  knownConclusions:  string[]  ≤4 条，每条 ≤420 字符
} | null
```

**文本规范化：**
- 转小写
- `\r\n` → `\n`
- 非字母/数字/CJK/空格字符删除
- 多空格 → 单空格

---

## L1c PersistentConfig（自动化任务配置）

**持久化位置：** 嵌套在 Session 的 `data` JSON 列中

```
PersistentConfig {
  version:    1
  kind:       PersistentKind     见下方枚举
  state:      'active' | 'paused'
  promotedAt: ISO8601
  updatedAt:  ISO8601

  digest: {
    title:     string   ≤120 字符
    summary:   string   ≤280 字符
    goal:      string   ≤180 字符
    keyPoints: string[] ≤6 条，每条 ≤140 字符
    recipe:    string[] ≤6 条，每条 ≤140 字符
  }

  execution: {
    mode:            'in_place' | 'spawn_session'
    runPrompt:       string   ≤4000 字符
    lastTriggerAt:   ISO8601 | ''
    lastTriggerKind: 'recurring' | 'schedule' | 'manual' | ''
    shellCommand?:   string            仅 skill 使用
    maxTurns?:       number            自动触发默认 40
    freshThread?:    boolean
  }

  runtimePolicy: {
    manual: {
      mode:     'follow_current' | 'session_default' | 'pinned'
      runtime?: { tool, model, effort, thinking }
    }
    schedule?: {
      mode:     'session_default' | 'pinned'
      runtime?: { tool, model, effort, thinking }
    }
  }

  ── kind = 'recurring_task' 专用 ──────────────────────────────
  recurring?: {
    cadence:   'hourly' | 'daily' | 'weekly'
    timeOfDay: 'HH:MM'              本地时间
    timezone:  string               IANA tz，如 'Asia/Shanghai'
    weekdays?: number[]             0=周日，仅 weekly 有效
    nextRunAt: ISO8601              调度器预计算
    lastRunAt: ISO8601 | ''
  }

  ── kind = 'scheduled_task' 专用 ─────────────────────────────
  scheduled?: {
    runAt:     ISO8601              目标触发时间
    timezone:  string
    nextRunAt: ISO8601              = runAt，统一查询接口
    lastRunAt: ISO8601 | ''
  }

  ── kind = 'recurring_task' 可选：GTD 流水线 ─────────────────
  loop?: {
    collect:  { instruction: string, sources: string[] ≤8 条 }
    organize: { instruction: string }
    use:      { instruction: string }
    prune:    { instruction: string }
  }

  ── kind = 'skill' 专用 ──────────────────────────────────────
  skill?: {
    lastUsedAt: ISO8601
  }

  ── 可选通用字段 ──────────────────────────────────────────────
  knowledgeBasePath?: string   ≤480 字符
  workspace?: {
    path:  string   ≤480 字符
    label: string   ≤120 字符
  }
}
```

### PersistentKind 枚举

```
'recurring_task'  → bucket: 'long_term'   周期性自动执行
'scheduled_task'  → bucket: 'short_term'  定时执行一次
'waiting_task'    → bucket: 'waiting'     等待人类处理
'skill'           → bucket: 'skill'       一键触发工具

别名输入：
  recurring / periodic_task              → 'recurring_task'
  short_term_task / short_task / ...     → 'scheduled_task'
  waiting / human_task                   → 'waiting_task'
  long_skill / persistent_skill          → 'skill'
```

### 调度触发规则

```
recurring_task:  recurring.nextRunAt <= now
scheduled_task:  scheduled.nextRunAt <= now  &&  lastRunAt 不存在

跳过条件（任一满足）：
  session.archived === true
  workflowState in ['done', 'complete', 'completed']
  session 正在运行（busy）
  persistent.state === 'paused'  （仅自动触发，手动不受影响）
```

---

## L1d TaskPoolMembership（项目归属）

**持久化位置：** 嵌套在 Session 的 `data` JSON 列中

```
TaskPoolMembership {
  longTerm: {
    role:             'project' | 'member'
    projectSessionId: string      所属项目的 session ID
    fixedNode:        boolean      true = 不可移出
    bucket?:          LongTermBucket
  }
} | null

LongTermBucket 枚举：
  'inbox'      → 收集箱（未分类）
  'short_term' → 短期任务
  'long_term'  → 长期任务（项目根所在层）
  'waiting'    → 等待任务
  'skill'      → 快捷按钮

项目根的条件（同时满足）：
  persistent.kind === 'recurring_task'
  taskPoolMembership.longTerm.role === 'project'
  taskPoolMembership.longTerm.fixedNode === true
  taskPoolMembership.longTerm.projectSessionId === session.id  （指向自身）
```

---

## L1e SessionState（长期投影状态）

**持久化位置：** 嵌套在 Session 的 `data` JSON 列中（由 workbench/long-term-projection 维护）

```
SessionState {
  goal:      string   当前目标
  mainGoal:  string   主线目标
  checkpoint:string   恢复提示
  longTerm?: {
    lane:           'long-term' | 'sessions'
    role:           'project' | 'member' | ''
    rootSessionId:  string
    rootTitle:      string   ≤88 字符
    rootSummary:    string   ≤120 字符
    bucket:         string
    suggestion?: {
      rootSessionId: string
      title:         string
      summary:       string
      score:         number   ≥6 才显示，≥8 才确定
    }
  }
}
```

---

## L2 Run

**持久化位置：** `sessions/runs/<runId>/status.json`

```
Run {
  ── 身份 ─────────────────────────────────────────────────────
  id:         string    'run_' + 24位 hex
  sessionId:  string    所属 session
  requestId:  string    对应用户消息的 requestId

  ── 状态 ─────────────────────────────────────────────────────
  state:      RunState  见下方枚举
  tool:       string | null
  model:      string | null
  effort:     string | null
  thinking:   boolean

  ── 时间线 ───────────────────────────────────────────────────
  createdAt:        ISO8601
  startedAt:        ISO8601 | null
  updatedAt:        ISO8601
  completedAt:      ISO8601 | null
  finalizedAt:      ISO8601 | null   写入 canonical history 完成的时间
  lastNormalizedAt: ISO8601 | null

  ── 取消 ─────────────────────────────────────────────────────
  cancelRequested:   boolean
  cancelRequestedAt: ISO8601 | null

  ── Provider 恢复 ID ──────────────────────────────────────────
  providerResumeId?: string
  claudeSessionId?:  string
  codexThreadId?:    string

  ── 进程 ID（用于 kill） ──────────────────────────────────────
  runnerProcessId?: number
  toolProcessId?:   number
  runnerId:         string   默认 'runner_local_detached'

  ── Spool 消费进度 ────────────────────────────────────────────
  normalizedLineCount:  number   ≥0
  normalizedByteOffset: number   ≥0
  normalizedEventCount: number   ≥0

  ── Token 统计 ────────────────────────────────────────────────
  contextInputTokens?:  number | null
  contextWindowTokens?: number | null

  ── 结果 ─────────────────────────────────────────────────────
  result?:       'success' | 'error' | 'cancelled' | null
  failureReason?: string | null
}
```

### RunState 枚举

```
'accepted'   → 已接受，等待 sidecar 启动
'running'    → 正在执行
'completed'  → 正常完成
'failed'     → 执行失败
'cancelled'  → 用户取消

终止态（terminal）：completed / failed / cancelled
```

---

## L2a RunManifest

**持久化位置：** `sessions/runs/<runId>/manifest.json`

```
RunManifest {
  id:        string    = run.id
  sessionId: string
  // 执行时参数快照：prompt、工具配置、上下文大小等
  // 用于调试和 resume，不是产品真相
  // 具体字段由各 provider 写入，无固定 schema
}
```

---

## L2b RunResult（结果信封）

**持久化位置：** `sessions/runs/<runId>/result.json`

```
RunResult {
  assistantMessage:  string         最终 assistant 消息文本
  statePatch?: {
    goal?:       string
    checkpoint?: string
    needsUser?:  boolean
    lineRole?:   'main' | 'branch'
    branchFrom?: string
  }
  actionRequests?:   any[]
  memoryCandidates?: any[]
  trace?:            any[]
}
```

---

## L2c SpoolRecord

**持久化位置：** `sessions/runs/<runId>/spool.jsonl`（每行一条）

```
SpoolRecord {
  // provider 原始输出行，格式因 provider 而异
  // claude: { type, delta, ... }
  // codex:  { type, content, ... }

  // 经规范化后的字段（run-store 写入时截断）：
  line?:          string   ≤16KB inline，超出写入 lineArtifact
  lineArtifact?:  string   artifact ref（指向 artifacts/<ref>.txt）
  lineBytes?:     number
  lineIndex?:     number
}

单行最大：2MB（超出截断）
inline 上限：16KB
```

---

## L3 History

**持久化位置：** `sessions/history/<sessionId>/`

### L3a HistoryMeta

**文件：** `meta.json`

```
HistoryMeta {
  latestSeq:   number    最新事件序号（从 1 开始）
  lastEventAt: number    最后事件的 Unix ms 时间戳
  size:        number    总事件数
  counts: {
    message?:           number
    message_user?:      number
    message_assistant?: number
    reasoning?:         number
    tool_use?:          number
    tool_result?:       number
    template_context?:  number
    status?:            number
  }
}
```

---

### L3b HistoryEvent

**文件：** `events/<seq_padded9>.json`（当前实现）
**目标：** `segments/<id>.events.jsonl`（迁移中，见 session-history-storage-layout.md）

```
HistoryEvent {
  ── 必须字段 ─────────────────────────────────────────────────
  seq:       number    单调递增，从 1 开始，全局唯一
  timestamp: number    Unix ms
  type:      EventType 见下方枚举

  ── 按 type 不同的 body 字段 ──────────────────────────────────
  content?:   string   type = message / reasoning / template_context
  toolInput?: string   type = tool_use
  output?:    string   type = tool_result
  role?:      'user' | 'assistant'   type = message 时有

  ── Body 存储元数据 ───────────────────────────────────────────
  bodyPersistence?: 'externalized' | 'preview_only'   磁盘存储模式
  bodyField?:     string    body 字段名（'content' / 'toolInput' / 'output'）
  bodyAvailable?: boolean   是否有 body 可加载
  bodyLoaded?:    boolean   当前是否已加载
  bodyBytes?:     number    原始 body 字节数
  bodyRef?:       string    外部化时的 ref（'evt_NNNNNNNNN_<field>'）
  bodyTruncated?: boolean
}
```

### EventType 枚举

```
'message'          → 用户或 assistant 消息
'reasoning'        → assistant 扩展思考（hidden）
'tool_use'         → 工具调用请求
'tool_result'      → 工具调用结果
'template_context' → 注入的模板上下文（hidden）
'status'           → 运行状态事件
```

### Body 存储决策规则

```
按 type 的 inline 上限（超出则 externalize）：
  message:          64 KB
  reasoning:         0   （始终 externalize 或 preview_only）
  template_context:  4 KB
  tool_use:          2 KB
  tool_result:       4 KB

preview 截断上限（preview_only 模式）：
  message:          1600 字符
  reasoning:        1600 字符
  tool_use:          800 字符
  tool_result:      1200 字符
  status:            800 字符
```

---

### L3c ContextHead

**文件：** `context.json`

```
ContextHead {
  mode:                 'history' | 'summary'
  summary:              string    压缩后的摘要文本
  activeFromSeq:        number    有效历史起始 seq
  compactedThroughSeq:  number    压缩截止 seq
  inputTokens?:         number    上次估算的 token 数
  updatedAt:            ISO8601
  source:               string    'manual' | 'compaction' | ...
  toolIndex?:           string
  barrierSeq?:          number
  handoffSeq?:          number
  compactionSessionId?: string
}
```

**文件：** `fork-context.json`

```
ForkContext {
  mode:              'history' | 'summary'
  summary:           string
  continuationBody:  string
  activeFromSeq:     number
  preparedThroughSeq:number
  contextUpdatedAt:  ISO8601 | null
  updatedAt:         ISO8601
  source:            string
}
```

---

## L4 Workbench

**持久化位置：** `workbench/*.json`（7 个独立文件，并行读写）

### L4a Project

**文件：** `workbench/projects.json`（数组）

```
Project {
  id:           string    'proj_' + 16位 hex
  title:        string
  brief:        string
  scopeKey:     string    对应 session ID（项目根 session）
  obsidianPath: string
  status:       string
  rootNodeId:   string
  createdAt:    ISO8601
  updatedAt:    ISO8601
}
```

---

### L4b Node

**文件：** `workbench/nodes.json`（数组）

```
Node {
  id:              string    'node_' + 16位 hex
  projectId:       string
  parentId:        string | ''
  title:           string
  type:            NodeType  见下方枚举
  summary:         string
  sourceCaptureIds:string[]
  state:           NodeState 见下方枚举
  nextAction:      string
  sessionId?:      string    关联的 session ID
  sourceSessionId?:string
  createdAt:       ISO8601
  updatedAt:       ISO8601
}

NodeType 枚举：
  'question' | 'insight' | 'solution' | 'task'
  'risk' | 'conclusion' | 'knowledge'
  默认：'insight'

NodeState 枚举：
  'open' | 'active' | 'done' | 'parked'
  默认：'open'
```

---

### L4c TaskMapPlan

**文件：** `workbench/task-map-plans.json`（数组）

```
TaskMapPlan {
  id:            string
  rootSessionId: string    对应的根 session ID
  nodes: [{
    id:              string
    sessionId:       string
    sourceSessionId?: string
    label:           string
    state:           'active' | 'done' | 'waiting' | 'failed'
    bucket?:         string
    parentNodeId?:   string
  }]
  edges: [{
    fromNodeId: string
    toNodeId:   string
    kind:       EdgeKind  见下方枚举
  }]
  activeNodeId:  string
}

EdgeKind 枚举：
  'structural' | 'related' | 'depends_on' | 'blocks'
  'maintains'  | 'spawned_from' | 'suggestion'
  'completion' | 'merge'
```

---

### L4d BranchContext

**文件：** `workbench/branch-contexts.json`（数组）

```
BranchContext {
  id:              string
  sessionId:       string
  parentSessionId: string
  status:          BranchStatus  见下方枚举
  summary:         string
  createdAt:       ISO8601
  updatedAt:       ISO8601
}

BranchStatus 枚举：
  'active' | 'resolved' | 'parked' | 'merged' | 'suppressed'
```

---

### L4e Skill（快捷按钮）

**文件：** `workbench/skills.json`（数组）

```
Skill {
  id:          string
  projectId?:  string    归属项目（可选）
  sessionId:   string    对应的 persistent session ID
  title:       string
  summary:     string
  pinned?:     boolean   常用标记
  createdAt:   ISO8601
  updatedAt:   ISO8601
}
```

---

### L4f CaptureItem（收集箱条目）

**文件：** `workbench/capture-items.json`（数组）

```
CaptureItem {
  id:              string    'cap_' + 16位 hex
  sourceSessionId: string
  sourceMessageSeq:number | null
  text:            string
  title:           string    ≤72 字符，从 text 推导
  kind:            NodeType
  status:          'inbox' | 'filed'
  createdAt:       ISO8601
  updatedAt:       ISO8601
  projectId?:      string    归档后关联项目
  promotedNodeId?: string    晋升为 Node 后的 node ID
}
```

---

## L5 Settings

### L5a GeneralSettings

**文件：** `~/.config/melody-sync/general-settings.json`（bootstrap）
**文件：** `runtimeRoot/config/general-settings.json`（runtime）

```
GeneralSettings {
  ── 路径配置（bootstrap 文件存储） ───────────────────────────
  brainRoot:   string    大脑目录路径
  runtimeRoot: string    运行时目录路径
  appRoot:     string    = brainRoot（别名）

  ── 用户偏好（runtime 文件存储） ─────────────────────────────
  completionSoundEnabled:  boolean   默认 true
  taskListTemplateGroups:  string[]  ≤12 条，每条 ≤32 字符

  ── 派生路径（只读，从 brainRoot/runtimeRoot 计算） ──────────
  configuredBrainRootPath:   string
  configuredRuntimeRootPath: string
  storagePath:               string
  bootstrapStoragePath:      string
  machineOverlayRoot:        string
  runtimeConfigRoot:         string
  emailPath:                 string
  hooksPath:                 string
  voicePath:                 string
  sessionsPath:              string
  logsPath:                  string
  memoryPath:                string
  workbenchPath:             string
  providerRuntimeHomesPath:  string
  customHooksPath:           string
  agentsPath:                string
  runtimeMode:               'split' | 'unified'
}
```

---

### L5b HookSettings

**文件：** `runtimeRoot/hooks/settings.json`

```
HookSettings {
  [hookId: string]: boolean   // hook ID → 是否启用
}
```

---

### L5c CustomHook

**文件：** `runtimeRoot/hooks/custom-hooks.json`（数组）

```
CustomHook {
  id:              string    'custom.<name>'
  eventPattern:    string    如 'instance.startup'
  label:           string
  shellCommand:    string
  runInBackground?:boolean
  enabled?:        boolean
}
```

---

## 层间关系图

```
Session ──────────────────────────────────────────────────────
  │  id                   ← 主键
  │  activeRunId          → Run.id
  │  rootSessionId        → Session.id（自引用，分支血缘）
  │  forkedFromSessionId  → Session.id
  │  taskPoolMembership
  │    .longTerm.projectSessionId → Session.id（项目根）
  │  persistent.execution.lastTriggerAt（调度器写）
  │
  ├── Run ───────────────────────────────────────────────────
  │     │  id
  │     │  sessionId       → Session.id
  │     │  finalizedAt     → 写入 History 完成后设置
  │     └── SpoolRecord[]  （spool.jsonl，finalize 后降级）
  │
  ├── History ────────────────────────────────────────────────
  │     │  sessionId（目录名）
  │     ├── HistoryMeta    （meta.json）
  │     ├── HistoryEvent[] （events/*.json → segments/*.events.jsonl）
  │     └── ContextHead    （context.json + fork-context.json）
  │
  └── Workbench ──────────────────────────────────────────────
        │
        ├── Project
        │     │  scopeKey   → Session.id（项目根 session）
        │     └── Node[]
        │           └── sessionId → Session.id
        │
        ├── TaskMapPlan
        │     │  rootSessionId → Session.id
        │     └── nodes[].sessionId → Session.id
        │
        ├── BranchContext
        │     │  sessionId       → Session.id
        │     └── parentSessionId → Session.id
        │
        ├── Skill
        │     └── sessionId → Session.id（persistent session）
        │
        └── CaptureItem
              └── sourceSessionId → Session.id
```

---

## 字段约束速查表

| 字段 | 最大长度 | 枚举值 |
|---|---|---|
| Session.name | 无硬限制 | — |
| Session.group / manualGroup | 32 字符 | — |
| Session.description | 160 字符 | — |
| Session.workflowState | — | '' / 'waiting_user' / 'done' / 'paused' |
| Session.effort | — | 'low' / 'medium' / 'high' |
| Session.activeAgreements | 6 条 × 240 字符 | — |
| TaskCard.summary / goal / mainGoal / checkpoint | 2400 字符 | — |
| TaskCard.candidateBranches | 3 条 × 220 字符 | — |
| TaskCard.knownConclusions | 4 条 × 420 字符 | — |
| PersistentConfig.digest.title | 120 字符 | — |
| PersistentConfig.digest.summary | 280 字符 | — |
| PersistentConfig.execution.runPrompt | 4000 字符 | — |
| PersistentConfig.kind | — | 见 PersistentKind 枚举 |
| PersistentConfig.state | — | 'active' / 'paused' |
| Run.state | — | 见 RunState 枚举 |
| HistoryEvent.type | — | 见 EventType 枚举 |
| Node.type | — | 见 NodeType 枚举 |
| Node.state | — | 见 NodeState 枚举 |
| BranchContext.status | — | 见 BranchStatus 枚举 |
| CaptureItem.title | 72 字符 | — |
