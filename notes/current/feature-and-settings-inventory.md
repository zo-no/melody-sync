# Feature And Settings Inventory

这份文档的目的不是定义新功能，而是把当前已有能力整理成可裁剪的清单。

你后面要做两类决策：

- 哪些功能继续保留在主流程
- 哪些功能应该移到设置，或者直接删除

所以这里不用“技术模块”来分，而是用“产品表面”来分。

## 1. 先用五个桶看整个项目

### A. 主流程

用户每次进入产品都高频触发，应该直接留在主界面。

### B. 侧边工作流

不是每轮都用，但它仍然服务当前 session-first 工作流，不应该被塞进设置。

### C. 设置项

低频调整、偏个性化、偏高级配置、偏副作用控制的能力，应该放进设置。

### D. 隐藏/内部能力

可以保留，但不应冒充主产品表面。它们是内部自动化、后台策略、系统能力，或者 API 级能力。

### E. 删除候选

已经脱离模板、没有稳定 UI、只剩代码残留，或者明显不是当前主流程的一部分。

## 2. 当前主流程功能

这些能力应继续留在主界面，不建议下沉到设置。

### Session 主流程

- Owner 登录
  - token/password 登录
- Session 列表与切换
  - 选择任务
  - 开始任务
  - 归档区展开/恢复
- Session 基础管理
  - 重命名
  - pin
  - archive
  - restore
  - delete
- 消息主流程
  - 发送消息
  - cancel run
  - busy 时 follow-up queue
- 输入能力
  - 文件上传
  - 粘贴图片/文件
  - 草稿恢复

### 当前主流程落点

- 模板：`templates/chat.html`
- Session 列表 UI：`static/chat/session-list/ui.js`
- Session 行动作：`static/chat/session/surface-ui.js`
- 发送/草稿/附件：`static/chat/session/compose.js`

## 3. 当前侧边工作流功能

这些能力服务当前 session-first 工作流，但不属于“设置”。

### Workbench / 任务工作流

- 任务地图
- 顶部任务追踪条
- 操作记录面板
- 建议支线的“开启支线”
- 子任务结束/挂起/带回主线
- 主线与支线状态展示

### 为什么不应该进设置

这些能力不是“配置项”，而是执行中的导航、收束、追踪能力。

如果把它们放进设置，会把 workflow surface 错放成“偏好设置”。

### 当前落点

- `static/chat/workbench-ui.js`
- `static/chat/workbench/task-map-model.js`
- `static/chat/workbench/node-contract.js`
- `chat/workbench-store.mjs`
- `chat/routes/workbench.mjs`

## 4. 现在就适合归到设置的功能

这些能力不是主任务执行动作，而是“如何运行”或“是否触发副作用”的配置。

### 4.1 Hooks 设置

- 当前已经在设置位
- 内容是：
  - push notification
  - email completion
  - workbench sync
  - branch candidates
  - session naming

推荐结论：

- 保留在设置，不进入主流程

当前落点：

- `templates/chat.html` 中 `hooksSettingsBtn`
- `static/chat/settings/hooks/ui.js`
- `chat/routes/hooks.mjs`

### 4.2 Runtime 偏好

- tool
- model
- effort
- thinking

这些现在是“能力存在，但默认 UI 隐藏”的状态：

- 模板里有 `input-config-row`
- 但当前默认是 `hidden`

推荐结论：

- 这组不应该回到默认主界面占位
- 应进入“Session 设置”或“高级设置”

原因：

- 它们是 per-session runtime preference
- 低频变更
- 对普通发送流程不是每轮都要操作

当前落点：

- `templates/chat.html`
- `static/chat/session/tooling.js`
- `lib/runtime-selection.mjs`
- `chat/router.mjs` 的 `/api/runtime-selection`

### 4.3 通知目标 / 副作用目标

现在代码里已经有能力，但没有干净的独立设置面：

- `completionTargets`
- push subscription
- email completion 目标

推荐结论：

- 如果保留，应该进设置
- 不应该散落在 session write payload 或隐藏字段里长期存在

当前落点：

- `chat/hooks/email-completion-hook.mjs`
- `chat/session-manager.mjs`

