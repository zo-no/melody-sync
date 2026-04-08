# Hooks + Node Architecture

状态：proposed

目的：把 MelodySync 的 `hooks + node` 从“能跑的局部机制”升级成一套统一、可配置、可扩展、对 AI 友好的架构。

这份文档描述的是**目标架构**，不是当前实现快照。当前已经落地的最小结构仍见：

- `../notes/current/hooks-and-node-structure.md`

## 1. 设计目标

这套架构要同时满足四个要求：

1. `hooks` 覆盖更完整的生命周期，而不只是 `run.completed` 后发通知。
2. `hooks` 可以由实例自由配置，但不能反过来成为隐藏的领域真相。
3. `node` 可以自定义，但底层格式和投影规则必须先固定。
4. 整个结构必须对 AI 友好：
   - 文件职责清楚
   - 契约集中
   - 没有隐式副作用
   - 一看就知道在哪改 metadata、在哪改 handler、在哪改 projection

当前建议把两个扩展入口都固定成单一 contract 文件：

- hooks contract：`backend/hooks/hook-contract.mjs`
- node contract：`frontend/workbench/node-contract.js`

同时把 GTD 任务列表本身也固定成独立 contract，而不是让 hooks 或 node 间接拥有它：

- session list contract：`frontend/session-list/contract.js`
- session list order contract：`frontend/session-list/order-contract.js`

## 2. 顶层原则

### 2.1 Hooks 是生命周期编排层，不是领域真相

`hooks` 负责：

- 在实例、会话、run、支线、完成闭环上的特定时机运行
- 生成派生状态
- 追加会话事件
- 触发外部副作用

`hooks` 不负责：

- 持有 `session / run / taskCard / branchContext` 的真值
- 直接成为 workflow authority

### 2.2 Node 是表达层，不是持久化真值

`node` 负责把任务生命周期表达给人看。

`node` 不负责：

- 直接持久化为 workflow authority
- 替代 session 或 taskCard
- 承担 run 的执行逻辑

### 2.3 Hook 与 Node 的关系

两者必须完全解耦：

```text
生命周期事件
  -> 核心主流程更新 durable state
  -> hook 编排会话事件 / 外部副作用 / 可选 graph plan

durable state + optional taskMapPlan
  -> node projection
  -> 地图 / 操作记录 / UI surface
```

也就是说：

- hook 不能成为 workflow durable state 的真值来源
- 关闭某个 hook 不应该让核心 continuity 丢失
- hook 可以补充 `taskMapPlan` 这种可替换/可增强的图谱表达层
- node 仍然优先从 `session / run / taskCard / branchContext / workbench continuity` 这些持久化状态投影

任务列表排序也适用同样的原则：

- GTD 分组、AI 可写字段、只读快照字段由 `session-list-contract` 统一维护
- hook 可以影响列表中的徽标、状态点和提示 UI
- hook 不应该直接拥有 `sidebarOrder` 或 `_sessionListOrder` 的真值
- 任务列表顺序由 `session-list-order-contract` + durable session metadata 决定

### 2.4 AI 友好优先于技巧性抽象

这套架构要优先保证：

- 一种信息只在一个地方定义
- metadata 和 handler 分开
- handler 尽量纯、短、可测试
- 配置文件 JSON 化，便于 AI 修改
- 当前实现和目标架构不混写在一起

## 3. Hook 分层

目标 hooks 要拆成三层。

### 3.1 Boot Hooks

负责实例启动、首次启动和恢复。

事件建议：

- `instance.first_boot`
- `instance.startup`
- `instance.resume`

适合放进这一层的能力：

- 首次 MelodySync 启动时初始化 `memory/bootstrap.md`
- 创建 `projects.md`、`skills.md`、`tasks/`
- 恢复 pending completion targets
- 启动期补全默认运行时选择、轻量 seed 文件

### 3.2 Lifecycle Hooks

负责 session / run / branch / completion 的生命周期编排。

事件建议：

- `session.created`
- `session.first_user_message`
- `session.contract.derived`
- `run.started`
- `run.completed`
- `run.failed`
- `run.ready_to_finish`
- `run.finished`
- `branch.suggested`
- `branch.opened`
- `branch.merged`

