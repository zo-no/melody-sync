# MelodySync

[English](README.md) | 中文

**一个把反复出现、但还没法直接自动化的数字工作，变成持续可执行的跨端工作台。**

MelodySync 适合知道任务会重复、却只有零散输入的用户。  
你不用先写出完美指令，也不需要一次把上下文说全。

从手机或桌面提交截图、样例文件或一句话，MelodySync 会把它整理成可执行上下文，并保持会话可恢复，让下一步从同一条线程继续。

当前基线：`v0.3` —— owner-first 的 session 运行时、落盘持久历史、executor 适配层，以及兼容手机和桌面的无构建 Web UI。

## 产品概览

### MelodySync 是什么

MelodySync 是一个运行在真实机器上的 AI 自动化工作台。
它把“模糊输入”转成“可执行上下文”。

它刻意做成跨端控制面：手机负责随手补上下文，桌面负责继续推进，宿主机负责把重活做掉，而工作线程本身保持可恢复。

### 它怎么工作

1. 输入：从反复任务、截图或样例文件开始。
2. 澄清：把目标、范围、缺口梳理成一份可执行 brief。
3. 执行：在宿主机由本地执行器（`codex`、`claude` 等）完成动作。
4. 延续：会话历史、运行状态和结果可持久恢复，不用从头复述。

### 为什么它不是普通 AI 聊天工具

- 这不是在聊天而是为了执行，它先解决的是“重复任务持续化”问题。
- 不要求完美 prompt；先帮你把事情说清楚，再让本机执行器跑起来。
- 首屏要引导用户进入一件具体任务，而不是扔进空 session 列表。
- 手机+桌面+真机执行+工作连续性是核心价值组合。
- `Session` 继续作为当前公开对象，workflow 语言可在后续分层上沉淀。

### 你现在可以做什么

- 用手机或桌面发起会话，让本地 AI 在真实机器执行。
- 从零散输入进入可执行流程，不需要从零写 spec。
- 断线或重启后依然保持会话可继续。
- 支持截图、文件、笔记等直接进入执行流。
- 重点是“中断后续做”，不是“第一次就完美写完”。

## 快速安装

如果上面的产品方向已经说清楚了，那就别继续往下看了。直接在部署机器上开一个新的终端，启动 Codex、Claude Code 或其他 coding agent，然后把下面这段 prompt 粘贴进去：

