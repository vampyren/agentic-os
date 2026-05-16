# Architecture Decision Records

This directory holds the architectural decisions for Agentic OS. Each ADR captures one decision, the context that forced it, the options considered, and the consequences.

## Format

A lightweight MADR-style template:

```markdown
# ADR-NNNN — Short decision title

**Status:** Accepted | Superseded by ADR-XXXX
**Date:** YYYY-MM-DD

## Context
The forces at play, the constraints, the existing reality.

## Decision
What we're doing.

## Consequences
What changes — positive, negative, neutral.

## Alternatives considered
Each option and why it was rejected.
```

## Rules

- ADRs are **immutable once accepted**. Don't edit history — write a new ADR that supersedes the old one.
- Numbers are monotonic. Skipping numbers is fine (e.g., if an ADR was drafted and abandoned), reusing numbers is not.
- A PR that contradicts an existing ADR must include a superseding ADR in the same PR.
- Short is better. If an ADR is over 200 lines, it's probably trying to be a design doc — move the design into `docs/` and keep the ADR focused on the decision.

## Current ADRs

| # | Title | Status |
|---|---|---|
| 0001 | Claude Code subprocess is the default transport | Accepted |
| 0002 | Agent registry and Transport interface | Accepted |
| 0003 | In-process event bus with single SSE endpoint | Accepted |
| 0004 | SQLite FTS5 index, markdown stays source of truth | Accepted |
| 0005 | Vault inbox-first contract for agent writes | Accepted |
| 0006 | Rebuild on new architecture instead of forking Julian's v0.1 | Accepted |
