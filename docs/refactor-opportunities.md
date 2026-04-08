# 架构优化机会

> 调研日期：2026-03-31
> 背景：系统处于 demo 阶段，以下为调研发现的优化机会，按优先级排列。

---

## 一、性能问题

### P0 — Runner stdout 无背压控制（可能导致进程挂起）

**文件**：`backend/run/sidecar.mjs:238`

**现状**：
```javascript
createInterface({ input: proc.stdout }).on('line', (line) => {
  void recordStdoutLine(line);  // fire-and-forget，不等待 I/O
});
```

`recordStdoutLine` 是异步 I/O，如果 AI 输出速度 > 磁盘写入速度，行会堆积在内存。`createInterface` 内部缓冲区满时会停止读取，导致 AI 进程的 stdout 管道被阻塞，进程挂起。

**风险场景**：长响应 + 磁盘 I/O 慢（如 NFS、慢 SSD）。

**修复**：将 `void recordStdoutLine(line)` 改为 `await recordStdoutLine(line)`，或实现显式写入队列。

**改动量**：1 行。

---

### P1 — `loadHistory` 是 N+1 串行查询

**文件**：`backend/history.mjs:403`

**现状**：
```javascript
for (let seq = fromSeq; seq <= meta.latestSeq; seq += 1) {
  const stored = await loadStoredEvent(sessionId, seq);     // 串行，每次一个文件 I/O
  events.push(includeBodies ? await hydrateEvent(...) : stored);
}
```

200 条消息的会话 = 400 次串行 I/O。此函数在 `buildPromptForToolInvocation`、`getSessionOperationRecords`、`finalizeDetachedRun` 等高频路径都有调用。

**优化**：
```javascript
const seqs = Array.from({ length: meta.latestSeq - fromSeq + 1 }, (_, i) => fromSeq + i);
const rawEvents = await Promise.all(seqs.map(seq => loadStoredEvent(sessionId, seq)));
```

**改动量**：约 10 行。

---

### P1 — `getSessionOperationRecords` 在循环里串行 loadHistory

**文件**：`backend/workbench/index.mjs`（当前对应 `operation-records.mjs` / `index.mjs` 组合）

**现状**：
```javascript
for (const ctx of state.branchContexts || []) {
  const branchEvents = await loadHistory(branchSess.id, ...); // 每个分支串行
}
```

5 个分支 session = 5 次串行 loadHistory，每次又是 N+1。

**优化**：
```javascript
const branchHistories = await Promise.all(
  validBranches.map(({ branchSess }) => loadHistory(branchSess.id, ...))
);
```

**改动量**：约 5 行。

---

### P2 — `finalizeDetachedRun` 有大量串行 await

**文件**：`backend/session/manager.mjs:2540`

**现状**：Run 完成后约 18 个串行 await，其中多个互不依赖：

```
appendEvents(finalizedEvents)          → 写历史
mutateSessionMeta(...)                 → 更新会话元数据      ← 可与 updateRun 并行
updateRun(...)                         → 更新 Run 状态       ← 可与 mutateSessionMeta 并行
findSessionMeta(sessionId)             → 查会话（刚写过的）  ← 可复用上面的返回值
updateSessionTaskCard(...)             → 更新 taskCard
findLatestUserMessageSeqForRun(...)    → 查最近用户消息
appendEvents(branchCandidateEvents)    → 写支线建议事件
queueSessionCompletionTargets(...)     → 触发通知
```

**影响**：每次 AI 响应完成后，用户等待的"最后一段时间"被不必要地拉长。

**改动量**：约 30 行，需仔细梳理依赖关系。

---

### P2 — WORKBENCH_QUEUE 是全局单一队列

**文件**：`backend/workbench/index.mjs`

**现状**：
```javascript
const WORKBENCH_QUEUE = createSerialTaskQueue();
```

所有 session 的 workbench 写操作共享一个串行队列。Session A 的操作执行时，Session B 必须等待，哪怕它们操作的是完全不同的数据。

**优化方向**：改为按 session 或 project 粒度的队列：
```javascript
const workbenchQueues = new Map();
function getWorkbenchQueue(scopeKey) {
  if (!workbenchQueues.has(scopeKey)) {
    workbenchQueues.set(scopeKey, createSerialTaskQueue());
  }
  return workbenchQueues.get(scopeKey);
}
```

