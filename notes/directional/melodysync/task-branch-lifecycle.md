# MelodySync｜任务与支线生命周期实现说明

> 文档定位：这份文档描述 2026-03-27 当前仓库里已经落地的主线/支线/子任务生命周期实现。它不是方向性 PRD，而是实现对齐文档。

## 1. 当前前台对象

当前前台只暴露两个核心对象：

- 任务列表中的主任务簇
- 聊天区顶部的任务栏

具体规则：

- 主线阶段：任务栏只显示最小主线态，不提前暴露支线能力。
- 支线阶段：任务栏聚焦当前支线任务本身，主线退成来源信息。
- 消息流中：支线入口统一收敛为 `支线任务建议` 分组，手动入口和自动推荐并列，不再拆成两套 UI。

## 2. 当前底层对象

当前底层围绕以下对象组织：

- `session`：真实会话容器，仍是后端执行与持久化的基础单位
- `taskCard`：每个会话的任务语义摘要
- `branchContext`：支线关系与状态对象
- `taskClusters`：供侧栏消费的主任务簇视图模型

### 2.1 `taskCard` 关键字段

当前实现实际依赖的字段包括：

- `goal`
- `mainGoal`
- `lineRole`
- `branchFrom`
- `branchReason`
- `checkpoint`
- `nextSteps`
- `candidateBranches`

### 2.2 `branchContext` 状态定义

当前支线状态以 `branchContext.status` 为准，支持：

- `active`：当前正在推进的支线
- `resolved`：已完成，但暂未回主线继续推进
- `parked`：暂停，后续可恢复
- `merged`：已通过 merge-return 带回主线
- `suppressed`：候选支线已被压制，不继续提示

其中前四种是当前子任务生命周期管理真正使用的状态。

## 3. 任务栏行为

### 3.1 主线态

主线态刻意保持最小披露：

- 标签：`主线任务`
- 标题：`开始和agent对话吧`

当前规则：

- 不展示 next step 说明性前缀
- 不提前展示支线能力
- 不在没有任务时残留旧的任务栏状态

### 3.2 支线态

进入支线后，任务栏切换为支线聚焦模式：

- 标签：`当前任务`
- 主标题：当前支线任务标题
- 次级来源：`来自主线`
- 次级标题：主线标题

支线 next step 会经过过滤，不再把这类伪下一步展示给用户：

- `等待用户决定保留还是撤回`
- `等待...确认`
- `继续当前任务`

## 4. 子任务生命周期动作

### 4.1 支线进行中时

当前任务栏提供两个动作：

- `完成但不回主线`
- `完成并回主线`

语义分别是：

- `完成但不回主线`：把当前支线标记为 `resolved`
- `完成并回主线`：执行 `merge-return`，把结果压回主线，并把支线标记为 `merged`

### 4.2 已完成 / 已暂停 / 已带回主线时

当前任务栏提供两个动作：

- `继续处理`
- `返回主线任务`

语义分别是：

- `继续处理`：把当前支线状态切回 `active`
- `返回主线任务`：附着回父主线，但不做新的 merge

## 5. 侧栏任务簇行为

当前侧栏不再直接消费原始 `sessions[]`，而是优先消费后端整理后的 `taskClusters[]`。

每个主任务簇最少包含：

- 主线 session id
- 当前支线 session id
- 支线数量
- 最近支线 session ids
- 支线会话快照及其 `_branchStatus`

前台展示规则：

- 默认态只露主线与一行结构摘要
- 单支线时优先用摘要表达，不强制展开成重复两层
- 多支线或有嵌套支线时再展开
- 支线按 `_branchDepth` 缩进展示

当前支线状态文案：

- `当前支线：xxx`
- `已完成：xxx`
- `已带回主线：xxx`
- `已暂停：xxx`

## 6. 支线创建与回流

### 6.1 创建支线

创建支线不再只是创建一个 branch session。

当前实现会立即给新支线 seed 一份最小 `taskCard`，至少包含：

- `goal`
- `mainGoal`
- `lineRole = branch`
- `branchFrom`
- `branchReason`
- `checkpoint`
- `nextSteps`

这样支线一创建出来，任务栏就能稳定显示，不需要等后续更多回复补全。

### 6.2 回主线

`merge-return` 仍然是当前正式回流路径：

- 读取当前 branch taskCard
- 构造 merge note
- 更新父主线 taskCard
- 将支线状态改为 `merged`
- 同步 `taskClusters` 和 continuity snapshot

## 7. 最小验证链路

当前最小验证链路建议固定为：

1. 创建主线任务，例如 `学习电影史`
2. 基于主线创建支线，例如 `表现主义`
3. 确认新支线创建后立刻具备 seed taskCard
4. 将支线标记为 `resolved`
5. 检查侧栏显示 `已完成：表现主义`
6. 从侧栏或任务栏点击 `继续处理`
7. 检查状态恢复为 `active`
8. 点击 `完成并回主线`
9. 检查支线状态变为 `merged`
10. 检查父主线 taskCard 已带回 merge 结果

## 8. 当前已知限制

当前版本已经有最小可用的子任务生命周期管理，但仍有明确边界：

- 已完成/已暂停/已带回主线目前是状态级管理，还没有单独的完成时间线或审计视图
- 候选支线发现仍主要依赖 `taskCard.candidateBranches`，独立 detector 尚未落地
- 部分历史老任务如果缺少 `branchContext` 或稳定的 `taskCard` 锚点，仍无法完美归入任务簇
- 任务列表虽然已消费 `taskClusters`，但仍有进一步降低“旧会话列表心智”的空间

## 9. 代码入口

本轮实现主要落在：

- `chat/workbench-store.mjs`
- `chat/router.mjs`
- `static/chat/workbench-ui.js`
- `static/chat/session-surface-ui.js`
- `static/chat/session-list-ui.js`
- `templates/chat.html`

阅读顺序建议：

1. `chat/workbench-store.mjs`
2. `chat/router.mjs`
3. `static/chat/workbench-ui.js`
4. `static/chat/session-surface-ui.js`
5. `static/chat/session-list-ui.js`