### 4.4 部署/实例/连接器配置

这类能力存在，但它们不是聊天页主设置：

- guest instance
- Cloudflare Tunnel
- Tailscale / self-hosting
- connector 运行脚本和系统接入

推荐结论：

- 放系统级设置、CLI、部署文档
- 不要塞进聊天页设置弹层

## 5. 应保留为隐藏/内部能力的东西

这些能力可以存在，但不应继续长成新的产品按钮。

### 自动化/后台逻辑

- session auto naming
- workbench sync hook
- runtime selection sync
- websocket invalidation
- build update detection

### 隐藏工作流

- session list organizer 的内部 agent/session
- session organize 的后台执行逻辑

推荐结论：

- 保留为内部能力
- 不要把它们都做成显式前台入口
- 如果以后要暴露，先判断它是不是主流程问题，而不是直接加按钮

## 6. 当前最明确的删除候选

这一组不是“可能优化”，而是已经能看出明显残留。

### 6.1 已脱离模板的 header 控件支持

这类残留前端 wiring 说明“实现表面”曾经大于“真实产品表面”。

- `sidebarFilters`

其中：

- `forkSessionBtn`
- `organizeSessionBtn`

这两组 header wiring 已经从当前前端主链清理掉。

当前这类旧过滤器兼容支撑也已经从前端主链清理掉：

- `sidebarFilters`

推荐结论：

- 不要再把它们当作活跃 UI
- 后续如果再出现类似“模板没有，代码还在”的控制面，应直接进入清理队列

主要落点：

- `static/chat/bootstrap.js`
- `static/chat/bootstrap-session-catalog.js`
- `static/chat/session/compose.js`

### 6.2 delegate / fork 的表面定义还不干净

现在后端能力仍在：

- `/api/sessions/:id/fork`
- `/api/sessions/:id/delegate`

但当前模板里并没有稳定的一线 UI。

推荐结论：

- 先不要把它们继续记作“明确在线的前台功能”
- 需要二选一：
  - 要么后续明确重做表面
  - 要么降为 API/internal capability
  - 要么删除

### 6.3 “整理任务”相关表面需要单独复核

当前有两层：

- Sidebar 里的 `sortSessionListBtn`
- session action 里的 `organize`

它们都不是 session-first 主流程的核心动作。

推荐结论：

- 这组不该继续占主界面显眼位置
- 后续应在两条路里二选一：
  - 移到设置/工具面板
  - 直接删除

## 7. 一个简单判断规则：到底该不该放进设置

满足下面任意两条，基本就应该考虑进入设置：

- 不是每轮会话都要用
- 更像偏好或策略，不像执行动作
- 开启后会产生额外副作用
- 更适合按 session 或按实例配置
- 用户大多数时候只在初始化时调一次

反过来，满足下面任意两条，就不应该放进设置：

- 它是当前执行中的动作
- 它直接改变当前任务推进
- 它是会话内的导航/收束/分支动作
- 它必须在当前上下文里快速操作

## 8. 对文件夹管理的直接影响

后面整理目录时，应该让目录体现上面的五个桶，而不是按历史堆文件。

推荐方向：

```text
static/chat/
  sessions/
  compose/
  workbench/
  settings/
  system/
```

对应理解：

- `sessions/`
  - session list、session row action、attach/hydrate
- `compose/`
  - 输入、草稿、附件、发送
- `workbench/`
  - task map、tracker、operation record、branch action
- `settings/`
  - hooks、runtime preferences、notification targets
- `system/`
  - build refresh、connectivity、guest/deployment 级提示

这样目录就能直接回答一个问题：

> 这个能力到底是主流程、工作流、设置，还是系统级外围能力？

## 9. 当前建议的下一步

如果按“先整理、后删改”的顺序推进，建议这样做：

1. 先把这个清单当作当前唯一功能盘点表
2. 下一轮先清理“已脱离模板的残留控制面”
3. 再决定 `organize` / `sortSessionList` 是进设置还是删除
4. 再决定 `fork` / `delegate` 是重新做前台表面，还是降级/删除
5. 最后再按主流程 / settings / system 重组前端目录
