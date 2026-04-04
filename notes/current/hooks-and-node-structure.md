# Hooks And Node Structure

这份文档只描述当前主线已经落地的结构，不讨论旧的“轴”或“会话树”方案。

当前与 hooks / node 相关的集中 contract 有三份：

- hooks contract：`chat/hooks/hook-contract.mjs`
- backend node definitions：`chat/workbench/node-definitions.mjs`
- frontend node contract：`static/chat/workbench/node-contract.js`
- session list contract：`static/chat/session-list/contract.js`
- session list order contract：`static/chat/session-list/order-contract.js`

如果你要看下一步目标架构，而不是当前实现快照，请同时阅读：

- `../../docs/hooks-node-architecture.md`

其中和后续“AI 组合 node / 画线”直接相关的目标段落是：

- `Node Composition Contract`
- `TaskMapPlan Contract`

## 1. 当前 hooks 结构

### 注册入口

- `chat/hooks/index.mjs`
  - 只负责初始化并导出 hooks registry
- `chat/hooks/hook-contract.mjs`
  - 统一维护 hooks 的 layer/event contract
- `chat/hooks/registry.mjs`
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
  - 作用：把 branch candidate event 追加回会话历史，并同步写入 hook 生成的 `taskMapPlan` candidate overlay，再通过 backend node-task-card sync 收口 `taskCard.candidateBranches`
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

- `chat/workbench/node-definitions.mjs`
  - 统一维护当前 node kind / lane / role / mergePolicy / composition 的 canonical exposure
  - 通过 chat bootstrap 和 `GET /api/workbench/node-definitions` 透出给前端与后续配置面
- `chat/workbench/node-settings-store.mjs`
  - 维护用户新增的 custom node kind 持久化
  - 当前只允许扩展自定义节点，不直接改写 builtin 节点
  - 当前也允许 custom node kind 保留 composition metadata，但设置 UI 还没有把这层完全开放出来
- `static/chat/workbench/node-contract.js`
  - 读取 backend 透出的 node definitions，并在前端做兜底校验与暴露
  - 当前已经包含 composition contract：root 能力、父子 kind 约束、默认交互、默认边类型、布局变体和统计口径
- `static/chat/workbench/node-effects.js`
  - 统一维护 task map 当前内建 node 的公共语义
  - 当前收口的效果包括：计数口径、compact 布局、候选边、开启支线动作、已收束徽标、surfaceBindings、taskCardBindings 和默认 view.type
- `static/chat/workbench/node-instance.js`
  - 统一维护前端 graph node instance contract
  - 当前负责把 `capabilities / surfaceBindings / taskCardBindings / origin / view` 收成稳定实例，避免 renderer、surface 和 capability 层各自拼 node payload
- `static/chat/workbench/graph-model.js`
  - 统一维护前端 task-map 的 graph node / edge collection 结构
  - 当前同时服务默认 continuity 投影和 task-map plan overlay，避免两边各自拼匿名节点集合
- `static/chat/workbench/graph-client.js`
  - 统一维护前端 canonical graph 读侧
  - 当前负责读取 backend `task-map-graph`，并优先把正式 graph payload 还原成前端 projection；拿不到时再回退到本地 continuity 投影
- `static/chat/workbench/node-capabilities.js`
  - 把 node capability 变成显式执行层
  - 当前负责把 `create-branch / open-session` 这类 node action 从 renderer 内联逻辑里抽出来
- `chat/workbench/task-map-plans.mjs`
  - 持久化可选的 task-map plan overlay
  - 这层不是 workflow 真值，只负责保存“可替换/可增强默认地图”的图谱计划
- `chat/workbench/task-map-plan-producers.mjs`
  - 把当前核心 workflow 状态翻译成 hook/system 可写的 task-map plan
  - 当前已经落地的 producer 是 `builtin.branch-candidates -> candidate overlay`
- `chat/workbench/node-instance.mjs`
  - 统一维护后端 graph node instance contract
  - 当前负责把 producer / persisted plan node 收成稳定实例，避免 `task-map-plans.mjs` 和 producer 各自维护不同 node payload 语义
- `chat/workbench/node-task-card.mjs`
  - 统一维护后端 node -> taskCard patch helper
  - 当前负责把 builtin candidate 和 custom node 在 backend side 汇总成稳定 patch，并明确 `plan/manual/hook > projection` 的标量字段优先级
