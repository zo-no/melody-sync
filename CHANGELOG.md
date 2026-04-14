# Changelog

## v0.4.1 - 2026-04-14

### Added
- 传递信息功能现在会向目标任务的对话历史写入一条结构化通知消息，AI 下次运行时能直接从上下文中读到来自源任务的结论和进展。
- 传递成功后自动跳转到目标任务，transcript 里显示"信息已传递过来"卡片，样式与支线带回通知一致。

### Changed
- 重构 `handoffSessionData`：不再修改目标任务的 taskCard，改为直接 appendEvent 写入对话历史，与支线合并带回的机制对齐。
- 删除 persistent editor 高级设置面板（执行服务选择、会话上下文选项），简化编辑器界面。
- 移除 global-control-panel 相关 CSS 和 DOM 死代码。

## Unreleased

- Removes the unused `Board` surface and keeps the shipped owner flow centered on sessions and settings.
- Removes voice-input UI/backend paths while keeping transcript-based voice cleanup intact.
- Keeps session workflow organization derived from `workflowState`, `workflowPriority`, review state, and live activity instead of a parallel planning surface.

## v0.3.1

- Fixes mobile keyboard layout so the shell behaves as stable header + content + composer rows.
- Removes a mobile horizontal overflow regression caused by a stale fixed negative margin on the composer resize handle.
- Keeps viewport-driven layout ownership centralized to reduce resize conflicts and future mobile compatibility risk.

## v0.3.0

- Adds a clearer user-facing `Ver x.y.z` build label while keeping commit and frontend fingerprint data available for debugging.
- Splits frontend/page version identity from backend/service identity so the UI reports the code actually on screen.
- Switches frontend freshness detection from timer polling to push-only WebSocket invalidation.

## v0.2.0

- Consolidates the repo around the current HTTP-first MelodySync architecture.
- Treats the current product shape as the new stable baseline after `v0.1`.
- Adds stronger session organization, restart recovery, and external-channel work.
- Moves scenario-style validation scripts into `tests/` to keep the repo root cleaner.
- Templates Cloudflare email-worker config so personal deployment values do not need to ship in git.
