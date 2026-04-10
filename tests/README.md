# Tests

Scenario-style validation scripts now live in this directory instead of the repo root.

- Run the current smoke suite with `npm test`.
- Run the live-instance release gate with `npm run test:core-gate`.
- Pull requests run the same smoke suite automatically via GitHub Actions in `.github/workflows/ci.yml`.
- Run a specific script with `node tests/<name>.mjs`.
- `tests/chat` and `tests/lib` are symlinked import roots so existing relative test imports stay stable after the move.

`test:core-gate` is the fast contract gate for changes that may reach the long-lived local instance through `melodysync release`. Keep it green even when the broader smoke suite grows.

High-value smoke scripts:

- `tests/test-session-naming.mjs`
- `tests/test-history-index-contract.mjs`
- `tests/test-session-route-utils.mjs`
- `tests/test-session-external-trigger-refresh.mjs`
- `tests/test-session-label-prompt-context.mjs`
- `tests/test-agent-mailbox.mjs`
- `tests/test-agent-mail-worker.mjs`
- `tests/test-agent-mail-reply.mjs`
