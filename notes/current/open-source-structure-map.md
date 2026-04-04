# Open Source Structure Map

这份文档只讨论“当前代码继续往开源质量收敛时，应该先抽什么、目录怎么体现责任边界”。

它不是历史记录，也不是一次性重写方案。

## 1. 现在最需要继续收口的点

### 1. hooks 要从“能跑”提升到“可维护”

当前已经补上的基础：

- `chat/hooks/registry.mjs`
  - 统一维护 hooks event contract
- `chat/hooks/builtin-hook-catalog.mjs`
  - 统一维护所有内建 hook 的定义信息
- `chat/routes/hooks.mjs`
  - 对外暴露 hooks 列表和 event definitions

这一步解决的是“多处各写一份 label / id / eventPattern”的问题。

下一步再拆时，应该继续保持三层：

- contract
  - event definition、builtin hook metadata
- registration
  - 谁在什么时候注册
- handler
  - 真正做事的副作用逻辑

不应该再把三者重新揉回 `session-manager.mjs`。

### 2. node 要从“前端隐式约定”提升到“显式契约”

当前已经补上的基础：

- `static/chat/workbench/node-contract.js`
  - 统一维护 task map node kind 定义
- `static/chat/workbench/task-map-model.js`
  - 只负责从 session/workbench snapshot 派生 projection

这里最重要的边界是：

- backend workbench 的 `nodes`
  - 是持久化工作台对象
- frontend task map 的 `main / branch / candidate / done`
  - 是展示层投影 node

这两类 node 不是一个概念，后面文档和目录都应该明确分开。

### 3. workbench-store 还太胖

`chat/workbench-store.mjs` 现在仍然同时承担：

- capture/project/node 持久化
- branch continuity
- summary / obsidian export

但第一刀已经落地：

- `chat/workbench/state-store.mjs`
  - 负责 workbench 持久化状态读写
- `chat/workbench/operation-records.mjs`
  - 负责操作记录投影
- `chat/workbench/continuity-store.mjs`
  - 负责 continuity / taskClusters 的读侧投影
- `chat/workbench/exporters.mjs`
  - 负责 summary / markdown / obsidian export / branch seed prompt
- `static/chat/workbench/task-tracker-ui.js`
  - 负责顶部 tracker 的标题、状态、详情渲染
- `static/chat/workbench/quest-state.js`
  - 负责 quest state / cluster / context / lineage 派生
- `static/chat/workbench/task-map-ui.js`
  - 负责 flow-board 任务地图渲染
- `static/chat/workbench/task-list-ui.js`
  - 负责任务列表 / 树视图渲染和展开状态
- `static/chat/workbench/branch-actions.js`
  - 负责支线收束、挂起、回主线和 tracker 动作按钮
- `static/chat/workbench/operation-record-ui.js`
  - 负责右侧操作记录面板交互
- `static/chat/session-list/model.js`
  - 负责左侧任务列表的分组和轻量支线标记，不再依赖 workbench 关系树

现在剩下最值得继续拆的热点，主要回到了 continuity 写侧和 knowledge 这两块。

## 2. 最适合优先抽离的内容

### 后端优先级

1. `chat/workbench-store.mjs`
   - 先拆成 4 个责任文件最值
2. `chat/session-manager.mjs`
   - 继续把 run finalize 后的派生动作往 hooks / finalize helpers 外移
3. `chat/router.mjs`
   - 继续薄化，只保留路由拼装

### 建议先拆出的 backend 模块

- `chat/workbench/state-store.mjs`
  - 只负责 load/save workbench 持久化状态
- `chat/workbench/continuity-store.mjs`
  - 只负责 branchContexts、taskClusters、session continuity
- `chat/workbench/operation-records.mjs`
  - 只负责操作记录投影和 session 历史拼接
- `chat/workbench/knowledge-store.mjs`
  - 只负责 capture/projects/nodes/summaries
- `chat/workbench/exporters.mjs`
  - 只负责 obsidian/export 一类外围输出

这样拆的好处是：以后删除外围功能时，不会动到 continuity 和 operation record 这两个主骨架。

### 前端优先级

1. `static/chat/workbench/controller.js`
   - 当前还混了 quest state、snapshot 协调和各子模块接线
2. `static/chat/`
   - 目录仍然偏平，不利于新 contributor 定位
3. `static/chat/settings/hooks/ui.js`
   - 还可以继续靠近 hooks contract，避免 UI 侧再次长出独立规则

### 建议先拆出的 frontend 模块

- `static/chat/workbench/task-map-ui.js`
  - 只负责地图渲染和交互
- `static/chat/workbench/quest-state.js`
  - 只负责 session/snapshot 到 quest state 的 selector 派生