```text
我想在这台机器上先把 MelodySync 本地配置好，这样我就能马上把重复数字工作交给 AI，并在真实机器上完成自动化。

请把 `https://raw.githubusercontent.com/zo-no/melody-sync/main/docs/setup.md` 当作配置契约和唯一真相来源。
不要假设这个仓库已经提前 clone 到本地。如果 `~/code/melody-sync` 还不存在，请你先读取那份契约，再自行 clone `https://github.com/zo-no/melody-sync.git`，然后继续完成安装。
后续流程都留在这个对话里。
开始执行前，请先用一条消息把缺少的上下文一次性问全，让我集中回复一次。
能自动完成的步骤请直接做。
我回复后，请持续自主执行；只在真的遇到 [HUMAN] 步骤、授权确认或最终完成时停下来。
停下来时，请明确告诉我具体要做什么，以及我做完后你会怎么验证。
```

如果你想先看更完整的说明，可以跳到 [安装细节](#安装细节) 或直接打开 `docs/setup.md`。

### MelodySync 不是什么

- 终端模拟器
- 传统的 editor-first IDE
- 只服务 AI 专家的“并发 session 驾驶舱”
- 一个默认假设用户已经把需求拆解得非常清楚的 prompt playground
- 通用多用户聊天 SaaS
- 一套试图在单任务执行层面正面超越 `codex` / `claude` 的闭环执行栈

### 产品语法

当前已发布产品的模型刻意保持简单：

- `Session` —— 持久化的工作线程
- `Run` —— 会话内部的一次执行尝试
- `Source metadata` —— `sourceId` / `sourceName` 这类被动元数据，用来标记会话从哪里进入系统

`Session` 继续放在公开层，是因为当前产品真正稳定的中心仍然是可恢复的工作线程。更高阶的 workflow 语言可以以后再往上加，但没必要现在硬改名。

这些模型背后的架构假设是：

- HTTP 是规范状态路径，WebSocket 只负责提示“有东西变了”
- 浏览器是控制面，不是系统事实来源
- 运行时进程可以丢，持久状态必须落在磁盘上
- 产品默认单 owner 模式
- 前端保持轻量、无框架，并兼容不同端的使用方式

### Provider 说明

- MelodySync 现在把 `Codex`（`codex`）作为默认内置工具，并放到选择器最前面。
- 这并不意味着“执行器选择本身就是产品”。恰恰相反：MelodySync 应该保持 adapter-first，把当前最强的本地执行器接进来。
- 对这种自托管控制面来说，API key / 本地 CLI 风格的集成通常比基于消费级登录态的远程封装更稳妥。
- `Claude Code` 依然可以在 MelodySync 里使用；其他兼容的本地工具也可以接入，前提是它们的认证方式和服务条款适合你的实际场景。
- 长期目标是 executor portability，而不是绑定某一个闭环 runtime。
- 实际风险通常来自底层提供商的认证方式和服务条款，而不只是某个 CLI 的名字本身。是否接入、是否继续用，请你自行判断。

### 安装细节

最快的方式仍然是：把一段 setup prompt 粘贴给部署机器上的 Codex、Claude Code 或其他靠谱的 coding agent。它可以自动完成绝大多数步骤，只会在真正需要人工参与的节点停下来。

这个仓库里的配置类和功能接入类文档都按同一个原则来写：人只需要把 prompt 发给自己的 AI agent，Agent 会尽量在最开始一轮把需要的上下文都问清楚，然后后续流程都留在那段对话里，只有明确标记为 `[HUMAN]` 的步骤才需要人离开对话手工处理。

最优雅的模式就是一次性交接：Agent 先一轮收齐信息，人回一次；之后 Agent 自己连续完成剩余工作，除非真的需要人工授权、浏览器操作、校验确认或最终验收。

**粘贴前的前置条件：**
- **macOS**：已安装 Homebrew + Node.js 18+
- **Linux**：Node.js 18+
- 至少安装了一个 AI 工具（`codex`、`claude`、`cline` 或兼容的本地工具）

**在宿主机开一个新的终端，启动 Codex 或其他 coding agent，然后粘贴这段 prompt：**

```text
我想在这台机器上先把 MelodySync 本地配置好，这样我就能控制 AI worker，并把长时间运行的 AI 工作组织起来。

请把 `https://raw.githubusercontent.com/zo-no/melody-sync/main/docs/setup.md` 当作配置契约和唯一真相来源。
不要假设这个仓库已经提前 clone 到本地。如果 `~/code/melody-sync` 还不存在，请你先读取那份契约，再自行 clone `https://github.com/zo-no/melody-sync.git`，然后继续完成安装。
后续流程都留在这个对话里。
开始执行前，请先用一条消息把缺少的上下文一次性问全，让我集中回复一次。
能自动完成的步骤请直接做。
我回复后，请持续自主执行；只在真的遇到 [HUMAN] 步骤、授权确认或最终完成时停下来。
停下来时，请明确告诉我具体要做什么，以及我做完后你会怎么验证。
```

如果你想看完整的本地配置契约和人工节点说明，请直接看 `docs/setup.md`。

### 配置完成后你会得到什么

先在本机打开 MelodySync：
- **本地**：`http://127.0.0.1:7760/?token=YOUR_TOKEN`

- 新建一个本地 AI 工具会话，默认优先使用 Codex
- 默认从 `~` 开始，也可以让 agent 切到其他仓库路径
- 发送消息时，界面会在后台不断重新拉取规范 HTTP 状态
- 关掉浏览器后再回来，不会丢失会话线程

### 日常使用

配置完成后，服务可以在开机时自动启动（macOS LaunchAgent / Linux systemd）。你可以先直接打开本地地址。

```bash
melodysync start
melodysync stop
melodysync restart chat
```

## 文档地图

如果你是经历了很多轮架构迭代后重新回来看，现在推荐按这个顺序读：

1. `README.md` / `README.zh.md` —— 产品概览、安装路径、日常操作
2. `docs/setup.md` —— 本地安装契约
3. `docs/project-architecture.md` —— 当前已落地架构和代码地图
4. `docs/README.md` —— 文档分层和同步规则
5. `notes/current/core-domain-contract.md` —— 当前领域模型 / 重构基线

