# Expandability Foundation Specs

This folder holds the detailed design and milestone execution specs for the
Agentic OS expandability foundation work — the layer that turns the kernel
skeleton (Phase 1A/1B/1C) into a feature-and-connector platform.

**Repo is the source of truth for accepted Agentic OS specs.** These files
are immutable history from the moment they ship — execution traces, not
working drafts. Obsidian holds product intent, project memory, working
drafts, and operator handoff. See [`docs/MAINTENANCE.md`](../../MAINTENANCE.md)
for the full split.

Use this folder when you need:

- the **architecture lock** for the foundation (`agentic-os-expandability-foundation-v8.md`);
- a per-milestone **task spec** decomposed into reviewable PR-sized work units;
- a faithful record of what each milestone shipped, with the merged PRs and
  closeout artefacts cross-referenced.

Keep `docs/ARCHITECTURE.md` and `docs/ROADMAP.md` concise; link here instead
of pasting long execution details into those overview documents.

## Status table

Status values:
**complete** — code shipped + closeout merged + acceptance passed;
**active** — code in flight or in review;
**parked** — design accepted but execution gated on a future decision;
**superseded** — replaced by a later spec or an ADR.

| Spec | Status | Related PRs / commits | Canonical next step |
|---|---|---|---|
| [`agentic-os-expandability-foundation-v8.md`](agentic-os-expandability-foundation-v8.md) | active (M1–M4a complete; M5–M10 outstanding) | PRs #11, #12, #13, #14, #15, #16, #17, #18, #19, #20, #21, #22, #23, #26 | After M5 ships, fold an "Implementation status" header refresh. |
| [`m1-task-spec.md`](m1-task-spec.md) | complete | PR #11 (merge `35b6f26`); fix `67d1c04` | None — final. |
| [`m2-task-spec.md`](m2-task-spec.md) | complete | PR #12 (merge `0ae4070`); side-fix PR #13 (`bda3145`) | None — final. |
| [`m3-task-spec.md`](m3-task-spec.md) | complete | PR #14 (state DB), PR #15 (RunLedger + restart recovery), PR #16 (`/api/runs` + scheduler wiring), closeout PR #17 | None — final. |
| [`m4-task-spec.md`](m4-task-spec.md) | complete | PR #18 (M4a-1), PR #19 (M4a-2), PR #20 (M4a-3a), PR #21 (M4a-3b), PR #22 (M4a-3c), PR #23 (M4a-4), closeout PR #26 | None — final. Live `docs/M4A-ACCEPTANCE.md` checklist passed 2026-05-23. |
| [`m4a-5-task-spec.md`](m4a-5-task-spec.md) | parked (design only — v1.2) | None merged (issue #24 folds in; issue #27 = HTTP capability-invoke route) | Rex decides M4a-5 PR AB vs M5 directly. Optional — may be deferred until after M5. |
| [`m4a-6-task-spec.md`](m4a-6-task-spec.md) | parked (design only — v1 draft) | None — provider picker + UI-managed connector secrets; OAuth + native vendor families explicitly deferred | M4a-5 closeout merge + M4a-5 operator acceptance tick + Rex green-light on PR A (secret store + authRef extension). |

## Naming caveat

The expandability foundation's `M1`-`M4a` numbering is **distinct from** the
pre-existing Phase-1C `M1`-`M4` numbering on the legacy roadmap
([`docs/ROADMAP.md` §Phase 1C](../../ROADMAP.md#phase-1c--scheduler-and-missions))
that refers to the mission-runner / scheduler work shipped in v0.3.0
(PRs #8, #9, #10). The two milestone series are unrelated; the
expandability foundation is layered ON TOP of the Phase-1C kernel.

## Placement rule

- Large design specs and milestone task specs belong **here**
  (`docs/specs/expandability-foundation/`).
- Short, durable decisions belong in [`docs/decisions/`](../../decisions/)
  as ADRs.
- Current-state architecture summaries belong in
  [`docs/ARCHITECTURE.md`](../../ARCHITECTURE.md).
- Acceptance checklists for completed milestones belong as flat docs at
  `docs/*.md` (e.g. [`docs/M4A-ACCEPTANCE.md`](../../M4A-ACCEPTANCE.md)).

When a spec is superseded, mark its status in the table above and add a
**Superseded by** line to the spec header — don't delete the file.