- `chat/workbench/node-task-card-sync.mjs`
  - 统一维护 backend `taskMapPlan -> session.taskCard` 写回
  - 当前先接在 `builtin.branch-candidates` 这条 hook 链上，用来让 candidate node 和 taskCard fallback 保持一致
- `chat/workbench/task-map-plan-contract.mjs`
  - 统一暴露 plan mode、source type、edge type、node composition 和允许产 plan 的 hook 白名单
  - 当前面向未来 hook / AI 生成图谱的入口，不直接参与渲染
- `chat/workbench/task-map-plan-service.mjs`
  - 统一暴露 session-scoped manual/system plan 写入口
  - 当前负责 root session 解析、source policy 限制、plan id 冲突保护，以及把 plan 写入统一接到 shared sync
- `chat/workbench/task-map-plan-sync.mjs`
  - 统一暴露 persisted plan set 的 shared sync
  - 当前负责比较旧/新 plan 集合、收集 managed binding keys，并把 node patch 写回同一 root 下的所有 session
- `chat/workbench/graph-model.mjs`
  - 统一维护 backend graph node / edge collection 结构
  - 当前同时服务默认 continuity 图和 task-map plan overlay，避免 backend 侧再拼第二套匿名 quest graph 结构
- `chat/workbench/task-map-graph-service.mjs`
  - 统一暴露 session-scoped canonical graph 读入口
  - 当前负责把 `continuity -> default quest graph -> taskMapPlan overlay` 收成一个稳定 payload，供后续 AI/manual tooling 和调试读取
- `chat/workbench/task-map-surface-service.mjs`
  - 统一暴露 session-scoped canonical surface 读入口
  - 当前负责把 graph node 的 `surfaceBindings` 投影成稳定 slot payload，先服务 `composer-suggestions`
- `static/chat/workbench/task-map-plan.js`
  - 把 task-map plan 归一化并叠加到默认 continuity 投影上
  - 当前支持两种模式：`replace-default` 和 `augment-default`
  - 当前 `augment-default` 也会按 node id 合并已有默认节点，所以 hook plan 可以给 continuity 默认节点补 `summary / surfaceBindings / view.type`
  - 当前也会保留 node `origin`（`projection` vs `plan`）和 `taskCardBindings`，让后续 hook / AI graph plan 保持 provenance 和字段绑定能力
  - 当前也提供 surface-node 收集能力，供 composer 等非地图表面优先读取 `composer-suggestions` 这类 node surface
- `static/chat/workbench/surface-projection.js`
  - 把 workbench graph 的 surfaceBindings 变成显式读侧选择器
  - 当前先服务 composer suggestion surface，避免 session UI 直接认识 task-map plan 细节
- `static/chat/workbench/task-map-clusters.js`
  - 把 synthetic cluster 生成、branch child 排序和当前 branch lineage 解析从默认投影器里抽出来
  - 当前负责默认 continuity 图的 quest source 准备
- `static/chat/workbench/task-map-mock-presets.js`
  - 把 cinema demo 这类 mock 图谱注入从默认投影器里抽出来
  - 当前让 `task-map-model.js` 不再同时承担真实投影和 demo augment
- `static/chat/workbench/node-rich-view-ui.js`
  - 把 markdown / html / iframe 这类 rich node view 渲染从 workbench 总控里抽出来
  - 当前负责 node canvas 的安全嵌入和 markdown 回退渲染
- `static/chat/workbench/node-canvas-ui.js`
  - 把右侧 node canvas 收成独立 UI 层
  - 当前负责把选中的 rich-view node 渲染到 taskMapRail 下半部分，而不是继续把内容直接塞进 flow node 本体
- `static/chat/workbench/node-settings-model.js`
  - 把 node definitions payload 归一化成地图域可消费的设置模型
- `static/chat/workbench/node-settings-ui.js`
  - 把 node 设置入口放在 task map rail 上，并用对称弹窗做编辑
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
  - 当前默认绑定 `taskCard.mainGoal`
- `branch`
  - 表示已经独立出去的真实执行线
  - 当前默认绑定 `taskCard.goal`
- `candidate`
  - 表示系统建议但尚未展开的下一条独立执行线
  - 当前既可以投影到地图，也可以投影到底部 composer suggestion surface
  - 当前默认绑定 `taskCard.candidateBranches`
- `done`
  - 表示当前主任务下的现有支线已经全部收束