---

## 架构速览

MelodySync 当前的落地架构已经稳定在：一个主 chat 控制面、detached runners，以及落盘的持久状态。

| 服务 | 端口 | 职责 |
|------|------|------|
| `chat-server.mjs` | `7760` | 生产可用的主 chat / 控制面 |

```
浏览器 / 客户端入口
   │
   ▼
运维侧管理的本地访问或入口层
   │
   ▼
chat-server.mjs (:7760)
   │
   ├── HTTP 控制面
   ├── 鉴权 + 策略
   ├── session/run 编排
   ├── 持久化历史 + run 存储
   ├── 很薄的 WS invalidation
   └── detached runners
```

当前最重要的架构规则：

- `Session` 是主持久对象，`Run` 是它下面的执行对象
- 浏览器状态始终要回收敛到 HTTP 读取结果
- WebSocket 是无效化通道，不是规范消息通道
- 之所以能在控制面重启后恢复活跃工作，是因为真正的状态在磁盘上
- 开发 MelodySync 自身时，`7760` 就是唯一默认 backend/control plane；现在依赖干净重启后的恢复能力，而不是常驻第二个验证服务

完整代码地图和流程拆解请看 `docs/project-architecture.md`。

外部渠道接入的规范契约请看 `docs/external-message-protocol.md`。

---

## CLI 命令

```text
melodysync setup                运行交互式配置向导
melodysync start                启动所有服务
melodysync stop                 停止所有服务
melodysync restart [service]    重启：chat | all
melodysync release              跑测试、生成 release 快照、重启并做健康检查
melodysync guest-instance       创建带独立 config + memory 的隔离实例
melodysync chat                 前台运行 chat server（调试用）
melodysync storage-maintenance  预览或清理可回收的运行态存储
melodysync generate-token       生成新的访问 token
melodysync set-password         设置用户名和密码登录
melodysync --help               显示帮助
```

如果你想在同一台机器上快速开一套隔离环境，可以用 `melodysync guest-instance create <name>`。它会为这个隔离实例单独准备独立的数据根目录和服务，但网络暴露方式仍然由 MelodySync 之外的运维层负责。

`melodysync setup`、`start`、`restart` 背后的本地服务脚本现在会把仓库根目录作为 service working directory，并且只有在本机 `/api/build-info` 健康检查通过后才算启动成功。macOS 下也改成了 `bootout/bootstrap/kickstart` 语义，plist 环境变量变更会真正生效。

## 存储增长与清理

- MelodySync 默认偏向保留数据：会话 history、run 输出、artifacts 和日志都会随着时间累积。
- 现在事件索引里也会先做一层瘦身：隐藏的 reasoning 轨迹，以及超大的隐藏 tool/context 正文，在主 history 视图里只保留预览和字节信息；完整正文仍可按需从外部化存储中取回。
- `归档` 只是组织语义，不会自动删除背后的 history 或 run 数据。
- 现在仓库内置了保守的清理命令：先运行 `melodysync storage-maintenance` 看 dry-run 报告，再用 `melodysync storage-maintenance --apply` 真正删除。
- 这个命令只清理可再生/非真值数据：旧 `api logs`、旧终态 run 的 `spool/artifacts`、旧的 Codex managed raw sessions 和 `shell_snapshots`。
- 它不会动 `sessions/chat-sessions.json`、`sessions/history/`，也不会删掉 run 的 `manifest/status/result` 真值文件。

## 配置项

