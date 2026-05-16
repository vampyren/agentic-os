# ADR-0007 — Phase 1 narrow MVP, split into 1A / 1B / 1C

**Status:** Accepted
**Date:** 2026-05-16
**Supersedes:** the original "Phase 1" definition in `docs/ROADMAP.md` (now rewritten).

## Context

The original Phase 1 in `docs/ROADMAP.md` bundled:

- Next.js scaffold
- REST API
- SSE event bus
- agent registry
- two transports (subprocess + streamJson)
- vault reader + writer
- SQLite FTS5 index
- chokidar watcher
- health probes + vitals UI
- activity stream UI
- goals page + journal page + memory page
- setup wizard
- audit log
- styled Mission Control UI (Tailwind + Framer Motion + cmdk)
- vitest + Playwright in CI

That's roughly 3-4 weeks of work for a single contributor. More importantly, it's a wide blast radius: a regression in any one component is hard to isolate when twelve other components also went in for the first time. External review (ChatGPT, 2026-05-16) called this out:

> Otherwise Claude Code may create a big scaffold with many half-working pieces.

The review is right. Phase 1 needs to ship in slices small enough to review end-to-end before adding the next.

## Decision

Split Phase 1 into three slices, each independently shippable. Each slice has its own exit criteria; we do not start the next until the prior signs off.

### 1A — Kernel skeleton

The minimum spine: config loader, agent registry, two transports, event bus + SSE, vault writer (inbox-first + atomic), JSONL audit, and an **intentionally unstyled** UI that proves the kernel works end-to-end with one real agent (Claude Code). Test scaffolding from day one (vitest + 3 unit tests, in CI).

### 1B — Operator UX

Port Julian's aesthetic. Add health probes, vitals, activity stream, goals/journal/memory pages, the SQLite FTS5 index + chokidar watcher, and the setup wizard. Playwright smoke tests.

### 1C — Scheduler

`node-cron` + missions. Built-ins for daily summary, weekly review. The scheduler is opt-in via config — disabled by default so 1B can run without it.

Full scope of each slice lives in `docs/ROADMAP.md`.

## Consequences

**Positive**

- The kernel API (`Registry.get(name).chat(...)`) gets reviewed in isolation before any UI work invests in its shape. Catching a bad API in 1A is cheap; catching it after the UI is built around it is expensive.
- 1A is small enough that an external reviewer (you, ChatGPT, anyone) can read every file in one sitting.
- Each slice's exit criteria are testable, not vibes.
- "Intentionally ugly UI in 1A" prevents wasting time on Tailwind animations before the kernel is proven.
- The split makes it possible to **deliver 1A and stop** if priorities change — the user still has a working agent runner, just without the polish.

**Negative**

- More commits / more PR cycles than a single Phase 1 chunk.
- The 1A UI will look bad. Operator has to know this is deliberate.
- Some integration bugs (e.g., "the event bus and the vitals card don't talk to each other quite right") only surface when both exist — they get pushed to 1B.

**Neutral**

- Total work doesn't shrink; just chunked differently.

## Alternatives considered

- **Keep the original wide Phase 1.** Rejected per the Context above.
- **Ship even smaller — 1A as just "the registry," 1B as "transports," 1C as "vault."** Rejected as over-decomposition. The kernel only proves out when something can flow end-to-end (config → registry → transport → vault → audit → UI). Splitting smaller than that defeats the "review a working slice" goal.
- **Combine 1A and 1B, keep 1C separate.** Rejected — the UI port and SQLite index are themselves big enough to deserve their own review window.

## References

- `docs/ROADMAP.md` — full scope of each slice.
- External review by ChatGPT, 2026-05-16 (filed via operator in the planning conversation).
