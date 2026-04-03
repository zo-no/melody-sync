# Hooks And Node Structure

这份文档只描述当前主线已经落地的结构，不讨论旧的“轴”或“会话树”方案。

当前与 hooks / node 相关的集中 contract 有三份：

- hooks contract：`chat/hooks/hook-contract.mjs`
- node contract：`static/chat/workbench/node-contract.js`
- session list contract：`static/chat/session-list/contract.js`
- session list order contract：`static/chat/session-list/order-contract.js`

如果你要看下一步目标架构，而不是当前实现快照，请同时阅读：

- `../../docs/hooks-node-architecture.md`

## 1. 当前 hooks 结构

### 注册入口

- `chat/session-hooks.mjs`
  - 只负责初始化并导出 hooks registry
- `chat/hooks/hook-contract.mjs`
  - 统一维护 hooks 的 layer/event contract
- `chat/session-hook-registry.mjs`
  - 维护事件定义、注册、启停和 emit
- `chat/hooks/builtin-hook-catalog.mjs`
  - 统一维护所有内建 hook 的 metadata contract
- `chat/hooks/hook-settings-store.mjs`
  - 维护 hooks 启停配置的持久化读写
- `chat/hooks/register-builtin-hooks.mjs`
  - 注册 repo 级内建 hooks
- `chat/hooks/register-session-manager-hooks.mjs`
  - 注册必须依赖 session-manager 内部能力的 hooks
- `chat/session-manager.mjs`
  - 只负责在启动和兼容入口里确保这些 hooks 已注册，不再内联 hook 实现

### 当前事件点

- `instance.first_boot`
- `instance.startup`
- `instance.resume`
- `session.created`
- `session.first_user_message`
- `run.started`
- `run.completed`
- `run.failed`
- `branch.suggested`
- `branch.opened`
- `branch.merged`

当前还**没有**真正落地的目标事件：

- `session.contract.derived`
- `run.ready_to_finish`
- `run.finished`

当前已经有内建实现的事件主要分成两组：

- boot hooks
  - `instance.first_boot`
  - `instance.resume`
- run 结束后的派生 hooks
  - `run.completed`
  - `run.failed`

### 当前内建 hooks

#### registry 侧

- `builtin.first-boot-memory`
  - 文件：`chat/hooks/first-boot-memory-hook.mjs`
  - 触发：`instance.first_boot`
  - 作用：实例第一次启动时初始化最小 memory/bootstrap / projects / skills 种子
- `builtin.resume-completion-targets`
  - 文件：`chat/hooks/resume-completion-targets-hook.mjs`
  - 触发：`instance.resume`
  - 作用：启动恢复后重新挂起 pending completion targets

- `builtin.push-notification`
  - 文件：`chat/hooks/push-notification-hook.mjs`
  - 触发：`run.completed`
  - 作用：run 完成后发推送
- `builtin.email-completion`
  - 文件：`chat/hooks/email-completion-hook.mjs`
  - 触发：`run.completed`
  - 作用：按 `completionTargets` 发完成邮件

- `builtin.branch-candidates`
  - 文件：`chat/hooks/branch-candidates-hook.mjs`
  - 触发：`branch.suggested`
  - 作用：把 branch candidate event 追加回会话历史
- `builtin.session-naming`
  - 文件：`chat/hooks/session-naming-hook.mjs`
  - 触发：`run.completed`
  - 作用：首次真实 run 完成后生成 session 标题和分组

当前 `branch.opened / branch.merged / session.first_user_message` 已经有 lifecycle event 触发点，
但还没有默认的 builtin hooks；它们目前主要作为可扩展的事件挂点存在。

### 当前 hooks 边界

- hooks 现在覆盖两类生命周期：
  - 实例启动 / 恢复
  - 会话首条用户消息、run 结束、支线建议/开启/回流的派生处理
- hook enable/disable 现在会持久化到 config 层，不再只是进程内状态
- hooks 不持有独立领域真相
- session / run / taskCard / branchContext 仍然是真实状态源
- workbench continuity 现在由主流程直接同步，不再通过 hook 驱动
- hooks 产出的是：
  - 启动初始化和恢复动作
  - 写回会话历史
  - 发外部通知
- hooks 可以操作会话流、状态条、行动区、任务地图表面、任务列表行/徽标、输入辅助和设置面板等 UI 表面
- hooks 不能直接拥有地图 node 真值
- hooks 也不能直接拥有任务列表顺序真值；列表顺序由 session list order contract 决定
- GTD 分组定义、任务列表可被 AI 修改的字段（任务名、分类、顺序）由 session list contract 统一维护

## 1.5 哪些现有功能适合继续做成 hooks

### 已经适合并已落地的

- `first boot memory init`
  - 当前已作为 `instance.first_boot` boot hook 落地
- `resume completion targets`
  - 当前已作为 `instance.resume` boot hook 落地

- `push notification`
  - 可选副作用，属于 `run.completed` 后的外部通知
- `email completion`
  - 可选副作用，属于 `run.completed` 后的外部通知
- `branch candidates`
  - 从 taskCard 派生回会话历史，适合放在 lifecycle hooks
- `session naming`
  - 首次真实 run 完成后的派生命名/分组，不应继续内联在 `session-manager`

### 适合未来继续 hook 化的

- `next step suggestion`
  - 如果以后变成稳定的 run 后评估结果，适合做 `run.completed` 派生 hook
- `ready-to-finish evaluation`
  - 如果只负责生成“现在可收尾”的提示，而不直接改领域状态，也适合做 hook
- `generic external callbacks/webhooks`
  - 对外系统同步天然属于 hooks 层，不该写死在核心 manager 里

### 不适合做成 hooks 的

- `taskCard` 真值更新
  - 它是 session 的核心状态，不是可选副作用
- `result asset publication`
  - 当前会直接更新 run 的 `publishedResultAssets` 并写回会话消息，属于核心结果持久化
- `context compaction / queued follow-up dispatch`
  - 这些决定运行正确性，不能降级成可开关副作用
- `session organizer`
  - 这是显式用户动作触发的隐藏 workflow，不是 run 生命周期的被动派生

## 2. 当前 node 结构

### task map 当前保留的 node kind

- `static/chat/workbench/node-contract.js`
  - 统一维护前端 task map node kind contract 与 schema 默认值
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
