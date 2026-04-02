# Hooks And Node Structure

这份文档只描述当前主线已经落地的结构，不讨论旧的“轴”或“会话树”方案。

## 1. 当前 hooks 结构

### 注册入口

- `chat/session-hooks.mjs`
  - 只负责初始化并导出 hooks registry
- `chat/session-hook-registry.mjs`
  - 维护事件定义、注册、启停和 emit
- `chat/hooks/builtin-hook-catalog.mjs`
  - 统一维护所有内建 hook 的 metadata contract
- `chat/hooks/register-builtin-hooks.mjs`
  - 注册 repo 级内建 hooks
- `chat/session-manager.mjs`
  - 注册必须依赖 session-manager 内部能力的 hooks

### 当前事件点

- `session.created`
- `run.started`
- `run.completed`
- `run.failed`

当前真正有内建实现的事件主要是 `run.completed` 和 `run.failed`。

### 当前内建 hooks

#### registry 侧

- `builtin.push-notification`
  - 文件：`chat/hooks/push-notification-hook.mjs`
  - 触发：`run.completed`
  - 作用：run 完成后发推送
- `builtin.email-completion`
  - 文件：`chat/hooks/email-completion-hook.mjs`
  - 触发：`run.completed`
  - 作用：按 `completionTargets` 发完成邮件
- `builtin.workbench-sync`
  - 文件：`chat/hooks/workbench-sync-hook.mjs`
  - 触发：`run.completed`
  - 作用：把 session/taskCard 同步回 workbench continuity 状态
- `builtin.workbench-sync-on-fail`
  - 文件：`chat/hooks/workbench-sync-hook.mjs`
  - 触发：`run.failed`
  - 作用：失败或取消时也同步 continuity 状态

#### session-manager 侧

- `builtin.branch-candidates`
  - 文件：`chat/session-manager.mjs`
  - 触发：`run.completed`
  - 作用：把 branch candidate event 追加回会话历史
- `builtin.session-naming`
  - 文件：`chat/session-manager.mjs`
  - 触发：`run.completed`
  - 作用：首次真实 run 完成后生成 session 标题和分组

### 当前 hooks 边界

- hooks 只做“run 结束后的派生处理”，不持有独立领域真相
- session / run / taskCard / branchContext 仍然是真实状态源
- hooks 产出的是：
  - 写回会话历史
  - 更新 workbench continuity
  - 发外部通知

## 2. 当前 node 结构

### task map 当前保留的 node kind

- `static/chat/workbench-node-contract.js`
  - 统一维护前端 task map node kind contract
- `main`
  - 主任务根节点，对应主 session
- `branch`
  - 已经拆出的真实支线 session
- `candidate`
  - 尚未真正拆出的建议支线
- `done`
  - 所有已存在支线都收束后出现的收束节点

### 明确移除的 node / 视图

- 不再有 `goal` node
  - `taskCard.goal` 仍保留为语义字段，但不再单独投影成地图节点
- 不再有“轴”视图
  - 不再维护 timeline flowchart 那套前端结构
- 不再把 branch 关系称为“会话树”
  - 右侧面板统一改名为“操作记录”

### node 的当前职责

- `main`
  - 给出当前主任务入口
- `branch`
  - 表示已经独立出去的真实执行线
- `candidate`
  - 表示系统建议但尚未展开的下一条独立执行线
- `done`
  - 表示当前主任务下的现有支线已经全部收束

### node 不负责的事

- 不负责持久化 workflow authority
- 不负责替代 taskCard / branchContext
- 不负责表达单独的“目标对象”
- 不负责替代 backend workbench 的持久化 `nodes`

## 2.5 node 的两层含义

这里要明确区分两类 node：

- backend workbench state 里的 `nodes`
  - 是持久化工作台对象，来源于 `chat/workbench-store.mjs`
- frontend task map 的 node kind
  - 是 `main / branch / candidate / done` 这组展示层投影

后面继续重构时，这两层不能混名为同一个概念。

## 3. 操作记录面板

### 当前定位

- 它是右侧的历史操作面板，不是任务地图
- 它服务“看发生过什么”，不是“决定下一步做什么”

### 当前数据来源

- route：`GET /api/workbench/sessions/:id/operation-record`
- route 文件：`chat/routes/workbench.mjs`
- projection：`chat/workbench/operation-records.mjs`
- state 读写：`chat/workbench/state-store.mjs`
- 前端面板：`static/chat/workbench/operation-record-ui.js`

### 当前展示内容

- 主线用户消息记录
- 挂在主线消息上的支线记录
- 支线内部自己的用户消息记录
- 支线收束摘要

## 4. 当前判断

当前主线已经收敛成下面这条边界：

- hooks 负责 run 结束后的派生动作
- task map 只保留最小 node 集合
- `taskCard.goal` 继续存在，但只作为语义字段，不再投影成独立 node
- “轴”彻底删除
- “会话树”统一改叫“操作记录”
