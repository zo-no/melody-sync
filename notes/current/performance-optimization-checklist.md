# MelodySync Performance Optimization Checklist

Use this before and during any performance pass on `zo-no-melody-sync`.

## 1. Define the symptom

- Which user action is slow?
- Is the complaint about `p50`, `p95`, or restart behavior?
- Is the problem server latency, first-token latency, or frontend repaint/fetch churn?

## 2. Map the path

- Which endpoint or module owns the path?
- Does the path touch session metadata, full history, run spool data, or child-process execution?
- Is WebSocket only invalidating, or is it indirectly causing repeated expensive HTTP refreshes?

## 3. Count expensive work

- How many child processes are spawned?
- How many files are opened?
- How many JSON blobs are parsed or serialized?
- Are we reading deltas or whole snapshots?
- Are we computing list-level metadata from transcript-level data?

## 4. Check event-loop risk

- Is any synchronous filesystem or CPU-heavy work happening on the request path?
- Does one request iterate across all sessions, all runs, or all events?
- Could this work delay unrelated requests on the same Node process?

## 5. Check working-set size

- Does the UI actually need all returned fields right now?
- Are we loading full message bodies when only counts, names, or timestamps are needed?
- Are we rebuilding structures that could be cached or incrementally maintained?

## 6. Measure before changing

- Capture `p50` and `p95` for the target path.
- Measure cold and warm behavior separately.
- Keep the workload realistic: large histories, active runs, and restart recovery if relevant.

## 7. Prefer these fixes first

- narrow payloads
- replace full reads with deltas
- reuse cached summaries
- move non-critical derivation off the hot path
- batch adjacent writes

## 8. Be careful with these "fixes"

- adding more background work without a measurement plan
- trading one full scan for another hidden full scan
- making WebSocket smarter when the real problem is oversized HTTP refresh work
- adding complexity before proving I/O volume is the bottleneck

## 9. Re-verify after the change

- Did the user-visible metric improve?
- Did restart recovery regress?
- Did memory or disk usage grow unacceptably?
- Did the change alter correctness for active runs, archived sessions, or owner-only session flows?
