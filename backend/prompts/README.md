# MelodySync 提示词目录

每个 `.md` 文件对应一段注入到 AI 系统提示中的内容。可以直接编辑这些文件来调整 AI 的行为，无需修改代码。

## 目录结构

```
prompts/
├── core/               每次会话都会注入
│   ├── constitution.md     AI 行为原则与执行偏好
│   ├── memory-system.md    记忆层级与启动加载规则
│   └── session-routing.md  会话路由、委托、上下文拓扑
│
├── gtd/                GTD 任务管理（条件注入：当会话涉及持久任务时）
│   ├── task-types.md       任务类型定义：长期 / 短期 / 等待 / 技能
│   ├── task-lifecycle.md   任务转换规则：AI 何时转换任务类型
│   ├── task-api.md         API 操作手册：创建、更新、归档任务
│   └── pipeline-pattern.md 流水线构建模式与示例
│
├── delegation/         会话派生（条件注入：当会话需要派生子会话时）
│   └── spawn-reference.md  子会话派生命令参考
│
└── dev/                MelodySync 开发（条件注入：当 folder 指向源码目录时）
    └── self-hosting.md     本地开发注意事项
```

## 注入条件

| 文件 | 注入条件 |
|------|----------|
| `core/*` | 始终注入 |
| `gtd/*` | `session.persistent` 存在，或 group 为 长期任务/短期任务/等待任务 |
| `delegation/*` | `session.persistent` 存在，或 group 为 coordinator/orchestrator |
| `dev/*` | `session.folder` 包含 melody-sync 或 melodysync |

## 修改说明

- 直接编辑 `.md` 文件，重启服务器后生效
- 变量占位符（如 `{{BOOTSTRAP_PATH}}`）由 `system-prompt.mjs` 在运行时替换
- 不要在 `.md` 文件里写 JS 代码，只写纯文本和 Markdown
