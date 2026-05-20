# ADR-0012 — Capability Router returns neutral, non-secret-bearing results

**Status:** Accepted
**Date:** 2026-05-20

## Context

The Capability Router (ADR-0010) resolves a capability to a connector
and delegates. A connector can fail two ways: it can **throw**, or it
can **return** `{ status: "failed", ... }`. A connector's failure
detail — `message`, `errorCode`, `metadata` — is untrusted: it may
carry an API key, a private filesystem path, command args, or the
caller's input echoed back.

The router file promises neutral skipped/error results. The first M2
implementation kept that promise only for *thrown* errors (collapsed in
a `catch`); a *returned* failed result passed `message` and `metadata`
straight through. PR #8 review (B2) caught the gap before merge.

## Decision

The Capability Router neutralises **both** failure paths identically.

- **Thrown error** → caught; result is `{ status: "failed", capability,
  connectorId, errorCode: "connector-invoke-threw", message: <generic> }`.
  The raw error is never echoed.
- **Returned `{ status: "failed" }`** → the connector's own `message`,
  `errorCode`, and `metadata` are **dropped**. Result is `{ status:
  "failed", capability, connectorId, errorCode:
  "connector-returned-failure", message: <generic> }`.
- **Skipped** (no provider, disabled connector, unknown `connectorId`
  override, connector without `invoke`) → `{ status: "skipped",
  capability, message: <generic> }`. The requested `connectorId` is not
  echoed back.

A connector's own `message`/`errorCode`/`metadata` is never trusted to
be secret-free, so none of it crosses the router boundary on failure.

`success` results may still pass `output` and `metadata` through —
those are the point of the call. (A future ADR may tighten success
metadata; M2 scoped the fix to failures, the actual leak surface.)

Test enforcement (`tests/capability-router.test.ts`): a connector that
throws — and a connector that returns a failed result — both planted
with a fake secret / private path / echoed prompt; the serialised
router response is asserted to contain none of them.

## Consequences

**Positive**
- A future connector author cannot accidentally leak a secret by
  returning (rather than throwing) a detailed failure.
- The router's neutrality promise is now total across both failure
  paths and verified by tests.

**Negative**
- A returned failure's connector-specific diagnostic detail is lost at
  the router boundary. Acceptable — diagnostics belong in the
  connector's own (redaction-aware) logging, not in a result object
  that flows up to features and the UI.

**Neutral**
- `ConnectorResult` currently supports only `success | failed`; the
  router maps any non-success to a neutral failure. If a connector ever
  needs a legitimate `skipped`, both `ConnectorResult` and the router
  must be updated together.

## Alternatives considered

- **Pass the connector's failure detail through.** Rejected — the leak
  PR #8 review flagged.
- **Redact the connector's message in place** (regex-scrub secrets).
  Rejected — brittle; a denylist of secret shapes always misses cases.
  Dropping the field entirely is the only reliable neutralisation.

## References

- ADR-0010 — Phase 1C registry triad.
- `PHASE-1C-DESIGN-CONSOLIDATED-v2.md` §10 (security rules).
- PR #8 consolidated review, blocker B2.
