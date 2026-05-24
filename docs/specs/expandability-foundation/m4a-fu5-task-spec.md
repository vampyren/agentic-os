# M4a-FU5 Task Spec — Persisted Connector Validation Status (v1.1 draft)

**Date:** 2026-05-24
**Version:** v1.1 — nine spec-fix amendments folded in (concurrency / freshness ordering via `test_started_at` reusing the existing `runs.created_at`; DELETE-contradiction grep-and-fix across the whole spec; ADR-0020 generalisation hedge; store wiring pinned to share the existing `state.db` connection; no-backfill rationale extended with the audit-JSONL note; fingerprint input shape pinned to the post-merge / post-validation effective config; fingerprint algorithm versioning note; preset-default change effect documented; authRef hashing wording tightened to not overclaim against local-DB access). v1 pinned O1–O7. v0 was the first design pass. **Committed to the repo as a design-accepted draft** per `docs/MAINTENANCE.md` only after Rex confirms v1.1.
**Milestone:** M4a-FU5 — Persisted connector validation status; the next implementation candidate per Rex/Jarvis preference order (#36 → #37 → M4a-6a).
**Status:** **DRAFT v1.1 — DESIGN ONLY**. Sub-option, open questions, and the nine v1.1 amendments locked per Rex (2026-05-24). No branch, no implementation until Rex green-lights FU5 PR A.
**Parent design:** `m4-task-spec.md` v2.1 (M4a connector runtime); `m4a-5-task-spec.md` v1.2 (model discovery); ADR-0014 (persistence four-store split); ADR-0016 (run ledger foundation).
**Predecessor milestone:** M4a-5 — VERIFIED 2026-05-24 (PRs #29 / #30 / #31 / #33 / #34 all merged; live operator acceptance passed against `main` at `05ad6b9`).
**Successor work:** **M4a-FU6 / issue #37** (UI design system / pattern library) — runs in parallel or after; **M4a-6a** (provider catalog UI) — gated on Rex's explicit green-light AFTER FU5 and FU6.
**Goal:** After a hard browser refresh, a connector row whose connector was previously tested shows its last-known validation status — UNLESS the connector's validation-relevant config has changed since that test, in which case the row falls back to "not tested" so a stale `valid` can't appear as current. Today the row falls back to `not tested` unconditionally because validation state lives in transient React state in `ConnectorsPanel.tsx`. This spec lands the **persistence + fingerprint-aware hydration** path that makes "last-known status" the default surface when valid, and codifies the contract so future statuses/configs (MCP server health, agent health, scheduler-mission outcomes, etc.) can reuse the same pattern.

> **v0 → v1 (locked decisions, 2026-05-24):**
>
> **Open questions all pinned per Rex:**
> - **O1 — A2 (separate `connector_health` table).** §3.3
>   recommendation accepted. A1 and Path B explicitly rejected.
> - **O2 — two-PR split** (kernel + route/UI). §11 stays as-is.
> - **O3 — no backfill** from the runs table. §8 unchanged.
> - **O4 — no orphan prune.** Harmless per §8; row never
>   surfaces because `GET /api/connectors` iterates from
>   config.
> - **O5 — fold acceptance** into `docs/M4A5-ACCEPTANCE.md`
>   Step 8 (remove the "known limitation #36" caveat; add the
>   hydration verification). §12 stays as-is.
> - **O6 — yes, ADR-0020** (connector_health table decision +
>   future-statuses generalisation). §10 stays as-is.
> - **O7 — table name `connector_health`** (matches v8 §7.2 +
>   M3 migration runner comment).
>
> **Amendments folded in:**
>
> 1. **Stale-config detection via `config_hash` fingerprint.**
>    The `connector_health` row gains a `config_hash` column.
>    Server computes a SHA-256 of a canonical representation
>    of the connector's validation-relevant config (connectorId
>    + typeFamily + presetId + effective settings +
>    capabilities + allowLocalNetwork + a HASHED-only authRef
>    identity). On hydration, the route recomputes the current
>    fingerprint and compares; if it differs, `lastValidation`
>    is OMITTED from the projection and the row falls back to
>    "not tested" — never shows a stale `valid` as current.
>    The fingerprint is NOT surfaced to the browser. Settings
>    canonicalisation uses recursive key-sorted JSON so equal
>    configs always produce the same hash. authRef is hashed
>    (never plaintext) so the env var name doesn't cross any
>    persistence surface. See §4.1 (schema), §4.4 (fingerprint
>    helper), §5.1 (route gate), §7 (tests), §9 (non-leak).
> 2. **DELETE wording softened.** §8 no longer claims true
>    cross-store atomicity between config.yaml and SQLite. New
>    wording: "After config removal succeeds, best-effort call
>    `connectorHealth.delete(connectorId)`. Failure is
>    harmless because orphaned health rows are not enumerated
>    by `GET /api/connectors`. No stale row should crash or
>    surface to UI." Carried into the M4a-6b PR B reviewer
>    note in §6 / §8.
> 3. **Acceptance command fix.** §12 acceptance step no longer
>    references `~/.agentic-os/secrets/store.json` — FU5 is
>    still env-only auth; the plaintext secret store is M4a-6b
>    scope. Replaced with current-surface checks:
>    `/api/connectors`, audit JSONL, `state.db
>    connector_health` table (via `sqlite3 … "SELECT * FROM
>    connector_health;"`), and `~/.agentic-os/config.yaml`.
> 4. **Test surface strengthened.** §7 adds:
>    - `config_hash` mismatch ⇒ no `lastValidation` hydration
>      (and existing valid hydration AS-IS when the config is
>      unchanged).
>    - DB-row non-leak: marker-string sweep against
>      `connector_health` content on disk asserts no secret
>      value, env var NAME, Authorization header, baseUrl,
>      raw provider response, raw error / stack, or settings
>      blob crosses.
>    - API response does NOT expose `config_hash` (covered in
>      §5.1 contract + an explicit test).
>    - Existing valid hydrated status survives both hard
>      browser refresh AND server restart (durability
>      assertion).

> **v1 → v1.1 (nine spec-fix amendments, 2026-05-24):**
>
> 1. **DELETE-contradiction fix — grep-and-fix across the whole
>    spec.** v1's changelog claimed the cross-store atomicity
>    wording had been softened, but §8 *Migration / compatibility*
>    (Connector-deletion row) and one other body site still
>    echoed the "same atomic block" claim. v1.1 brings every
>    body site into agreement with the changelog: §6 reviewer
>    note, §8 row, and §10 / ADR-0020 text all use the
>    best-effort wording — never "atomic" or "atomically" — and
>    explicitly state that config.yaml (file) and state.db
>    (SQLite) are different stores. Asserted by a grep at
>    sign-off time (`rg '\batomic|atomically\b' …` should hit
>    only the changelog meta-references and the explicit
>    "NOT atomic" callouts).
>
> 2. **Concurrency / freshness ordering pinned via
>    `test_started_at` reusing the existing `runs.created_at`.**
>    Overlapping connector tests (a slow older test completing
>    after a newer faster test for the same connectorId) must
>    not clobber the current row. Per Rex's "check what exists
>    first" directive, the M3 `runs` table ALREADY carries
>    `created_at` AND `started_at` (`src/kernel/state/migrations.ts`
>    lines 56–57) and `RunRecord` exposes `createdAt`. v1.1
>    DENORMALISES `runs.created_at` into a new
>    `connector_health.test_started_at` column (avoids an extra
>    JOIN on every hydration; one column delta; matches the
>    v8 §7.2 denormalised-current-state pattern). The UPSERT
>    guard refuses to replace the row when
>    `incoming.test_started_at < existing.test_started_at` —
>    i.e. only newer-or-equal test starts win. A test asserts
>    the slow-older-vs-fast-newer race. See §4.1 (schema), §4.5
>    (UPSERT guard), §7 (concurrency test).
>
> 3. **ADR-0020 generalisation hedge.** The
>    `<thing>_health` table pattern fits low-frequency,
>    operator- or test-triggered status updates. High-frequency
>    telemetry, push-based heartbeats, and live process-state
>    observation may need different patterns; ADR-0020 does not
>    preclude them. Noted in §10.
>
> 4. **Store wiring pinned.** `ConnectorHealthStore` accepts a
>    `Database` instance in its constructor and **shares the
>    existing `state.db` connection** used by the state / run
>    ledger layer — does not open a second production SQLite
>    connection. The `__TEST__.newStore(db)` seam injects a
>    separate in-memory DB for unit tests. Updated §4.3.
>
> 5. **No-backfill rationale extended.** Backfill from audit
>    JSONL is technically possible if audit lines carry the
>    full validation result, but rejected because the audit log
>    is append-only and was not designed as a query source, and
>    one-click re-test remediation is trivial. Updated §13 O3.
>
> 6. **Fingerprint input shape pinned.** §4.4 clarifies the
>    fingerprint input is the *post-defaults-merge,
>    post-validation, validation-relevant effective connector
>    config* — the shape used by the connector test path —
>    NOT the raw `config.yaml` entry. The testConnection write
>    path and the GET hydration path MUST call
>    `fingerprintConnectorConfig` on the same effective shape;
>    the symmetry test enforces this.
>
> 7. **Fingerprint algorithm versioning note.** If a future
>    schema change alters the fingerprint algorithm or inputs,
>    the migration or implementation owns the cleanup. Existing
>    rows may harmlessly mismatch and fall back to "not tested"
>    until re-tested. No backwards-compatibility tax is
>    required for old fingerprints. Added to ADR-0020 / §4.4.
>
> 8. **Preset-default change effect documented.** If a shipped
>    preset's defaults change between Agentic OS versions, the
>    effective config fingerprint may change, causing
>    `lastValidation` hydration to be omitted until the
>    connector is re-tested. This is acceptable and safer than
>    showing stale validation. Added to §8 + §4.4.
>
> 9. **AuthRef hashing wording tightened.** v1 risked
>    overclaiming that hashing makes low-entropy env var names
>    impossible to infer if someone has local DB access. The
>    real guarantees are: env var names are not stored in
>    plaintext; `config_hash` is server-internal and not
>    exposed via API; the DB row does not contain raw env var
>    names or secret values. **This is NOT a substitute for
>    protecting local `state.db`.** Updated §4.4 + §9.

---

## 0. Preconditions

```text
[x] M4a-5 verified by Rex (2026-05-24) — acceptance §11 sign-off passed.
[x] PR #34 merged (`05ad6b9` on `main`) — establishes the StatusPill
    surface this spec hydrates into.
[x] Issue #36 filed and accepted as the next implementation
    candidate.
[ ] Rex explicitly green-lights M4a-FU5 PR A.
```

---

## 1. Scope

### 1.1 In scope

- **Persist connector-test validation state** alongside the existing
  `connector-test` run record. Persist the full
  `ConnectorValidation` shape (status + errorCode + message +
  testedAt + durationMs), not just the run's terminal
  succeeded/failed bit, so future surfaces don't lose granularity
  (`invalid` vs `unreachable` vs `misconfigured` vs `unknown`).
- **Hydrate** `GET /api/connectors` projection with the latest
  validation per connector. UI-safe (neutral fields only — no
  secret value, no env var name, no Authorization header, no raw
  provider response).
- **Hydrate the UI** at `ConnectorsPanel.tsx` mount time:
  `testResults` map gets pre-populated from the projection so the
  `StatusPill` on every existing row renders the last-known status
  before the operator clicks Test.
- **Remove the M4A5-ACCEPTANCE.md Step 8 "known limitation"
  caveat** about refresh fallback to `not tested`. Update the
  acceptance to verify the new behaviour.
- **One state-DB migration** appending the `connector_health`
  table per ADR-0014 / M3 migration discipline. `_meta`
  stateDbVersion bumps from 1 to 2. The forward-guard already in
  place refuses an older build against a newer DB.

### 1.2 Out of scope (explicitly)

- **Realtime push** of validation status from server to UI (no SSE,
  no WebSocket). The UI hydrates on mount + on explicit Test
  clicks. If a different operator (or a scheduled job) updates a
  connector's status server-side, the UI shows it on next refresh.
- **MCP server health**, **agent health**, **mission-outcome
  history** — all benefit from the same pattern, but each is its
  own future milestone. FU5 only ships `connector_health` and the
  UI hydration for it.
- **History view** of past tests. `connector_health` stores the
  LATEST validation per connectorId; the existing `connector-test`
  run records continue to hold the audit trail of every test.
- **Enable/disable toggle** (issue #35 / FU4).
- **Connector row management modal** (issue #35 / FU4).
- **M4a-6a, M4a-6b, M5.**
- **OAuth**, **native vendor families** — explicitly deferred.

---

## 2. User stories

```text
US-1  As Rex, after I refresh the Settings → Connectors page, my
      previously-tested connectors still show their last-known
      status (green "valid" pill / red "invalid" pill / etc.).
      They do NOT all reset to "not tested" every time I reload.

US-2  As Rex, after a server restart, the same hydration works —
      `connector_health` is durable, not in-memory.

US-3  As Rex, when I add a new connector and the auto-test runs
      (PR #34 behaviour), the row's StatusPill renders the result
      immediately AND that result survives a subsequent refresh.

US-4  As Rex, a connector I have NEVER tested still shows
      "not tested" — hydration only restores what was actually
      recorded.

US-5  As Rex, when I delete a connector (a future M4a-6b PATCH
      flow OR a manual config-yaml edit), the orphaned
      connector_health row is either cleaned up or harmlessly
      ignored — never a source of crashes or stale-id leaks.

US-6  As a developer adding a new statusful surface later (MCP
      server health, agent health, …), I can follow the same
      table + projection + hydration pattern without re-deriving
      it.
```

---

## 3. The design decision — Path A vs Path B

Issue #36's body presented two paths; this section makes the
recommendation explicit.

### 3.1 Path A — persist validation state in state.db (RECOMMENDED)

Extend the SQLite state DB to durably store the latest
`ConnectorValidation` per `connectorId`. Two sub-options:

- **A1 — extend the existing `runs` table** with a nullable
  `validation_json` column (set only on `connector-test` runs).
  Latest-per-connector query reads the runs table.
  - **Pros:** zero new tables; one column delta; preserves the
    "everything-is-a-run" mental model from M3.
  - **Cons:** "latest per connector" query is a `GROUP BY` /
    `MAX(created_at)` over the runs table — O(N) per page load
    where N is the run-history size; awkward to denormalise
    later if hot-path performance matters; mixes "audit trail
    of every test" with "current health" in one table.

- **A2 — separate `connector_health` table** with one row per
  `connectorId`, upserted on every connector-test completion.
  - **Pros:** **explicitly named in the v8 §7.2 design and
    pre-allocated in the M3 migration runner's header comment**
    (*"Other v8 §7.2 tables (artifacts, approvals,
    `connector_health`, …) arrive in later milestones'
    migrations."*) — this is filling a slot the design already
    anticipated, not inventing scope. Clean separation: runs
    table holds history; connector_health holds current state.
    `GET /api/connectors` does an O(1) lookup per connector
    (`SELECT … WHERE connector_id = ?`).
  - **Cons:** one extra write per test (denormalisation cost);
    one extra table to migrate.

### 3.2 Path B — lossy RunLedger query (NOT recommended)

`RunLedger.latestConnectorTest(connectorId)` reads the most recent
`connector-test` run and reconstructs a `ConnectorValidation`:

- `succeeded` → `{ status: "valid", errorCode: undefined }`
- `failed`    → `{ status: "unreachable" (or "unknown"),
                   errorCode: <preserved> }`

No schema change. No migration. But:

- **Status granularity is lost.** The existing run record stores
  only the terminal status + errorCode. The original
  `ConnectorValidation.status` discriminant — `invalid` vs
  `unreachable` vs `misconfigured` vs `unknown` — never lands in
  the DB, so it can't be reconstructed. The hydrated badge would
  show "unreachable" for what was actually a "misconfigured"
  outcome, etc.
- **Pattern doesn't generalise.** Future statuses (MCP, agent,
  etc.) that don't map cleanly onto the run lifecycle would each
  need their own bespoke encoding.

### 3.3 Recommendation — Path **A2**

Ship Path A2 (separate `connector_health` table). Rationale:

1. **Lossless** — preserves the full `ConnectorValidation`
   discriminant. The StatusPill stays accurate after refresh.
2. **Pattern reusable** — Rex flagged FU5 as "fundamental for
   other statuses/configs later"; A2's "one denormalised table per
   stateful surface" pattern generalises naturally to MCP health,
   agent health, etc.
3. **Pre-allocated** — already named in the M3 migration runner
   comment; filling the slot is consistent with the v8 §7.2 plan.
4. **O(1) hydration** — `GET /api/connectors` doesn't pay an
   O(N-runs) scan per page load.
5. **Clean separation** — audit trail (runs) and current health
   (connector_health) live in different tables. ADR-0009 already
   established this discipline for audit-vs-state.

Cost: one extra DB write per `runConnectorTest` invocation (an
UPSERT on `connector_health`). Negligible.

§4 onward assumes Path A2. If Rex prefers A1 (one column, no new
table), §4 / §5 / §11 collapse accordingly — the route + UI
contract is unchanged.

---

## 4. Data model (Path A2)

### 4.1 `connector_health` table schema

```sql
CREATE TABLE IF NOT EXISTS connector_health (
  connector_id    TEXT PRIMARY KEY,
  status          TEXT NOT NULL,
  error_code      TEXT,
  message         TEXT,
  tested_at       TEXT NOT NULL,       -- ISO 8601 UTC; completion time
  duration_ms     INTEGER NOT NULL,
  -- Freshness ordering for the UPSERT race (see §4.5). Denormalised
  -- copy of `runs.created_at` for the producing connector-test run.
  -- `runs.created_at` is set at run-creation time (BEFORE the family's
  -- testConnection executes), so it represents test-START order, not
  -- test-COMPLETION order — exactly what the UPSERT guard needs to
  -- prevent a slow older test from clobbering a newer faster one.
  test_started_at TEXT NOT NULL,       -- ISO 8601 UTC
  -- Fingerprint of the validation-relevant config at test time.
  -- SHA-256 hex of a canonical JSON serialisation (see §4.4). NEVER
  -- exposed to the browser. Used by the route to decide whether
  -- `lastValidation` still applies to the CURRENT config.
  config_hash     TEXT NOT NULL,
  -- Provenance: the run that produced this state. NULL only when a
  -- legacy / out-of-band test bypassed the run ledger.
  run_id          TEXT REFERENCES runs(id) ON DELETE SET NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS connector_health_updated_at
  ON connector_health(updated_at);
```

- `connector_id` is `PRIMARY KEY` → one row per connector instance.
- `status` is a `ConnectorValidation.status` value
  (`valid` | `invalid` | `unreachable` | `misconfigured` | `unknown`).
  Stored as the literal string; the route validates against the
  closed union before projecting.
- `error_code` is a `ConnectorErrorCode` value or NULL.
- `message` is the kernel-generated neutral message (`testConnection.ts`
  already generates this from status + errorCode; no raw provider
  text crosses).
- `test_started_at` is the **denormalised copy of `runs.created_at`**
  for the producing connector-test run. Used by the UPSERT guard
  in §4.5 to ensure a slow older test cannot clobber a newer
  faster test for the same connectorId. **Design choice (per
  Rex's "check what exists first" directive):** the M3 `runs`
  table already carries `created_at` (set at run-creation time,
  i.e. test-START order — `src/kernel/state/migrations.ts:56`)
  AND `started_at` (set at the `queued → running` transition).
  `created_at` is the right freshness source for the race we
  care about, because it's set BEFORE the family's
  `testConnection` executes — completion-time ordering can lie
  (a slow older test can complete after a newer faster test).
  Denormalising into `connector_health` (rather than JOINing on
  every hydration query) keeps the hot-path read O(1) and
  matches the v8 §7.2 denormalised-current-state pattern.
- `config_hash` is the fingerprint of the connector's
  validation-relevant config at the time the test ran (see §4.4).
  Compared against the current-config fingerprint at hydration
  time (§5.1) to detect edits between test and refresh — when they
  differ, `lastValidation` is omitted from the projection so a
  stale `valid` can't appear as current. Never exposed in API
  responses (§9 non-leak; §5.1 contract).
- `run_id` is the connector-test run that produced this row. Set to
  NULL on cascade delete to keep the row valid even if the run is
  ever pruned (and so the operator's "last-known" status doesn't
  disappear just because run-retention policy kicked in).
- `updated_at` makes "most recently tested across all connectors"
  cheap.

### 4.2 Migration runner step — `MIGRATION_2_CONNECTOR_HEALTH`

Add migration version 2 to `src/kernel/state/migrations.ts`. Per
M3 / ADR-0014 discipline:

- One migration version per milestone.
- Idempotent `CREATE TABLE IF NOT EXISTS`.
- Forward-guard already in place refuses an older build from
  reading a v≥2 DB.
- A WAL-safe `db.backup()` snapshot is taken before applying.
- Shipped migrations are immutable — never edit MIGRATION_1.

```ts
const MIGRATION_2_CONNECTOR_HEALTH = `
CREATE TABLE IF NOT EXISTS connector_health (
  connector_id    TEXT PRIMARY KEY,
  status          TEXT NOT NULL,
  error_code      TEXT,
  message         TEXT,
  tested_at       TEXT NOT NULL,
  duration_ms     INTEGER NOT NULL,
  test_started_at TEXT NOT NULL,
  config_hash     TEXT NOT NULL,
  run_id          TEXT REFERENCES runs(id) ON DELETE SET NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS connector_health_updated_at
  ON connector_health(updated_at);
`;

export const MIGRATIONS: Migration[] = [
  { version: 1, name: "run-ledger",        up: (db) => { db.exec(MIGRATION_1_RUN_LEDGER); } },
  { version: 2, name: "connector-health",  up: (db) => { db.exec(MIGRATION_2_CONNECTOR_HEALTH); } },
];
```

### 4.3 `ConnectorHealthStore` — the kernel service

New module: `src/kernel/connectors/connectorHealth.ts`.

```ts
import type DatabaseType from "better-sqlite3";

export interface ConnectorHealthRow {
  connectorId: string;
  validation: ConnectorValidation;
  /** Denormalised copy of runs.created_at — used as the freshness
   *  source for the UPSERT guard (see §4.5). Set BEFORE the
   *  family's testConnection executes, so a slow older test
   *  cannot clobber a newer faster test. */
  testStartedAt: string;
  /** SHA-256 hex of canonical validation-relevant config at the
   *  time this row was written. See §4.4 for the canonicalisation. */
  configHash: string;
  runId: string | null;
  updatedAt: string;
}

export class ConnectorHealthStore {
  /** Accepts the existing state.db connection — does NOT open a
   *  second SQLite connection. The state DB is opened once per
   *  process by `src/kernel/state/db.ts::getStateDb()` (M3); FU5
   *  shares that handle so writes go through the same WAL +
   *  prepared-statement cache. */
  constructor(db: DatabaseType.Database);

  /** UPSERT with freshness guard (see §4.5). Used by
   *  runConnectorTest's `finish` callback. The `configHash` is
   *  computed by the caller (testConnection.ts) from the EFFECTIVE
   *  instance config in scope when the test was launched (§4.4).
   *  The `testStartedAt` is the producing run's `created_at`. */
  recordTest(input: {
    connectorId: string;
    validation: ConnectorValidation;
    testStartedAt: string;
    configHash: string;
    runId: string | null;
  }): void;

  /** Single-connector lookup. Returns undefined if never tested. */
  get(connectorId: string): ConnectorHealthRow | undefined;

  /** Bulk fetch for `GET /api/connectors`. Returns a Map by connectorId. */
  getMany(connectorIds: ReadonlyArray<string>): Map<string, ConnectorHealthRow>;

  /** Drop the row for a connector that was deleted. Idempotent. */
  delete(connectorId: string): void;
}
```

**Test seam.** `__TEST__.newStore(db)` constructs an isolated
store against an injected in-memory `Database` instance — same
pattern as the existing `__TEST__.newRegistry()` for the
connector registry. Unit tests never touch the real `state.db`.

**Singleton in production.** A globalThis singleton wraps
`new ConnectorHealthStore(getStateDb())` so Next.js hot-reload
doesn't spawn a second store — same pattern as the connector
registry and the run ledger. The singleton resolves the
underlying `Database` lazily on first read (matching
`getRunLedger()`'s init-promise approach so the M3 migration
runner has time to apply v2 before the store touches the table).

### 4.5 UPSERT guard — freshness ordering by `test_started_at`

The race the guard prevents:

```text
  t=0  Operator clicks Test on connector "openai".
       Run #A created with runs.created_at = 0; status running;
       family.testConnection starts but stalls on slow DNS.

  t=2  Operator clicks Test again (impatient).
       Run #B created with runs.created_at = 2; status running;
       family.testConnection completes quickly with status='valid'.
       Run #B's finish() writes connector_health row at t=3.

  t=5  Run #A finally completes with status='unreachable' (DNS
       timed out). Run #A's finish() tries to UPSERT.
       Without a guard, run #A would overwrite the newer, more
       accurate result from run #B.
```

The guard: `recordTest` performs an UPSERT that includes a
`WHERE` clause checking `incoming.test_started_at >= existing.test_started_at`.
In `better-sqlite3` SQL this is:

```sql
INSERT INTO connector_health (
  connector_id, status, error_code, message, tested_at,
  duration_ms, test_started_at, config_hash, run_id, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(connector_id) DO UPDATE SET
  status          = excluded.status,
  error_code      = excluded.error_code,
  message         = excluded.message,
  tested_at       = excluded.tested_at,
  duration_ms     = excluded.duration_ms,
  test_started_at = excluded.test_started_at,
  config_hash     = excluded.config_hash,
  run_id          = excluded.run_id,
  updated_at      = excluded.updated_at
WHERE excluded.test_started_at >= connector_health.test_started_at;
```

The `WHERE` on the `DO UPDATE` clause is the key. When the
incoming row's `test_started_at` is older than the stored row's,
the conflict is recognised but the update is skipped (the row
stays unchanged) — no exception thrown, no separate transaction
needed. The behaviour is silent-skip: callers don't need to know
they were beaten by a newer test.

A concurrency test in §7 (`tests/connector-health-store-concurrency.test.ts`)
proves: seed a row with `test_started_at = "T2"`; call
`recordTest` with `test_started_at = "T1"`; query — the original
T2 row is intact.

Equal `test_started_at` (same instant — unlikely with ISO 8601
ms precision but possible) is allowed to overwrite, mirroring
"newest wins, ties favour the latest writer." If millisecond
collisions become a problem in practice, a tiebreaker on
`run_id` is a future hardening item.

### 4.4 Fingerprint — `fingerprintConnectorConfig(...)`

New helper in `src/kernel/connectors/connectorHealth.ts` (or a
sibling `connectorFingerprint.ts` for cleaner separation). The
fingerprint identifies the validation-relevant config at a moment
in time so the hydration path can tell whether the stored
validation still applies to the CURRENT config.

**Input shape — pinned (v1.1).** `ConnectorInstanceConfig` here
means the **effective** instance config after preset-defaults
merge and family `settingsSchema` validation — exactly the
shape `buildConnectorContext` produces and `runConnectorTest`
hands to `family.testConnection(ctx)`. NOT the raw
`config.yaml` entry. Reasons:

- Raw entries can omit fields that the preset fills in
  (`baseUrl` for OpenAI, the local `allowLocalNetwork` flag for
  Ollama, etc.). Hashing the raw entry would produce different
  fingerprints for two semantically-equal configs (one with
  explicit overrides, one relying on preset defaults), causing
  spurious "not tested" fallbacks.
- The post-validation effective shape is what the family
  actually ran against; it's the right thing to compare for
  "did the inputs to the test change?"
- Both the testConnection write path AND the GET hydration
  path MUST call `fingerprintConnectorConfig` on the same
  effective shape. The symmetry test
  (`tests/connector-fingerprint-symmetry.test.ts`, §7)
  enforces this — divergence is a test failure.

```ts
import { createHash } from "node:crypto";
import type { ConnectorInstanceConfig } from "./schema";

/**
 * Deterministic, irreversible fingerprint of the
 * validation-relevant config for one connector. SHA-256 hex of a
 * canonical JSON serialisation (recursive key sort + sorted
 * capability list + HASHED authRef identity).
 *
 * Inputs covered:
 *  - connectorId
 *  - typeFamily
 *  - presetId (or `null` if absent)
 *  - effective settings (the family-shaped, secret-screened
 *    settings the runtime would parse)
 *  - capabilities narrowing (sorted; `null` when un-narrowed)
 *  - allowLocalNetwork (default `false`)
 *  - authRef identity, HASHED (`none` | `env:<sha16>` |
 *    `secret:<sha16>`). NEVER the raw env var name or secret id —
 *    same posture as the §9 non-leak invariants.
 *
 * Stable across server restarts (JSON.stringify + recursive sort).
 * Crosses no PII / no secret values.
 */
export function fingerprintConnectorConfig(
  connectorId: string,
  config: ConnectorInstanceConfig,
): string {
  const canonical = {
    connectorId,
    typeFamily: config.typeFamily,
    presetId: config.presetId ?? null,
    settings: canonicaliseValue(config.settings ?? {}),
    capabilities: config.capabilities
      ? [...config.capabilities].sort()
      : null,
    allowLocalNetwork: config.allowLocalNetwork ?? false,
    authRef: hashAuthRefIdentity(config.authRef),
  };
  return createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
}

/** Recursive key sort so equivalent objects always serialise the
 *  same way. Arrays preserve order (operator intent). Primitives
 *  pass through. */
function canonicaliseValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicaliseValue);
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = canonicaliseValue((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

/** Hashed authRef identity. Never the raw env var name (§9
 *  non-leak). `env:VAR_NAME` -> `env:<sha256(authRef).slice(0,16)>`.
 *  Future `secret:<id>` (M4a-6b) -> the same shape. `none` /
 *  absent -> literal "none". */
function hashAuthRefIdentity(authRef: string | undefined): string {
  if (!authRef || authRef === "none") return "none";
  const prefix = authRef.startsWith("env:")
    ? "env"
    : authRef.startsWith("secret:")
      ? "secret"
      : "unknown";
  const hash = createHash("sha256").update(authRef).digest("hex").slice(0, 16);
  return `${prefix}:${hash}`;
}
```

Locked properties:

- **Deterministic** — equivalent configs always produce the same
  hex string across processes / restarts.
- **Irreversible** — SHA-256 is one-way; even if a fingerprint
  leaked into a log line, it couldn't be reversed to recover the
  env var name or the secret id. **But** see the wording note in
  §9 — irreversibility is not a substitute for protecting
  local `state.db`. An attacker with read access to the file can
  enumerate plausible env var names and check hashes;
  irreversibility just means the hash itself doesn't *contain*
  the plaintext.
- **Narrow** — only validation-relevant fields. `trustOverride`
  and `enabled` are intentionally excluded — they don't change
  what a connector test would do.
- **Symmetric across the test write and the hydration read** —
  the testConnection code path and the `GET /api/connectors`
  route MUST call the same helper with the same EFFECTIVE
  instance config shape (post-merge, post-validation). A
  divergence is a test failure (see §7).
- **Algorithm-versioning posture.** If a future schema change
  alters the fingerprint algorithm or inputs (e.g. a new
  validation-relevant field becomes part of the effective
  config, or SHA-256 is replaced), the migration / implementation
  owns the cleanup. Existing rows may harmlessly mismatch and
  fall back to "not tested" until re-tested. **No
  backwards-compatibility tax is required for old
  fingerprints** — the system is designed to tolerate
  algorithm changes by treating any mismatch as "stale, show
  not tested." See §10 / ADR-0020 for the full posture.
- **Preset-default change effect.** If a shipped preset's
  defaults change between Agentic OS versions (e.g.
  `presets/openai.json` updates its default `model`), the
  effective config fingerprint for any operator-instance using
  that preset will change at the next hydration, causing
  `lastValidation` to be omitted until the connector is
  re-tested. This is **acceptable and safer than showing stale
  validation** — preset-default changes typically reflect
  real changes in what the test would do. Operators see one
  "not tested" prompt after an upgrade; one click of Test
  resolves it.

Behaviour:

- All reads / writes go through `better-sqlite3` prepared
  statements (synchronous, the same pattern RunLedger uses).
- Test seam: `__TEST__.newStore(db)` creates an isolated store
  against an injected in-memory DB.
- Failure mode: write failures are logged neutrally and **swallowed
  in `runConnectorTest`'s `finish` path** — the audit JSONL
  remains the source of truth, the run record still transitions,
  and the operator gets the live validation back from the function
  return. A `connector_health` write failure does NOT break the
  test. This matches the ADR-0016 rule for the run ledger itself
  ("a ledger write failure is logged and swallowed — it never
  breaks a mission run").

---

## 5. API changes

### 5.1 Extend `GET /api/connectors` projection

`src/app/api/connectors/_shared.ts` — extend `ConnectorListItem`:

```ts
export interface ConnectorListItem {
  connectorId: string;
  typeFamily: string;
  presetId?: string;
  enabled: boolean;
  trust: "first-party" | "community" | "untrusted" | "unknown";
  capabilities: CapabilityId[];
  authRefKind: "env" | "none" | "unset";
  allowLocalNetwork?: boolean;
  /** NEW — populated from `connector_health` ONLY when the stored
   *  config_hash matches the CURRENT instance config's fingerprint
   *  (§4.4). Absent when:
   *    - the connector has never been tested, OR
   *    - the config has changed since the last test (stale →
   *      omit so the UI shows "not tested" instead of a stale
   *      "valid").
   *  UI shows the StatusPill in its "not tested" state for both
   *  cases — no new pill state needed. */
  lastValidation?: {
    status: ConnectorValidation["status"];
    errorCode?: ConnectorErrorCode;
    message?: string;
    testedAt: string;
    durationMs: number;
  };
  // INTENTIONALLY NOT EXPOSED: config_hash. The fingerprint stays
  // server-side; the route uses it for the elide-stale decision
  // and nothing else. See §9 non-leak.
}
```

`projectConnector(connectorId, entry, health?)` gains an optional
`health` parameter. The route's GET handler does a single
`store.getMany(connectorIds)` and, per connector, recomputes the
current config fingerprint with
`fingerprintConnectorConfig(connectorId, entry)` and compares
against `health.configHash`:

- **Match** → include `lastValidation` in the projection.
- **Mismatch** (config edited since the test) → omit
  `lastValidation`. UI falls back to the existing "not tested"
  StatusPill state.
- **No row** (never tested) → omit `lastValidation`. Same UI
  state.

The route MUST NOT add a new "stale" or "needs retest" pill
variant — Rex's clarification: "do not add a new confusing
duplicate status unless the current StatusPill pattern supports
it cleanly." Stale and never-tested visually collapse to the same
"not tested" state. (A future spec can introduce a richer state
if operator feedback demands it.)

### 5.2 No changes to `POST /api/connectors`, `POST /api/connectors/[id]/test`, `POST /api/connectors/models/preview`

`runConnectorTest` already returns a `ConnectorValidation`; the
caller (the existing test endpoint or the post-add auto-test) gets
the live result via the return value, same as today. The new
`connector_health` write happens inside `runConnectorTest`'s
`finish` callback and is transparent to callers.

### 5.3 No new audit kind

Validation already audits as `connector.test` (per the M4a-1
contract). A second audit line for the persistence write would be
noise — the test outcome IS the meaningful event. The
`connector_health` UPSERT is plumbing.

---

## 6. File-level changes

### NEW files

```text
src/kernel/connectors/connectorHealth.ts
  ConnectorHealthStore class + ConnectorHealthRow type + the
  Path A2 prepared-statement queries. Singleton via globalThis
  (same pattern as RunLedger) so Next.js hot-reload doesn't
  spawn a second store.

src/kernel/connectors/connectorHealthSerialize.ts (optional)
  Pure helpers: serialiseValidation(v) / parseValidationRow(row).
  Kept separate from the store class so unit tests can exercise
  the (de)serialisation independently of the DB.

src/kernel/connectors/connectorFingerprint.ts (NEW — required;
  could also live inline in connectorHealth.ts if the file size
  stays small)
  fingerprintConnectorConfig(connectorId, instanceConfig) per
  §4.4. Imports node:crypto only (no DB, no I/O). The route
  AND testConnection both call this; tests assert symmetry.
```

### MODIFIED files

```text
src/kernel/state/migrations.ts
  + MIGRATION_2_CONNECTOR_HEALTH literal + entry in MIGRATIONS array.
  Header comment updated to record the new table.

src/kernel/connectors/testConnection.ts
  finish() now also computes the config fingerprint via
  fingerprintConnectorConfig(connectorId, instanceConfig) and calls
  connectorHealth.recordTest(connectorId, validation, configHash,
  runId) BEFORE awaiting the audit line. Wrapped in a try/catch
  that logs neutrally and swallows on failure (per §4.3 failure
  mode). The fingerprint is computed from the SAME instanceConfig
  the test actually used — not re-fetched from disk — so a
  mid-test config edit doesn't poison the row.

src/app/api/connectors/_shared.ts
  + lastValidation field on ConnectorListItem (UI-safe shape —
  no secret, no env var name, no raw provider response).
  projectConnector(connectorId, entry, health?) gains the
  optional health parameter and copies the relevant fields.

src/app/api/connectors/route.ts (GET handler only)
  Adds a single connectorHealth.getMany(ids) call before mapping
  to projections. For each connector, the handler recomputes the
  CURRENT config fingerprint via fingerprintConnectorConfig and
  compares against the stored health row's configHash; mismatch
  -> omit lastValidation. Reviewer note for M4a-6b PR B (which
  ships PATCH + DELETE handlers on this same route file): after
  config removal succeeds, BEST-EFFORT call
  connectorHealth.delete(connectorId). Failure is harmless —
  orphaned health rows are not enumerated by GET /api/connectors
  (the route iterates from config). No stale row should crash or
  surface to UI. This is NOT a cross-store atomic transaction —
  config.yaml (file) and state.db (SQLite) are different stores.

src/app/settings/_connectors/api.ts
  ConnectorListItem TS type extended to match the new server
  shape.

src/app/settings/_connectors/ConnectorsPanel.tsx
  refresh() now hydrates testResults from the fetched
  ConnectorListItem.lastValidation entries. The existing
  onAdded() flow and Test button flow stay unchanged — they
  continue to write to testResults locally; the next refresh
  pulls the canonical value back from the server.

docs/M4A5-ACCEPTANCE.md  (consider extracting to its own
  FU5 acceptance doc if this spec ships as its own milestone)
  Step 8 "Known limitation (#36)" caveat REMOVED. Step 8
  acceptance line updated to require:
    - existing rows show their last-known status after refresh
    - never-tested rows still show "not tested" after refresh
    - server restart preserves status (durability check)
```

### Test files (NEW)

```text
tests/connector-health-store.test.ts          (CRUD + UPSERT + delete)
tests/connector-health-serialize.test.ts      (round-trip + invalid input)
tests/connector-health-migration.test.ts      (migration v1 -> v2)
tests/connector-test-run-persists-health.test.ts
                                              (testConnection writes
                                               to connector_health on
                                               success AND on failure)
tests/api-connectors-hydration.test.ts        (GET /api/connectors
                                               projection includes
                                               lastValidation; never-
                                               tested connectors omit
                                               the field)
```

### Test files (MODIFIED)

```text
tests/connector-test-run.test.ts              (verify the new
                                               connector_health write
                                               doesn't break the
                                               existing flow; also
                                               assert write failure
                                               is swallowed)
```

### Docs (closeout, in PR D)

```text
docs/decisions/ADR-0020-connector-health-table.md  (NEW — locks the
  Path A2 decision + the failure-mode + the future-statuses
  generalisation note)
docs/ARCHITECTURE.md §7 (State store + run ledger) — add a paragraph
  on the connector_health table; note that the run ledger and
  connector_health are complementary (history vs current state).
docs/ROADMAP.md — record M4a-FU5 complete + acceptance status.
docs/specs/expandability-foundation/README.md — status row added/
  updated for m4a-fu5-task-spec.md.
docs/specs/expandability-foundation/m4a-fu5-task-spec.md — this
  spec, status header bumped from DRAFT to CODE COMPLETE.
docs/M4A5-ACCEPTANCE.md Step 8 — remove the #36 known limitation
  caveat (or, if FU5 ships as its own milestone, ship a
  docs/M4AFU5-ACCEPTANCE.md and link from there).
```

---

## 7. Tests

### Kernel

```text
tests/connector-health-store.test.ts
  - recordTest() inserts a fresh row.
  - recordTest() called twice with same connectorId UPSERTs (one
    row, second value wins).
  - get(id) returns ConnectorHealthRow with intact validation.
  - get(unknown) returns undefined.
  - getMany([…]) returns Map; missing ids are absent (not null).
  - delete(id) removes the row; subsequent get returns undefined.
  - delete(unknown) is idempotent (no throw).
  - Schema: connector_id PK uniqueness enforced; updated_at
    auto-set on every write.

tests/connector-health-serialize.test.ts
  - Round-trip every ConnectorValidation.status value through
    serialise+parse.
  - errorCode-less validations round-trip cleanly.
  - Malformed row data fails neutrally (invalid status string ->
    parse returns null; caller treats as "not tested").

tests/connector-health-migration.test.ts
  - Apply migration 1 then migration 2 from a fresh DB ->
    connector_health table exists with the right schema.
  - Apply migration 2 against an already-v2 DB -> no-op (idempotent).
  - Forward-guard refuses a DB stamped v3 against a v2 build.

tests/connector-test-run-persists-health.test.ts
  - Successful testConnection populates a connector_health row
    with status='valid' AND the correctly-computed configHash.
  - Failed testConnection (e.g. mock auth-failed) populates a row
    with status reflecting the validation + errorCode preserved
    + configHash recorded.
  - A connector_health write failure (mocked store throws) is
    swallowed; the existing testConnection result still returns
    correctly; the run record still transitions; the audit line
    still writes.
  - The same `runId` is recorded on both the run and the
    connector_health row.
  - testConnection fingerprints the SAME instanceConfig it tested
    with; a later config edit doesn't poison the row.

tests/connector-fingerprint.test.ts (NEW — §4.4 helper)
  - Deterministic: same input twice -> same hex string.
  - Object key order in `settings` doesn't affect the hash.
  - Arrays in settings preserve order (operator intent).
  - Capabilities are sorted before hashing (insertion order
    doesn't affect the hash).
  - allowLocalNetwork defaults to false when absent.
  - authRef "none" / absent maps to literal "none".
  - authRef "env:OPENAI_API_KEY" produces "env:<sha16>" — the
    raw VAR_NAME never appears in the hash input the test
    captures. Marker-string assertion: "OPENAI_API_KEY" appears
    in NO recoverable form in the output.
  - Future "secret:<id>" form (M4a-6b) maps to "secret:<sha16>".
  - Different connectorId / typeFamily / presetId / settings /
    capabilities / allowLocalNetwork / authRef each independently
    produce different hashes.

tests/connector-fingerprint-symmetry.test.ts (NEW)
  - The fingerprint computed at testConnection time AND the
    fingerprint computed at hydration time (via the route)
    agree, given the same instance config. Asserted by calling
    fingerprintConnectorConfig from both call sites in the same
    test against an isolated registry + config.
  - When the operator edits the instance config (changes
    baseUrl / model / authRef / allowLocalNetwork / capabilities
    / typeFamily / presetId) the hash changes — covers every
    fingerprint-input field.

tests/api-connectors-hydration.test.ts
  - GET /api/connectors with N seeded connectors + M < N
    connector_health rows returns N items, M with lastValidation
    populated, N-M without.
  - lastValidation field never carries the secret value, env var
    name, Authorization header, baseUrl, raw provider response.
    (Marker-string sweep — symmetric with the M4a-5 secret-
    non-leak discipline.)
  - **Fingerprint mismatch elides hydration:** seed a
    connector_health row with a stale configHash (simulating an
    edit), then call GET /api/connectors — the response MUST NOT
    include lastValidation for that connector. UI behaviour is
    "not tested" for that row.
  - **Fingerprint match hydrates:** seed a connector_health row
    whose configHash matches the current config — the response
    MUST include lastValidation with the stored status /
    errorCode / message / testedAt / durationMs.
  - **API response does NOT expose configHash.** Explicit
    assertion that no `configHash` / `config_hash` /
    `fingerprint` key appears in the JSON.
  - A connector_health row whose run was deleted (cascade) still
    surfaces (run_id is NULL; lastValidation is intact).

tests/connector-health-row-non-leak.test.ts (NEW)
  - Marker-string sweep against the connector_health table
    contents AS WRITTEN to disk. Set OPENAI_API_KEY to a
    test-only marker; run a testConnection; query
    sqlite3 ~/.agentic-os/state.db
    "SELECT * FROM connector_health;" — the marker MUST NOT
    appear anywhere in the row (status / error_code / message /
    config_hash / run_id / etc.). Symmetric assertion for the
    env var NAME literal "OPENAI_API_KEY" — must not appear in
    plaintext (the fingerprint stores only sha16 of authRef).
  - Same sweep for baseUrl: a recognisable test-only URL must
    not appear in any column.
  - settings blob is NOT persisted in the connector_health row —
    explicit assertion (no settings-shaped column / JSON).

tests/api-connectors-refresh-durability.test.ts (NEW)
  - Run a testConnection, restart the in-test DB (close +
    reopen at the same path), call GET /api/connectors — the
    lastValidation field survives. Server-restart durability.
  - Equivalent in-test simulation of a "hard browser refresh"
    (just a fresh fetch — server state is identical) — the
    lastValidation field still surfaces with the same content.
```

### UI

Deferred per the spec convention (no `@testing-library/react`
in the repo); manual verification per the updated
`docs/M4A5-ACCEPTANCE.md` Step 8 (or a new
`docs/M4AFU5-ACCEPTANCE.md`).

---

## 8. Migration / compatibility

| Concern | Behaviour |
|---|---|
| Existing connectors with no test history | `connector_health` table is empty for them. `GET /api/connectors` omits `lastValidation`. UI shows "not tested". |
| Existing connectors tested before FU5 ships | No retroactive backfill from the runs table. The first post-FU5 test populates `connector_health` for that connector. Operators see "not tested" until then; one click of Test fixes it. (This is honest — we can't synthesise the lossy run-table data into the lossless table.) |
| Server restart | Trivial — `connector_health` is durable in `state.db`. |
| Fresh install | Migration 2 runs on first DB open; empty `connector_health` table is created; no functional impact. |
| Downgrade to a pre-FU5 build | Forward-guard already in place. The older build refuses to open the v2 DB. Operators rolling back must restore the pre-migration backup (the migration runner takes one before applying). |
| Connector deletion (M4a-6b DELETE flow) | After config removal succeeds, M4a-6b DELETE should **best-effort** call `connectorHealth.delete(connectorId)`. Failure is harmless because orphaned health rows are not enumerated by `GET /api/connectors` — the route iterates connectors from config. No stale row should crash or surface to UI. **This is NOT a cross-store atomic transaction** — `config.yaml` (file) and `state.db` (SQLite) are different stores; FU5 makes no claim of joint commit semantics across them. Out-of-scope for THIS spec, but flagged here so M4a-6b PR B reviewers catch it. |
| Manual config-yaml edit deleting a connector | `connector_health` row becomes orphaned. Harmless — `GET /api/connectors` doesn't enumerate it (it iterates connectors from config). Cleanup is a future hardening item (a periodic prune; not blocking). |

---

## 9. Security non-leak invariants (locked)

`connector_health` carries operator-visible metadata only. The
M4a/M4a-5 non-leak surface list (PRs #29 / #30 / #34) extends here:

Across every shipped surface (`GET /api/connectors`, the
hydrated row, `connector_health` table on disk, the kernel
helper return values, any log line, any audit line), NONE may
contain:

- The resolved secret value.
- The env var NAME (the fingerprint stores only a SHA-256
  hash; `OPENAI_API_KEY` MUST never appear plaintext in the
  DB row).
- The Authorization header.
- The `baseUrl` (it's already in the config; not duplicated
  here, not embedded in `config_hash` in any recoverable
  form).
- The raw provider response body.
- The raw kernel error / stack trace.
- The connector's `settings` blob beyond status + errorCode +
  message + testedAt + durationMs. **Notably: `settings` are
  NOT a column on `connector_health` — only the SHA-256 of
  the canonical config crosses, and SHA-256 is irreversible.**
- The `config_hash` itself in any API response (server-side
  only; §5.1 contract; explicit test in §7).

Asserted by **two** marker-string sweeps in §7:

1. `tests/api-connectors-hydration.test.ts` — sweeps the API
   response body (and any error envelope) for the marker.
2. `tests/connector-health-row-non-leak.test.ts` — sweeps the
   raw `connector_health` table contents on disk (via
   `sqlite3 … "SELECT * FROM connector_health;"`) for the
   marker AND for the env var NAME literal.

The `message` field is the kernel-generated neutral message from
`testConnection.ts`'s `neutralMessage(status, errorCode)` — that
function explicitly avoids passing through any family-provided
string (per the M4a-1 review fix that landed it). No new surface
adds raw provider text.

**Honest scope of the `config_hash` / authRef hashing guarantee.**
The hash is irreversible (SHA-256), so a fingerprint embedded
in a leaked log line cannot be reversed *as a string* into the
env var name, secret id, or settings blob. The real
guarantees this provides are narrow and explicit:

- env var names are **not stored in plaintext** in the
  `connector_health` row (`config_hash` and the per-authRef
  `env:<sha16>` shape replace the raw name);
- `config_hash` is **server-internal** and not exposed via the
  API (§5.1 contract; §7 test asserts the API response carries
  no `configHash` / `config_hash` / `fingerprint` field);
- the DB row carries **no raw env var name, no secret value,
  no Authorization header, no baseUrl, no raw provider
  response**.

This is **NOT a substitute for protecting local `state.db`**.
Env var names are low-entropy (`OPENAI_API_KEY`,
`OPENROUTER_API_KEY`, etc.); an attacker with read access to
the SQLite file can enumerate plausible names and hash-match
them against the stored fingerprint. The right defence against
that attack is the existing file-permission posture on the
operator's home directory (and, post-M4a-6b, the secret store
file at 0600). FU5 doesn't widen that attack surface; it just
doesn't pretend hashing closes it.

---

## 10. ADR work

**ADR-0020 — Connector health table (denormalised current-state
store).** New decision doc, ships in PR D closeout:

- **Decision:** persist last-known `ConnectorValidation` per
  connectorId in a dedicated `connector_health` table in
  `state.db`. ADR-0014's four-store split is unchanged
  (`connector_health` lives alongside the run ledger in state.db,
  not in a fifth store).
- **Decision:** `runConnectorTest` UPSERTs on every test
  completion; write failure is logged and swallowed (audit JSONL
  remains source-of-truth).
- **Decision:** `GET /api/connectors` hydrates the projection
  with `lastValidation`. UI hydrates `testResults` from the
  projection on mount.
- **Decision:** future statusful surfaces (MCP health, agent
  health, …) follow the same `<thing>_health` table + projection
  + hydration pattern. Codified here so they don't reinvent.
- **Hedge on generalisation (v1.1).** This pattern fits
  **low-frequency, operator-triggered or test-triggered**
  status updates — connector tests, MCP server pings on
  config-add, agent-binary capability probes. **High-frequency
  telemetry, push-based heartbeats, and live process-state
  observation may need different patterns** (a circular
  buffer, an event stream, an in-memory cache rather than an
  on-disk table, etc.). ADR-0020 does NOT preclude those —
  it just doesn't claim to be the right shape for them.
  Future statusful surfaces should weigh the update frequency
  before reaching for the `<thing>_health` template.
- **Decision (fingerprint algorithm versioning, v1.1).** If a
  future change alters `fingerprintConnectorConfig`'s algorithm
  (e.g. SHA-256 → BLAKE3) or inputs (e.g. a new
  validation-relevant field becomes part of the effective
  config), the change owner does NOT have to preserve old
  fingerprints. Existing `connector_health` rows will harmlessly
  mismatch and fall back to "not tested" until re-tested. No
  backwards-compatibility tax is required. Operators see a
  one-time "not tested" prompt after the upgrade; one click of
  Test resolves it. This is the same posture as the
  preset-default change effect documented in §4.4 / §8.
- **Decision (DELETE cleanup, v1.1).** When M4a-6b ships the
  `DELETE /api/connectors/[id]` route, the handler does a
  **best-effort** `connectorHealth.delete(connectorId)` after
  config removal succeeds. Failure is harmless because
  `GET /api/connectors` iterates connectors from config, so
  orphaned health rows never surface. **This is NOT a
  cross-store atomic transaction** — `config.yaml` (file) and
  `state.db` (SQLite) are different stores and FU5 makes no
  claim of joint-commit semantics across them.
- **Alternatives considered:** Path A1 (extend runs.validation_json
  column — rejected for query awkwardness + history/current
  mixing); Path B (lossy RunLedger query — rejected because
  status granularity is lost and the pattern doesn't generalise).
- **References:** ADR-0009 (audit log), ADR-0014 (four-store split,
  which pre-names `connector_health` as a future table), ADR-0016
  (run ledger foundation), ADR-0017 (connector runtime + authRef),
  ADR-0018 (preset catalog), `m4a-fu5-task-spec.md`.

ADR-0016 / ADR-0017 / ADR-0018 do not need amendments — FU5
extends them, doesn't change their decisions.

---

## 11. PR breakdown

Per the workflow's "one logical change per PR" rule, FU5 splits
cleanly into two PRs. (Could ship as one if scope contracts; both
are reasonable.)

```text
PR 1 (FU5 PR A) — Kernel: connector_health table + store + testConnection wiring.
  + src/kernel/state/migrations.ts (MIGRATION_2_CONNECTOR_HEALTH)
  + src/kernel/connectors/connectorHealth.ts (NEW store + types)
  + src/kernel/connectors/connectorHealthSerialize.ts (optional;
    can also be inlined in connectorHealth.ts)
  + extend src/kernel/connectors/testConnection.ts (finish()
    UPSERTs into connector_health; failure swallowed)
  + tests/connector-health-store.test.ts
  + tests/connector-health-serialize.test.ts
  + tests/connector-health-migration.test.ts
  + tests/connector-test-run-persists-health.test.ts
  + extend tests/connector-test-run.test.ts (swallow-on-failure)
  DoD: typecheck + tests green; existing connector-test flow
  observably unchanged; new table populated; nothing leaks per §9.

PR 2 (FU5 PR B) — Route projection + UI hydration + acceptance update.
  + extend src/app/api/connectors/_shared.ts (lastValidation on
    ConnectorListItem; projectConnector accepts health)
  + extend src/app/api/connectors/route.ts GET handler
    (single connectorHealth.getMany call; per-connector
    projection hydration)
  + extend src/app/settings/_connectors/api.ts (ConnectorListItem
    TS type)
  + extend src/app/settings/_connectors/ConnectorsPanel.tsx
    (refresh() hydrates testResults from lastValidation)
  + tests/api-connectors-hydration.test.ts (incl. marker-string
    secret-non-leak sweep)
  + extend docs/M4A5-ACCEPTANCE.md Step 8 — remove the #36
    "known limitation" caveat; add the post-refresh hydration
    verification step
  DoD: existing rows show last-known status after refresh;
  never-tested rows still show "not tested"; server restart
  preserves status; secret non-leak sweep clean; M4A5
  acceptance step passes against a live server.

PR 3 (FU5 PR C — closeout, can fold into PR 2 if small).
  + docs/decisions/ADR-0020-connector-health-table.md
  + docs/ARCHITECTURE.md §7 — connector_health paragraph
  + docs/ROADMAP.md — M4a-FU5 status
  + docs/specs/expandability-foundation/README.md — status row
  + docs/specs/expandability-foundation/m4a-fu5-task-spec.md
    status header bumped to CODE COMPLETE
  DoD: per docs/MAINTENANCE.md milestone-done rule — eight items
  ticked (code, tests, ADR, ARCHITECTURE, ROADMAP, spec status,
  acceptance checklist, live acceptance pass).
```

---

## 12. Operator acceptance

Rather than a separate `M4AFU5-ACCEPTANCE.md`, **update the
existing `docs/M4A5-ACCEPTANCE.md` Step 8** — remove the "known
limitation (#36)" caveat and add the hydration verification.
Justification: FU5 is the closure of M4a-5's acceptance-time
known-limitation; folding the verification into the same doc
keeps the acceptance surface continuous.

Sketch of the Step 8 update:

```text
Step 8 — Successful Add returns to the Connectors list with a
highlighted row (current behaviour — unchanged); AND validation
status persists across browser refresh (NEW with FU5):

[ ] [existing PR #34 ticks unchanged]
[ ] Click Test on a connector → green pill + "valid".
[ ] Hit refresh (Cmd-R / F5 hard refresh). The row still shows
    green "valid" — no transient fallback to "not tested".
[ ] **Edited-config check.** Edit the connector's settings (e.g.
    change the model id in ~/.agentic-os/config.yaml or via the
    M4a-6b PATCH route once it exists). Hit refresh. The row now
    shows "not tested" — the previous valid status is hidden
    because the config_hash changed. Clicking Test re-establishes
    valid, which then survives the next refresh.
[ ] **Secret hygiene sweep — current surfaces only.** FU5 is still
    in env-only auth (the plaintext UI-managed secret store is
    M4a-6b scope; do NOT reference ~/.agentic-os/secrets/store.json
    here). Run against the marker (e.g. the first 8 chars of your
    OPENAI_API_KEY value):

    KEY_PREFIX="sk-abc123"
    grep -r "$KEY_PREFIX" ~/.agentic-os/audit/        # MUST be empty
    grep -r "$KEY_PREFIX" ~/.agentic-os/config.yaml   # MUST be empty
    curl http://127.0.0.1:3000/api/connectors | grep "$KEY_PREFIX"
                                                      # MUST be empty
    sqlite3 ~/.agentic-os/state.db \
      "SELECT * FROM connector_health;" | grep "$KEY_PREFIX"
                                                      # MUST be empty
    sqlite3 ~/.agentic-os/state.db \
      "SELECT * FROM connector_health;" | grep "OPENAI_API_KEY"
                                                      # MUST be empty
                                                      # (env var NAME
                                                      # must not
                                                      # appear in any
                                                      # column —
                                                      # config_hash
                                                      # stores only
                                                      # sha16 of the
                                                      # authRef)

[ ] Restart the dev server. Refresh the page. The row STILL
    shows the last-known status. Durability confirmed.
[ ] A never-tested connector still shows "not tested" — hydration
    only restores actually-recorded state.
[ ] The "known limitation (#36)" caveat from prior acceptance is
    REMOVED from this step.
```

---

## 13. Open questions for Rex

All seven open questions pinned in v1. The decisions below are
LOCKED for execution; reverting them requires a spec amendment.

```text
O1  [LOCKED — Rex 2026-05-24] Path A1 vs A2.
    DECISION: A2 — separate connector_health table per §3.3.
    A1 (extend runs.validation_json column) and Path B (lossy
    RunLedger query) explicitly rejected. Rationale recorded in
    §3.

O2  [LOCKED — Rex 2026-05-24] PR breakdown.
    DECISION: TWO-PR split per §11. PR A = kernel (store +
    fingerprint + migration + testConnection wiring + kernel
    tests). PR B = route + UI hydration + acceptance update +
    closeout (ADR-0020 + ARCHITECTURE + ROADMAP + spec status +
    M4A5-ACCEPTANCE.md Step 8 rewrite). PR C closeout-only is
    optional; default folds into PR B.

O3  [LOCKED — Rex 2026-05-24; extended v1.1 2026-05-24] Backfill
    from runs table OR audit JSONL.
    DECISION: NO backfill from either source. Operators see "not
    tested" on previously-tested connectors until they click Test
    once post-FU5.

    Why not the runs table: it's lossy on the discriminant we
    care about (the run record stores the outcome category, not
    the full `ConnectorValidation` shape with errorCode +
    detail). Even if we recovered a discriminant, we'd have no
    fingerprint to gate it against — so we'd hydrate stale data
    indistinguishable from current data, which is exactly the
    bug FU5 exists to fix in the first place.

    Why not the audit JSONL (v1.1 extension): the audit log is
    **append-only and not a query source**. It's the
    source-of-truth for *what happened*, not for *current
    state*. Reading it to reconstruct `connector_health` would
    invert the architectural relationship (audit = ledger,
    state.db = current-state projection — ADR-0009 / ADR-0014
    are explicit about this direction). It would also be O(log
    size) per cold-start, which is the wrong shape for a
    request-path hydration. Better to start fresh and be honest:
    one click of Test post-upgrade is a 200ms cost; reversing
    the audit-vs-projection direction is an architectural
    cost we'd pay forever.

O4  [LOCKED — Rex 2026-05-24] Orphan prune.
    DECISION: NO prune in this spec. Orphans are harmless — the
    route iterates connectors from config, so stale rows never
    surface to the UI. Filed as a future-hardening item if it
    ever bites.

O5  [LOCKED — Rex 2026-05-24] Acceptance doc location.
    DECISION: FOLD into docs/M4A5-ACCEPTANCE.md Step 8. Remove
    the "known limitation #36" caveat; add the hydration +
    fingerprint + DB-non-leak verification. Per §12 sketch.

O6  [LOCKED — Rex 2026-05-24] ADR-0020.
    DECISION: YES. The connector_health table + denormalised
    <thing>_health pattern is intended to generalise (MCP
    health, agent health, etc.); codifying as an ADR makes
    that intent reviewable. PR D / closeout step lands
    ADR-0020.

O7  [LOCKED — Rex 2026-05-24] Table name.
    DECISION: connector_health. Matches v8 §7.2 + the M3
    migration runner header comment.

O8  [NEW in v1] Stale-config UI affordance.
    DEFAULT: omit lastValidation when the fingerprint mismatches
    so the row falls back to "not tested" (the existing
    StatusPill state). NO new pill state introduced. Rex's
    clarification: "do not add a new confusing duplicate status
    unless the current StatusPill pattern supports it cleanly."
    Pin only if a future operator complaint demands richer
    state (e.g. "edited — re-test recommended" with a
    distinct color); not in v1 scope.
```

---

**End of M4a-FU5 task spec (v1.1 draft, design only).** O1–O7
all pinned per Rex (2026-05-24); v1 folded in four amendments
(stale-config fingerprinting; softened DELETE atomicity
wording; acceptance command corrected to drop the M4a-6b-scope
secret store reference; test surface strengthened with
fingerprint + DB-row non-leak + restart-durability coverage).

v1.1 (2026-05-24) folded in nine cleanups:

1. **§8 DELETE contradiction fixed** — the connector-deletion
   row in §8 still said "same atomic block" in v1; rewritten
   to best-effort with harmless orphans, and the lack of
   cross-store atomicity is now stated explicitly.
2. **Concurrency semantics pinned** — added `test_started_at`
   column (denormalised from existing `runs.created_at`, no
   new architectural primitive) + new §4.5 UPSERT-guard SQL
   with `ON CONFLICT … DO UPDATE … WHERE excluded.test_started_at
   >= connector_health.test_started_at` + slow-older-vs-fast-
   newer race test reference.
3. **ADR-0020 generalisation hedged** — the
   `<thing>_health` pattern fits low-frequency / operator- /
   test-triggered updates only; high-frequency telemetry and
   push-based heartbeats may need different patterns.
4. **Store wiring pinned** — `ConnectorHealthStore` accepts
   `Database` in constructor and shares the existing
   `state.db` connection; no second SQLite connection.
5. **No-backfill rationale extended (§13 O3)** — audit JSONL
   backfill explicitly rejected (audit is append-only, not a
   query source; reversing the audit-vs-projection direction
   is an architectural cost we'd pay forever).
6. **Fingerprint input shape pinned** — must be
   post-defaults-merge, post-validation EFFECTIVE config (not
   raw `config.yaml`); both the testConnection write site
   and the hydration read site call the same helper with the
   same effective shape.
7. **Fingerprint algorithm versioning posture** — future
   schema changes own cleanup; existing rows harmlessly
   mismatch and fall back to "not tested". No
   backwards-compatibility tax required.
8. **Preset-default change effect** — if shipped preset
   defaults change between versions, fingerprint may change
   and `lastValidation` is omitted until re-test. Acceptable
   and safer than showing stale validation.
9. **authRef hashing wording tightened (§9)** — irreversibility
   is NOT a substitute for protecting local `state.db`. Real
   guarantees stated narrowly: env var names not in plaintext
   in the row; `config_hash` server-internal only; DB row
   contains no raw values.

Committed to `docs/specs/expandability-foundation/m4a-fu5-task-spec.md`
per `docs/MAINTENANCE.md` when Rex accepts v1.1. No implementation
begins until that commit lands AND Rex green-lights FU5 PR A.