- `static/chat/workbench/task-list-ui.js`
  - 只负责任务列表 / 树视图渲染
- `static/chat/workbench/task-tracker-ui.js`
  - 只负责顶部 tracker
- `static/chat/workbench/operation-record-ui.js`
  - 只负责右侧操作记录面板
- `static/chat/workbench/branch-actions.js`
  - 只负责结束、挂起、回主线等动作
- `static/chat/session-list/model.js`
  - 只负责左侧任务列表的 group / badge / light list semantics
- `static/chat/workbench/task-map-model.js`
  - 保持纯 projection
- `static/chat/workbench/node-contract.js`
  - 保持纯契约

## 3. 推荐目录形态

这不是要求一口气搬迁，而是后续每做一轮清理都往这个方向靠。

### backend

```text
chat/
  hooks/
    builtin-hook-catalog.mjs
    register-builtin-hooks.mjs
    push-notification-hook.mjs
    email-completion-hook.mjs
  routes/
    hooks.mjs
    workbench.mjs
    ...
  sessions/
    manager.mjs
    naming.mjs
    task-card.mjs
    workflow-state.mjs
  runs/
    store.mjs
    finalize.mjs
    supervisor.mjs
  workbench/
    state-store.mjs
    continuity-store.mjs
    knowledge-store.mjs
    operation-records.mjs
    exporters.mjs
```

### frontend

```text
static/chat/
  core/
    bootstrap-data.js
    app-state.js
    bootstrap.js
    bootstrap-session-catalog.js
    i18n.js
    icons.js
    layout-tooling.js
    realtime.js
    realtime-render.js
    gestures.js
    init.js
  session/
    http-helpers.js
    http-list-state.js
    http.js
    tooling.js
    compose.js
    surface-ui.js
    state-model.js
  session-list/
    contract.js
    order-contract.js
    model.js
    ui.js
    sidebar-ui.js
  settings/
    hooks/
      model.js
      ui.js
  workbench/
    node-contract.js
    task-map-model.js
    quest-state.js
    task-map-ui.js
    task-list-ui.js
    task-tracker-ui.js
    operation-record-ui.js
    branch-actions.js
```

### 当前已经落地的第一步

- backend 已经有：
  - `chat/workbench/state-store.mjs`
  - `chat/workbench/continuity-store.mjs`
  - `chat/workbench/operation-records.mjs`
  - `chat/workbench/exporters.mjs`
- frontend 已经有：
  - `static/chat/core/bootstrap.js`
  - `static/chat/core/bootstrap-session-catalog.js`
  - `static/chat/core/realtime.js`
  - `static/chat/core/realtime-render.js`
  - `static/chat/session/state-model.js`
  - `static/chat/session/http.js`
  - `static/chat/session/tooling.js`
  - `static/chat/session/compose.js`
  - `static/chat/session/surface-ui.js`
  - `static/chat/session-list/sidebar-ui.js`
  - `static/chat/settings/hooks/ui.js`
  - `static/chat/workbench/node-contract.js`
  - `static/chat/workbench/task-map-model.js`
  - `static/chat/workbench/quest-state.js`
  - `static/chat/workbench/task-tracker-ui.js`
  - `static/chat/workbench/task-map-ui.js`
  - `static/chat/workbench/task-list-ui.js`
  - `static/chat/workbench/branch-actions.js`
  - `static/chat/workbench/operation-record-ui.js`
- 旧入口仍然保留：
  - `chat/workbench-store.mjs`
  - `static/chat/workbench/controller.js`

这样做的目的不是保留双份实现，而是先让目录边界出现，再继续把剩余责任从旧入口往下搬。

## 4. 文件夹管理要体现的规则

目录不是整理好看，而是要表达边界。

应该坚持：

- contract 文件和 implementation 文件分开放
- projection/model 文件和持久化 store 文件分开放
- UI 渲染文件和 action/mutation 文件分开放
- route 入口保持薄，只做 request/response 映射

不应该继续累积：

- 一个大文件里既有 HTTP 处理、状态拼接、业务规则、字符串文案
- 前端平铺二十多个文件，只能靠文件名猜职责
- “为了方便”把 registry、catalog、handler 再写到同一处

## 5. 如果准备删旧上新，建议顺序

1. 先把 contract 和 state/store 边界补齐
2. 再拆 `workbench-store.mjs` 和 `workbench/controller.js`
3. 再删外围功能和历史兼容残留
4. 最后再考虑大规模移动目录

原因很简单：

- 先删功能，容易把仍然有用的边界一起删坏
- 先补 contract，后续删改的风险最小
- 先抽 store / projection，后面无论加新功能还是删旧功能都更稳
