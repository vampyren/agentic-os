# ADR-0020 — Connector health table (denormalised current-state store)

**Status:** Accepted
**Date:** 2026-05-24

## Context

M4a-5 shipped the connector test surface — Settings → Connectors,
the right-side `StatusPill`, the below-row `ValidationDetail`, and
the auto-close + highlight UX on Add Provider. Validation outcomes
(`valid` / `invalid` / `unreachable` / `misconfigured` / `unknown`)
lived in transient React state in `ConnectorsPanel.tsx`. A hard
browser refresh dropped every row back to "not tested" — the
operator had to click Test on each connector again after every
reload. Live acceptance flagged the bug as the next thing to fix
(known limitation in `docs/M4A5-ACCEPTANCE.md` Step 8; issue #36).

Hydrating from the M3 run ledger directly is lossy on the
discriminant we care about — the run ledger stores the *run*
record (kind / status / errorCode / duration), not the full
`ConnectorValidation` shape with `errorCode` and message. Even if
we widened the run record's columns, we'd still need to decide
whether the stored outcome still applies to the CURRENT config (an
operator edit between test and refresh must surface as
"not tested" so a stale `valid` can't appear on a now-broken
config).

The v8 architecture lock already named **`connector_health`** as a
future ADR-0014 four-store occupant (§7.2 — denormalised
current-state tables). FU5 is the milestone that ships it. This
ADR locks the decision so the next round of statusful surfaces
(MCP server health, agent capability probes, future health
projections) reuse the same shape rather than reinventing.

## Decision

### Single denormalised current-state table

`state.db` gets one new table per migration 2:

```sql
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
```

One row per connector instance, keyed by `connector_id`. UPSERTed
on every `runConnectorTest` completion (`finish()` in
`src/kernel/connectors/testConnection.ts`).

### The connector_health table is NOT a fifth store

ADR-0014's four-store split is preserved unchanged. `connector_health`
lives alongside `runs` / `run_steps` / `external_refs` inside the
existing `state.db` file and shares the same `better-sqlite3`
connection via `getStateDb()`. There is no second SQLite handle
and no new persistence root.

### Two-path fingerprint over an EFFECTIVE config

`config_hash` is the SHA-256 hex of a canonical-JSON serialisation
of the validation-relevant slice of the connector's config at the
moment of the test (`src/kernel/connectors/connectorFingerprint.ts`):

- `connectorId`,
- `typeFamily`,
- `presetId` (or `null`),
- `settings` — recursive key-sort (so insertion order doesn't
  change the hash); array order preserved (operator intent);
- `capabilities` — sorted (set-shaped narrowing intent);
- `allowLocalNetwork` (default `false`),
- `authRef` — hashed at the **identity** part only
  (`env:VAR_NAME` → `env:<sha256(VAR_NAME).slice(0,16)>`); the
  raw env var NAME never enters the hash input. Future
  `secret:<id>` (M4a-6b) follows the same shape.

`trustOverride` and `enabled` are **excluded** — they don't change
what a connector test would do.

`runConnectorTest` and `GET /api/connectors` both consume the same
two fingerprint helpers:

1. `buildConnectorContext` SUCCEEDS → `fingerprintConnectorConfig(...)`
   over the EFFECTIVE post-merge/post-validation config (the shape
   the family actually ran against).
2. `buildConnectorContext` FAILS (family missing,
   `settingsSchema` parse failure, `auth-missing`, defensive B4) →
   `fingerprintFromInstanceConfig(...)` over the RAW instance
   config (settings' secret-looking values redacted to
   `[redacted:<sha16>]` first, so the raw value never enters the
   JSON fed to SHA-256).

`computeCurrentFingerprint(connectorId, instanceConfig, registry)`
is the **single dispatch helper** PR B's hydration calls; the
testConnection write path has the resolved build context already
and calls the two atomic helpers directly. The two ends are
asserted symmetric by `tests/connector-fingerprint-symmetry.test.ts`
on both branches.

A common misconfigured config (auth-missing, settings-invalid)
that the operator hasn't edited still hydrates its
`misconfigured / <errorCode>` status across refresh — the
fallback fingerprint matches between write and read.

### Hydration gate

`GET /api/connectors` hydrates each row's optional `lastValidation`
**only when** the stored `config_hash` matches the recomputed
current fingerprint:

- match → `lastValidation` populated from the row;
- mismatch → field omitted; UI's `StatusPill` falls back to
  "not tested" (no new pill state was added; spec O8).

The fingerprint itself is **server-internal** and never crosses
the API boundary — `/api/connectors` never includes a
`config_hash` / `configHash` / `fingerprint` field, asserted by
`tests/api-connectors-hydration.test.ts`.

### Freshness ordering — slow-older vs fast-newer race

UPSERTs are guarded by `test_started_at`:

```sql
INSERT INTO connector_health (...) VALUES (...)
ON CONFLICT(connector_id) DO UPDATE SET ...
WHERE excluded.test_started_at >= connector_health.test_started_at;
```

A slow test started earlier cannot overwrite a faster test that
completed later for the same connector. The older write is a
silent skip (no throw, no separate transaction needed). Equal
timestamps favour the latest writer.

`test_started_at` is denormalised from the producing run's
**`runs.created_at`** — captured at `ledger.createRun(...)` time,
BEFORE the family's `testConnection` executes. Falls back to a
function-entry timestamp only when the ledger is unavailable or
`createRun` throws. Denormalising avoids a JOIN on every
hydration read.

### Failure mode — write failures are swallowed

A `connector_health` write failure (DB closed, disk full, etc.)
is logged neutrally and **swallowed** in `runConnectorTest`'s
`finish()` path. The run record still transitions, the audit
JSONL line still writes, and the caller gets the live validation
back from the function return. Audit JSONL (ADR-0009) remains
source-of-truth for *what happened*; `connector_health` is a
current-state projection, not a ledger. The same posture applies
to hydration: a `getMany` throw is logged and swallowed; the
route returns 200 with projections that lack `lastValidation`.
This mirrors ADR-0016's rule for the run ledger itself.

### Non-leak invariants

`connector_health` carries operator-visible metadata only. None
of the following ever cross to disk in this table:

- The resolved secret value.
- The env var NAME (only `env:<sha16>` lives in the
  authRef-identity hash that feeds the fingerprint).
- The Authorization header.
- The `baseUrl` (it's in the config; not duplicated here, not
  reconstructible from `config_hash`).
- The raw provider response body.
- The raw kernel error / stack trace.
- The connector's `settings` blob beyond status + errorCode +
  message + testedAt + durationMs. **`settings` is NOT a column
  on `connector_health`** — only the SHA-256 of the canonical
  config crosses, and SHA-256 is irreversible.
- The `config_hash` itself in any API response (server-internal
  only).

Asserted by marker-string sweeps in both
`tests/connector-health-row-non-leak.test.ts` (on-disk table
contents AND raw DB file bytes) and
`tests/api-connectors-hydration.test.ts` (API response body).

**Honest scope of the hashing guarantee.** SHA-256 is one-way, so
a fingerprint embedded in a leaked log line cannot be reversed
*as a string* into the env var name or settings blob. But this is
NOT a substitute for protecting local `state.db`. Env var names
are low-entropy (`OPENAI_API_KEY`, `OPENROUTER_API_KEY`, …); an
attacker with read access to the SQLite file can enumerate
plausible names and hash-match against the stored fingerprint.
The right defence is the existing file-permission posture on the
operator's home directory (and, post-M4a-6b, the secret store
file at 0600). FU5 doesn't widen that surface, and doesn't pretend
hashing closes it.

