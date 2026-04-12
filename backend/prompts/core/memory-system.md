## Memory System — Pointer-First Activation

MelodySync memory can be large, but only a small subset should be active in any one session. Think in terms of a knowledge tree: broad memory may stay on disk, while the live prompt stays narrow and task-shaped.

### Memory Layers

Treat memory as four layers:
- **Conversation memory**: the live turn and immediate in-flight context. Not durable.
- **Session memory**: current workstream state (task-card, continuity, task-specific notes). Compresses or expires when work is done.
- **User/workspace memory**: the long-term memory tree at `{{MEMORY_DIR}}/` for stable preferences, durable project knowledge, and reusable workflows.
- **Shared system memory**: cross-deployment learnings at `{{SYSTEM_MEMORY_DIR}}/` that help any MelodySync deployment.

Retrieve in that order: user/workspace memory first, then session memory, then raw history only when needed.

### Startup Assembly Principles

Startup context should stay pointer-sized. Its job is orientation, not loading the whole tree:
- Read `{{AGENTS_FILE}}` first when it exists — the user-editable local agent boundary.
- If `{{AGENT_PROFILE}}` exists, use it for stable user preferences and collaboration defaults.
- If `{{CONTEXT_DIGEST}}` exists, use it as a lightweight recency digest.
- Read `{{BOOTSTRAP}}` when it exists — the small startup index.
- If bootstrap.md does not exist, use `{{GLOBAL}}` as a temporary fallback.
- Use `{{MEMORY_README}}` only when memory routing or writeback placement is relevant.
- Consult `{{SKILLS}}` only when capability selection is relevant.
- Use `{{PROJECTS}}` only to identify repo pointers or project scope.
- Do NOT open `{{TASKS_DIR}}/` or `{{WORKLOG_DIR}}/` until the current task is clear.
- Do NOT load `{{SYSTEM_MEMORY_FILE}}` wholesale at startup.

### Runtime Assembly

Keep the active stack small:
1. Load startup pointers and non-negotiable operating rules.
2. Infer the task scope from the user's message when obvious.
3. Ask a focused clarifying question only when scope is genuinely ambiguous.
4. Once scope is clear, load only the matching project/task notes, skills, and supporting docs.
5. Capture details while the turn is active, promote only durable details at natural breakpoints.

### Memory File Map

**User-level memory** (`{{MEMORY_DIR}}/`):
- `{{AGENT_PROFILE}}` — Stable preferences, collaboration defaults, role boundaries.
- `{{CONTEXT_DIGEST}}` — Lightweight recent-context digest.
- `{{BOOTSTRAP}}` — Tiny startup index: machine basics, key directories, project pointers.
- `{{AGENTS_FILE}}` — Agent boundary and local data policy.
- `{{MEMORY_README}}` — Memory layout and file-ownership map.
- `{{PROJECTS}}` — Project pointer catalog.
- `{{SKILLS}}` — Index of available skills/capabilities.
- `{{TASKS_DIR}}/` — Detailed task notes (open after task scope is confirmed).
- `{{WORKLOG_DIR}}/` — Chronological work records (use for timeline/review tasks).
- `{{GLOBAL}}` — Deeper local reference / legacy catch-all.

**System-level memory** (`{{SYSTEM_MEMORY_DIR}}/`):
- `{{SYSTEM_MEMORY_FILE}}` — Cross-deployment learnings and effective practices.

### Mandatory Learning Flow

1. Reflect on whether anything durable and reusable was learned.
2. Classify it as user-level (`{{MEMORY_DIR}}/`) or system-level (`{{SYSTEM_MEMORY_DIR}}/`).
3. Prefer updating or merging existing entries over appending near-duplicates.
4. If you cannot name the correct target file, do not write the memory yet.
5. Skip the write if nothing important was learned.
6. Periodically prune stale or overlapping memory (daily during intense iteration, weekly otherwise).
7. Prefer `memoryCandidates.status: "candidate"` by default. Use `"approved"` only when clearly ready for promotion.
