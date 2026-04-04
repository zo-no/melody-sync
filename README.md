# MelodySync

[中文](README.zh.md) | English

**A cross-surface AI workbench that helps ordinary people hand repetitive digital work to AI.**

MelodySync is not only for the small group of people who already know how to use AI well. The goal is to bring AI automation to a much wider set of users, especially people with lots of repetitive digital work but no engineering automation background.

It does not care much whether the control surface is a phone, tablet, or desktop. The point is to let a user hand over a messy recurring task, screenshot, or sample file, have the AI clarify the problem first, and then let strong executors like `codex`, `claude`, and compatible local tools do the real work on a real machine.

![MelodySync across surfaces](docs/readme-multisurface-demo.png)

> Current baseline: `v0.3` — an owner-first session runtime, durable on-disk history, executor adapters, and a no-build web UI that works across phone and desktop.

> Reach the same system from desktop, phone, and optional integration surfaces without changing the core session workflow.

## Quick install

If the demo makes sense, do not keep reading. Open a fresh terminal on the host machine, start Codex, Claude Code, or another coding agent, and paste this:

```text
I want to set up MelodySync locally on this machine so I can hand repetitive digital work to AI and use it right away.

Use the setup contract at `https://raw.githubusercontent.com/zo-no/melody-sync/main/docs/setup.md` as the source of truth.
Do not assume the repo is already cloned. If `~/code/melody-sync` does not exist yet, fetch that contract, clone `https://github.com/zo-no/melody-sync.git` yourself, and continue.
Keep the workflow inside this chat.
Before you start work, collect every missing piece of context in one message so I can answer once.
Do every step you can automatically.
After my reply, continue autonomously and only stop for real [HUMAN] steps, approvals, or final completion.
When you stop, tell me exactly what I need to do and how you'll verify it after I reply.
```

Need the longer version first? Jump to [Setup details](#setup-details) or open `docs/setup.md`.

---

## For Humans

### Vision

Bluntly: MelodySync is an AI automation workbench for ordinary people. It should first serve people who have repetitive digital work but have not yet turned AI into part of their daily operating flow.

The first goal is concrete: in a short conversation, help a user hand off a tedious job that used to cost hours every week — data cleanup, light analysis, report generation, file batch work, exports/imports, triggered notifications, and other scriptable chores.

### Core judgments

- The biggest unmet need is not encouraging people to open endless concurrent sessions; it is finding repetitive work that is actually worth automating.
- Most target users are not AI-native operators and do not arrive with product-manager-grade prompts; the AI needs to help clarify the task, gather examples, and design a workable approach.
- The first high-fit user slice is not literally everyone with a computer; it looks more like time-pressed middle managers / owner-operators in traditional industries who both coordinate others and still personally carry repetitive digital admin work.
- The first screen cannot be a blank session list. New users need a clear default task-entry flow that helps them describe one concrete repetitive job worth automating.
- The best wedge is simple, fast-payback digital work: data cleanup, analysis, file processing, reports, notifications, and other repetitive scriptable tasks.
- Phone + desktop + real-machine execution is the product advantage: capture context anywhere, let the machine do the heavy work, and review results or approvals from the most convenient device.
- `Session`, source metadata, concurrency, and distribution still matter, but they are enabling layers or later multipliers rather than the first headline.

### What MelodySync is

- an AI automation workbench that sits above strong executors running on a real machine
- an AI collaboration entry point that helps users turn vague problems into executable plans
- a cross-surface control plane where people can start from phone, continue from desktop, and let the machine do the work
- a durable work-thread system that helps humans recover context instead of repeatedly re-explaining the task
- a task workspace that keeps durable threads, execution state, and reusable source context

### What MelodySync is not

- a terminal emulator
- a traditional editor-first IDE
- a power-user cockpit whose main value is opening as many concurrent sessions as possible
- a prompt playground that assumes the user already knows how to specify the work perfectly
- a generic multi-user chat SaaS
- a closed all-in-one executor stack trying to out-execute `codex` or `claude`

### Two core product layers

1. **First, solve repetitive digital work.** MelodySync should accept a messy but recurring task, help the user clarify inputs, outputs, and constraints, and turn it into an automation that reliably saves time.
2. **Then stabilize and reuse what works.** Once an automation proves valuable, MelodySync should preserve the session context, source metadata, and operating pattern in a form that can be redesigned later without distorting the current product.

### Product grammar

The current product model is intentionally simple:

- `Session` — the durable work thread
- `Run` — one execution attempt inside a session
- `Source metadata` — passive tags such as `sourceId` / `sourceName` used to label how a session entered the system

The architectural assumptions behind that model:

- HTTP is the canonical state path and WebSocket only hints that something changed
- the browser is a control surface, not the system of record
- runtime processes are disposable; durable state lives on disk
- the product is single-owner first
- the frontend stays framework-light and endpoint-flexible

### Why this boundary matters

MelodySync is opinionated in a few ways:

- **Clarify the problem before executing.** MelodySync should not assume the user already thinks like an AI product manager; the AI needs to carry part of the problem-framing and solution-design work.
- **Do not rebuild the executor layer.** MelodySync should not spend most of its energy optimizing single-task agent internals.
- **Recover context, do not dump logs.** Durable sessions matter more than raw terminal continuity.
- **Package recurring workflows carefully, but keep the current shipped product session-first until the next workflow model is ready.**
- **Integrate the strongest tools, keep them replaceable.** The point is a stable abstraction layer so better executors can be adopted quickly as the ecosystem evolves.

### What you can do

- start a session from phone or desktop while the agent works on your real machine
- keep durable history even if the browser disconnects
- recover long-running work after control-plane restarts
- let the agent auto-title and auto-group sessions in the sidebar
- paste screenshots directly into the chat
- let the UI follow your system light/dark appearance automatically

### Provider note

- MelodySync treats `Codex` (`codex`) as the default built-in tool and shows it first in the picker.
- That is not because executor choice is the product. The opposite is true: MelodySync should stay adapter-first and integrate the strongest executors available locally.
- API-key / local-CLI style integrations are usually a cleaner fit for a self-hosted control plane than consumer-login-based remote wrappers.
- `Claude Code` still works in MelodySync, and any other compatible local tool can fit as long as its auth and terms work for your setup.
- Over time, the goal is portability across executors, not loyalty to one closed runtime.
- In practice, the main risk is usually the underlying provider auth / terms, not the binary name by itself. Make your own call based on the provider and account type behind that tool.

### Setup details

The fastest path is still to paste a setup prompt into Codex, Claude Code, or another capable coding agent on the machine that will host MelodySync. It can handle almost everything automatically and stop only for real machine-auth, package-manager, or final verification steps.

Configuration and feature-rollout docs in this repo are model-first and prompt-first: the human copies a prompt into their own AI coding agent, the agent gathers the needed context up front in as few rounds as possible, and the rest of the work stays inside that conversation except for explicit `[HUMAN]` steps.

The best pattern is one early handoff: the agent asks for everything it needs in one message, the human replies once, and then the agent keeps going autonomously until a true manual checkpoint or final completion.

**Prerequisites before you paste the prompt:**
- **macOS**: Homebrew installed + Node.js 18+
- **Linux**: Node.js 18+
- At least one AI tool installed (`codex`, `claude`, `cline`, or a compatible local tool)

**Open a fresh terminal on the host machine, start Codex or another coding agent, and paste this:**

```text
I want to set up MelodySync locally on this machine so I can control AI workers and keep long-running AI work organized.

