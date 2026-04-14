# 左边栏项目卡片重设计

> 状态：已实现
> 关联文件：`frontend-src/workbench/task-map-react-ui.jsx`、`frontend-src/chat-sidebar.css`、`backend/session/meta-store.mjs`

---

## 一、UI 目标

### 长期项目 Tab — 项目标题行

当前问题：折叠按钮（`∨`）藏在标题行内部，整行点击既折叠又有 `›` 按钮，视觉上混乱；控制面板入口是标题行内嵌的小按钮，不够显眼；控制面板按钮（`lt-project-card-body`）在内容区形成"卡片套卡片"的嵌套感。

目标布局：

```
∨  melody-sync
   MelodySync 产品迭代项目  ›
   ─────────────────────────
   [收集箱]  2
     · 任务 A
   [长期任务]  1
     · 任务 B
```

具体规则：

- **左侧**：独立的折叠/展开按钮（`∨` / `›`），只控制内容区折叠，不打开控制面板
- **右侧**：上下两行结构
  - 上行：项目名称（`session.name`），点击行为与左侧折叠/展开按钮一致
  - 下行：项目描述（`session.description`，见第二节），有则显示；无则显示「展示面板」
  - 最右：`›` 箭头，下行可点击，打开控制面板
- **移除**：`lt-project-card-content` 区域内的 `lt-project-card-body`（控制面板入口按钮），入口合并到标题行右侧
- **移除**：标题行右侧原有的小 `›` panel-btn 按钮

视觉语言：扁平，无嵌套卡片感，与全局任务控制台按钮风格一致。

### 任务 Tab — 全局任务控制台

保持现有样式不变（`sessions-tab-daily-panel-btn`，左边文字右边 `›`）。

---

## 二、数据结构问题：项目 description 字段

### 现状问题

项目 session（`taskPoolMembership.longTerm.role === 'project'`）目前没有独立的 `description` 字段。

前端代码中有 `projectSummary` 逻辑读取 `projectSession.taskCard?.goal`——这是错误的：
- `taskCard.goal` 是由 `api-shapes.mjs` 从 `sessionState.goal` 自动投影出来的
- 对于项目 session，`sessionState.goal` 来自对话内容，不是项目描述
- 项目是容器，不是任务，不应该有 `taskCard`

### 目标

新增 `description` 字段到项目 session meta：

```json
{
  "id": "...",
  "name": "melody-sync",
  "description": "MelodySync 产品迭代项目",
  "taskPoolMembership": { "longTerm": { "role": "project", ... } }
}
```

### 实现要点

1. **`meta-store.mjs`**：`description` 字段已经是透传的（meta 不做字段限制），无需改动
2. **`api-shapes.mjs`**：对 `role === 'project'` 的 session，跳过 `taskCard` 投影（不应该有 `taskCard`）
3. **`session-project.mjs`**：`ensureMelodySyncProject` 创建时写入 `description`
4. **前端读取**：控制面板标题行读 `groupEntry.projectSession?.description`，不读 `taskCard.goal`
5. **编辑入口**：暂不实现，后续在控制面板内迭代

### 受影响的前端代码

- `task-map-react-ui.jsx` 中 `projectSummary` 的取值逻辑，改为读 `projectSession?.description`
- 移除对 `taskCard?.goal` 的引用（在项目卡片渲染中）

---

## 三、实现顺序

1. **Phase 1（UI 重构）**：先按新布局调整 `task-map-react-ui.jsx` 和 `chat-sidebar.css`，`description` 暂时留空，标题行下行不显示
2. **Phase 2（数据结构）**：修复 `api-shapes.mjs` 的 `taskCard` 投影逻辑，为项目 session 添加 `description` 字段，更新 `ensureMelodySyncProject`
3. **Phase 3（联通）**：前端读取 `description` 字段，在控制面板标题行下行显示

---

## 四、关键文件

| 文件 | 改动 |
|------|------|
| `frontend-src/workbench/task-map-react-ui.jsx` | 重构 `SessionListGroupSection` 中 `isLongTermProject` 的标题行布局 |
| `frontend-src/chat-sidebar.css` | 调整 `.lt-project-card-top` 布局，新增右侧可点击区域样式 |
| `backend/session/api-shapes.mjs` | 项目 session 跳过 `taskCard` 投影 |
| `backend/session/system-project.mjs` | `ensureMelodySyncProject` 写入 `description` |
