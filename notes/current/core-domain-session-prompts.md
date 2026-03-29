# Core Domain Session Prompts

This file replaces the older share/visitor-oriented prompt packs.

## Current prompt maintenance rules

When changing prompt construction in `chat/session-manager.mjs`:

1. Keep the owner-only model explicit.
2. Treat Apps as template/context sources, not access scopes.
3. Keep run/session boundaries clear.
4. Avoid reintroducing retired share or visitor terminology.
5. Prefer focused regression tests over large speculative prompt rewrites.

## Read before editing

1. `../../docs/project-architecture.md`
2. `core-domain-contract.md`
3. `core-domain-implementation-mapping.md`
4. `core-domain-refactor-todo.md`

## Good prompt work

- tighten manager notes
- improve session continuation packets
- reduce duplication between system context and app instructions
- keep source/runtime hints additive and bounded

## Bad prompt work

- adding product logic that belongs in routing or session metadata
- reviving retired share/visitor guardrails
- mixing multiple independent refactors into one prompt-only pass
