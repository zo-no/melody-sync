# 下一轮功能开发前的裁剪地图

这份文档不是历史总结，而是为了下一轮“删除无用功能、接新功能”准备的当前执行地图。

目标只有两个：

1. 保住 session-first 主链
2. 在不误删核心能力的前提下，优先移除外围噪音和历史残留

---

## 1. 当前必须保留的主骨架

这些文件现在就是产品主链，不适合在“删旧”阶段直接动刀：

### 后端主链

- `chat/router.mjs`
- `chat/routes/auth.mjs`
- `chat/routes/session-read.mjs`
- `chat/routes/session-write.mjs`
- `chat/routes/runs.mjs`
- `chat/routes/assets.mjs`
- `chat/routes/workbench.mjs`
- `chat/session-manager.mjs`
- `chat/history.mjs`
- `chat/runs.mjs`
- `chat/runner-supervisor.mjs`
- `chat/runner-sidecar.mjs`
- `chat/runner-sidecar-finalize.mjs`
- `chat/provider-runtime-monitor.mjs`
- `chat/session-meta-store.mjs`
- `chat/session-api-shapes.mjs`
- `chat/workbench-store.mjs`

### 前端主链

- `templates/chat.html`
- `static/chat.js`
- `static/chat/core/bootstrap.js`
- `static/chat/core/bootstrap-data.js`
- `static/chat/core/bootstrap-session-catalog.js`
- `static/chat/session/http.js`
- `static/chat/session/http-helpers.js`
- `static/chat/session/http-list-state.js`
- `static/chat/core/realtime.js`
- `static/chat/core/realtime-render.js`
- `static/chat/session/surface-ui.js`
- `static/chat/session-list/ui.js`
- `static/chat/session-list/sidebar-ui.js`
- `static/chat/session/compose.js`
- `static/chat/workbench/controller.js`
- `static/chat/workbench/task-map-model.js`
- `static/chat/settings/hooks/ui.js`

### 基础支撑

- `lib/auth.mjs`
- `lib/config.mjs`
- `lib/tools.mjs`
- `lib/runtime-selection.mjs`

判断原则：

- 只要一个文件还直接承接“登录 -> 会话列表 -> 会话详情 -> 发消息 -> detached run -> 历史回放/恢复”，就先不要删
- 先删外围，再拆核心

---

## 2. 当前 workbench 的最小闭环

现在 workbench 已经收口到这几个概念：

- 任务地图 node kind：`main`、`branch`、`candidate`、`done`
- hooks：`push-notification`、`email-completion`、`branch-candidates`、`session-naming`
- 记录面板：`操作记录`

已经确定退出主线的概念：

- “轴”
- “会话树” 这个命名
- `goal` 独立节点

所以后面新增功能时，不要再围绕这些旧概念补兼容层。

---

## 3. 优先删的不是核心，是外围和历史残留

下面这些区域更适合做第一轮裁剪：

### A. 文档和阶段记录

优先归档或降级，而不是继续让它们和当前主线并列：

- `notes/current/capability-first-shipping-plan.md`
- `notes/current/remove-board-and-rewrite-main-flow.md`
- `notes/current/session-main-flow-next-push.md`
- `notes/current/operator-throughput-control-surface.md`
- `notes/current/ai-era-hard-skills-roadmap.md`

### B. 前端旧状态和样式残留

优先继续清理：

- 已退休功能对应的隐藏按钮、旧 DOM 挂点、未再引用的 CSS 段
- task map / operation record 已经替代旧概念后的兼容展示逻辑
- 非当前交互路径还留着的全局变量式 UI 状态

### C. 路由和兼容壳

先 grep 再删，重点检查：

- `chat/compat/apps.mjs`
- `chat/router-public-routes.mjs`
- `chat/router-system-routes.mjs`
- `chat/compat/session-meta-compat.mjs`

这些文件不一定都该立刻删除，但它们属于“历史兼容 / 外围壳 / 非主链路由”的高概率裁剪区。

### D. 与下一轮功能无关的外围能力

如果下一轮功能不碰部署、访客实例、外部连接器，可以先降噪：

- `lib/guest-instance-command.mjs`
- `lib/guest-instance.mjs`
- `lib/release-command.mjs`
- `lib/release-runtime.mjs`
- `lib/cloudflared-config.mjs`
- `lib/tunnel-diagnostics.mjs`
- 对应的专项文档和脚本入口

处理方式建议是“移出主阅读路径”优先，而不是上来就大删。

---

## 4. 推荐裁剪顺序

### 第 1 步：先减文档噪音

- 把不再服务当前主线的 note 降级或归档
- 保留 `core-domain-*`、`hooks-and-node-structure.md`、`session-run-closure-requirements.md`

### 第 2 步：再删前端死挂点

- 删 UI 上已经没有入口的 DOM / CSS / 全局状态
- 每删一块都保持 `templates/chat.html` 和 `static/chat/*.js` 一起收口

### 第 3 步：再削路由兼容壳

- 对 retired surface 做引用检查
- 删掉只剩历史兼容意义、但不再服务当前产品的 route handler

### 第 4 步：最后再拆大文件

- `chat/session-manager.mjs`
- `chat/workbench-store.mjs`
- `static/chat/workbench/controller.js`

这一步应该在“功能残留删干净”后再做，否则只是在给旧逻辑换目录。

---

## 5. 这轮调整后可以直接依赖的结论

- 操作记录现在会沿分支上下文回溯到真实主线，不再因为旧支线缺少 `rootSessionId` 而空白
- 操作记录会按 `sessionId` 去重分支上下文，不再把同一支线重复投影出来
- 操作记录打开时不再给页面加半透明遮罩，面板本身也改成不透明侧栏
- 当前分支路径会默认展开，即使支线还没有用户消息，也会显示当前摘要

下一轮如果要“删旧上新”，建议先按这份地图把外围噪音削掉，再考虑大规模目录重排。
