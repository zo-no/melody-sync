# Local Maintenance Contract

This document defines how to keep a personal RemoteLab fork maintainable while staying close to upstream.

Use this when the local machine needs extra runtime behavior such as proxy injection, custom service wiring, local-only defaults, or temporary UI/UX patches that should not make `main` drift away from upstream.

## Copy this prompt

```text
I want you to maintain this RemoteLab fork with an upstream-first workflow.

Use `docs/local-maintenance.md` as the contract.
Before changing code, inspect the current branch, the dirty worktree, and whether `main` still matches `origin/main`.
Keep `main` as the upstream-sync branch.
Put local-only behavior on a dedicated `kual/*` branch unless I explicitly ask to upstream it.
Prefer thin local overlays over broad source edits.
When a machine-specific runtime behavior is required, isolate it in service config, startup scripts, or a local config surface instead of scattering conditionals through the app.
If you need to rebase, preserve upstream behavior first and then re-apply the smallest local delta.
At the end, tell me which changes are general enough to upstream and which should remain local.
```

## Operating model

- `main` is the upstream-sync branch. Treat it as a clean mirror of `origin/main`.
- local work lives on a dedicated branch such as `kual/local-maintenance`.
- if the working tree is dirty while on `main`, move that state onto a local branch before doing anything else.
- prefer rebasing local branches onto the updated `main` instead of merging upstream into a long-running fork branch.

## Standard branch workflow

1. verify whether `main` still matches `origin/main`
2. if local edits are sitting on `main`, create or switch to a `kual/*` branch first
3. update `main` from upstream
4. switch back to the local branch
5. rebase the local branch onto `main`
6. resolve conflicts by keeping upstream structure first, then re-applying the smallest necessary local change

## Runtime isolation rule

For machine-specific behavior, prefer this order:

1. service environment or per-instance config
2. startup / restart script glue
3. small config-loading surface in application code
4. direct business-logic edits only if the first three are insufficient

Examples of local-only runtime state:

- proxy settings such as `http_proxy`, `https_proxy`, and `all_proxy`
- local ports, host bindings, and service labels
- machine-specific paths and credentials
- debug-only defaults

Do not spread machine-specific assumptions across unrelated frontend or server modules when the behavior can be isolated at process startup.

## What should stay local

These changes usually belong on the local branch unless there is a clear upstream use case:

- machine-specific proxy injection
- personal launchd or systemd integration details
- local paths, hostnames, and workstation-specific defaults
- temporary experiments that are not yet generalized

## What is worth upstreaming

These changes are good upstream candidates:

- generic hooks for environment loading
- service-template improvements that help all operators
- conflict-reduction refactors that make startup behavior easier to override
- docs that clarify the supported maintenance workflow for forks

## Conflict rule

When rebasing a local branch:

- prefer upstream file structure, naming, and flow
- keep local patches narrow and easy to re-spot
- if a local customization grows beyond a thin overlay, stop and redesign it as configuration or a reusable hook

## Documentation rule

When a local maintenance convention becomes stable, record it in one of these places:

- `docs/` for current operational truth that another contributor could follow
- `notes/local/` for machine-specific state that should not be mistaken for shared architecture

Do not let chat history become the only source of truth for fork maintenance.
