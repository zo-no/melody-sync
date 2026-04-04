# MelodySync Local Setup Contract (Prompt-First)

This document is the setup contract for an AI coding agent running on the target machine.
The canonical public copy is `https://raw.githubusercontent.com/zo-no/melody-sync/main/docs/setup.md`, so the setup flow can start from a clean terminal even before the repo exists locally.

This contract is intentionally local-first. External exposure is handled separately in `EXTERNAL_ACCESS.md`.

The human's job should stay small:

- open a fresh terminal on the target machine
- paste one setup prompt into their own AI coding agent
- answer one concentrated context handoff near the start
- step in again only for true `[HUMAN]` checkpoints such as browser login, system approval, or final verification

## Copy this prompt

```text
I want you to set up MelodySync locally on this machine so I can start using it right away.

Use `https://raw.githubusercontent.com/zo-no/melody-sync/main/docs/setup.md` as the setup contract.
Do not assume the repo is already cloned. If `~/code/melody-sync` does not exist yet, fetch this contract, clone `https://github.com/zo-no/melody-sync.git` yourself, and continue.
Keep the workflow inside this chat.
Before doing work, collect every missing input in one message so I can answer once.
Do every automatable step yourself.
After my reply, continue autonomously until a true `[HUMAN]` step or final completion.
When you stop, tell me the exact action I need to take and how you'll verify it after I reply.
If I later want external access, point me to `EXTERNAL_ACCESS.md`.
```

## One-round input handoff

The AI should gather all missing setup context up front instead of asking a long trail of follow-up questions.

- platform: `macOS` or `Linux`
- which local AI CLI tools are installed and allowed
- default tool, model, and effort / reasoning preference for new sessions
- auth preference: token-only or token + password fallback
- whether the user wants a custom app root path instead of the machine-local default

If a browser or provider login is needed later, the AI should still explain the full expected payload so the human can return once with all missing details.

If multiple tools are installed and the user has no strong preference, prefer `Codex` (`codex`) as the default built-in tool.

## Storage rule

MelodySync has two layers of local config:

1. **Current device config file**
   - machine-local file: `~/.config/melody-sync/general-settings.json`
   - its job is only to tell MelodySync where the app root lives

2. **App root**
   - default when unset: `~/.melodysync`
   - if `general-settings.json` contains `appRoot`, MelodySync treats that value as the **direct app root**
   - MelodySync stores its own durable data directly under that app root using:
     - `config/`
     - `memory/`
     - `sessions/`
     - `hooks/`
     - `workbench/`
     - `logs/`

Important:

- Do **not** create an extra nested `.melodysync/` under a custom app root.
- If the app root is synced by Obsidian or another tool, each machine still needs its **own** local device config file so the service can find that synced directory on that machine.

## Minimal file layout

Once MelodySync is set up, the minimum usable layout is:

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

How to read this:

- `~/.config/melody-sync/general-settings.json` belongs to the current machine only
- `<appRoot>/` is the actual MelodySync application directory
- if you want cross-machine continuity, sync `<appRoot>/`; each machine still keeps its own local device config file

## Runtime configuration principle

MelodySync setup is the primary configuration UX.

- the AI should ask which installed tool(s) the user wants enabled
- the AI should ask for default model and effort preferences where the tool supports them
- those choices should seed defaults for new sessions
- the current chat turn's tool/model choice remains the runtime source of truth
- background helpers such as auto-naming should inherit the current turn selection rather than silently switching providers

## [HUMAN] checkpoints

1. Any OS, package-manager, or provider auth the AI cannot finish alone, such as a sudo password, Homebrew install approval, or external login
2. Opening the final local MelodySync URL and confirming the first successful login

The AI should minimize interruptions and batch requests whenever one human visit can unblock multiple downstream steps.

## AI execution contract

The AI should do the rest inside the conversation:

- verify prerequisites: Node.js 18+ and at least one supported AI CLI
- gather the full context packet before starting execution
- do not require the human to pre-clone the repo; if `~/code/melody-sync` is missing, fetch this contract from its canonical URL, clone `https://github.com/zo-no/melody-sync.git` into `~/code/melody-sync`, otherwise update the existing repo, then run `npm install`
- prefer `melodysync setup` when it cleanly fits the environment
- generate access auth with `melodysync generate-token`; optionally add password auth with `melodysync set-password`
- configure the boot-managed local owner stack on `127.0.0.1:7760`
- if the user wants a custom app root, write `~/.config/melody-sync/general-settings.json` so it points at that directory
- ensure the selected app root contains the standard MelodySync directories
- persist or seed the chosen tool/model/effort defaults for new sessions
- validate the local service and final access URL before handing back control
- if the user asks for external access later, route them to `EXTERNAL_ACCESS.md` rather than implementing network ingress inside MelodySync setup

## Target state

| Surface | Expected state |
| --- | --- |
| Primary chat service | boot-managed owner service on `http://127.0.0.1:7760` |
| Current device config file | `~/.config/melody-sync/general-settings.json` points to the correct app root when a custom path is used |
| App root auth | `<app-root>/config/auth.json` exists and the token is known to the user |
| Defaults | new-session tool/model/effort defaults match the user's stated preference |

## Cross-machine note

If the user stores the app root inside an Obsidian vault or another synced folder, MelodySync can load the same sessions, memory, hooks, and workbench data on another machine.

But the second machine still needs:

1. the synced app root directory itself
2. its own local `~/.config/melody-sync/general-settings.json` pointing at that directory
3. its own machine-level runtime setup such as local provider auth and service startup

## Done means

- the local logs show the chat server is listening on `7760`
- the current device config file and app root resolve to the intended storage directory
- the app root contains `config/ memory/ sessions/ hooks/ workbench/ logs/`
- the AI returns the final local URL as `http://127.0.0.1:7760/?token=...`
- the human confirms the browser can open MelodySync successfully

## Repair rule

If validation fails, the AI should stay in the conversation, inspect logs, and repair the machine.

Keep manual instructions only for browser, approval, or external-auth steps the AI cannot do itself, and do not restart the whole questioning flow unless the missing context actually changed.
