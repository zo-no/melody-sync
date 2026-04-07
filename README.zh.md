# MelodySync

[English](README.md) | 中文

**一个让人把模糊但反复出现的数字工作交给 AI，并在长期任务中保持工作连续性的跨端工作台。**

MelodySync 面向的是那些手上有重复数字工作、却不是自动化专家的人。它服务的场景很具体：用户知道某件事总在反复发生，手里也许已经有截图、样例文件或零散上下文，但还没有一份足够清晰的自动化说明。

用户可以从手机或桌面把这些模糊输入交进来。MelodySync 先把问题收敛成可执行工作，再让 `codex`、`claude` 和兼容的本地工具在真实机器上执行，同时把工作线程保留下来，让任务之后还能续上，而不是每次都重开。

> 当前基线：`v0.3` —— owner-first 的 session 运行时、落盘的持久历史、可替换的 executor adapter，以及同时兼容手机和桌面的无构建 Web UI。

> 同一条工作线程可以从桌面、手机，以及可选接入面进入，而不改变核心 session 工作流。

## 快速安装

如果上面的 demo 已经说明白了，那就别往下看了。直接在部署机器上开一个新的终端，启动 Codex、Claude Code 或其他 coding agent，然后把下面这段 prompt 粘贴进去：

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

---

## 给人类看的部分

### MelodySync 是什么

MelodySync 是一个运行在真实机器之上的 AI 自动化工作台。它面向的不是已经很会搭自动化系统的人，而是那些知道某件数字工作值得交给 AI，却还需要先把输入、输出和约束讲清楚的人。

它刻意做成跨端控制面：手机负责随手补上下文，桌面负责继续推进，宿主机负责把重活做掉，而工作线程本身保持可恢复。

### 它怎么工作

1. 从一个反复出现的任务、一张截图或一份样例文件开始。
2. MelodySync 先帮你把目标、输入、约束和缺口讲清楚，收敛成一份可执行 brief。
3. `codex`、`claude` 或其他兼容的本地工具在宿主机上执行。
4. 会话历史、运行状态和阶段结果会保留下来，让任务之后还能继续推进，而不必从头重讲。

### 为什么它不是普通 AI 聊天工具

- 目标不是多开几个聊天标签，而是让重复数字工作真正进入可执行状态。
- 用户不需要先写出产品经理级别的 prompt；MelodySync 本来就应该先帮忙澄清问题。
- 首屏应该把新用户导向一个具体值得自动化的任务，而不是把人丢进空的 session list。
- 手机 + 桌面 + 真机执行 + 工作连续性，才是这类产品真正的组合优势。
- `Session` 继续作为当前 shipped product 的公开对象，因为今天真正稳定的是可恢复的工作线程；更高层的 workflow 语言可以以后再往上叠。

### 你现在可以做什么

- 用手机或桌面端发消息，让 agent 在真实机器上执行
- 浏览器断开后依然保留持久化历史
- 在控制面重启后恢复长时间运行的工作
- 让 agent 自动生成会话标题和侧边栏分组
- 直接往聊天里粘贴截图
- 界面自动跟随系统亮色 / 暗色外观

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
melodysync guest-instance       创建带独立 config + memory 的访客实例
melodysync chat                 前台运行 chat server（调试用）
melodysync generate-token       生成新的访问 token
melodysync set-password         设置用户名和密码登录
melodysync --help               显示帮助
```

如果你想在同一台机器上快速开一套隔离环境，可以用 `melodysync guest-instance create <name>`。它会为这个访客实例单独准备 `REMOTELAB_INSTANCE_ROOT` 和独立服务，但网络暴露方式仍然由 MelodySync 之外的运维层负责。

## 配置项

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CHAT_PORT` | `7760` | Chat server 端口 |
| `CHAT_BIND_HOST` | `127.0.0.1` | Chat server 监听地址；本地访问或同机反代时保持 `127.0.0.1`，只有在你的入口层确实需要时才改成 `0.0.0.0` |
| `SESSION_EXPIRY` | `86400000` | Cookie 有效期（毫秒，24h） |
| `SECURE_COOKIES` | `1` | 只有在纯 HTTP 访问时才设为 `0` |
| `REMOTELAB_INSTANCE_ROOT` | 未设置 | 可选的额外实例数据根目录；设置后默认使用 `<root>/config` + `<root>/memory` |
| `REMOTELAB_CONFIG_DIR` | 兼容回退 `~/.config/melody-sync` | 可选的运行时数据/配置目录覆盖，包含 auth、sessions、runs、apps、push、provider runtime home |
| `REMOTELAB_MEMORY_DIR` | 兼容回退 `~/.melody-sync/memory` | 可选的用户 memory 目录覆盖，供 pointer-first 启动使用 |

## 常用文件位置

下面这些是未配置自定义应用目录时的默认路径。

- 如果 `general-settings.json` 里配置了 `appRoot`，MelodySync 会把它当作直接应用目录。
- 如果没有配置自定义应用目录，则继续回退到下面的机器本地默认路径。
- 当前设备配置文件位于 `~/.config/melody-sync/general-settings.json`。

最小可用结构：

```text
~/.config/melody-sync/general-settings.json

<appRoot>/
  AGENTS.md
  config/
    auth.json
    general-settings.json
  memory/
    bootstrap.md
    projects.md
    skills.md
  sessions/
    chat-sessions.json
    history/
    runs/
  hooks/
    custom-hooks.json
  workbench/
  logs/
```

- `~/.config/melody-sync/general-settings.json` 只属于当前这台机器
- `<appRoot>/` 才是 MelodySync 真正的应用目录
- 如果你把应用目录放进同步盘，需要同步的是 `<appRoot>/`；每台机器仍然保留自己的“当前设备配置文件”

| 路径 | 内容 |
|------|------|
| `~/.melodysync/config/auth.json` | 访问 token + 密码哈希 |
| `~/.melodysync/config/auth-sessions.json` | Owner 登录会话 |
| `~/.melodysync/sessions/chat-sessions.json` | Chat 会话元数据 |
| `~/.melodysync/sessions/history/` | 每个会话的事件存储（`meta.json`、`context.json`、`events/*.json`、`bodies/*.txt`） |
| `~/.melodysync/sessions/runs/` | 持久化 run manifest、spool 输出和最终结果 |
| `~/.melodysync/memory/` | pointer-first 启动时使用的机器私有 memory |
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

- `scripts/chat-instance.sh` 现在除了旧的 `--home` 模式，也支持 `--instance-root`、`--config-dir`、`--memory-dir`。
- 如果你想让第二实例继续复用当前机器的 provider 登录状态、但把 MelodySync 自己的数据和 memory 完全隔离，优先用 `--instance-root`。
- 示例：`scripts/chat-instance.sh start --port 7692 --name companion --instance-root ~/.melodysync/instances/companion --secure-cookies 1`

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
