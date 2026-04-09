# Workbench 任务图优化顺序

这份文档不是愿景描述，而是把当前 Workbench 任务图从“已有 graph 基础设施”推进到“真正的主线任务地图”所需的下一轮实现顺序收口出来。

相关背景：

- 目标交互：`notes/directional/melodysync/task-map-interaction-model.md`
- 当前结构：`notes/current/hooks-and-node-structure.md`
- 当前前端协调入口：`frontend-src/workbench/controller.js`
- 当前地图读侧：`backend/workbench/task-map-graph-service.mjs`

## 1. 当前已经有的底座

当前不是从零开始，以下几层已经成立：

- 后端已经有 canonical graph 读侧：`GET /api/workbench/sessions/:id/task-map-graph`
- 前端已经能优先读取 canonical graph，再回退到 continuity 投影
- node kind / node instance / node effects / graph model 已经分层
- 候选支线已经能通过 hook 产出 `candidate` overlay，而不是硬塞成真实 branch session
- 右侧已经有 node canvas / task tracker / output panel 这些“当前节点工作区”雏形

所以下一轮不该再继续扩 graph 基建，而应该开始把“前台主对象”从 `session` 切到 `main quest + task node`。

同时要把两个旧限制移掉：

- 不要再把任务图理解成“只给接下来三步”
- 不要再把 node 理解成“只能是任务”

AI 应该能一次性生成更深的图，而且可以直接创建承载 markdown / html / iframe 内容的富文本节点。

## 2. 现在真正卡住的不是地图，而是对象层还没切干净

### 2.1 左栏仍然是 session-first，不是 main-quest-first

目标模型要求左栏只放主线任务，但当前主导航仍然是 session 列表：

- `frontend-src/session-list/ui.js` 仍以 session 为渲染对象
- branch session 仍然作为列表项暴露
- workbench 的 `activeMainQuest` 只是地图投影结果，还没有成为左栏导航真值

结果是：

- 用户仍然从“会话项”进入，而不是从“主线任务”进入
- 支线是否存在、当前在做哪条主线，仍要靠读 session 关系来推断

### 2.2 右栏仍主要在消费 session/taskCard，而不是 node focus

虽然 tracker 和 canvas 已经存在，但当前工作焦点仍然偏 session：

- `quest-state.js` 的核心输入仍是 focused session
- `task-tracker-ui.js` 的主要信息源仍是 `session.taskCard`
- 节点被点击后，更多像是在地图里“打开相关 session”，而不是切换统一的当前节点焦点

结果是：

- “当前在哪个节点”与“当前在哪个 session”还没有彻底分离
- 右栏像是 session 状态条增强版，而不是节点工作区

### 2.3 支线生命周期只完成了“出现”，还没完成“回收”

当前候选支线的生成路径已经有了，但完整生命周期还没闭环：

- `backend/workbench/task-map-plan-producers.mjs` 目前主要把 `taskCard.candidateBranches` 翻成 `candidate` node
- 候选节点仍然依赖字符串标题和直接子 session 去重
- 支线完成后的“回流结论”“折叠展示”“父节点摘要更新”还不是地图默认行为

结果是：

- 地图能长出岔路，但还不具备稳定的“收束感”
- done 节点和 merged/resolved branch 更像状态标记，而不是产品层的收尾动作

### 2.4 地图的信息负担控制还没被做成硬规则

目标模型强调：

- 一次只允许一个当前激活节点
- 默认只展开当前路径和附近一层
- 已完成支线默认折叠
- 左栏不再显示支线

但当前实现更接近“把图渲染出来”，还没把这些规则收成默认交互约束。

## 3. 下一轮建议不要按技术模块拆，而要按四个产品任务拆

### 任务 A：主线任务导航化

目标：

- 左栏改成 `MainQuest` 列表
- session 继续是执行容器，但不再直接作为主导航对象

建议做法：

- 先复用现有 `taskClusters` / `activeMainQuest`，做一个 main-quest 列表 adapter
- 左栏第一版直接按 root session 聚合，不需要新 durable object
- branch session 从默认左栏隐藏，只在当前主线地图里出现

完成标准：

- 用户进入产品时先看到“我有哪些主线”，不是“我有哪些 session”
- 切换主线不会要求用户理解 branch session 结构

### 任务 B：当前节点焦点化

目标：

- 右栏真正服务当前节点，而不是当前 session
- “当前任务 Bar + 聊天执行区”围绕 node focus 工作

建议做法：

- 在 workbench view model 里显式区分：
  - `activeMainQuest`
  - `activeNode`
  - `selectedNode`
- 节点点击优先切换 `activeNode`
- 只有当节点能力需要真实执行容器时，才解析回对应 session

完成标准：

- 用户能明确知道自己当前推进的是哪个节点
- 地图切焦点时，右栏文案和建议动作同步变化

### 任务 C：支线生命周期闭环

目标：

- 候选支线 -> 正式支线 -> 已回收支线 成为默认地图流

建议做法：

- 候选节点不只绑定标题，还要允许携带：
  - 分叉原因
  - 预期产出
  - 回流目标父节点
- 支线完成时，默认写回父节点一句结论
- 已完成支线保留在图上，但默认折叠

完成标准：

- 地图上的支线不会“做完就消失”
- 父节点能看到这条支线带回了什么

### 任务 D：信息负担与布局默认值

目标：

- 地图从“能看”变成“低负担可扫读”

建议做法：

- 布局默认改成“主线脊柱 + 侧挂支线”
- 当前路径最强高亮
- 非当前路径默认弱化
- 已完成支线默认折叠
- 移动端默认用抽屉承载地图，但仍保持一个清晰当前节点

完成标准：

- 用户不用读长摘要，也能知道当前位置、岔路和下一步
- 冗余文案默认不显示，例如未运行节点的 `空闲`

## 4. 推荐执行顺序

推荐顺序不是按文件，而是按依赖关系：

1. 先做 `任务 A：主线任务导航化`
2. 再做 `任务 B：当前节点焦点化`
3. 再做 `任务 C：支线生命周期闭环`
4. 最后做 `任务 D：信息负担与布局默认值`

原因：

- 如果左栏还没从 session 切到 main quest，后面所有地图优化都还会被 session-first 心智拖回去
- 如果没有稳定的 active node，右栏和地图只能继续共享一套 session 语义
- 如果支线回收没闭环，地图再漂亮也只是“分叉展示器”
- 信息负担控制应该压在对象和生命周期稳定之后，否则容易反复返工

## 5. 这轮支线可以直接产出的任务图骨架

如果要把这条 `Workbench 任务图` 支线继续拆成下一层，建议就拆四个分支：

- `主线任务列表`
- `节点焦点工作区`
- `支线生命周期`
- `地图默认布局`

其中建议先开前两个，后两个可以作为后续支线。

## 6. 一句话结论

Workbench 任务图下一轮不该继续围绕“怎么把 branch session 画得更清楚”优化，而应该先把前台对象切成：

- 左栏：`MainQuest`
- 中栏：`TaskNode graph`
- 右栏：`Current node workspace`

底层仍然可以继续复用 session，但前台语义不该再暴露成 session-first。
