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
| [`m4a-5-task-spec.md`](m4a-5-task-spec.md) | complete (v1.2 — backend + UI) | PR #29 (PR AB — hardening + backend discovery), PR #30 (PR C — UI picker), PR #34 (post-add UX polish + StatusPill + Settings refresh URL state); issue #24 (M4a-FU1) folded into the spec; #27 (M4a-FU3 — HTTP capability-invoke route) follows separately; #36 (M4a-FU5 — persisted validation status) extends this spec via [`m4a-fu5-task-spec.md`](m4a-fu5-task-spec.md) | None — final. Live `docs/M4A5-ACCEPTANCE.md` checklist passed 2026-05-24 (Step 8 was rewritten by M4a-FU5 PR B; re-passed live 2026-05-24). |
| [`m4a-6-task-spec.md`](m4a-6-task-spec.md) | parked (design only — v2 draft; split into 6a + 6b sub-milestones) | None — **M4a-6a** = provider catalog UI + new presets (one PR, no authRef change, no secret persistence). **M4a-6b** = UI-managed connector secrets (four PRs, secret store + new authRef kind). OAuth + native vendor families explicitly deferred | M4a-5 operator acceptance tick + Rex green-light on **M4a-6a PR** (catalog only — 6b begins after 6a is merged + operator-accepted). |
| [`m4a-fu5-task-spec.md`](m4a-fu5-task-spec.md) | complete (v1.1 — CODE COMPLETE) | PR #38 (spec promotion `009b9db`), PR #39 (PR A kernel — migration v2 `connector_health` + `ConnectorHealthStore` + fingerprint helpers + `runConnectorTest` UPSERT wiring + kernel test-isolation guard, `715b113`), PR #40 (PR B route + UI hydration — `GET /api/connectors` populates `lastValidation` gated on fingerprint match, `ConnectorsPanel.refresh()` hydrates `testResults`, `M4A5-ACCEPTANCE.md` Step 8 rewritten, `636be08`), closeout PR (this one — [ADR-0020](../../decisions/ADR-0020-connector-health-table.md) + `ARCHITECTURE.md` §7 paragraph + `ROADMAP.md` entry + this status row + spec status header bumped). Issue #36 closes on closeout merge | None — final. Live `docs/M4A5-ACCEPTANCE.md` Step 8 (rewritten) passed 2026-05-24. |
| [`m4a-fu6-task-spec.md`](m4a-fu6-task-spec.md) | parked (design accepted — v1; implementation-ready) | None yet — issue #37 (M4a-FU6). Adds an internal `/dev/ui` live visual reference + `docs/UI-GUIDELINES.md` written rules + extracts the connector-test status / trust color tokens. O1–O12 pinned per Rex 2026-05-24 (notably: `/dev/ui` not in operator sidebar; `--status-unknown` stays Mission Control grey while a new `--status-test-unknown` carries connector-test yellow; inline-hex extraction threshold 3+ sites; reviewer checklist lives in `UI-GUIDELINES.md`, no PR template). Four-PR breakdown: A (additive skeleton — route shell + first-draft guidelines + smoke test), B (fill `/dev/ui` sections with live components, mock data only), C (tightly bounded color-token swap — no logic / layout / shape / API / file-move changes), D (closeout — ROADMAP + this row + spec status to CODE COMPLETE + M4a-6a spec reference + short `ARCHITECTURE.md` UI-consistency paragraph). M4a-6a UI work gated on FU6 PR D landing | Rex green-light on **M4a-FU6 PR A** (additive `/dev/ui` skeleton + `docs/UI-GUIDELINES.md` draft + route smoke test). |

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
