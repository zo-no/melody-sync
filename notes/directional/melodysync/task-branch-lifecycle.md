# MelodySync｜任务与支线生命周期实现说明

> 文档定位：这份文档记录 2026-03-28 当前仓库里已经落地的任务/子任务生命周期实现。它回答三个问题：前台对象是什么，生命周期状态是什么，代码里实际如何流转。

## 1. 当前前台对象

当前前台已经明确分成三层：

- 左侧：任务列表
- 中间：对话推进区
- 顶部：任务 bar / 当前焦点条

具体职责：

- 任务列表负责结构、恢复入口、状态
- 对话区负责推进当前任务
- 顶部焦点条只负责说明“我现在正在做什么”

也就是说，结构信息主要进入任务列表；顶部 task bar 只保留当前焦点，并在需要时按需展开当前主任务下面的子任务结构。

## 2. 当前底层对象

当前实现仍然以 `session` 为执行容器，但前台语义已经围绕下面几类对象组织：

- `session`
- `taskCard`
- `branchContext`
- `taskClusters`

### 2.1 `taskCard`

当前真正参与任务语义的字段包括：

- `goal`
- `mainGoal`
- `lineRole`
- `branchFrom`
- `branchReason`
- `checkpoint`
- `nextSteps`
- `candidateBranches`

### 2.2 `branchContext`

`branchContext` 用来承载主线/子任务关系和当前状态。

当前主要状态：

- `active`
- `parked`
- `resolved`
- `merged`
- `suppressed`

其中前四种是真正的子任务生命周期状态。

### 2.3 `taskClusters`

`taskClusters` 是给左侧任务列表消费的视图模型。  
它不再要求前端从 `sessions[]` 里临时猜整套结构。

当前 cluster 至少会提供：

- `mainSessionId`
- `currentBranchSessionId`
- `branchSessionIds`
- `branchSessions`

其中 `branchSessions` 还会带：

- `_branchDepth`
- `_branchParentSessionId`
- `_branchStatus`

## 3. 任务栏当前规则

### 3.1 主线态

主线态保持最小披露：

- 标签：`当前任务`
- 标题：当前主任务标题
- 桌面端 hover 后，才展示当前主任务下面的完整子任务结构
- 移动端通过显式 `子任务` 按钮下拉展开同一套结构

主线态不负责：

- 展示完整子任务链
- 展示状态统计
- 展示大段 next step 说明

### 3.2 子任务态

进入子任务后，顶部条切换成当前焦点：

- 标签：`当前子任务`
- 上方：一条弱化的主线引用
- 下方标题：当前子任务标题
- next step：只保留一条短句，不展示冗余解释

当前实现已经过滤伪下一步文案，不再把以下内容塞进焦点条：

- `等待用户决定保留还是撤回`
- `等待…确认`
- `继续当前任务`

## 4. 子任务生命周期动作

### 4.1 进行中

当前子任务进行中时，顶部只保留两类轻量动作：

- `close`
- `stop`

对应行为：

- `close` -> 状态改为 `resolved`，并附着回父主线
- `stop` -> 状态改为 `parked`，并附着回父主线

### 4.2 已关闭 / 已挂起 / 已带回主线

非 active 状态下，当前实现支持：

- `继续`
- `返回主线`

对应行为：

- `继续` -> 把状态切回 `active`
- `返回主线` -> 附着回父主线，不做新的 merge

## 5. 列表中的生命周期表达

左侧任务列表不再把所有子任务都叫“支线”。  
当前实现会在前台显式区分：

- `当前支线：xxx`
- `已挂起：xxx`
- `已关闭：xxx`
- `已带回主线：xxx`

这层表达的目的不是做审计视图，而是让用户知道这条子任务现在还能不能继续、是否已经收尾。

## 6. 支线创建

创建子任务时，当前实现不再只创建一个空 session。

创建路径会立刻 seed 一份最小 `taskCard`，至少包含：

- `goal`
- `mainGoal`
- `lineRole = branch`
- `branchFrom`
- `branchReason`
- `checkpoint`
- `nextSteps`

这样子任务一创建出来，就具备最基本的任务语义，不需要等下一轮回复再补齐。

## 7. 回主线

当前正式回流路径仍然是 `merge-return`。

它会：

1. 读取当前子任务的 `taskCard`
2. 生成 merge note
3. 更新父主线 `taskCard`
4. 把当前子任务标记为 `merged`
5. 同步 `taskClusters` 和 continuity snapshot

## 8. GTD 与任务生命周期的关系

GTD 分组是任务列表的组织视图，不是生命周期状态本身。

当前前台分组：

- `收件箱`
- `长期任务`
- `短期任务`
- `知识库内容`
- `等待任务`

新任务默认进入 `收件箱`。  
只有用户点击 `整理任务` 后，系统才会把任务重新整理到这些分组。

子任务生命周期和 GTD 分组是两套不同维度：

- GTD 负责“这类任务属于哪种工作篮子”
- 生命周期负责“这条子任务现在处于什么推进状态”

## 9. 删除与旧归档路径

当前前台已经把旧的 `归档` 动作切成 `删除`。

删除主任务时，系统会递归删除它下面的子任务树，而不是只删一级 session 壳。

这条路径已经在后端形成独立 API：

- `DELETE /api/sessions/:id`

## 10. 最小验证链路

当前推荐固定验证链路如下：

1. 创建主任务，例如 `学习电影史`
2. 从主任务创建子任务，例如 `表现主义`
3. 确认新子任务创建后立刻带最小 `taskCard`
4. 把子任务标为 `parked`
5. 把子任务恢复为 `active`
6. 把子任务标为 `resolved`
7. 再次恢复为 `active`
8. 执行 `merge-return`
9. 检查状态变为 `merged`
10. 检查父主线 `taskCard` 已更新

## 11. 已知边界

当前实现已经有最小可用的子任务生命周期管理，但仍有三个真实边界：

1. 已完成/已挂起/已带回主线当前仍然是状态级管理，没有独立的审计时间线。  
2. 候选支线发现仍然主要依赖 `taskCard.candidateBranches`，独立 detector 还没有落地。  
3. 老历史任务如果没有稳定的 `branchContext` 或 `taskCard` 锚点，仍然无法完美归入新任务簇。

## 12. 代码入口

这一轮最关键的代码入口：

- `chat/workbench/index.mjs`
- `chat/router.mjs`
- `chat/session-manager.mjs`
- `chat/history.mjs`
- `static/chat/workbench/controller.js`
- `static/chat/session/surface-ui.js`
- `static/chat/session-list/ui.js`
- `static/chat/core/realtime.js`

阅读顺序建议：

1. `workbench/index.mjs`
2. `router.mjs`
3. `session-manager.mjs`
4. `workbench/controller.js`
5. `session/surface-ui.js`
6. `session-list/ui.js`
