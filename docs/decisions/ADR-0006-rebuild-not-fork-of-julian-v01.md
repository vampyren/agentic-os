# ADR-0006 — Rebuild on new architecture instead of forking Julian's v0.1

**Status:** Accepted
**Date:** 2026-05-16

## Context

Julian Goldie's `agentic-os v0.1` (kept in `source-julian/agentic-os-v0.1.zip`) is the inspiration for this project. It ships a working Next.js 16 dashboard with streaming Claude chat, Hermes/OpenClaw bridges, vault read/write, vitals, activity stream, command palette, and a goals/journal UI. It's a credible single-developer prototype, roughly 2,500 lines.

Three options for our relationship to it:

1. **Fork v0.1 and refactor in place.** Inherit the working UI and incrementally rebuild the kernel.
2. **Re-pour onto a new architecture.** Keep v0.1 in `source-julian/` as reference; build a fresh codebase that mirrors v0.1's UI aesthetic but is built on the abstractions in ADR-0002 / ADR-0003 / ADR-0004 / ADR-0005.
3. **Run v0.1 as-is alongside a new headless kernel service.** Two processes, eventual integration.

This project's goals require the agent registry (ADR-0002), the event bus (ADR-0003), a real search index (ADR-0004), and the inbox-first vault contract (ADR-0005). v0.1 contradicts all four directly:

| v0.1 reality | Required by ADR |
|---|---|
| `AgentName = "claude" \| "openclaw" \| "hermes"` referenced in 6+ files | ADR-0002 (registry kills hardcoded enum) |
| REST polling for `/api/vitals` and `/api/activity` | ADR-0003 (single SSE off a bus) |
| Linear `indexOf` over every `.md` in the vault | ADR-0004 (SQLite FTS5) |
| Writes to `Agentic OS/` subfolder with type/date tags | ADR-0005 (inbox-first, approved tags only) |
| 15-second hardcoded subprocess timeout for non-streaming calls | Architecture requires per-transport timeouts |
| `OpenClawPanel`, `HermesPanel`, `ClaudePanel` hardcoded per-agent | Manifest-driven generic panel + opt-in custom |
| No MCP | Roadmap Phase 2 |
| No scheduler | Roadmap Phase 2 |
| No event bus | ADR-0003 |

Each line is touchable by a refactor. The aggregate is a rewrite.

## Decision

**Option 2: re-pour on a new architecture.** Specifically:

- A fresh `src/` tree built around the abstractions in ADR-0002, ADR-0003, ADR-0004, ADR-0005.
- v0.1 stays in `source-julian/` as reference material. We read it, we steal good ideas, we do not fork it.
- The UI aesthetic (aurora gradients, glass panels, pill statuses, the Mission Control + agent room layout) is **re-implemented** from observation of Julian's components, not copy-pasted. This keeps the new code free of v0.1's hardcoded assumptions.
- Julian's `package.json` stack choices (Next.js 16, React 19, Tailwind v4, Framer Motion, lucide-react, cmdk, react-markdown) are kept — they're good choices, no reason to deviate.
- Credit Julian in the README and acknowledge the v0.1 reference as the spark.

## Consequences

**Positive**

- The kernel is clean from day one. No legacy assumptions leak in via refactor-survivors.
- Test coverage starts at 100% of the new code, not 5% of a refactored legacy.
- The agent registry, event bus, FTS5 index, and inbox-first writer all land as designed instead of as "the closest thing we could squeeze into v0.1 without breaking it."
- v0.1 stays available as a working reference: when the new code has a bug, we can compare behavior side-by-side.

**Negative**

- Phase 1 takes longer to reach the same visible feature set as v0.1. Re-implementing the UI eats time even though it mostly looks the same.
- The operator can't `npm install` and run anything until Phase 1 ships. v0.1 is runnable; the new repo is docs-only for now.
- Risk of NIH-syndrome — re-implementing UI patterns that didn't need re-implementing. Mitigation: keep `source-julian/` open in a tab while building, and call out each "we're doing this differently because..." in a commit message.

**Neutral**

- License compatibility: v0.1 is "for AIPB members only, not for redistribution." We don't distribute or fork it; `source-julian/agentic-os-v0.1.zip` in this repo is reference-only. The new code is MIT and original work.

## Alternatives considered

- **Option 1 — Fork and refactor.** Rejected: every ADR in this repo would land as "ripped out v0.1's X." High noise, easy to leave half-refactored code in place, hard to enforce clean abstractions.
- **Option 3 — Run v0.1 as-is alongside a new headless kernel.** Rejected: doubles operational surface for no benefit. Either v0.1 stays canonical (we never ship the new thing) or the new thing replaces it (in which case Option 2 is cheaper to start from).

## References

- `source-julian/agentic-os-v0.1.zip` — the v0.1 reference build.
- `source-julian/web/page.txt` — the AIPB classroom page that introduced the GOLDIE Mission Stack concept.
- [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) — the architecture this rebuild realizes.