Use the setup contract at `https://raw.githubusercontent.com/zo-no/melody-sync/main/docs/setup.md` as the source of truth.
Do not assume the repo is already cloned. If `~/code/melody-sync` does not exist yet, fetch that contract, clone `https://github.com/zo-no/melody-sync.git` yourself, and continue.
Keep the workflow inside this chat.
Before you start work, collect every missing piece of context in one message so I can answer once.
Do every step you can automatically.
After my reply, continue autonomously and only stop for real [HUMAN] steps, approvals, or final completion.
When you stop, tell me exactly what I need to do and how you'll verify it after I reply.
```

If you want the full local setup contract and the human-only checkpoints, use `docs/setup.md`.

### What you'll have when done

Open MelodySync locally first:
- **Local**: `http://127.0.0.1:7760/?token=YOUR_TOKEN`

![Dashboard](docs/new-dashboard.png)

- create a session with a local AI tool, with Codex first by default
- start from `~` by default, or point the agent at another repo when needed
- send messages while the UI re-fetches canonical HTTP state in the background
- leave and come back later without losing the conversation thread

### Daily usage

Once set up, the service can auto-start on boot (macOS LaunchAgent / Linux systemd). Open the local URL directly.

```bash
melodysync start
melodysync stop
melodysync release
melodysync restart chat
```