适合放进这一层的能力：

- 自动命名与自动分组
- branch candidate 生成
- next-step suggestion
- ready-to-finish evaluation
- completion receipt
- branch merge back summary

### 3.3 Delivery Hooks

负责对外通知与外部系统同步。

事件建议：

- `run.completed`
- `run.failed`
- `branch.merged`
- `run.finished`

适合放进这一层的能力：

- push notification
- email completion
- future webhook/callback

### 3.4 新增一个 Hook 时应该改哪里

目标是只动这几处：

1. `backend/hooks/hook-contract.mjs`
   - 只有在新增 lifecycle layer 或 lifecycle event 时才改
2. `backend/hooks/builtin-hook-catalog.mjs`
   - 加 metadata definition
3. `backend/hooks/*.mjs`
   - 加 handler/factory
4. `backend/hooks/register-*.mjs`
   - 把 definition 绑定到 handler

如果新增 hook 还要去改 UI 文案或别的 schema，说明 contract 还不够集中。

### 3.5 Hook 可操作的 UI 范围

为了让 hooks 后续能安全扩展到更多 UI，而不侵入排序或地图真值，hooks contract 需要显式列出允许操作的 UI target：

- `session_stream`
- `task_status_strip`
- `task_action_panel`
- `task_map`
- `task_list_rows`
- `task_list_badges`
- `composer_assist`
- `workspace_notices`
- `settings_panels`

同时显式保留两类真值，不允许 hooks 直接拥有：

- `task_list_order`
- `task_map_nodes`

## 4. 哪些能力应该统一进 hooks

### 4.1 应该纳入 hooks 的

- 首次 MelodySync 启动记忆初始化
- completion target 恢复
- session naming
- branch candidates
- next-step suggestion
- ready-to-finish evaluation
- branch merged summary
- completion receipt
- generic external callbacks

### 4.2 不应该纳入 hooks 的

这些仍然应该留在核心主流程里：

- `taskCard` 真值更新
- run / session 持久化
- result asset publication
- context compaction
- queued follow-up dispatch
- detached run rehydration
- session organizer

原因很简单：

- 它们影响运行正确性
- 它们是领域真值
- 它们不该被“关闭某个 hook”这种配置影响

## 5. Hook Contract

Hook 不应该只返回 `Promise<void>`。

目标 contract 建议固定成一个 JSON 友好的结构：

```js
{
  statePatches: {
    sessionMeta: null,
    taskCard: null,
  },
  sessionEvents: [],
  uiEffects: [],
  sideEffects: [],
}
```

含义：

- `statePatches`
  - hook 提议的派生 patch
  - 是否应用 patch 由核心流程决定
- `sessionEvents`
  - 插入到会话流的生命周期事件
- `uiEffects`
  - 操作允许的 UI 表面，但不拥有排序和地图 node 真值
- `sideEffects`
  - 外部通知或 callback

这样做的好处是：

- hook 可以统一表达自己“想产出什么”
- 真正应用 patch 的 authority 仍然不在 hook 自己
- AI 修改某个 hook 时，不需要碰主流程的真实状态机

## 6. Hook Manifest

为了支持“用户可配置 hooks”，metadata 应从 handler 里剥离出来，做成 manifest。

建议每个 hook 一个 JSON 文件，放在：

```text
config/hooks/<hook-id>.json
```

第一版 manifest 格式先固定：

```json
{
  "id": "builtin.session-naming",
  "label": "Session 自动命名",
  "event": "run.completed",
  "enabled": true,
  "handler": "backend/hooks/session-naming-hook.mjs",
  "priority": 200,
  "outputs": {
    "statePatches": true,
    "sessionEvents": false,
    "sideEffects": false
  },
  "config": {}
}
```

约束：

- manifest 只描述配置，不包含业务逻辑
- `handler` 指向一个明确文件
- `priority` 决定同一 event 下的执行顺序
- `config` 保持 JSON 化，方便 AI 修改

## 7. Node 架构

