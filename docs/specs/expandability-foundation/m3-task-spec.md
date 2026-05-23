# M3 Task Spec — SQLite Run Ledger Foundation (v2)

**Date:** 2026-05-22
**Version:** v2 — consolidated review (`ChatGPT_Review.txt`) edits 1–8 folded in; M2 merged at `bda3145`
**Milestone:** M3 — SQLite run ledger foundation
**Status:** **DONE (2026-05-23)** — code shipped as **PR #14** (state DB + migration runner), **PR #15** (RunLedger + restart recovery), **PR #16** (`/api/runs` + scheduler wiring); closeout merged as **PR #17** (ADR-0014 + ADR-0016 + ARCHITECTURE §7). The §13 acceptance ran (isolated temp paths used per Rex direction). Open questions in §16 all defaulted.
**Parent design:** `agentic-os-expandability-foundation-v8.md` (§M3, §5.6, §7.2, §10.4, §11)
**Predecessor milestone:** M2 — Registry-driven shell (DONE — merged `0ae4070`, PR #12)
**Successor milestone:** M4a — Connector runtime + local connectors + preset catalog
**Audience:** Claude Code (executing agent) and Rex (approving)
**Purpose:** Decompose M3 into concrete file-level work — the `~/.agentic-os/state.db` run ledger, its migration runner, the run lifecycle service, restart recovery, and the run-status API — adapted to the live v0.3.0 repo, plus the acceptance script Rex runs before approving M4a.

This spec follows the M1/M2 template. Section 3 is the M3 equivalent of M1/M2's corrective guardrails — it pins the v8 §M3 prose to what the repo actually contains.

---

## 1. Scope (locked from v8 §M3)

Build the first of Agentic OS's four persistence stores — the **SQLite state DB** — and seed it with the **run ledger**:

```text
~/.agentic-os/state.db
stateDbVersion + forward guard
migration runner (backup before migrate)
runs table
run_steps table
external_refs table
restart recovery
cancellation model
run status API
basic run events (in-process change notifications)
```

Proof producer stays **Scheduler** — M3 wires the existing mission runner so
every scheduled / manual mission fire is persisted as a `RunRecord`, joined to
the audit JSONL by `runId`. No new feature is introduced.

Out of scope (deferred):

```text
audit in SQLite                            → NEVER — audit stays JSONL (§3.4)
artifacts / approvals / connector_health   → their own milestones' migrations
collaboration / proposals / decision gates → orchestration milestone
claim / heartbeat / stale-claim sweep      → M4a (connector runtime owns it)
budget enforcement (maxIterations etc.)    → later — M3 persists schema slots only
true run resume after restart              → later — M3 marks interrupted (§3.6)
a Runs UI page / run cards in the shell    → later shell milestone (M3 is API only)
capability router / connector runs         → M4a
```

---

## 2. Exit criteria (locked from v8 §M3)

```text
A dummy long-running run can start, update progress, finish, fail, cancel,
  and restore after server refresh/restart.
Active runs are marked interrupted/resumed/cancelled based on the run's
  onRestart policy.
Scheduler mission fires are represented as Run records.
A run can link to an external system reference such as a Hermes task/run ID.
state.db carries a stateDbVersion; a forward guard refuses a DB newer than the
  code; migrations back up the DB before applying.
```

---

## 3. Repo-reality adaptations (READ FIRST)

v8 §M3 predates the v0.3.0 repo. Adapt to what exists; do not invent a parallel
persistence layer.

1. **`better-sqlite3` is already a dependency** (`better-sqlite3@^11.10.0`,
   `@types/better-sqlite3` dev). It is in live use at
   `src/kernel/vaultIndex.ts` — the canonical pattern: `new Database(path)`,
   `db.pragma("journal_mode = WAL")`, `db.prepare<Params,Row>(...)`,
   `db.transaction(fn)`. M3 reuses this library and pattern. **Do not** install
   Drizzle / Kysely / an ORM — M3 uses raw prepared statements like vaultIndex.

2. **There is no migration runner today.** `vaultIndex.ts` just runs
   `db.exec(SCHEMA)` once. M3 builds a real ordered migration runner because the
   state DB will grow tables milestone by milestone (artifacts, approvals,
   connector_health, …). The runner is the M3 deliverable that those later
   milestones extend with one migration each.

3. **No `RunRecord` / `RunStatus` type exists in `src/`.** Run identity today is
   just a `runId = randomUUID()` generated inside `runMission()`
   (`src/features/scheduler/missions/runner.ts`) and echoed into the audit line
   and the `MissionContext.runId` field. M3 introduces the run types and makes
   that `runId` the primary key of a persisted ledger row.

4. **Audit stays JSONL — do NOT move it into SQLite.** `src/kernel/audit.ts`
   writes `~/.agentic-os/audit/YYYY-MM-DD.jsonl`; `auditMissionRun()` already
   records `{ kind:"mission.run", missionId, runId, trigger, status, durationMs,
   … }`. M3 keeps audit exactly as-is. The ledger and the audit log are two
   independent sinks joined only by `runId`. The ledger may store an
   `inputSummary`; the audit log keeps its neutral-metadata-only posture
   (hashes / IDs, never raw input — v8 §10.4 "audit neutral metadata only").

5. **The server-boot hook is `src/instrumentation.ts`.** Its `register()` runs
   once per Node process (`NEXT_RUNTIME === "nodejs"`) and currently calls
   `startGlobalMissionScheduler()`. M3 attaches the restart-recovery sweep here,
   **before** the scheduler starts — interrupted runs from the prior process
   must be reconciled before any new mission can fire.

6. **M3 has no runtime to "resume" into.** v8's restart policy lists
   `onRestart: "resume"`, but resume needs the connector/orchestration runtime
   (M4a+). For M3 every producer is the scheduler, whose missions are
   `mark-interrupted` on restart. M3 therefore implements `mark-interrupted` and
   `cancel`; an `onRestart: "resume"` row is treated as `mark-interrupted` with
   a logged note. The `resume` code path is left as a documented stub.

7. **The run ledger is platform infrastructure, not a feature.** It lives under
   `src/kernel/state/` (alongside `src/kernel/audit.ts`, `src/kernel/config.ts`,
   `src/kernel/vaultIndex.ts`). The `/api/runs` routes are **platform** routes —
   CORS-gated via `src/app/api/_lib/cors.ts` like every route, but **not**
   `gateFeatureApi`-gated on a single feature (runs will soon come from many
   producers). The scheduler remains the only *producer* in M3.

8. **Path resolution.** `state.db` lives at
   `path.join(os.homedir(), ".agentic-os", "state.db")` — the same convention
   `vaultIndex.ts` uses for `index.db` and `config.ts` uses for `config.yaml`.
   Add an `AGENTIC_OS_STATE_DB` env override so Vitest can point at a tmp file
   (mirrors `AGENTIC_OS_AUDIT_DIR` / `AGENTIC_OS_CONFIG`).

9. **Tests use Vitest + tmpdir isolation.** `tests/*.test.ts`, `environment:
   "node"`, `fs.mkdtemp(os.tmpdir(), …)` + an env override per suite,
   cleaned in `afterEach`. `better-sqlite3` is native but already compiles and
   runs clean in the current 48-file suite — no new dep risk. Because
   `getStateDb()` is a process singleton (§5), any suite that changes
   `AGENTIC_OS_STATE_DB` MUST call `closeStateDbForTests()` in `afterEach` so
   the next suite reopens against its own tmp DB.

10. **Per-step git approvals remain a hard rule.** Commit only on Rex's explicit
    go-ahead; end-of-milestone doc sync (ADRs — §15) before M3 is called done.

---

## 4. File structure

```text
NEW — kernel state layer (platform infrastructure, mostly pure / DOM-free):
  src/kernel/state/paths.ts          resolve ~/.agentic-os/state.db
                                     (+ AGENTIC_OS_STATE_DB override for tests)
  src/kernel/state/db.ts             open better-sqlite3, WAL pragma, run the
                                     migration runner, hand back a Database
  src/kernel/state/migrations.ts     ordered migration list + runner:
                                     forward guard, backup-before-migrate,
                                     _meta stateDbVersion bookkeeping
  src/kernel/state/runTypes.ts       RunRecord / RunStatus / RunKind /
                                     RunStepRecord / ExternalRef (M3 subset)
  src/kernel/state/runLedger.ts      RunLedger service — create / get / list /
                                     update-progress / transition / cancel runs
                                     and steps; emits in-process change events
  src/kernel/state/restartRecovery.ts
                                     boot sweep: every non-terminal run ->
                                     onRestart policy

NEW — run-status API (platform routes; CORS-gated, not feature-gated):
  src/app/api/runs/route.ts             GET — list runs (filter: status, kind,
                                        featureId, limit)
  src/app/api/runs/[id]/route.ts        GET — one run + its steps + external refs
  src/app/api/runs/[id]/cancel/route.ts POST — cancel a run

MODIFIED — scheduler wiring (the only M3 run producer):
  src/features/scheduler/missions/runner.ts
                                     open a RunRecord when a mission starts,
                                     transition it on completion. runId stays
                                     the join key into the audit JSONL.
  src/instrumentation.ts             call the restart-recovery sweep once at
                                     boot, before startGlobalMissionScheduler().

NEW — tests (Vitest, repo `tests/` pattern):
  tests/state-migrations.test.ts     version bookkeeping, forward guard, backup
  tests/run-ledger.test.ts           lifecycle transitions, steps, external refs
  tests/restart-recovery.test.ts     onRestart policy applied at boot
  tests/api-runs.test.ts             list / detail / cancel routes + neutrality
  tests/scheduler-run-ledger.test.ts a mission fire produces a ledger row
```

**Do not** restructure `src/kernel/` or touch `vaultIndex.ts`, `audit.ts`, the
constrained vault writer, `safeSpawn`, or scheduler cron behaviour. M3 *adds* a
store and *wires one call site*.

---

## 5. State DB & migration runner (§3.2)

`src/kernel/state/db.ts` exposes a single accessor — `getStateDb(): Database` —
that opens the DB once per process (module-level singleton, like the global
scheduler), sets `journal_mode = WAL` and `foreign_keys = ON`, then runs the
migration runner before returning.

For tests, `db.ts` also exports **`closeStateDbForTests()`** (alias
`resetStateDbForTests()`): it closes the open handle and clears the singleton
so the next `getStateDb()` re-resolves `AGENTIC_OS_STATE_DB`. The singleton is
additionally **keyed by resolved DB path**, so a path change without an
explicit close is still detected and reopened — belt and braces (review edit 3).

`src/kernel/state/migrations.ts`:

```text
_meta table        key TEXT PRIMARY KEY, value TEXT     (holds "stateDbVersion")
MIGRATIONS array   ordered: [{ version: 1, name, up(db) }, ...]
                   M3 ships exactly version 1 — the run-ledger tables (§6).
                   Later milestones append version 2, 3, ... — never edit a
                   shipped migration.

runMigrations(db):
  1. read current version from _meta (absent => 0).
  2. FORWARD GUARD: if current > max(MIGRATIONS.version) -> throw a clear
     error and refuse to use the DB (code is older than the DB).
  3. if current === max -> return (nothing to do).
  4. BACKUP (WAL-safe): write state.db.bak-v<current> via better-sqlite3
     `db.backup()` before applying anything (skip when current === 0 /
     fresh DB). NEVER plain-copy state.db under WAL — uncheckpointed WAL
     data would be lost. Fallback only if db.backup() is unavailable: run
     `wal_checkpoint(TRUNCATE)`, then copy while no migration txn is open.
  5. apply each pending migration in a transaction; bump _meta version
     inside the same transaction. Stop and rethrow on any failure.
```

Rules:
- Each migration is forward-only and idempotent in spirit (`CREATE TABLE IF NOT
  EXISTS`). No down-migrations in M3.
- A fresh DB (no file) is created by `better-sqlite3` on open; version starts at
  0 and migration 1 brings it to 1.
- The backup uses `db.backup()` (WAL-safe), never a plain `fs.copyFile`.

ADR-0014 (§15) records this contract.

---

## 6. Run-ledger schema — migration v1 (§3.2, v8 §5.6 / §7.2)

Migration version 1 creates exactly three tables (plus `_meta`, created by the
runner itself). Other v8 §7.2 tables (`artifacts`, `approvals`,
`connector_health`, …) are **not** created in M3 — each later milestone adds its
own migration.

```text
runs
  id              TEXT PRIMARY KEY        -- RunId (the existing randomUUID)
  kind            TEXT NOT NULL           -- RunKind; M3 producers use the
                                          --   mission-run kind
  feature_id      TEXT NOT NULL           -- "scheduler" for all M3 runs
  parent_run_id   TEXT                    -- FK runs.id; null in M3 (no fan-out
                                          --   yet) but column + cascade exist
  correlation_id  TEXT
  trigger         TEXT NOT NULL           -- manual | scheduled | replay | ...
  status          TEXT NOT NULL           -- RunStatus (§7)
  current_step    TEXT
  total_steps     INTEGER
  completed_steps INTEGER
  capability_id   TEXT
  connector_id    TEXT
  created_at      TEXT NOT NULL           -- ISO-8601
  started_at      TEXT
  ended_at        TEXT
  updated_at      TEXT NOT NULL
  duration_ms     INTEGER
  input_hash      TEXT
  input_summary   TEXT                    -- neutral one-liner; never raw input
  error_code      TEXT
  cancelled_by    TEXT                    -- user | parent-run | timeout
                                          --   | stale-claim | system
  on_restart      TEXT NOT NULL           -- resume | mark-interrupted | cancel
  -- budget schema slots (v8: persisted in M3, enforced later):
  max_iterations  INTEGER
  max_duration_ms INTEGER
  max_tool_calls  INTEGER
  max_cost_usd    REAL
  indexes: (status), (feature_id), (created_at), (parent_run_id)

run_steps
  id              TEXT PRIMARY KEY
  run_id          TEXT NOT NULL           -- FK runs.id ON DELETE CASCADE
  idx             INTEGER NOT NULL        -- step order within the run
  kind            TEXT NOT NULL           -- RunStepRecord.kind (v8 §5.6)
  status          TEXT NOT NULL           -- RunStatus
  started_at      TEXT
  ended_at        TEXT
  capability_id   TEXT
  connector_id    TEXT
  agent_id        TEXT
  error_code      TEXT
  index: (run_id, idx)

external_refs
  id              INTEGER PRIMARY KEY AUTOINCREMENT
  run_id          TEXT NOT NULL           -- FK runs.id ON DELETE CASCADE
  system          TEXT NOT NULL           -- e.g. "hermes"
  ref_kind        TEXT NOT NULL           -- e.g. "task" | "run"
  ref_id          TEXT NOT NULL           -- the external identifier
  created_at      TEXT NOT NULL
  index: (run_id), (system, ref_id)
```

Notes:
- Claim/heartbeat fields, `round`, and `joinPolicy` are **omitted** from the M3
  schema — M4a / the orchestration milestone add them via their own migrations.
  This keeps M3's table honest about what M3 actually exercises.
- `external_refs` is a child table (chosen over a JSON column on `runs`) so
  "find the run for Hermes task X" is a plain indexed lookup — satisfying the
  exit criterion directly.
- `run_steps` is created and CRUD-covered in M3 but M3's scheduler producer
  writes at most a coarse step set (or none) — missions are single-shot. The
  table exists so M4a/orchestration have it ready; tests exercise it with
  synthetic steps.

---

## 7. Run types (`src/kernel/state/runTypes.ts`) (v8 §5.6)

Define the M3 types — the subset of v8's `RunRecord` that M3's schema persists.

```ts
export type RunId = string;

export type RunStatus =
  | "queued"
  | "running"
  | "waiting-approval"        // valid in the type; not produced until M5
  | "waiting-clarification"   // "
  | "blocked"                 // "        produced by the M4a claim sweep
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted-by-restart";

export type RunKind =
  | "scheduled-mission"
  | "manual-mission"
  | "capability-invoke"
  | "connector-test"
  | "external-work-bridge"
  | "orchestration-phase"
  | "artifact-generate"
  | "approval-action"
  | "user-action";

export interface RunRecord { /* mirrors the §6 `runs` columns, camelCase */ }
export interface RunStepRecord { /* mirrors the §6 `run_steps` columns */ }

export interface ExternalRef {
  system: string;   // connector / system id, e.g. "hermes"
  kind: string;     // task | thread | run | ...
  id: string;       // opaque external id
  scope?: string;
}
// DB columns stay snake_case (external_refs.ref_kind / .ref_id, §6); the
// row<->record mapper maps ref_kind<->kind and ref_id<->id.
```

Rules:
- `RunStatus` carries the full v8 enum so later milestones need no type change;
  M3 *produces* only `queued`, `running`, `succeeded`, `failed`, `cancelled`,
  `interrupted-by-restart`. The transition validator (§8) rejects transitions
  into states M3 cannot reach.
- `RunKind` is **locked** to the v8 union above — not discretionary, because
  `kind` is a long-lived query / filter / index field. M3's scheduler producer
  uses `"scheduled-mission"` for cron fires and `"manual-mission"` for manual
  triggers. Do NOT introduce a `"mission.run"` kind (review edit 1).
- Row ↔ record mapping (snake_case column ↔ camelCase field) lives in
  `runLedger.ts`; keep it in one mapper function, not scattered.

---

## 8. RunLedger service (`src/kernel/state/runLedger.ts`)

The single API surface over the `runs` / `run_steps` / `external_refs` tables.
Pure data logic — no HTTP, no React. Built on prepared statements and
`db.transaction()` (vaultIndex pattern).

```ts
createRun(input): RunRecord
  // status defaults to "running" (or "queued" if the caller passes it);
  // sets id, createdAt, updatedAt; persists onRestart (required).
  // If created as "running", startedAt = createdAt. If created as "queued",
  // startedAt stays null until the queued -> running transition (review edit 5).
getRun(id): RunRecord | null
listRuns(filter?): RunRecord[]
  // filter: { status?, kind?, featureId?, limit? }; newest-first by createdAt.
updateProgress(id, { currentStep?, completedSteps?, totalSteps? }): RunRecord
transitionRun(id, nextStatus, patch?): RunRecord
  // validates the transition (§9); sets updatedAt; sets startedAt on first
  // -> running; sets endedAt + durationMs on any -> terminal status.
cancelRun(id, by): RunRecord
  // transition to "cancelled" with cancelledBy; CANCEL CASCADE: also cancels
  // every non-terminal descendant via parent_run_id (recursive, one txn).
appendStep(runId, step): RunStepRecord
transitionStep(stepId, nextStatus, patch?): RunStepRecord
addExternalRef(runId, ref): void
listExternalRefs(runId): ExternalRef[]
findRunsByExternalRef(system, id, opts?): RunRecord[]
  // opts: { kind?, scope? }; indexed lookup over external_refs (system, ref_id)
  // -> the owning run rows. Satisfies "find the run for Hermes task X".
```

**Basic run events (§1 "basic run events"):** the ledger extends a Node
`EventEmitter` (or exposes `onRunChanged(listener)`) and emits a
`{ runId, status }` event after every successful create / transition / cancel.
This is **in-process only** — no table, no socket. It exists so a future live
Runs UI and the scheduler can react without polling. M3 ships the emitter and
one consumer-free test that it fires; no UI wiring.

Rules:
- All multi-row writes (cancel cascade, transition + step writes) run inside one
  `db.transaction()`.
- `updatedAt` is bumped on every mutation.
- `durationMs` on any -> terminal transition is `endedAt - startedAt` when
  `startedAt` is set, else `endedAt - createdAt` (review edit 5).
- Terminal statuses: `succeeded`, `failed`, `cancelled`, `interrupted-by-restart`.
  A mutation on an already-terminal run throws a typed error (callers must not
  resurrect a finished run).
- The service is constructed against `getStateDb()` but accepts an injected
  `Database` so tests can pass a tmp-file DB.

---

## 9. Transition & restart rules (locked)

**Status transitions** M3 validates and allows:

```text
queued     -> running | cancelled
running    -> succeeded | failed | cancelled | interrupted-by-restart
(any non-terminal) -> interrupted-by-restart   (restart sweep only)
terminal   -> (nothing)   -- throws
```

`waiting-approval -> resumed`, `blocked -> *`, and other v8 §5.6 transitions are
**not** reachable in M3 (no approvals, no claim sweep) — the validator rejects
them with a clear error rather than silently allowing them. They are enabled by
the milestone that introduces their producer.

**Restart recovery** (`restartRecovery.ts`, run from `instrumentation.ts` at
boot, before the scheduler starts):

```text
sweepInterruptedRuns():
  for each run in listRuns({ status in non-terminal set }):
    switch run.onRestart:
      "mark-interrupted" -> transitionRun(id, "interrupted-by-restart")
      "cancel"           -> cancelRun(id, "system")
      "resume"           -> transitionRun(id, "interrupted-by-restart")
                            + log "resume deferred (M3): treated as interrupted"
  return a small summary { interrupted, cancelled } for the boot log.
```

All M3 producer runs (scheduler missions) are created with
`onRestart: "mark-interrupted"` (v8 restart policy: scheduled & manual missions
→ mark-interrupted). The `cancel` / `resume` branches exist for forward compat
and are covered by tests with synthetic rows.

---

## 10. Scheduler wiring (`src/features/scheduler/missions/runner.ts`)

`runMission()` already mints `runId = randomUUID()` and threads it through
`MissionContext` and `auditMissionRun()`. M3 adds ledger calls around the
existing flow — **additive only**, audit untouched:

```text
on mission start (after runId is minted, before the mission body):
  runLedger.createRun({
    id: runId,
    kind: trigger === "scheduled" ? "scheduled-mission" : "manual-mission",
    featureId: "scheduler", trigger, status: "running",
    onRestart: "mark-interrupted",
    inputSummary: <missionId + neutral trigger label>, ...
  })

on mission completion (alongside the existing auditMissionRun call):
  success  -> runLedger.transitionRun(runId, "succeeded")
  skipped  -> runLedger.transitionRun(runId, "succeeded",
                { currentStep: "skipped" })   // skip is NOT a failure — never
              // set errorCode for a skip; record it via currentStep (or a
              // neutral inputSummary "mission skipped: <reason-code>")
  failed   -> runLedger.transitionRun(runId, "failed", { errorCode: errorClass })
```

Rules:
- The ledger write must **never** break a mission run. Wrap ledger calls so a
  ledger failure is logged (and audited as a diagnostic if appropriate) but the
  mission result is still returned. The audit JSONL line remains the
  source-of-truth record; the ledger is the queryable mirror.
- Do not change `RunnerResult`, the audit envelope, or mission semantics.
- `skipped` maps to `succeeded` with `currentStep: "skipped"` (or a neutral
  `inputSummary` note) — **never** `errorCode`, which is reserved for real
  failures (review edit 8).
- **`inputSummary` is audit-grade, operator-visible text.** Never store raw
  prompts, raw mission options, filesystem paths, secrets, provider stderr,
  raw config payloads, or private note content. Use the mission id, trigger,
  feature id, counts, hashes, and short neutral labels only. This rule binds
  every future producer that writes the field, not just the scheduler
  (review edit 7).

---

## 11. Run-status API (`src/app/api/runs/...`)

Platform routes. Each route applies the CORS gate (`originOk` / `forbidden`
from `src/app/api/_lib/cors.ts`) and returns **neutral** JSON errors in the
established mission-runner style — `{ ok:false, error, errorClass }`, never a
raw path, stack, or SQL.

```text
GET  /api/runs
  query: status?, kind?, featureId?, limit? (default 50, hard cap 200)
  -> { ok:true, runs: RunSummary[] }   newest-first
  RunSummary is a projection — id, kind, featureId, trigger, status, timestamps,
  progress, errorCode. NO input_hash beyond a short value, NO internal paths.

GET  /api/runs/:id
  -> 200 { ok:true, run, steps, externalRefs }   |   404 neutral if unknown

POST /api/runs/:id/cancel
  -> 200 { ok:true, run }                cancels a non-terminal run
  -> 404 neutral if unknown
  -> 409 neutral if already terminal
```

Rules:
- The API is read + cancel only. No create endpoint — runs are created by
  producers (the scheduler), not by the browser.
- Responses carry only ledger data already safe for display. `inputSummary` is
  neutral by construction (§10); the `RunSummary` projection additionally
  redacts/omits any `inputSummary` that still looks path- or secret-like —
  defence in depth against a misbehaving future producer. Never serialize raw
  config or filesystem paths.
- These routes are not `gateFeatureApi`-gated (§3.7) — the run ledger is
  platform infrastructure. CORS gating still applies.

---

## 12. Tests (`tests/` — Vitest, repo pattern)

Each suite uses a tmp-file DB via `AGENTIC_OS_STATE_DB` (set in `beforeEach`,
tmp dir removed in `afterEach`) — never the real `~/.agentic-os/state.db`.
Every such suite calls `closeStateDbForTests()` in `afterEach` so the singleton
re-resolves against the next suite's path.

`tests/state-migrations.test.ts`:

```text
- a fresh DB migrates 0 -> latest; _meta stateDbVersion === latest
- running the runner twice is a no-op the second time
- forward guard: a DB stamped at version > code max throws, DB not mutated
- a WAL-safe backup (state.db.bak-v<n> via db.backup()) is written before a
  real migration applies
- the v1 migration creates runs / run_steps / external_refs with expected cols
```

`tests/run-ledger.test.ts`:

```text
- createRun -> getRun round-trips every field; status defaults sane
- transition queued -> running sets startedAt
- transition running -> succeeded sets endedAt + durationMs
- transition running -> failed records errorCode
- transition running -> cancelled via cancelRun sets cancelledBy
- illegal transition (terminal -> running) throws
- illegal transition (queued -> succeeded) throws
- cancel cascade: cancelling a parent cancels non-terminal child runs,
  leaves already-terminal children untouched
- appendStep / transitionStep persist and round-trip
- addExternalRef + listExternalRefs persist a Hermes task ref;
  findRunsByExternalRef(system, id) returns the owning run (incl. kind/scope opts)
- listRuns filters by status / featureId and is newest-first
- onRunChanged fires once per successful transition
```

`tests/restart-recovery.test.ts`:

```text
- a "running" run with onRestart "mark-interrupted" becomes
  "interrupted-by-restart" after the sweep
- a "running" run with onRestart "cancel" becomes "cancelled" with
  cancelledBy "system"
- an onRestart "resume" run is marked interrupted (M3 stub) — documented
- already-terminal runs are left untouched
- the sweep returns an accurate { interrupted, cancelled } summary
```

`tests/api-runs.test.ts`:

```text
- GET /api/runs lists seeded runs newest-first; respects status filter + limit cap
- GET /api/runs/:id returns run + steps + externalRefs; 404 neutral for unknown
- POST /api/runs/:id/cancel cancels a running run; 409 neutral when terminal
- error responses leak no path / stack / SQL (neutrality regression guard)
- a seeded run whose inputSummary contains "/home/operator/.secrets/token" is
  omitted/redacted in GET /api/runs and GET /api/runs/:id (review edit 7)
- a disallowed CORS origin is rejected by the gate
```

`tests/scheduler-run-ledger.test.ts`:

```text
- running a mission via the runner creates exactly one runs row, keyed by the
  same runId the audit line carries (audit + ledger join correctly)
- a mission that throws -> ledger row ends "failed" with the errorClass
- a ledger write failure does not change the RunnerResult (mission still
  returns its real result)
```

All existing tests (current 48 files / 434+) must still pass. No new test
dependency — `better-sqlite3` is already present and compiles in CI.

---

## 13. Acceptance script (Rex runs this before approving M4a)

```text
Step 1 — Fresh DB + migration.
  Ensure ~/.agentic-os/state.db does not exist (or back it up aside).
  Start the app. Confirm state.db is created. Inspect it (sqlite3 CLI or any
  viewer): _meta has stateDbVersion = latest; runs / run_steps / external_refs
  tables exist and are empty.

Step 2 — A mission fire becomes a run.
  With features.scheduler.enabled = true, trigger a manual mission (e.g.
  vitals-heartbeat via POST /api/missions/vitals-heartbeat/run, or wait for a
  scheduled fire). Then GET /api/runs -> the run appears with status
  "succeeded" (or "failed"), the correct trigger, and timestamps.
  Confirm the runId in /api/runs matches the runId in today's audit JSONL line
  for that mission — the two records join.

Step 3 — Run detail + cancel API.
  GET /api/runs/:id -> run + steps + externalRefs. For a still-running or
  synthetic run, POST /api/runs/:id/cancel -> status becomes "cancelled";
  cancelling an already-finished run -> 409 neutral error.

Step 4 — External ref.
  Confirm (via a test or a seeded run) that a run can carry a Hermes-style
  external ref and be found by it — exit-criteria check.

Step 5 — Restart recovery.
  Seed / leave a run in a non-terminal status (a test helper, or stop the
  server mid-mission). Restart the server. Confirm via GET /api/runs that the
  previously-active run is now "interrupted-by-restart" (mark-interrupted
  policy). The boot log reports the sweep summary.

Step 6 — Forward guard.
  Bump _meta stateDbVersion above the code's max (sqlite3 CLI), restart.
  Confirm the app refuses the DB with a clear error and does not mutate it.
  Restore the version afterwards.

Step 7 — npm run typecheck && npm test  -> all green.
Step 8 — npm run build  -> succeeds (then `git checkout -- next-env.d.ts`
         if Turbopack/NFT drift reappears, as in M1/M2).
```

---

## 14. PR breakdown (suggested)

```text
PR 1 — State DB + migration runner
  paths.ts, db.ts, migrations.ts (v1 = run-ledger tables), runTypes.ts.
  tests/state-migrations.test.ts. No producer wiring yet.
  DoD: typecheck + tests green; state.db created with v1 schema.

PR 2 — RunLedger service + restart recovery
  runLedger.ts, restartRecovery.ts, instrumentation.ts boot hook.
  tests/run-ledger.test.ts, tests/restart-recovery.test.ts.
  DoD: lifecycle + cascade + restart sweep covered; sweep runs at boot.

PR 3 — Run-status API + scheduler wiring
  src/app/api/runs/* , runner.ts ledger calls.
  tests/api-runs.test.ts, tests/scheduler-run-ledger.test.ts.
  DoD: full acceptance script passes.
```

One combined PR is acceptable if Claude Code prefers — the breakdown is a
suggestion. Per-step git approval applies regardless.

---

## 15. Done definition

M3 is **DONE** when:

```text
✓ ~/.agentic-os/state.db is created with a stateDbVersion, a forward guard,
  and backup-before-migrate.
✓ runs / run_steps / external_refs tables exist via migration v1.
✓ RunLedger supports create / progress / transition / cancel (with cascade) /
  steps / external refs, with transition validation.
✓ Restart recovery applies each run's onRestart policy at server boot.
✓ Every scheduler mission fire is persisted as a RunRecord, joined to the
  audit JSONL by runId; audit remains JSONL and unchanged.
✓ /api/runs (list), /api/runs/:id (detail), /api/runs/:id/cancel work and
  return neutral errors.
✓ A run can carry and be found by an external system reference.
✓ npm run typecheck, npm test, npm run build all pass; no regression.
✓ End-of-milestone doc sync: ADR-0014 (persistence four-store split +
  stateDbVersion) and ADR-0016 (run ledger foundation) written; ARCHITECTURE
  updated for the new SQLite state store.
✓ Rex signs off via "M3 verified, proceed to M4a".
```

---

## 16. Open questions — RESOLVED

The consolidated review (`ChatGPT_Review.txt`) **accepted all seven defaults
below; they are locked.** Q2's default is refined: `skipped -> succeeded` with
`currentStep: "skipped"` (or a neutral `inputSummary` note) — never `errorCode`
(see §10, review edit 8). The original questions are kept for traceability.

1. **`run_steps` depth in M3.** Scheduler missions are single-shot, so M3's
   producer writes few or no steps. Default: create + fully CRUD-test the table
   but have the scheduler write **no steps** in M3 (steps become real with M4a
   capability invocations). Alternative: write one coarse "mission.run" step per
   run. Default: no steps from the scheduler in M3.

2. **`skipped` mission → ledger status.** A mission that reports `skipped` has no
   `skipped` RunStatus. Default: map `skipped` → `succeeded` with
   `inputSummary`/`errorCode` noting the skip. Alternative: add a `"skipped"`
   RunStatus. Default: map to `succeeded` + note (keeps the enum aligned to v8).

3. **Long-running-run acceptance (Step 5).** M3's real producer (the scheduler)
   runs fast missions, so "a dummy long-running run" is hard to catch mid-flight
   by hand. Default: cover the long-running lifecycle (progress updates,
   mid-flight restart) in `run-ledger` / `restart-recovery` tests, and let the
   manual acceptance use a test helper / seeded row. Alternative: ship a
   dev-only "debug long-run" mission behind a flag. Default: tests + seeded row;
   no debug mission.

4. **`external_refs` as a table vs a JSON column.** Default: a child table
   (§6) — indexed lookup by `(system, refId)` directly satisfies "find the run
   for Hermes task X". Alternative: a JSON `external_refs` column on `runs`.
   Default: child table.

5. **Budget columns in the v1 schema.** v8 says M3 persists budget slots
   (`maxIterations` etc.) without enforcing them. Default: include the four
   nullable columns now (§6) so M4a needs no migration for them. Alternative:
   defer the columns to M4a's migration. Default: include them now.

6. **Claim / heartbeat columns.** Default: **omit** from M3's schema — they
   belong to M4a's connector runtime and arrive in M4a's migration, keeping
   M3's table scoped to what M3 exercises. Alternative: add them now as unused
   nullable columns. Default: omit.

7. **Run-status API gating.** Default: platform routes, CORS-gated only, not
   `gateFeatureApi`-gated (§3.7) — runs will soon have many producers.
   Alternative: gate `/api/runs` on `scheduler` while it is the sole producer.
   Default: platform, CORS-only.

If Rex skips these, the defaults apply.

---

**End of M3 task spec (v2).** M3 shipped: PR #14 (state DB + migration runner),
PR #15 (RunLedger + restart recovery), PR #16 (`/api/runs` + scheduler wiring),
PR #17 (closeout — ADR-0014, ADR-0016, ARCHITECTURE §7). The `m4-task-spec.md`
v2.1 (M4a) was generated next; M4a code shipped as PRs #18–#23 + closeout
PR #26. See AutoMem `agentic-os-current-state.md`.