## Documentation map

If you are refreshing yourself after several architecture iterations, use this reading order:

1. `README.md` / `README.zh.md` — product overview, setup path, daily operations
2. `docs/setup.md` — local setup contract
3. `docs/project-architecture.md` — current shipped architecture and code map
4. `docs/README.md` — documentation taxonomy and sync rules
5. `notes/current/core-domain-contract.md` — current domain/refactor baseline

---

## Architecture at a glance

MelodySync’s shipped architecture is now centered on a stable chat control plane, detached runners, and durable on-disk state.

| Service | Port | Role |
|---------|------|------|
| `chat-server.mjs` | `7760` | Primary chat/control plane for production use |

```
Browser / client surface
   │
   ▼
operator-managed local access or ingress
   │
   ▼
chat-server.mjs (:7760)
   │
   ├── HTTP control plane
   ├── auth + policy
   ├── session/run orchestration
   ├── durable history + run storage
   ├── thin WS invalidation
   └── detached runners
```

Key architectural rules:

- `Session` is the primary durable object; `Run` is the execution object beneath it
- browser state always converges back to HTTP reads
- WebSocket is an invalidation channel, not the canonical transcript
- active work can recover after control-plane restarts because the durable state is on disk
- `7760` is the shipped chat/control plane; restart recovery now removes the need for a permanent second validation service

For the full code map and flow breakdown, read `docs/project-architecture.md`.

For the canonical contract that external channels should follow, read `docs/external-message-protocol.md`.

---

## CLI Reference

```text
melodysync setup                Run interactive setup wizard
melodysync start                Start all services
melodysync stop                 Stop all services
melodysync restart [service]    Restart: chat | all
melodysync release              Run tests, snapshot the runtime, restart, and health-check the active release
melodysync guest-instance       Create isolated guest instances with separate config + memory
melodysync chat                 Run chat server in foreground (debug)
melodysync generate-token       Generate a new access token
melodysync set-password         Set username & password login
melodysync --help               Show help
```

For quick isolated sandboxes on the same machine, use `melodysync guest-instance create <name>`. It provisions a separate `REMOTELAB_INSTANCE_ROOT` and a dedicated local service without mixing chat history or memory into the owner's main instance.

Production updates should go through `melodysync release` rather than live-editing the running `7760` surface. The release command snapshots the shipped runtime, restarts only after the test gate passes, and automatically restores the previous active release if the health check fails.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `CHAT_PORT` | `7760` | Chat server port |
| `CHAT_BIND_HOST` | `127.0.0.1` | Host to bind the chat server; keep `127.0.0.1` for local or same-machine reverse proxy access, use `0.0.0.0` only when your operator-managed ingress needs it |
| `SESSION_EXPIRY` | `86400000` | Cookie lifetime in ms (24h) |
| `SECURE_COOKIES` | `1` | Set `0` only for plain HTTP access such as local development or private-network access without HTTPS |
| `REMOTELAB_INSTANCE_ROOT` | unset | Optional isolated data root for an additional instance; defaults to `<root>/config` + `<root>/memory` when set |
| `REMOTELAB_CONFIG_DIR` | legacy `~/.config/melody-sync` fallback | Optional runtime data/config override for auth, sessions, runs, apps, push, and provider-managed homes |
| `REMOTELAB_MEMORY_DIR` | legacy `~/.melody-sync/memory` fallback | Optional user-memory override for pointer-first startup files |
| `REMOTELAB_LIVE_CONTEXT_COMPACT_TOKENS` | `window overflow` | Optional auto-compact override in live-context tokens; unset = compact only after live context exceeds 100% of a known context window, `Inf` = disable |