## 2.5 当前正式 plan 写入口

当前 `taskMapPlan` 已经不只存在于 builtin hook 内部，已经有正式的 session-scoped 写入口：

- `GET /api/workbench/sessions/:id/task-map-plans`
  - 读取当前 session 所属 root quest 的 plan 集合
- `POST /api/workbench/sessions/:id/task-map-plans`
  - 写入 `manual/system` source 的 plan
  - 当前会自动限制 `rootSessionId`，并拒绝 `hook` source 直接通过 API 写入
- `DELETE /api/workbench/sessions/:id/task-map-plans/:planId`
  - 删除当前 root quest 下的 plan

当前这条链已经具备的行为：

- plan 写入会走 shared `task-map-plan-sync`
- node `taskCardBindings` 会回写到对应 session 的 `taskCard`
- managed `candidateBranches` 删除 plan 时会被清空
- managed `mainGoal / summary` 这类标量字段会被保守保留，直到下一次显式替换
- `branch-candidates` builtin hook 已经通过同一条共享链工作，不再有独立的 hook 专用 patch 流程

### node 不负责的事

- 不负责持久化 workflow authority
- 不负责替代 taskCard / branchContext
- 不负责表达单独的“目标对象”
- 不负责替代 backend workbench 的持久化 `nodes`

### 当前 task map 的 node effect 层

- `task-map-model.js`
  - 继续负责 continuity -> 地图节点投影
  - 当前已经显式产出 `nodes + edges`，其中 edge type 会标明 `structural / suggestion / completion`
- `node-instance.js`
  - 负责把 projection node / plan node 统一成稳定 graph node instance
  - 当前 node instance 统一包含：
    - `capabilities`
    - `surfaceBindings`
    - `taskCardBindings`
    - `view`
    - `origin`
- `node-task-card.js`
  - 负责把前端 graph node instance 汇总成 taskCard patch
  - 当前和 backend `chat/workbench/node-task-card.mjs` 保持同一条优先级规则：`plan/manual/hook` 节点可以覆盖默认 projection 节点的标量绑定
- `task-map-clusters.js`
  - 负责 continuity quest source 的 synthetic cluster 和 branch lineage helper
- `task-map-mock-presets.js`
  - 负责 demo/mock 任务图 augment，而不是默认投影真值
- `graph-model.js`
  - 负责 graph node / edge instance 的构建、追加和 quest graph snapshot 归一化
- `task-map-ui.js`
  - 继续负责树布局和渲染
  - 当前已经把 rich node view 渲染委托给 `node-rich-view-ui.js`
- `node-effects.js`
  - 作为两者之间共享的语义层，避免继续在 model / ui 里散落 `kind === "candidate"` 这类判断

这意味着当前主线已经从“只暴露 node kind”前进到：

- `node kind catalog`
- `composition contract`
- `backend node-instance + task-card patch + task-card sync`
- `shared node effects`
- `optional taskMapPlan overlay`
- `rich right-canvas view contract`

但当前 `taskMapPlan` 仍然只是 overlay 层：

- 没有 plan 时，继续回退到 continuity -> task-map projection
- 有 plan 时，只替换或增强地图图谱，不接管 session / branchContext / taskCard 真值
- 当前 hook 白名单里，只有 `builtin.branch-candidates` 具备产 plan 资格，而且策略是 `augment-default`

### 当前 rich canvas 能力

`taskMapPlan` 里的 node 现在可以声明：

- `view.type`
  - `flow-node`
  - `markdown`
  - `html`
  - `iframe`
- `view.width / view.height`
- `view.renderMode`
  - 当前 `html` 支持 `inline / iframe`

当前规则是：

- plan / AI 只声明要展示什么
- renderer 负责无限画布里的尺寸、布局和嵌入方式
- 默认 continuity 节点仍然走 `flow-node`

## 2.5 node 的两层含义

这里要明确区分两类 node：

- backend workbench state 里的 `nodes`
  - 是持久化工作台对象，来源于 `chat/workbench-store.mjs`
- frontend task map 的 node kind
  - 是 `main / branch / candidate / done` 这组展示层投影
- backend exposed node definitions
  - 是当前 node 类型 contract 的透出层，供 bootstrap、API、前端 contract 和后续用户配置入口共享
- persisted custom node settings
  - 是用户新增 node kind 的配置层，当前通过共享设置弹窗里的“节点” tab 维护

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
