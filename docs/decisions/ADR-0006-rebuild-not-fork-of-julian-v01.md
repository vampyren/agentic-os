# ADR-0006 — Rebuild on new architecture instead of forking the v0.1 prior art

**Status:** Accepted
**Date:** 2026-05-16
**Updated:** 2026-05-16 (removed all references to the reference build's binary; it is AIPB members-only material and is not redistributed in this repository)

## Context

A working Next.js 16 dashboard for managing AI agents — `agentic-os v0.1` — was distributed inside AI Profit Boardroom (AIPB) as a member-only resource by Julian Goldie. The operator was a member at the time and used it as the inspiration for this project. **That build is not redistributed here.** Its license explicitly prohibits redistribution; this repository contains original MIT-licensed code only.

The v0.1 build was useful to audit during the design phase. It implemented streaming Claude chat, Hermes/OpenClaw subprocess bridges, vault read/write, vitals, an activity stream, a command palette, and a goals/journal UI in roughly 2,500 lines. It is a credible single-developer prototype.

Three options for our relationship to it:

1. **Fork v0.1 and refactor in place.** Inherit the working UI and incrementally rebuild the kernel.
2. **Re-pour onto a new architecture.** Read v0.1 for design inspiration; build a fresh codebase that mirrors the look-and-feel but is built on the abstractions in ADR-0002 / ADR-0003 / ADR-0004 / ADR-0005.
3. **Run v0.1 as-is alongside a new headless kernel service.** Two processes, eventual integration.

This project's goals require the agent registry (ADR-0002), the event bus (ADR-0003), a real search index (ADR-0004), and the inbox-first vault contract (ADR-0005). The v0.1 build's architecture contradicts all four:

| v0.1 reality | Required by ADR |
|---|---|
| `AgentName = "claude" \| "openclaw" \| "hermes"` referenced in 6+ files | ADR-0002 (registry kills hardcoded enum) |
| REST polling for vitals and activity | ADR-0003 (single SSE off a bus) |
| Linear `indexOf` over every `.md` in the vault | ADR-0004 (SQLite FTS5) |
| Writes to a top-level `Agentic OS/` subfolder with type/date tags | ADR-0005 (inbox-first, approved tags only) |
| 15-second hardcoded subprocess timeout for non-streaming calls | Architecture requires per-transport timeouts |
| Hardcoded `ClaudePanel` / `HermesPanel` / `OpenClawPanel` | Manifest-driven generic panel + opt-in custom |
| No MCP | Roadmap Phase 2C |
| No scheduler | Roadmap Phase 1C |
| No event bus | ADR-0003 |

Each line is touchable by a refactor. The aggregate is a rewrite — and a rewrite of someone else's code that we can't ship publicly is a worse starting point than a clean original codebase.

## Decision

**Option 2: re-pour on a new architecture.** Specifically:

- A fresh `src/` tree built around the abstractions in ADR-0002, ADR-0003, ADR-0004, ADR-0005. All MIT-licensed original work.
- The reference v0.1 build is **not redistributed** in this repository. Anyone wanting to study it should obtain it through the original AIPB channel.
- The UI aesthetic from v0.1 (aurora gradients, glass panels, pill statuses) is re-implemented from observation, not copy-pasted. This keeps the new code free of v0.1's hardcoded assumptions and free of any copied source.
- Stack choices we share with v0.1 (Next.js 16, React 19, Tailwind v4, Framer Motion, lucide-react, cmdk, react-markdown) are conventional choices we'd have picked independently; no IP issue.
- Credit Julian Goldie in the README for the conceptual model.

## Consequences

**Positive**

- The kernel is clean from day one. No legacy assumptions leak in via refactor-survivors.
- Test coverage starts at 100% of the new code, not 5% of a refactored legacy.
- The agent registry, event bus, FTS5 index, and inbox-first writer all land as designed.
- No license overhead: the codebase is purely our own original work under MIT.
- The reference build stays where it belongs — in the AIPB members-only distribution channel.

**Negative**

- Phase 1A takes longer to reach the same visible feature set as the reference build. Re-implementing UI eats time even though it mostly looks similar.
- We lose the ability to cite specific files in the v0.1 codebase in design discussions. Working around this with prose descriptions instead.

**Neutral**

- License compatibility: v0.1 is AIPB members-only ("for AIPB members only, not for redistribution"). Our position is unambiguous: we don't distribute it, fork it, or include any of its files. The architecture decisions captured in this ADR were made by reading v0.1 as a member and building something different.

## Alternatives considered

- **Option 1 — Fork and refactor.** Rejected: the v0.1 license forbids redistribution, so a public fork is not legally available. And even if it were, every ADR in this repo would land as "ripped out v0.1's X." High noise, hard to enforce clean abstractions.
- **Option 3 — Run v0.1 as-is alongside a new headless kernel.** Rejected: doubles operational surface for no benefit, and still depends on the unredistributable binary.

## References

- [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) — the architecture this rebuild realizes.
- The reference v0.1 build is available only through the AIPB members-only distribution; intentionally not linked from here.
