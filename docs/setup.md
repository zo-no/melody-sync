# MelodySync Local Setup Contract (Prompt-First)

This document is the setup contract for an AI agent running on the target machine.
The canonical public copy is `https://raw.githubusercontent.com/zo-no/melody-sync/main/docs/setup.md`, so the setup flow can start from a clean terminal even before the repo exists locally.

This contract is intentionally local-first. External exposure is handled separately in `EXTERNAL_ACCESS.md`.

The human's default job is simple: open a fresh terminal on the target machine, paste a prompt into their own AI agent, answer one concentrated context handoff near the start, and only step in again for explicit `[HUMAN]` checkpoints. The configured object is the AI toolchain and its defaults, not a long manual checklist for the human to replay.

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

The AI should try to collect everything below in its first exchange, not through a long trail of follow-up questions.

- platform: `macOS` or `Linux`
- which local AI CLI tools are actually installed and allowed to be used
- default tool, model, and reasoning / effort preference for new sessions
- auth preference: token-only or token + password fallback

If something cannot be known until a browser or provider login happens, the AI should still explain the full payload it expects back so the human can return once with all missing details.

If multiple tools are installed and the user has no strong preference, prefer `Codex` (`codex`) as the default built-in tool.

## Runtime configuration principle

MelodySync setup is the primary configuration UX.

- the AI should ask which installed tool(s) the user wants enabled
- the AI should ask for default model and reasoning preferences where the tool supports them
- these answers should seed defaults for new sessions
- the current chat turn's tool/model choice remains the runtime source of truth
- background helpers such as auto-naming or summarization should inherit the current turn selection rather than silently switching providers

## [HUMAN] checkpoints

1. Any OS, package-manager, or provider auth the AI cannot finish alone, such as a sudo password, Homebrew install approval, or external login.
2. Opening the final local MelodySync URL and confirming the first successful login.

The AI should minimize how often it interrupts the human for these checkpoints and should batch requests whenever one human visit can unblock multiple downstream steps.

## AI execution contract

The AI should do the rest inside the conversation:

- verify prerequisites: Node.js 18+ and at least one supported AI CLI
- gather the full context packet before starting execution, so the human is not repeatedly re-interrupted for small missing details
- do not require the human to pre-clone the repo; if `~/code/melody-sync` is missing, fetch this contract from its canonical URL, clone `https://github.com/zo-no/melody-sync.git` into `~/code/melody-sync`, otherwise update the existing repo, then run `npm install`
- prefer `melodysync setup` when it cleanly fits the environment
- generate access auth with `melodysync generate-token`; optionally add password auth with `melodysync set-password`
- configure the boot-managed local owner stack on `127.0.0.1:7760`
- persist or seed the chosen tool/model/reasoning defaults for new sessions
- validate the local service and final access URL before handing back control
- if the user asks for external access later, route them to `EXTERNAL_ACCESS.md` rather than implementing network ingress inside MelodySync setup

## Target state

| Surface | Expected state |
| --- | --- |
| Primary chat service | boot-managed owner service on `http://127.0.0.1:7760` |
| Auth | default owner auth exists at `~/.config/melody-sync/auth.json` (or a migrated legacy path) and the token is known to the user |
| Defaults | new-session tool/model/reasoning defaults match the user's stated preference |

## Done means

- the local logs show the chat server is listening
- the AI returns the final local URL as `http://127.0.0.1:7760/?token=...`
- the human confirms the browser can open MelodySync successfully

## Repair rule

If validation fails, the AI should stay in the conversation, inspect logs, and repair the machine. Keep manual instructions only for browser, approval, or external-auth steps the AI cannot do itself, and avoid restarting the whole questioning flow unless the missing context truly changed.

For long-lived forks that carry machine-specific runtime customizations, keep `main` aligned with upstream and move local-only maintenance rules to `docs/local-maintenance.md`.