目标是让 node 可自定义，但格式固定。

### 7.1 Node 分两层

必须明确区分：

- backend workbench state 里的持久化 `nodes`
- frontend task map / operation record 的展示层 `node kinds`

以后任何文档和代码都不能把这两层混成一个概念。

### 7.2 Node Definition

建议 node kind 也引入 definition registry。

每种 node 定义至少固定这些字段：

```json
{
  "id": "next-step",
  "label": "下一步",
  "description": "系统建议继续推进的下一步。",
  "lane": "main",
  "role": "action",
  "sessionBacked": false,
  "derived": true,
  "mergePolicy": "replace-latest"
}
```

建议保留的核心字段：

- `id`
- `label`
- `description`
- `lane`
  - `main` / `branch` / `side`
- `role`
  - `state` / `action` / `summary`
- `sessionBacked`
- `derived`
- `mergePolicy`

### 7.3 Node Composition Contract

如果后面要让 hook / AI 能稳定地“自己拼 node”，只透出 node kind 还不够。

还必须给它一层 machine-readable 的组合规则，让系统知道：

- 这个 kind 能不能做 root
- 这个 kind 可以挂在哪些父节点下面
- 这个 kind 默认能产出哪些子节点
- 这个 kind 是否必须绑定真实 session
- 这个 kind 的默认交互是什么

最小 contract 建议固定成：

```json
{
  "id": "candidate",
  "label": "建议子任务",
  "description": "系统建议但尚未真正展开的下一条执行线。",
  "lane": "branch",
  "role": "action",
  "sessionBacked": false,
  "derived": true,
  "mergePolicy": "replace-latest",
  "composition": {
    "canBeRoot": false,
    "allowedParentKinds": ["main", "branch"],
    "allowedChildKinds": [],
    "requiresSourceSession": true,
    "defaultInteraction": "create-branch",
    "defaultEdgeType": "suggestion",
    "layoutVariant": "compact",
    "countsAs": {
      "sessionNode": false,
      "branch": false,
      "candidate": true,
      "completed": false
    }
  }
}
```

推荐先固定这些规则字段：

- `canBeRoot`
- `allowedParentKinds`
- `allowedChildKinds`
- `requiresSourceSession`
- `defaultInteraction`
  - `open-session` / `create-branch` / `none`
- `defaultEdgeType`
  - `structural` / `suggestion` / `completion` / `merge`
- `layoutVariant`
  - `root` / `default` / `compact`
- `countsAs`
  - 控制是否计入 branch / candidate / completed 等地图统计

目标不是一次把所有表达力做满，而是先把当前内建 kind 的隐式行为显式化。

当前主线已经有一个更轻的过渡层：

- `frontend/workbench/node-effects.js`

它先把 `main / branch / candidate / done` 的计数、交互、边类型和 compact 布局规则收口成共享语义，再由 `task-map-model.js` 和 `task-map-ui.js` 共同消费。

当前主线也已经开始把 composition 规则直接透出到 node contract：

- `backend/workbench/node-definitions.mjs`
- `frontend/workbench/node-contract.js`

当前主线还新增了一层可选 overlay：

- `backend/workbench/task-map-plans.mjs`
- `backend/workbench/task-map-plan-contract.mjs`
- `frontend/workbench/task-map-plan.js`

这层的作用不是替代 continuity，而是把“默认 continuity 图”和“未来 hook / AI 规划图”明确分开。

这一步的意义是：

- 先停止在 model / ui 里散落 `kind === ...` 判断
- 不改当前 continuity 投影能力
- 让当前默认投影已经能显式携带 edge 语义，而不是只在 renderer 里临时推断
- 为后续 `TaskMapPlan` 和 AI 组合 node 留出稳定落点

### 7.4 TaskMapPlan Contract

目标上不建议让 hook 或 AI 直接产最终 DOM，也不建议让它直接碰像素坐标。

更合理的是增加一层 `taskMapPlan`：

- hook / AI 负责产出“这张图上应该有什么”
- renderer 负责“怎么把它画出来”
- 没有 `taskMapPlan` 时继续回退到当前 continuity 投影

