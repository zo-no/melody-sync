# AI-Era Hard Skills Roadmap For RemoteLab

This is a practical roadmap for strengthening systems-level engineering ability around `zo-no-remotelab`.

The goal is not to consume more content. The goal is to become stronger at building AI systems that are:

- reliable
- observable
- secure
- efficient
- evolvable

## The stack to study

For this project, hard-skill growth should be prioritized in this order:

1. operating systems and concurrency
2. networking and distributed systems
3. storage and data systems
4. observability and reliability engineering
5. security engineering
6. language/runtime design
7. human-computer interaction and workflow design

Why this order:

- RemoteLab already depends on process control, file I/O, detached runs, HTTP, WebSocket invalidation, and durable session state
- its next bottlenecks are more likely to be systems bottlenecks than model-quality bottlenecks
- once the systems base is strong, AI-specific product work becomes easier and safer

## How to study

Use one rule for every topic:

- read a small amount
- inspect the matching project code
- run one measurement or one experiment
- write down one concrete lesson

Do not study these topics as isolated theory. Force each block back into the repo.

## 12-week roadmap

### Weeks 1-2: Operating systems and process model

Primary goal:

- build a sharp mental model for processes, descriptors, signals, scheduling, and blocking work

Suggested material:

- `CSAPP` process and exceptional control flow chapters
- one concise OS source such as `Operating Systems: Three Easy Pieces`

Read against these files:

- `chat-server.mjs`
- `chat/session-manager.mjs`
- `chat/process-runner.mjs`
- `chat/runner-supervisor.mjs`

Practice task:

- trace a message send from HTTP request to child-process execution to run completion

Deliverable:

- a short note describing every process boundary and which parts are on the server event loop vs delegated to child processes

What success looks like:

- you can explain where latency comes from without saying "Node is async so it should be fine"

### Weeks 3-4: Concurrency, event loops, and backpressure

Primary goal:

- understand where one slow path can stall unrelated work

Suggested material:

- event loop and async I/O internals for Node.js
- backpressure concepts for streams and queues

Read against these files:

- `chat/session-manager.mjs`
- `chat/runs.mjs`
- `chat/ws.mjs`
- `static/chat/core/realtime.js`

Practice task:

- identify one path where oversized refresh work or repeated disk scanning could delay unrelated requests

Deliverable:

- a hot-path inventory with three categories: CPU-heavy, I/O-heavy, fanout-heavy

What success looks like:

- you can point to at least one place where concurrency exists but parallelism does not

### Weeks 5-6: Networking and distributed systems

Primary goal:

- think clearly about truth sources, retries, timeouts, idempotency, and eventual consistency

Suggested material:

- `Computer Networking: A Top-Down Approach`
- a practical distributed-systems source focused on retries, failure, and consistency

Read against these files:

- `chat/router.mjs`
- `chat/ws.mjs`
- `docs/external-message-protocol.md`
- `lib/agent-mail-http-bridge.mjs`

Practice task:

- write down the exact consistency model of one flow: HTTP refresh, WebSocket invalidation, and connector-triggered updates

Deliverable:

- a one-page contract for what the browser may temporarily see stale and how it converges

What success looks like:

- you stop using "real-time" loosely and start describing specific freshness guarantees

### Weeks 7-8: Storage and data systems

Primary goal:

- understand logs, indexes, snapshots, compaction, and data-layout tradeoffs

Suggested material:

- `Designing Data-Intensive Applications`
- a database internals reference or focused notes on B-Tree vs log-structured storage

Read against these files:

- `chat/history.mjs`
- `chat/runs.mjs`
- `chat/session-meta-store.mjs`
- `chat/session-continuation.mjs`

Practice task:

- analyze whether session list, current session, and run spool paths use the right data shape for their read pattern

Deliverable:

- a table with `object`, `write path`, `read path`, `current access pattern`, `likely scaling risk`

What success looks like:

- you can explain why append-only logs are attractive and where they become painful without derived indexes

### Weeks 9-10: Observability and reliability

Primary goal:

- make performance and failures legible before attempting bigger optimization work

Suggested material:

- practical SRE notes on SLIs/SLOs
- tracing/metrics/logging fundamentals

Read against these files:

- `chat/api-request-log.mjs`
- `tests/`
- browser performance marks already used by the frontend

Practice task:

- define a minimum useful metric set for the current product

Minimum set:

- session list latency
- current session refresh latency
- first-token latency
- run completion latency
- detached run recovery time after restart

Deliverable:

- a short metrics contract with names, definitions, and why each metric matters

What success looks like:

- you can answer "what got slower?" with evidence instead of impression

### Weeks 11-12: Security engineering and runtime boundaries

Primary goal:

- reason rigorously about trust boundaries, capability exposure, and abuse paths

Suggested material:

- web auth/session security basics
- command execution and sandbox boundary case studies
- capability-oriented system design

Read against these files:

- `lib/auth.mjs`
- `chat/router.mjs`
- `chat/system-prompt.mjs`
- owner-side session flows in `chat/session-manager.mjs`

Practice task:

- map the trust boundaries for owner, external connector, and local process execution

Deliverable:

- a threat table with `actor`, `allowed capability`, `sensitive asset`, `failure mode`, `current guardrail`

What success looks like:

- you can explain not only what the system does, but what it must never allow

## Secondary track: language/runtime design

This should run in parallel at lower intensity, not replace the systems track.

Why it matters:

- RemoteLab is slowly becoming a runtime for sessions, apps, prompts, tools, and connectors
- this means language/runtime thinking is useful even without building a traditional compiler

Suggested material:

- `Crafting Interpreters`
- selected compiler/runtime talks on ASTs, IRs, validation, and execution boundaries

Good project-facing questions:

- what is the real schema of an App?
- which pieces of session behavior are data and which are code?
- where do we need stronger contracts instead of free-form prompt composition?

## Secondary track: workflow and product systems

This is softer than OS or networking, but still hard skill when done rigorously.

Why it matters:

- many AI products fail because they automate the wrong unit of work
- state-machine clarity and workflow clarity are engineering advantages, not just design taste

Suggested material:

- state-machine driven UI design
- workflow modeling for async human/agent systems

Good project-facing questions:

- when should work stay in one session vs branch into child sessions?
- which states are durable facts vs temporary UI summaries?
- where is the product relying on user memory instead of explicit system state?

## Weekly cadence

Keep the study loop small:

1. read for 60-90 minutes
2. inspect relevant code for 30-60 minutes
3. run one experiment or write one measurement note
4. capture one reusable conclusion in `notes/` or memory if it is durable

That is enough. Do not turn this into a passive reading project.

## What to avoid

- replacing systems study with generic "AI agent" content
- reading distributed-systems theory without mapping it to actual RemoteLab flows
- trying to optimize before defining a metric
- confusing framework fluency with hard skill

## Recommended reading order

If time is limited, do this order:

1. `CSAPP`
2. `Operating Systems: Three Easy Pieces`
3. `Computer Networking: A Top-Down Approach`
4. `Designing Data-Intensive Applications`
5. practical SRE / observability material
6. security engineering basics for auth, trust boundaries, and command execution
7. `Crafting Interpreters`

## The real target

The target is not "know more topics".

The target is:

- to diagnose slowness without guessing
- to add AI capabilities without making the machine unsafe
- to evolve RemoteLab from a clever prototype into a durable system
