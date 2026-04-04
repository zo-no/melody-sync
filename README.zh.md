# MelodySync

[English](README.md) | 中文

**让普通人也能把重复数字工作交给 AI 的跨端工作台。**

MelodySync 的目标，不是只服务已经很会用 AI 的少数人，而是把 AI 的自动化能力带给更多普通用户，尤其是那些每天有大量重复数字工作、却没有研发自动化背景的人。

它并不执着于用户到底从手机、平板还是桌面端进入。端只是入口，真正重要的是：让用户能把一个模糊但反复出现的问题、样例文件或截图交给 AI，由 AI 先帮忙把问题想清楚，再让 `codex`、`claude` 和兼容的本地工具在真实机器上把活做掉。

![MelodySync 跨端演示](docs/readme-multisurface-demo.png)

> 当前基线：`v0.3` —— owner-first 的 session 运行时、落盘的持久历史、可替换的 executor adapter，以及同时兼容手机和桌面的无构建 Web UI。

> 同一套系统可以从桌面、手机，以及飞书 / 邮件这类接入面进入。

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
如果之后我想要外网访问，请引导我看 `EXTERNAL_ACCESS.md`，并在服务器反代、Cloudflare Tunnel、Tailscale 三种方式里推荐最适合的方案。
```

如果你想先看更完整的说明，可以跳到 [安装细节](#安装细节)、直接打开 `docs/setup.md`，或者查看 [`EXTERNAL_ACCESS.md`](EXTERNAL_ACCESS.md) 了解外网访问方式。

---

## 给人类看的部分

### 愿景

如果说得更直接一点，MelodySync 是一个面向普通人的 AI 自动化工作台：它优先服务那些有重复数字工作、却还没有把 AI 真正用进日常流程的人。

它的第一阶段目标也很具体：让用户花很短时间，就能把一个原本每周都要做几小时的琐碎工作交给 AI，例如数据整理、简单分析、报表生成、文件批处理、导出导入、通知触发这类事情。

### 基础判断

- 最值得解决的问题，不是鼓励用户同时开无数个 session，而是先找到那些确实值得自动化的重复工作。
- 目标用户默认不是 AI-native，也不是天生会写 prompt 的产品经理；AI 需要先帮他们把问题澄清、把输入要齐、把方案设计出来。
- 首屏不能只是一个空的 session list。新用户需要一个清晰的任务入口，帮助他们把一个具体的重复工作先讲清楚，再进入第一轮自动化尝试。
- 最好的切入点是简单、明确、回报快的数字工作：数据整理、分析、文件处理、报表、通知、脚本化重复操作。
- 手机 + 桌面 + 真机执行是组合优势：用户可以随手发上下文，AI 在真实机器上做重活，结果和审批再回到最方便的设备上。
- `Session`、来源元数据、并发和分发仍然重要，但它们更像能力层或后续放大的方向，不应该压过首期价值验证。

### MelodySync 是什么

- 一个运行在真实机器之上的 AI 自动化工作台
- 一个帮助用户把模糊问题澄清成可执行方案的 AI 协作入口
- 一个让手机端发起、桌面端继续、AI 在本机执行的跨端控制面
- 一个帮助人类在长任务中恢复上下文、而不是反复重讲需求的持久化工作线程系统
- 一个能保留 durable thread、执行状态和来源上下文的任务工作台

### MelodySync 不是什么

- 终端模拟器
- 传统的 editor-first IDE
- 只服务 AI 专家的“并发 session 驾驶舱”
- 一个默认假设用户已经把需求拆解得非常清楚的 prompt playground
- 通用多用户聊天 SaaS
- 一套试图在单任务执行层面正面超越 `codex` / `claude` 的闭环执行栈

### 两条核心产品线

1. **先帮用户解决重复数字工作。** MelodySync 要能接住一个模糊但反复出现的任务，帮用户澄清输入、输出和约束，然后尽快把它变成一个能稳定省时间的自动化流程。
2. **再把被验证的 workflow 稳定下来并复用。** 当某个自动化真的帮用户省下时间后，先沉淀 session 上下文、来源元数据和操作模式，后续再用新的系统设计复用它，而不是继续扩张已经退役的旧模板系统。

### 产品语法

当前产品模型刻意保持简单：

- `Session` —— 持久化的工作线程
- `Run` —— 会话内部的一次执行尝试
- `Source metadata` —— `sourceId` / `sourceName` 这类被动元数据，用来标记会话从哪里进入系统

这些模型背后的架构假设是：

- HTTP 是规范状态路径，WebSocket 只负责提示“有东西变了”
- 浏览器是控制面，不是系统事实来源
- 运行时进程可以丢，持久状态必须落在磁盘上
- 产品默认单 owner 模式
- 前端保持轻量、无框架，并兼容不同端的使用方式

### 为什么这个边界重要

MelodySync 在几个点上是刻意有立场的：

- **先帮用户把问题讲明白，再执行。** MelodySync 不应假设用户本身已经会像 AI 产品经理一样派活；AI 需要承担一部分问题澄清与方案设计责任。
- **不重造执行器这一层。** MelodySync 不应该把主要精力花在优化单任务 Agent 内部实现细节上。
- **强调上下文恢复，不堆原始日志。** 比起终端连续性，durable session 更重要。
- **强调 workflow 的稳定沉淀，但不要在 workflow 模型还不稳定时把模板系统硬塞进已发布产品。**
- **接入最强工具，并保持可替换。** 它更像一层稳定抽象，让更强执行器出现时可以被快速接入，而不是把自己做成重闭环 runtime。

### 你现在可以做什么

- 用手机或桌面端发消息，让 agent 在真实机器上执行
- 浏览器断开后依然保留持久化历史
- 在控制面重启后恢复长时间运行的工作
- 让 agent 自动生成会话标题和侧边栏分组
- 直接往聊天里粘贴截图
- 界面自动跟随系统亮色 / 暗色外观

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
- 如果后续需要外网或异地访问，请再去看 [`EXTERNAL_ACCESS.md`](EXTERNAL_ACCESS.md)

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
如果之后我想要外网访问，请引导我看 `EXTERNAL_ACCESS.md`，并在服务器反代、Cloudflare Tunnel、Tailscale 三种方式里推荐最适合的方案。
```

