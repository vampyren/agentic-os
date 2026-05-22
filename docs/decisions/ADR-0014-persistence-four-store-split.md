# ADR-0014 — Persistence: a four-store split, with a versioned SQLite state DB

**Status:** Accepted
**Date:** 2026-05-22

## Context

Agentic OS holds several kinds of data with very different lifecycles:

- **Canonical user content** — notes, goals, journal entries. Owned by the
  operator, edited in Obsidian, must outlive Agentic OS itself.
- **Mutable platform state** — runs (M3), and later approvals and artifact
  metadata. Transactional, queryable, authoritative; changes constantly.
- **Opaque artifact bytes** — generated media, proposal bodies, diffs. A later
  milestone; named here so the model is complete.
- **The audit trail** — an append-only, immutable record of what happened.

Before M3 only three of these had a home: the markdown vault, the derived
SQLite FTS index (`index.db`), and the JSONL audit log. M3 introduces the run
ledger — the first **mutable platform state** — and it needs a store.

Putting mutable state in the audit JSONL is wrong: the audit log is
append-only and immutable (ADR-0009). Putting it in `index.db` is wrong:
that index is *derived* from the vault and can be deleted and rebuilt at any
time — platform state cannot. Mutable, transactional, authoritative state needs
its own store.

## Decision

Agentic OS persistence is **exactly four stores**, each with one role:

1. **Obsidian markdown vault** — canonical user-facing content. Source of
   truth for notes / goals / journal. (`index.db` is a *derived* FTS index of
   this store — not a fifth store; it is disposable and rebuildable.)
2. **SQLite state DB** — `~/.agentic-os/state.db`. Mutable platform state:
   the run ledger (M3 — `runs` / `run_steps` / `external_refs`), and later
   approvals, artifact metadata, orchestration. Transactional and queryable.
3. **Filesystem artifacts** — `~/.agentic-os/artifacts/<featureId>/...`. Opaque
   bytes, served only through guarded routes. Slot named now; implemented in
   its own milestone.
4. **JSONL audit log** — `~/.agentic-os/audit/YYYY-MM-DD.jsonl`. Append-only,
   immutable, neutral-metadata-only (ADR-0009). **Never moved into SQLite.**

The state DB carries a **`stateDbVersion`** in a `_meta` table. An ordered
migration runner brings the schema up to date when the DB is opened; a
**forward guard** refuses to use a DB stamped newer than the running build
(rather than corrupting it); a **WAL-safe `db.backup()`** snapshot is taken
before any migration applies. Each milestone appends exactly one migration;
shipped migrations are immutable.

The run ledger and the audit log stay independent and are joined only by
`runId`: the ledger is the queryable mirror, the audit JSONL line is the
source-of-truth record.

## Consequences

**Positive**
- Every data kind has one unambiguous home; no lifecycle is conflated with
  another.
- The state DB can be migrated and backed up without touching the vault or the
  audit trail.
- The forward guard stops an older build from silently corrupting a DB written
  by a newer one.

**Negative**
- Two SQLite files now exist (`index.db` derived, `state.db` authoritative).
  Acceptable — they have different lifecycles and rebuild stories.

**Neutral**
- The artifacts store (#3) is named but unimplemented until its milestone.
- A second write path (the ledger) sits alongside the audit log; M3 makes
  ledger writes non-fatal so the audit log remains authoritative (ADR-0016).

## Alternatives considered

- **One SQLite database for everything, including audit.** Rejected — couples
  the immutable append-only audit trail with constantly-mutating transactional
  state. ADR-0009's reasons for JSONL audit still hold.
- **Run state as JSON files on disk.** Rejected — no transactions, no indexed
  queries, no clean way to represent in-flight state or restart recovery.
- **Reuse `index.db` for state.** Rejected — `index.db` is derived and
  disposable by design; authoritative state must not live in a rebuildable
  cache.

## References

- ADR-0009 — JSONL audit log, one file per day.
- ADR-0016 — Run ledger foundation.
- `agentic-os-expandability-foundation-v8.md` §7.1–§7.4.
- `docs/ARCHITECTURE.md` §7 (state store and run ledger).