**改动量**：约 15 行。

---

## 二、数据流问题

### P3 — `buildPromptForToolInvocation` 中 context 有重复查询

**文件**：`backend/session/manager.mjs:2218`

**现状**：
```javascript
const contextHead = await getContextHead(sessionId);
const prepared = await getOrPrepareForkContext(
  sessionId,
  snapshot || await getHistorySnapshot(sessionId),  // 如果 snapshot 没传，再查一次
  contextHead,
);
```

`getHistorySnapshot` 内部查 meta + context，而 `prepareForkContextSnapshot` 内部又可能调用 `loadHistory`，形成两次独立的历史查询。

**根因**：`snapshot` 参数是可选的，调用方不总是传入，导致函数内部被迫重新查询。

**优化**：在函数入口统一确保 snapshot 存在，避免重复查询。

---

### P3 — `syncSessionContinuityFromSession` 每次 AI 响应后全量重算

**文件**：`backend/workbench/index.mjs`（当前 continuity 同步主入口）

**现状**：每次 Run 完成后调用，内部执行：
- `loadState()`（读 6 个 JSON 文件）
- `syncSessionContinuityState()`（重建 project/node/branchContext）
- `saveState()`（写 6 个 JSON 文件）

这是全量读-改-写，每次 AI 响应都触发，哪怕 taskCard 没有实质变化。

**优化方向**：对比前后 taskCard 是否有变化，没变化跳过重算。

---

## 三、可靠性问题

### 已修复 — Runner stdout 无背压（见 P0）

---

## 四、架构设计问题

### P3 — "AI Hooks"是硬编码的，没有扩展点

**文件**：`backend/session/manager.mjs:2540`（`finalizeDetachedRun`）

**现状**：所有后置处理都写死在一个 300 行的大函数里：
- 写历史事件
- 更新 taskCard
- 生成支线建议
- 触发通知
- 触发 workbench 同步

每次要加新的后置行为都要修改这个函数。

**建议方向**：提取 `runCompleteHooks` 数组，每个 hook 是 `(sessionId, run, events) => Promise<void>`：
```javascript
const runCompleteHooks = [
  updateTaskCardHook,
  buildBranchCandidatesHook,
  notifyCompletionHook,
  syncWorkbenchHook,
];
await Promise.allSettled(runCompleteHooks.map(hook => hook(sessionId, run, events)));
```

新增行为只需注册 hook，不修改核心函数。

---

### P4 — TaskCard 职责混合（AI 输出格式 ≈ 业务状态）

**现状**：AI 被要求在响应末尾生成 `<task_card>` JSON，这个 JSON 直接被解析为业务状态。这意味着：
- AI 的输出格式变化 = 业务状态结构变化
- AI 生成质量直接影响 taskCard 的可靠性
- `normalizeSessionTaskCard` 里有大量容错逻辑（别名、截断、默认值）

**建议方向**：将 AI 输出的 taskCard（raw）和业务状态（normalized）明确分层。AI 只负责生成 raw，业务层负责转换和验证。

---

## 五、优先级汇总

| 优先级 | 问题 | 改动量 | 收益 |
|--------|------|--------|------|
| **P0** | Runner stdout 无背压（可能挂进程） | 1 行 | 可靠性修复 |
| **P1** | `loadHistory` N+1 串行 → 并行 | 10 行 | 性能，高频路径 |
| **P1** | `getSessionOperationRecords` 循环串行 → 并行 | 5 行 | 性能，操作记录渲染 |
| **P2** | `finalizeDetachedRun` 串行 await 并行化 | 30 行 | 响应完成延迟 |
| **P2** | WORKBENCH_QUEUE 改为 per-session | 15 行 | 多会话并发 |
| **P3** | `runCompleteHooks` 架构抽取 | 中等 | 可扩展性 |
| **P3** | `syncSessionContinuityFromSession` 增量判断 | 中等 | 减少无效写入 |
| **P4** | TaskCard 分层（raw vs normalized） | 大 | 长期维护性 |

> P0 和 P1 改动量小、收益直接，建议优先处理。