### Test-isolation guard (operational)

FU5 PR A also lands a kernel-side guard
(`src/kernel/state/db.ts::assertNotRealDbInTests`) — `getStateDb()`
THROWS if a vitest process tries to open the default
`~/.agentic-os/state.db` path. Forces every test that touches a
state-DB singleton to set `AGENTIC_OS_STATE_DB` to a tmp file.
Caught a real test-isolation incident during PR A development
(a missing env-var redirect migrated the operator's real DB);
disclosed in PR #39's body and regression-tested in
`tests/state-migrations.test.ts`.

### Generalisation — the `<thing>_health` pattern

Future low-frequency, **operator-triggered or test-triggered**
status updates follow the same shape:

```
<thing>_health table  →  recordX() UPSERT with freshness guard
  + config-fingerprint match  →  projection on the public route
```

Likely next consumers: **MCP server health** (config-add pings),
**agent capability probes** (binary version + capability
discovery on cli-acp-agent presets), and similar. The pattern
codifies how to keep current-state projections in `state.db`
without conflating them with the run ledger.

**Hedge — what this pattern does NOT fit.** High-frequency
telemetry, push-based heartbeats, and live process-state
observation may need different patterns (a circular buffer, an
event stream, an in-memory cache rather than an on-disk table,
etc.). ADR-0020 does NOT preclude those — it just doesn't claim
to be the right shape for them. Future statusful surfaces should
weigh the update frequency before reaching for the
`<thing>_health` template.

### Algorithm versioning posture

If a future schema change alters `fingerprintConnectorConfig`'s
algorithm (SHA-256 → BLAKE3, new validation-relevant field) or
`fingerprintFromInstanceConfig`'s redaction rule, the change
owner does NOT have to preserve old fingerprints. Existing rows
will harmlessly mismatch and fall back to "not tested" until
re-tested. **No backwards-compatibility tax is required.**
Operators see one "not tested" prompt after the upgrade; one
click of Test resolves it.

### Preset-default change effect

If a shipped preset's defaults change between Agentic OS versions
(e.g. `presets/openai.json` updates its default `model`), the
effective config fingerprint for any operator-instance using that
preset will change at the next hydration, omitting
`lastValidation` until the connector is re-tested. Acceptable and
safer than showing stale validation — preset-default changes
typically reflect real changes in what the test would do.

### Connector deletion — best-effort, not atomic

When M4a-6b ships the `DELETE /api/connectors/[id]` route, the
handler does a **best-effort** `connectorHealth.delete(connectorId)`
after config removal succeeds. Failure is harmless because
`GET /api/connectors` iterates connectors from `config.yaml`, so
an orphaned health row never surfaces.

**This is NOT a cross-store atomic transaction** —
`config.yaml` (file) and `state.db` (SQLite) are different stores
and FU5 makes no claim of joint-commit semantics across them. The
M4a-6b PR B reviewer note in `m4a-fu5-task-spec.md` §6 carries
this forward to whoever ships the DELETE handler.

## Consequences

**Positive**

- Validation outcomes survive browser refresh AND server restart.
  Operators no longer re-test every connector after every reload.
- The `connector_health` projection is queryable: future surfaces
  (a "connectors at a glance" dashboard, an event stream of
  config-test failures, etc.) can read it without re-running tests.
- The `<thing>_health` template gives future statusful surfaces
  a reviewable shape — MCP server health, agent capability probes,
  and so on don't each reinvent persistence.
- The audit / projection roles stay distinct: ADR-0009 (audit
  JSONL = what happened) and ADR-0014 (state.db = current state)
  remain the partition. FU5 doesn't blur them; it adds one row
  per connector to the projection side.

**Negative**

- One more table on the projection side to keep in sync with the
  audit log. The "swallow on failure" rule means the projection
  can drift if writes start failing silently; operators would see
  this as "not tested" reappearing in rows they recently tested
  (an unusual symptom, but possible). A future hardening item is
  a periodic reconcile / lint that compares the projection
  against the latest audit lines.
- Edited-config rows fall back to "not tested" with no separate
  UI affordance (spec O8 default). An operator who edited their
  config and didn't realise re-testing was needed gets a "not
  tested" row instead of "edited — re-test recommended." Pin a
  richer state only if a future operator complaint demands it.
- Down-grading to a pre-FU5 build refuses to open the v2 DB
  (forward guard in `migrations.ts`). Operators rolling back must
  restore the pre-migration backup (`state.db.bak-v1`, taken by
  the migration runner).

**Neutral**

- Capabilities for a build-failure fingerprint come from
  `instanceConfig.capabilities ?? []` (no family-max merge),
  because family resolution may itself have failed on the
  failure path. Both ends use the same rule.
- The fingerprint MUST be computed from the SAME instance config
  the family ran against — `runConnectorTest` reads from the
  captured `buildConnectorContext` output, not from disk, so a
  mid-test config edit can't poison the row. Hydration on a
  config-changed scenario falls back to "not tested" via the
  fingerprint mismatch.

## Alternatives considered

- **Extend `runs.validation_json` (Path A1).** Rejected — mixes
  history and current state in one column; the run ledger is a
  history surface and shouldn't be queried as a current-state
  projection.
- **Lossy `RunLedger.latestConnectorTest` query (Path B).**
  Rejected — the run record stores the outcome category, not the
  full `ConnectorValidation` shape (errorCode + detail), so the
  status granularity is lost. The pattern also doesn't generalise
  (every future `<thing>_health` would need its own bespoke
  lossy query). The route's hydration would do an O(connectors)
  lookup over the runs table on every request; a denormalised
  current-state table is O(1) per connector.
- **Backfill from the runs table on FU5 deploy (spec §13 O3).**
  Rejected — lossy on the discriminant. Operators see "not
  tested" once on the next refresh after FU5 ships, then click
  Test once; that's a 200ms one-time cost vs. shipping
  permanently-stale data that *looks* like a real test outcome.
- **Backfill from the audit JSONL (v1.1 §13 O3 extension).**
  Rejected — the audit log is **append-only and not a query
  source** (ADR-0009 / ADR-0014). Reading it to reconstruct
  `connector_health` would invert the architectural
  relationship; O(log size) per cold-start is the wrong shape
  for a request-path hydration.
- **Single helper that the testConnection write site and the
  hydration read site BOTH call to recompute the fingerprint.**
  Considered, partially adopted — the route uses
  `computeCurrentFingerprint`, which dispatches to the two
  atomic helpers; `testConnection` already has the resolved
  build context and calls the atomics directly. Equivalent
  outcome (same hash for the same state); the two ends are
  asserted symmetric.
- **Use a constant sentinel for redacted secret-looking values.**
  Rejected — would make the fingerprint unable to detect a
  changed secret value. The current rule
  (`[redacted:<sha16-of-JSON-stringified-value>]`) is
  irreversible AND value-sensitive, so editing a secret still
  invalidates the row (proven by `tests/connector-test-run-
  persists-health.test.ts::editing a SECRET-LOOKING value also
  changes the fallback fingerprint`).

## References

- ADR-0009 — JSONL audit log (source-of-truth for *what happened*).
- ADR-0014 — Persistence four-store split (pre-names
  `connector_health` as a future table; this ADR ships it).
- ADR-0016 — Run ledger foundation (extended; `runs.created_at`
  is the freshness source).
- ADR-0017 — Connector runtime + authRef (the authRef shape this
  fingerprint hashes the identity of).
- ADR-0018 — Connector preset catalog (preset-default change
  effect referenced above).
- `agentic-os-expandability-foundation-v8.md` §7.2 — names the
  `<thing>_health` denormalised-current-state pattern.
- `docs/specs/expandability-foundation/m4a-fu5-task-spec.md` v1.1
  (CODE COMPLETE) — full design + tests + acceptance.
- `docs/M4A5-ACCEPTANCE.md` Step 8 — operator acceptance flow
  (rewritten in PR B; passed 2026-05-24).
- `src/kernel/state/migrations.ts` — `MIGRATION_2_CONNECTOR_HEALTH`.
- `src/kernel/connectors/connectorHealth.ts` — `ConnectorHealthStore`.
- `src/kernel/connectors/connectorFingerprint.ts` — the two
  atomic helpers + `computeCurrentFingerprint`.
- PRs #38 (spec), #39 (PR A kernel), #40 (PR B route + UI),
  and this closeout PR.
