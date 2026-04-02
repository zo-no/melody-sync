# Current Notes Map

这份索引用来整理 `notes/current/` 里的现有文档，让你能快速判断：

- 这份文档是不是当前主线
- 它主要解决什么问题
- 什么时候应该更新它
- 后续是长期保留、阶段归档，还是只在专项工作时查看

## 管理原则

- `docs/` 放当前对外和可共享的运行说明
- `notes/current/` 放仍然生效的内部设计、执行和治理文档
- 如果一份 note 不再服务当前主线，就不应长期留在 `current`
- 同一层内容只能有一份主文档，其他文档要么是补充，要么是阶段记录

## A. 当前主线

这些文档定义当前产品边界、架构和后续方向，应该长期保留，并在路线变化时同步更新。

### 阅读优先级

1. `core-domain-contract.md`
2. `core-domain-implementation-mapping.md`
3. `hooks-and-node-structure.md`
4. `feature-and-settings-inventory.md`
5. `open-source-structure-map.md`
6. `next-feature-cleanup-map.md`
7. `session-first-workflow-surfaces.md`
8. `product-surface-lifecycle.md`
9. `session-run-closure-requirements.md`
10. `core-domain-refactor-todo.md`
11. `documentation-flywheel.md`

### 各自作用与管理方式

- `core-domain-contract.md`
  - 当前 session-first 产品的核心对象和边界定义
  - 管理方式：长期保留，只有产品边界真的变化时才改
- `core-domain-implementation-mapping.md`
  - 当前领域对象到代码实现的映射
  - 管理方式：代码结构明显变化时同步更新
- `session-first-workflow-surfaces.md`
  - workflow 视图必须基于 session 派生，不能偷偷长出平行对象
  - 管理方式：长期保留，作为 workbench / 任务地图设计约束
- `hooks-and-node-structure.md`
  - 当前 hooks、task map node、操作记录面板的最小结构说明
  - 管理方式：hooks、node kind 或操作记录面板发生收敛变化时同步更新
- `feature-and-settings-inventory.md`
  - 当前功能盘点表，明确哪些留在主流程、哪些属于设置、哪些是隐藏能力、哪些已经进入删除复核区
  - 管理方式：产品表面、设置边界或删除候选判断发生变化时同步更新
- `open-source-structure-map.md`
  - 面向开源继续收口时，哪些模块最值得先抽、目录应该往哪种责任划分靠
  - 管理方式：目录结构或模块拆分主方向变化时同步更新
- `next-feature-cleanup-map.md`
  - 下一轮删旧上新前，哪些是主骨架、哪些是外围裁剪区、推荐按什么顺序收口
  - 管理方式：进入新一轮清理或新增大功能前同步更新
- `product-surface-lifecycle.md`
  - 功能 keep / iterate / retire 的产品面规则
  - 管理方式：长期保留，作为产品面治理规则
- `session-run-closure-requirements.md`
  - 后续重构完成后，任务闭环、hooks、任务地图的顶层产品需求
  - 管理方式：当前后续方向总纲，后续应以它为准继续细化
- `core-domain-refactor-todo.md`
  - 当前重构待办和代码拆分主方向
  - 管理方式：当前重构期间持续更新，阶段结束后收口
- `documentation-flywheel.md`
  - 文档如何服务产品目标、重构执行、实现和测试，形成项目飞轮
  - 管理方式：长期保留，作为文档治理规则

## B. 阶段性主流程文档

这些文档仍有参考价值，但更偏某一阶段的产品推进记录、执行包或决策记录。

它们不应继续与当前主线并列竞争，而应作为背景或过渡文档来看待。

- `capability-first-shipping-plan.md`
- `remove-board-and-rewrite-main-flow.md`
- `session-main-flow-next-push.md`
- `session-state-audit.md`
- `operator-throughput-control-surface.md`

### 当前作用

- 这组文档多数围绕“移除 board 后的主流程重建”和“session-first 主路径”展开
- `session-state-audit.md` 仍然对 session 状态契约清理有参考价值
- `operator-throughput-control-surface.md` 更像产品问题意识来源，而不是当前实现总纲

### 管理方式

- 当前保留，但不作为最高优先级入口
- 当 `session-run-closure-requirements.md` 继续细化后，应逐步把重叠结论回收到主线文档
- 阶段结束后，这组文档应优先考虑归档或降级为历史记录

## C. Prompt / Memory / Manager 设计

这些文档服务 prompt 架构、记忆激活和 manager 行为，不属于任务闭环主文档，但仍然是当前系统的重要内部设计说明：

- `core-domain-session-prompts.md`
- `manager-policy-persistence.md`
- `memory-activation-architecture.md`
- `prompt-layer-topology.md`

### 管理方式

- 长期保留
- 只在 prompt、memory、manager 行为相关工作时重点阅读
- 不作为任务闭环和 workbench 主线总纲

## D. 性能 / 稳定性 / 运维辅助

这些文档主要服务优化、稳定性和本地运行策略：

- `csapp-performance-for-remotelab.md`
- `performance-optimization-checklist.md`
- `self-hosting-dev-restarts.md`

### 管理方式

- 作为工程支撑文档保留
- 在性能优化、重启恢复、运行稳定性相关工作时使用
- 不进入日常产品方向讨论主入口

## E. 专项方案与独立议题

这些文档是当前 repo 中仍保留的专项设计，但不属于当前主线：

- `feishu-dynamic-access-plan.md`
- `ai-era-hard-skills-roadmap.md`

### 当前作用

- `feishu-dynamic-access-plan.md` 是 Feishu connector 方向的专项方案
- `ai-era-hard-skills-roadmap.md` 更像团队/个人成长路线，不是产品设计主文档

### 管理方式

- 只在对应专题工作中查看
- 长期不再使用时，优先迁出 `current`

## F. 当前推荐阅读路径

如果你现在要重新掌控整个项目文档，建议按这个顺序看：

1. `core-domain-contract.md`
2. `core-domain-implementation-mapping.md`
3. `hooks-and-node-structure.md`
4. `feature-and-settings-inventory.md`
5. `open-source-structure-map.md`
6. `next-feature-cleanup-map.md`
7. `session-first-workflow-surfaces.md`
8. `core-domain-refactor-todo.md`
9. `session-run-closure-requirements.md`
10. `documentation-flywheel.md`

这样能先掌握：

- 当前对象边界
- 当前代码落点
- 当前 workflow 限制
- 当前重构方向
- 后续闭环目标
- 文档治理方法

## G. 待后续清理建议

下面这些情况后续应继续整理：

1. 主流程相关文档存在一定重叠：
   - `capability-first-shipping-plan.md`
   - `remove-board-and-rewrite-main-flow.md`
   - `session-main-flow-next-push.md`
   - `session-run-closure-requirements.md`

2. 如果后续任务闭环路线成为新的顶层产品方向，应考虑：
   - 把重叠的“主流程目标”统一进一份主文档
   - 将旧阶段性执行包降级为历史说明或迁入 archive

3. 如果某些专项 note 长期不再引用，应考虑：
   - 迁入 `notes/archive/`
   - 或删除并把必要结论并回主线文档