有些高级环境变量仍然保留旧的 `MELODYSYNC_` 前缀作为兼容层。它们现在只是在覆盖 MelodySync 自己的运行时路径和行为，不代表还存在另一套产品抽象。

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CHAT_PORT` | `7760` | Chat server 端口 |
| `CHAT_BIND_HOST` | `127.0.0.1` | Chat server 监听地址；本地访问或同机反代时保持 `127.0.0.1`，只有在你的入口层确实需要时才改成 `0.0.0.0` |
| `SESSION_EXPIRY` | `86400000` | Cookie 有效期（毫秒，24h） |
| `SECURE_COOKIES` | `1` | 只有在纯 HTTP 访问时才设为 `0` |
| `MELODYSYNC_INSTANCE_ROOT` | 未设置 | 可选的额外 MelodySync 隔离实例数据根目录；设置后默认使用 `<root>/config` + `<root>/memory` |
| `MELODYSYNC_CONFIG_DIR` | 机器默认 `~/.config/melody-sync` | 可选的运行时数据/配置目录覆盖，包含 auth、sessions、runs、push、provider runtime home |
| `MELODYSYNC_MEMORY_DIR` | 机器默认 `~/.melodysync/memory` | 可选的用户 memory 目录覆盖，供 pointer-first 启动使用 |

## 常用文件位置

下面这些是未配置自定义根目录时的默认路径。

- `general-settings.json` 现在可以同时指向可迁移的 `brainRoot` 和当前机器的 `runtimeRoot`。
- `brainRoot` 只放长期、可迁移的资产，比如 `AGENTS.md` 和 `memory/`。
- `runtimeRoot` 只放当前机器的运行态数据，比如 sessions、runs、voice/email 运行文件、logs、provider runtime homes。
- 当前设备配置文件位于 `~/.config/melody-sync/general-settings.json`。

最小可用结构：

```text
~/.config/melody-sync/general-settings.json

<brainRoot>/
  AGENTS.md
  memory/
    bootstrap.md
    projects.md
    skills.md

<runtimeRoot>/
  config/
    provider-runtime-homes/
  email/
  hooks/
  voice/
  sessions/
    chat-sessions.json
    history/
    runs/
  workbench/
  logs/
```

- `~/.config/melody-sync/general-settings.json` 只属于当前这台机器
- `<brainRoot>/` 是可跨机器同步的长期“大脑”
- `<runtimeRoot>/` 是当前设备的本地运行态
- 如果你要跨机器延续 agent，应该同步 `<brainRoot>/`，而不是 `<runtimeRoot>/`

| 路径 | 内容 |
|------|------|
| `~/.config/melody-sync/auth.json` | 访问 token + 密码哈希 |
| `~/.config/melody-sync/auth-sessions.json` | Owner 登录会话 |
| `~/.config/melody-sync/general-settings.json` | 当前设备 bootstrap，指向 `brainRoot` + `runtimeRoot` |
| `~/.melodysync/runtime/sessions/chat-sessions.json` | Chat 会话元数据 |
| `~/.melodysync/runtime/sessions/history/` | 每个会话的事件存储（`meta.json`、`context.json`、`events/*.json`、`bodies/*.txt`） |
| `~/.melodysync/runtime/sessions/runs/` | 持久化 run manifest、spool 输出和最终结果 |
| `~/Desktop/diary/diary/00-🤖agent/memory/` | 作为 `brainRoot` 时承载长期 memory 的目录示例 |
| `~/Library/Logs/chat-server.log` | Chat server 标准输出 **(macOS)** |
| `~/.local/share/melody-sync/logs/chat-server.log` | Chat server 标准输出 **(Linux)** |

## 安全

- `256` 位随机访问 token，做时序安全比较
- 可选 scrypt 哈希密码登录
- `HttpOnly` + `Secure` + `SameSite=Strict` 的认证 cookie
- 登录失败按 IP 限流，并做指数退避
- 默认服务只绑定 `127.0.0.1`，不直接暴露到公网
- 如果后续需要网络暴露，请把它视为 MelodySync 之外的运维层能力
- CSP 头使用基于 nonce 的脚本白名单

## 手动起第二实例

- `scripts/local-service/chat-instance.sh` 现在除了旧的 `--home` 模式，也支持 `--instance-root`、`--config-dir`、`--memory-dir`。
- 如果你想让第二实例继续复用当前机器的 provider 登录状态、但把 MelodySync 自己的数据和 memory 完全隔离，优先用 `--instance-root`。
- 示例：`scripts/local-service/chat-instance.sh start --port 7692 --name companion --instance-root ~/.melodysync/instances/companion --secure-cookies 1`

## 故障排查

**服务启动失败**

```bash
# macOS
tail -50 ~/Library/Logs/chat-server.error.log

# Linux
journalctl --user -u melodysync-chat -n 50
tail -50 ~/.local/share/melody-sync/logs/chat-server.error.log
```

**端口被占用**

```bash
lsof -i :7760
```

**重启单个服务**

```bash
melodysync restart chat
```

---

## License

MIT
