# ADR-0016 — Run ledger foundation

**Status:** Accepted
**Date:** 2026-05-22

## Context

Missions — and soon connector tests, capability invocations, and orchestration
phases — are all **runs**: units of tracked work with a lifecycle. Before M3 a
"run" was nothing more than a `runId = randomUUID()` minted in the mission
runner and echoed into one audit line. There was no queryable record, no way to
see an in-flight run, and no way to reconcile a run the server was executing
when it restarted.

M3 builds the run ledger — the durable, queryable home for runs — on the
SQLite state DB (ADR-0014).

## Decision

The run ledger lives in `~/.agentic-os/state.db` as three tables created by
migration v1: **`runs`**, **`run_steps`**, **`external_refs`**. The `RunLedger`
service (`src/kernel/state/runLedger.ts`) is the single API over them.

Locked rules:

- **Transition validator.** Run status transitions follow a fixed table;
  terminal and illegal transitions throw a typed `RunLedgerError`
  (`not-found` / `terminal` / `invalid-transition`). `RunKind` and `RunStatus`
  are the v8-shaped unions; M3 produces a subset (`queued`, `running`,
  `succeeded`, `failed`, `cancelled`, `interrupted-by-restart`).
- **Cancel cascade.** Cancelling a run cancels its non-terminal descendants via
  `parent_run_id`, in one transaction. The **root** run records the actor
  (`user` / `system` / `timeout` / `stale-claim`); **cascade descendants**
  record `cancelledBy: "parent-run"`; already-terminal descendants are
  untouched.
- **Restart recovery.** At server boot — before the scheduler starts
  (`src/instrumentation.ts`) — every non-terminal run has its `onRestart`
  policy applied: `mark-interrupted` → `interrupted-by-restart`; `cancel` →
  `cancelled` (`cancelledBy: "system"`); `resume` → interrupted (an M3 stub —
  there is no resume runtime yet).
- **The audit log stays authoritative.** The scheduler runner mirrors every
  mission fire into the ledger, but a ledger write failure is logged and
  swallowed — it never breaks a mission run. The audit JSONL line is the
  source-of-truth record; the ledger is the queryable mirror, joined by
  `runId`.
- **`/api/runs`** exposes the ledger read-only plus cancel (`list` / `detail` /
  `cancel`). It is a platform route — CORS-gated, **not** feature-gated.
  Responses are neutral and `inputSummary` is redacted against any path- or
  secret-like value.
- **`inputSummary` is audit-grade text.** Producers write only neutral labels
  (mission id, trigger, counts) — never raw prompts, options, paths, secrets,
  or provider output.

Claim / heartbeat fields, per-run budgets, `round`, and `joinPolicy` are
**schema slots only** in M3 (or deferred to a later migration) — persisted or
reserved, not enforced.

## Consequences

**Positive**
- Runs are durable, queryable, and survive a restart with a defined recovery
  policy.
- The ledger is the foundation the next milestones build on: connector tests
  (M4a — `connector-test` runs) and orchestration phases (M6).
- `/api/runs` gives the operator a real window into run history.

**Negative**
- A second write path sits alongside the audit log. Mitigated: ledger writes
  are non-fatal, so the audit trail remains the authoritative record.

**Neutral**
- M3 ships only the run-ledger tables; approvals / artifacts / connector-health
  tables arrive with their own milestones' migrations (ADR-0014).
- Budget and claim/heartbeat enforcement is deferred — the columns exist (or
  are reserved) but nothing acts on them yet.

## Alternatives considered

- **Keep runs only in the audit JSONL.** Rejected — the audit log is
  append-only and immutable; it cannot represent an in-flight run, a status
  transition, or restart recovery, and it is not built for indexed queries.
- **A dedicated `runs.db`.** Rejected — ADR-0014 fixes platform state to a
  single SQLite state DB.
- **Move the audit log into the ledger.** Rejected — ADR-0009 / ADR-0014: the
  immutable audit trail and mutable run state have different lifecycles.

## References

- ADR-0009 — JSONL audit log.
- ADR-0014 — Persistence four-store split and `stateDbVersion`.
- `agentic-os-expandability-foundation-v8.md` §5.6, §M3.
- `docs/ARCHITECTURE.md` §7 (state store and run ledger).
