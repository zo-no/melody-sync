# MelodySync

[中文](README.zh.md) | English

**A cross-surface AI workbench for handing messy recurring digital work to AI and keeping long-running work continuous.**

MelodySync is for people who have repetitive digital work but are not automation specialists. It is built for the moment when someone knows a task keeps coming back, has a screenshot or sample file that explains the problem, but does not yet have a clean automation spec.

A user can start from phone or desktop with that messy input. MelodySync helps turn it into executable work, lets strong local executors such as `codex`, `claude`, and compatible tools do the machine-side execution, and keeps the work thread durable enough to resume later instead of restarting from zero.

> Current baseline: `v0.3` — an owner-first session runtime, durable on-disk history, executor adapters, and a no-build web UI that works across phone and desktop.

> Reach the same work thread from desktop, phone, and optional integration surfaces without changing the core session workflow.

## Product overview

### What MelodySync is

MelodySync is an AI automation workbench that sits above strong executors running on a real machine. It is designed for the common situation where someone knows a job is worth automating, but still needs help clarifying the inputs, outputs, and constraints before any executor should run.

The product is deliberately cross-surface: collect context from a phone, continue from a desktop, and let the host machine do the heavy work while the thread stays recoverable.

### How MelodySync works

1. Start with a recurring job, a screenshot, or a sample file.
2. MelodySync helps clarify the task, gather the missing context, and shape the problem into an execution brief.
3. A strong local executor such as `codex`, `claude`, or another compatible tool runs on the host machine.
4. Session history, run state, and outputs stay durable so the next step can continue later without re-explaining everything.

### Why it is different from a normal AI chat tool

- The goal is not to open more chat tabs; it is to get repetitive digital work into a form that can actually be executed.
- The user does not need product-manager-grade prompts; MelodySync is supposed to help with clarification before execution.
- The first screen should lead toward one concrete job worth automating, not drop a new user into an empty session list.
- Phone + desktop + real-machine execution + durable continuity is the product advantage.
- `Session` remains the shipped public object because recoverable work threads are the current product center; richer workflow language can layer on later.

### What you can do today

- start a session from phone or desktop while the agent works on your real machine
- keep durable history even if the browser disconnects
- recover long-running work after control-plane restarts
- let the agent auto-title and auto-group sessions in the sidebar
- paste screenshots directly into the chat
- let the UI follow your system light/dark appearance automatically

## Quick install

If the product direction already makes sense, do not keep reading. Open a fresh terminal on the host machine, start Codex, Claude Code, or another coding agent, and paste this:

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

### What MelodySync is not

- a terminal emulator
- a traditional editor-first IDE
- a power-user cockpit whose main value is opening as many concurrent sessions as possible
- a prompt playground that assumes the user already knows how to specify the work perfectly
- a generic multi-user chat SaaS
- a closed all-in-one executor stack trying to out-execute `codex` or `claude`

### Product grammar

The current shipped product model is intentionally simple:

- `Session` — the durable work thread
- `Run` — one execution attempt inside a session
- `Source metadata` — passive tags such as `sourceId` / `sourceName` used to label how a session entered the system

`Session` stays public because the product still centers on recoverable work threads. More ambitious workflow language can sit above it later without forcing a rename now.

The architectural assumptions behind that model:

- HTTP is the canonical state path and WebSocket only hints that something changed
- the browser is a control surface, not the system of record
- runtime processes are disposable; durable state lives on disk
- the product is single-owner first
- the frontend stays framework-light and endpoint-flexible

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
| `chat-server.mjs` | `7760` | Primary backend/control plane for production use |

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
- `7760` is the shipped backend/control plane; restart recovery now removes the need for a permanent second validation service

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
melodysync guest-instance       Create isolated instances with separate config + memory
melodysync chat                 Run chat server in foreground (debug)
melodysync storage-maintenance  Report or prune reclaimable runtime storage
melodysync generate-token       Generate a new access token
melodysync set-password         Set username & password login
melodysync --help               Show help
```

For quick isolated sandboxes on the same machine, use `melodysync guest-instance create <name>`. It provisions a separate isolated instance root and a dedicated local service without mixing chat history or memory into the owner's main instance.

Production updates should go through `melodysync release` rather than live-editing the running `7760` surface. The release command snapshots the shipped runtime, restarts only after the test gate passes, and automatically restores the previous active release if the health check fails.

## Configuration

Some advanced env vars still keep the older `MELODYSYNC_` prefix for compatibility. They now override MelodySync runtime paths and behavior only; they do not imply a separate product layer.

| Variable | Default | Description |
|----------|---------|-------------|
| `CHAT_PORT` | `7760` | Chat server port |
| `CHAT_BIND_HOST` | `127.0.0.1` | Host to bind the chat server; keep `127.0.0.1` for local or same-machine reverse proxy access, use `0.0.0.0` only when your operator-managed ingress needs it |
| `SESSION_EXPIRY` | `86400000` | Cookie lifetime in ms (24h) |
| `SECURE_COOKIES` | `1` | Set `0` only for plain HTTP access such as local development or private-network access without HTTPS |
| `MELODYSYNC_INSTANCE_ROOT` | unset | Optional isolated MelodySync data root for an additional instance; defaults to `<root>/config` + `<root>/memory` when set |
| `MELODYSYNC_CONFIG_DIR` | machine default `~/.config/melody-sync` | Optional runtime data/config override for auth, sessions, runs, push, and provider-managed homes |
| `MELODYSYNC_MEMORY_DIR` | machine default `~/.melodysync/memory` | Optional user-memory override for pointer-first startup files |
| `MELODYSYNC_LIVE_CONTEXT_COMPACT_TOKENS` | `window overflow` | Optional auto-compact override in live-context tokens; unset = compact only after live context exceeds 100% of a known context window, `Inf` = disable |

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
- MelodySync now trims some non-canonical payloads in the event index: hidden reasoning traces and oversized hidden tool/context bodies keep previews plus byte counts in the main history view, while full bodies remain recoverable on demand from externalized storage.
- Archiving a session is organizational only. It hides the session from the active list, but it does **not** delete the stored history or run data behind it.
- On long-lived installs, storage can grow materially, especially if you keep long conversations, large tool outputs, heavy reasoning traces, or generated artifacts.
- MelodySync still does **not** auto-delete old data by default, but it now ships a conservative cleanup command for reclaimable runtime storage.
- Use `melodysync storage-maintenance` for a dry-run report, then `melodysync storage-maintenance --apply` to prune old API logs, old terminal run spool/artifacts, and old manager-owned Codex raw sessions/shell snapshots.
- The cleanup command intentionally does **not** touch canonical session truth such as `sessions/chat-sessions.json`, `sessions/history/`, or run `manifest/status/result` files.
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