最小结构建议：

```json
{
  "version": 1,
  "quests": [
    {
      "id": "quest:sess_main",
      "rootSessionId": "sess_main",
      "title": "整理 hooks 和 node 架构",
      "summary": "当前主任务",
      "activeNodeId": "session:sess_branch_1",
      "mode": "replace-default",
      "source": {
        "type": "hook",
        "hookId": "builtin.branch-candidates",
        "event": "branch.suggested",
        "generatedAt": "2026-04-03T09:00:00.000Z"
      },
      "nodes": [
        {
          "id": "session:sess_main",
          "kind": "main",
          "title": "整理 hooks 和 node 架构",
          "summary": "当前主任务",
          "parentId": null,
          "sourceSessionId": "sess_main",
          "state": "active"
        },
        {
          "id": "candidate:sess_main:graph-plan",
          "kind": "candidate",
          "title": "设计 graph plan",
          "summary": "建议拆成独立支线",
          "parentId": "session:sess_main",
          "sourceSessionId": "sess_main",
          "state": "candidate"
        }
      ],
      "edges": [
        {
          "id": "edge:1",
          "from": "session:sess_main",
          "to": "candidate:sess_main:graph-plan",
          "type": "suggestion"
        }
      ]
    }
  ]
}
```

约束建议：

- `kind` 必须来自 node definition registry
- `nodes` 决定“图里有什么”
- `edges` 决定“它们怎么连”
- 不允许 hook / AI 提供坐标、样式 class、DOM 结构
- `mode`
  - `replace-default`
  - `augment-default`

建议 renderer 最终遵守：

```text
有 taskMapPlan
  -> 先校验 plan
  -> 再按 plan 渲染

无 taskMapPlan
  -> 回退到 continuity -> task-map projection
```

这样做能同时保住：

- 当前默认地图能力
- 未来 hook/AI 的可扩展地图能力
- renderer 的统一性

为了避免未来 hook / AI 端自己重新拼装 node 和 hook metadata，建议同时暴露一个 machine-readable contract payload，至少包含：

- `planModes`
- `edgeTypes`
- `sourceTypes`
- `fallbackProjection`
- `nodeKindDefinitions`
- `planCapableHooks`

当前主线已经有对应落点：

- `backend/workbench/task-map-plan-contract.mjs`
- `GET /api/workbench/task-map-plan-contract`

当前白名单策略也已经落地：

- 不是所有 hook 都能产 plan
- 当前只有 `builtin.branch-candidates` 被标记为 `augment-default`
- 不支持产 plan 的 hook 即使手动写入 plan source，也会在持久化层被拒绝

当前主线已经有一个最小落地版本：

- backend 会在 `workbench snapshot` 里透出 `taskMapPlans`
- frontend 会先生成 continuity 默认图，再由 `task-map-plan.js` 选择 `replace-default` 或 `augment-default`
- 如果没有 plan，或者 plan 非法，前端继续回退到默认 continuity 投影
- current backend 也已经有正式的 session-scoped 写入口：
  - `GET /api/workbench/sessions/:id/task-map-plans`
  - `POST /api/workbench/sessions/:id/task-map-plans`
  - `DELETE /api/workbench/sessions/:id/task-map-plans/:planId`
- 这条入口目前只允许 `manual/system` source，`hook` source 仍然必须走 hook producer + shared sync

### 7.5 右侧无限画布展示类型

当前 `taskMapPlan` 的 node 已经可以直接声明右侧无限画布里的展示类型：

- `flow-node`
  - 当前默认节点卡片
- `markdown`
  - 交给 markdown renderer 渲染
- `html`
  - 支持 `inline` 或 `iframe` 两种嵌入方式
- `iframe`
  - 直接挂外部或本地嵌入地址

这里的边界要固定：

- hook / AI 决定 `view.type` 和内容
- renderer 决定布局、尺寸和 iframe 容器
- 不让 hook / AI 直接决定 DOM 结构或像素坐标
### 7.6 新增一个 Node Kind 时应该改哪里

目标是只动这几处：

