# Current Notes Map

`notes/current/` 里的文档都是仍然生效的内部设计、执行和治理文档。

管理原则：
- `docs/` 放当前对外和可共享的运行说明
- `notes/current/` 放仍然生效的内部设计和治理文档
- 如果一份 note 不再服务当前主线，直接删除或合并进主文档

## 阅读优先级

1. `core-domain-contract.md` — 当前 session-first 产品的核心对象和边界定义
2. `core-domain-implementation-mapping.md` — 领域对象到代码实现的映射
3. `hooks-and-node-structure.md` — 当前 hooks、task map node、操作记录面板的最小结构
4. `session-first-workflow-surfaces.md` — workflow 视图必须基于 session 派生的约束
5. `feature-and-settings-inventory.md` — 当前功能盘点：主流程 / 设置 / 隐藏 / 删除候选
6. `product-surface-lifecycle.md` — 功能 keep / iterate / retire 的治理规则
7. `session-run-closure-requirements.md` — 任务闭环的后续方向

## 各文档作用

### 产品边界与架构
- `core-domain-contract.md` — 长期保留，只有产品边界真的变化时才改
- `core-domain-implementation-mapping.md` — 代码结构明显变化时同步更新
- `session-first-workflow-surfaces.md` — 长期保留，作为 workbench / 任务地图设计约束
- `hooks-and-node-structure.md` — hooks、node kind 或操作记录面板收敛变化时同步更新
- `persistent-session-architecture.md` — Session 作为唯一持久对象的决策记录

### 产品治理
- `feature-and-settings-inventory.md` — 产品表面、设置边界或删除候选判断变化时同步更新
- `product-surface-lifecycle.md` — 长期保留，作为产品面治理规则
- `session-run-closure-requirements.md` — 后续方向总纲

### Prompt / Memory / Manager 设计
- `core-domain-session-prompts.md` — prompt 维护规则，prompt 相关工作时使用
- `manager-policy-persistence.md` — manager 状态跨续聊持续生效的设计
- `memory-activation-architecture.md` — 内存激活分层设计
- `prompt-layer-topology.md` — prompt 堆栈的分层设计

### 工程支撑
- `self-hosting-dev-restarts.md` — 开发时重启的容错策略
