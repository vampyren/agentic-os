# ADR-0009 — JSONL audit log, one file per day

**Status:** Accepted
**Date:** 2026-05-16

## Context

The original SECURITY.md design specified a single append-only plain-text audit log at `~/.agentic-os/audit.log` with rotation after 30 days. That works for a console-tail debugging workflow but has three problems at any scale:

1. **Not machine-parseable.** Building a UI that filters audit entries by agent or kind means writing a fragile line parser.
2. **One file rotated daily** still grows linearly within the day. A chatty operator on a multi-agent setup could write tens of thousands of lines per day to a single file the kernel keeps re-opening.
3. **Hard to ship to durable storage later.** If the operator ever wants to ingest the audit log into a SQLite table, a timeseries DB, or just `jq` it from the shell, JSON-per-line is dramatically easier than parsing a custom text format.

External review (ChatGPT, 2026-05-16) suggested JSONL with a per-day file layout. The suggestion is correct.

## Decision

The audit log is JSONL (newline-delimited JSON), one file per UTC day:

```
~/.agentic-os/audit/YYYY-MM-DD.jsonl
```

Each line is one JSON object. Required envelope fields:

```json
{ "ts": "ISO8601 UTC", "kind": "<event-kind>", ... event-specific fields ... }
```

**Event kinds (initial set):**

- `agent.invoke` — start of an agent call. Includes `agent`, `transport`, `command`, `argsRedacted`, `promptSha256`, `promptChars`.
- `agent.invoke.complete` — end. Adds `status`, `exitCode`, `durationMs`, `bytesOut`.
- `agent.invoke.error` — failed call. Adds `status` (e.g., `"missing-secret"`, `"timeout"`, `"transport-error"`) and a sanitized `message`.
- `vault.write` — `agent`, `path`, `action` (`create` / `append` / `promote`), `bytes`.
- `vault.promote` — `from`, `to`, `templateApplied`.
- `secrets.read` — `keyPath`, `requester`. No secret value, ever.
- `verb.run` — operator-triggered CLI verb. `agent`, `verb`, `exitCode`, `durationMs`.
- `mission.run` — `name`, `cronExpr`, `status`, `durationMs`.
- `system.boot` — startup. Records loaded manifests and config hash.
- `system.shutdown` — clean shutdown.

**Redaction (hard rules, see SECURITY.md):**

- Prompts: never stored. Only `promptSha256` (first 8 hex chars are fine) and `promptChars`.
- Secret-bearing args (anything matching a known secret env var name): replaced with `[REDACTED]`.
- HTTP headers carrying `Authorization` / `x-api-key`: stripped.
- HTTP bodies: never logged. Only metadata (`bytesIn`, `bytesOut`, `durationMs`).

**Rotation:** one file per UTC day. Files older than `audit.retentionDays` (default 30) are deleted on kernel boot. Setting `audit.retentionDays: 0` disables deletion (keep forever).

**Writes:** append-only, `fsync` on each line (best-effort; OS-dependent). A crashed write loses at most the in-flight line.

## Consequences

**Positive**

- `jq` works out of the box: `jq 'select(.kind == "vault.write")' ~/.agentic-os/audit/2026-05-16.jsonl`.
- Per-day files keep individual files small enough to open in any editor.
- Easy to ship to SQLite later (Phase 1B's FTS5 index can ingest audit JSONL on the side to power a dashboard activity view).
- Deletion of old logs is a simple file-level operation, not a log-rotation tool.
- The envelope is extensible: new event kinds get added without breaking old parsers.

**Negative**

- Slightly more disk overhead per record vs. plain text (JSON keys repeated on every line).
- A daily file boundary at UTC midnight means an event near midnight in the operator's timezone lands in a file whose name doesn't match the operator's day. Documented; not worth a timezone-aware rollover.

**Neutral**

- Operators who really want a tail-friendly console view can still get it with `jq -r '... | "\(.ts) \(.kind) \(.agent // "-")"' audit/2026-05-16.jsonl`.

## Alternatives considered

- **One plain-text log, rotated daily.** What the original SECURITY.md said. Rejected — see Context.
- **SQLite database for audit.** Overkill. Adds the watcher/migration headache of a real DB to a log that's append-only by definition. The Phase 1B FTS5 index can read JSONL files instead.
- **Send to an external log shipper (Loki, Vector).** Out of scope. Localhost-only architecture; no external services in Phase 1.

## References

- `docs/SECURITY.md` — secrets and redaction rules.
- External review by ChatGPT, 2026-05-16.