1. `frontend/workbench/node-contract.js`
   - 加新的 node kind definition
2. `frontend/workbench/task-map-model.js`
   - 在 projection 里决定何时产出这种 node
3. 对应 UI renderer
   - 只有当新 node 需要新的视觉表达时才改

node 的 schema、lane、role、mergePolicy 不应散落在 projection 或 UI 里重复定义。

### 7.7 Node Instance

Node instance 是 projection 产物，格式也应固定：

```js
{
  id: 'node-123',
  kind: 'next-step',
  title: '先明确第一版路线的三段结构',
  detail: '继续当前任务，不需要单独处理。',
  status: 'active',
  sourceEvent: 'run.completed',
  sourceSessionId: 'sess_...',
  sourceRunId: 'run_...',
  createdAt: '...',
  edges: [],
}
```

这里最重要的是：

- `kind` 来自 definition registry
- `instance` 只装内容，不定义 schema
- `instance` 可以来自默认 continuity projection，也可以来自 future `taskMapPlan`

## 8. 推荐的最小 Node Kinds

为了先把格式定住，当前建议最小集合是：

- `main`
- `branch`
- `candidate`
- `next-step`
- `needs-input`
- `ready-to-finish`
- `done`
- `evaluation`

这组是“目前格式先固定下来”的最小可用集合。

以后新增 case 时，可以加新的 node kind，但不应打破 instance 格式。

## 9. AI-Friendly 目录结构

推荐收敛成下面这个形态：

```text
backend/
  hooks/
    registry/
      hook-events.mjs
      hook-registry.mjs
      hook-manifest-store.mjs
    builtin/
      push-notification-hook.mjs
      email-completion-hook.mjs
      branch-candidates-hook.mjs
      session-naming-hook.mjs
    lifecycle/
      first-boot-memory-hook.mjs
      next-step-hook.mjs
      ready-to-finish-hook.mjs
      completion-receipt-hook.mjs
      branch-merged-hook.mjs
    registration/
      register-builtin-hooks.mjs
      register-session-manager-hooks.mjs
  workbench/
    node-definitions.mjs
    node-projection.mjs
    operation-records.mjs
```

前端：

```text
frontend/workbench/
  node-contract.js
  node-definition-store.js
  node-projection.js
  task-map-ui.js
  operation-record-ui.js
```

目标不是一口气搬迁，而是让新能力都往这个方向靠。

## 10. 面向 AI 修改的规则

为了让 AI 更容易改对，必须遵守这些规则：

### 10.1 一种信息只在一个地方定义

- hook 事件定义只能在一处
- builtin hook metadata 只能在一处
- node kind definition 只能在一处

### 10.2 不允许 import 副作用注册

禁止这种模式：

- import 某个模块
- 模块自动把 hook 注册进 registry

必须显式通过 registration 层注册。

### 10.3 Handler 不直接偷改领域真值

handler 只返回 contract；是否应用 patch 由核心流程决定。  
地图 node 也不能从 hook contract 直接生成，必须等主流程写完 durable state 后再投影。

### 10.4 每个 hook / node kind 都要有最小测试

至少要覆盖：

- 是否注册成功
- manifest 是否有效
- event 触发是否产出预期 contract
- node kind 是否能被前端识别

### 10.5 配置优先 JSON 化

AI 更适合稳定修改 JSON 和小模块，不适合编辑大量隐式 JS 逻辑。

## 11. 迁移优先级

### 第一阶段

- `instance.first_boot`
- `instance.resume`
- `branch-candidates`
- `session-naming`

### 第二阶段

- `next-step suggestion`
- `ready-to-finish`
- `completion receipt`
- `branch merged summary`

### 第三阶段

- generic external callback/webhook
- user-defined hook packs
- user-defined node definitions

## 12. 当前最重要的边界

这套架构最终要守住三句话：

- hooks 是生命周期编排层，不是领域真相
- node 是表达层，不是 workflow authority
- 配置和实现必须分开，方便 AI 修改

如果后续重构偏离这三点，就会再次回到“大文件 + 隐式规则 + 很难让 AI 改对”的状态。