如果你想看完整的本地配置契约和人工节点说明，请直接看 `docs/setup.md`。如果你想看外网访问方式，请看 [`EXTERNAL_ACCESS.md`](EXTERNAL_ACCESS.md)。

如果你是在腾讯云机器上做 Nginx/CLB 反代，也直接按 [`EXTERNAL_ACCESS.md`](EXTERNAL_ACCESS.md) 里的服务器反代方案走，不再单独维护一份腾讯云专用说明。

### 配置完成后你会得到什么

先在本机打开 MelodySync：
- **本地**：`http://127.0.0.1:7760/?token=YOUR_TOKEN`
- **后续外网访问**：从 [`EXTERNAL_ACCESS.md`](EXTERNAL_ACCESS.md) 里选择服务器反代、Cloudflare Tunnel 或 Tailscale

![Dashboard](docs/new-dashboard.png)

- 新建一个本地 AI 工具会话，默认优先使用 Codex
- 默认从 `~` 开始，也可以让 agent 切到其他仓库路径
- 发送消息时，界面会在后台不断重新拉取规范 HTTP 状态
- 关掉浏览器后再回来，不会丢失会话线程

### 日常使用

配置完成后，服务可以在开机时自动启动（macOS LaunchAgent / Linux systemd）。你可以先直接打开本地地址；如果后续需要外部访问，再按 [`EXTERNAL_ACCESS.md`](EXTERNAL_ACCESS.md) 里的方式接入。

```bash
melodysync start
melodysync stop
melodysync restart chat
```

## 文档地图

如果你是经历了很多轮架构迭代后重新回来看，现在推荐按这个顺序读：

1. `README.md` / `README.zh.md` —— 产品概览、安装路径、日常操作
2. `docs/setup.md` —— 本地安装契约
3. `EXTERNAL_ACCESS.md` —— 服务器反代 / Cloudflare Tunnel / Tailscale 外部访问教程
4. `docs/project-architecture.md` —— 当前已落地架构和代码地图
5. `docs/README.md` —— 文档分层和同步规则
6. `notes/current/core-domain-contract.md` —— 当前领域模型 / 重构基线

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
- 开发 MelodySync 自身时，`7760` 就是唯一默认 chat/control plane；现在依赖干净重启后的恢复能力，而不是常驻第二个验证服务

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

- 如果 `general-settings.json` 里配置了 `obsidianPath`，MelodySync 会把它当作直接应用目录。
- 如果没有配置自定义应用目录，则继续回退到下面的机器本地默认路径。
- 启动指针文件本身位于 `~/.config/melody-sync/general-settings.json`。

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
- 如果需要外部访问，请用 [`EXTERNAL_ACCESS.md`](EXTERNAL_ACCESS.md) 里的服务器反代、Cloudflare Tunnel 或 Tailscale 方案
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
