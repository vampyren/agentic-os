# ADR-0011 — Missions return outputs; a central runner persists them

**Status:** Accepted
**Date:** 2026-05-20

## Context

Phase 1C makes missions (daily-summary, weekly-review, vitals-heartbeat,
and future ones) the first consumer of the integration spine. A mission
needs to produce results — typically a vault note, sometimes a bus
event. The naïve design lets a mission write its own files.

That is the wrong contract. If every mission touches the filesystem
directly, the vault-output allowlist, audit, conflict policy, and
path-safety checks must be re-implemented (and can be forgotten) in
every mission. The vault inbox-first contract (ADR-0005) only holds if
there is a single chokepoint.

## Decision

A mission's `run()` **returns** a `MissionRunResult`; it never performs
side effects itself.

`MissionRunResult` is a discriminated union over `success | skipped |
failed`. A `success` carries `MissionOutput[]` — itself a discriminated
union:

- `{ kind: "vault-note"; outputFolder; filenameHint; frontmatter?;
  content; conflictPolicy? }`
- `{ kind: "event"; eventKind; payload }`

A central **mission runner** (Phase 1C M4) consumes `MissionOutput[]`:
- a `vault-note` is written through the **constrained writer**, which
  enforces the `00_Inbox/agentic-os/...` output allowlist
  (`src/lib/vaultPaths.ts`, branded `VaultRelativePath`) and a
  realpath/symlink-escape check at write time;
- an `event` is validated and emitted on the bus.

`MissionContext` gives a mission read-only vault access, the capability
router, a bus handle, a logger, and an `AbortSignal` — but no write
path. The mission cannot write even if it wants to.

Phase 1C M3 ships the mission type system, registry, effective-plan
resolver, and three **stub** missions whose `run()` returns well-formed
`MissionOutput[]` with no real logic. The runner + constrained writer
land in M4.

## Consequences

**Positive**
- One chokepoint for every vault write — allowlist, audit, conflict
  policy, and path safety are enforced once, in the runner/writer.
- Missions are trivially testable: assert on the returned object, no
  filesystem fixture needed.
- The `event` output kind lets a mission (vitals-heartbeat) produce a
  bus signal with no file at all.

**Negative**
- A mission cannot do a streaming/incremental write. Acceptable —
  missions are batch summarisers, not streams.

**Neutral**
- The `vault.note.write` capability exists in the `CapabilityId` enum
  but has no provider until M4; it must route through the same
  constrained writer — never a second vault-write path.

## Alternatives considered

- **Missions write their own files.** Rejected — see Context; defeats
  the single-chokepoint guarantee.
- **A single `MissionResult` with an optional `drafts[]`.** Rejected —
  the discriminated `MissionOutput` union makes the event-only case
  (vitals-heartbeat) clean and gives free TypeScript narrowing.

## References

- ADR-0005 — vault inbox-first contract.
- ADR-0010 — Phase 1C registry triad.
- `PHASE-1C-DESIGN-CONSOLIDATED-v2.md` §2.5, §7.
