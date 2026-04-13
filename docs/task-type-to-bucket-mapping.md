# 任务类型与分类的自动映射

## 设计原则

用户不需要手动选择"长期任务"或"短期任务"分类。任务的分类由其**执行方式**自动决定：

| 执行方式 | persistent.kind | 自动归入分类 | 说明 |
|---------|----------------|------------|------|
| 周期循环执行 | `recurring_task` | 长期任务（long_term） | 每天/每周自动重复执行 |
| 定时一次性执行 | `scheduled_task` | 短期任务（short_term） | 指定时间执行一次 |
| 等待外部触发 | `waiting_task` | 等待任务（waiting） | 等待用户/事件触发 |
| AI 快捷按钮 | `skill` | 快捷按钮（skill） | 一键手动触发 |
| 普通对话任务 | 无 | 收集箱（inbox） | 默认归入，待整理 |

## 实现位置

- **后端映射**：`backend/session/persistent-kind.mjs` → `KIND_TO_BUCKET`
- **promote 时自动设置 bucket**：`backend/services/session/persistent-service.mjs` → `buildPersistentTaskPoolMembership` → `inferBucketFromKind`
- **前端分类显示**：`frontend-src/session-list/ui.js` → `LONG_TERM_BUCKET_DEFS`

## 用户操作流程

1. 用户创建任务 → 自动进入收集箱
2. 用户点击"设置执行方式" → 弹出配置弹窗
3. 用户选择执行方式（周期/定时/等待/快捷按钮）并配置时间
4. 保存后任务自动移动到对应分类，无需用户手动选择

## 变更记录

- 移除了 task card 中"升级为长期任务/升级为短期任务/设为快捷按钮"三个独立按钮
- 合并为单一"设置执行方式"入口，点击打开配置弹窗
- 侧边栏菜单中的"升级任务类型"也合并为弹窗选择，与 task card 保持一致