## Common file locations

These are the default paths when no custom app root is configured.

- If `general-settings.json` includes `appRoot`, MelodySync treats it as the direct app root.
- If no custom app root is configured, MelodySync falls back to the machine-local paths below.
- The current device config file lives at `~/.config/melody-sync/general-settings.json`.

Minimum usable layout:

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

- `~/.config/melody-sync/general-settings.json` belongs to the current machine only
- `<appRoot>/` is the actual MelodySync application directory
- if you use a synced folder, sync `<appRoot>/`; each machine still keeps its own current device config file

| Path | Contents |
|------|----------|
| `~/.melodysync/config/auth.json` | Access token + password hash |
| `~/.melodysync/config/auth-sessions.json` | Owner auth sessions |
| `~/.melodysync/sessions/chat-sessions.json` | Chat session metadata |
| `~/.melodysync/sessions/history/` | Per-session event store (`meta.json`, `context.json`, `events/*.json`, `bodies/*.txt`) |
| `~/.melodysync/sessions/runs/` | Durable run manifests, spool output, and final results |
| `~/.melodysync/memory/` | Private machine-specific memory used for pointer-first startup |
| `~/Library/Logs/chat-server.log` | Chat server stdout **(macOS)** |
| `~/.local/share/melody-sync/logs/chat-server.log` | Chat server stdout **(Linux)** |

## Storage growth and manual cleanup

- MelodySync is durability-first: session history, run output, artifacts, and logs accumulate on disk over time.
- Archiving a session is organizational only. It hides the session from the active list, but it does **not** delete the stored history or run data behind it.
- On long-lived installs, storage can grow materially, especially if you keep long conversations, large tool outputs, heavy reasoning traces, or generated artifacts.
- MelodySync does **not** automatically delete old data and does **not** currently ship a one-click cleanup feature. This is intentional: keeping user data is safer than guessing what is safe to remove.
- If you want to reclaim disk space, periodically review old archived sessions and prune them manually from the terminal, or ask an AI operator to help you clean them up carefully.
- In practice, most storage growth lives under `~/.melodysync/sessions/history/` and `~/.melodysync/sessions/runs/`.

## Ad-hoc extra instances

- `scripts/chat-instance.sh` now supports `--instance-root`, `--config-dir`, and `--memory-dir` in addition to the older `--home` mode.
- Use `--instance-root` when you want a second instance to keep the same machine `HOME` (so provider auth keeps working) while isolating MelodySync's own runtime data and memory.
- Example: `scripts/chat-instance.sh start --port 7692 --name companion --instance-root ~/.melodysync/instances/companion --secure-cookies 1`

## Security

- `256`-bit random access token with timing-safe comparison
- optional scrypt-hashed password login
- `HttpOnly` + `Secure` + `SameSite=Strict` auth cookies
- per-IP rate limiting with exponential backoff on failed login
- default: services bind to `127.0.0.1` only — no direct external exposure
- if you need network exposure later, keep it outside MelodySync itself and use your own operator-managed ingress
- CSP headers with nonce-based script allowlist

## Troubleshooting

**Service won't start**

```bash
# macOS
tail -50 ~/Library/Logs/chat-server.error.log

# Linux
journalctl --user -u melodysync-chat -n 50
tail -50 ~/.local/share/melody-sync/logs/chat-server.error.log
```

**Port already in use**

```bash
lsof -i :7760
```

**Restart a single service**

```bash
melodysync restart chat
```

---

## License

MIT
