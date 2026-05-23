# Docs maintenance

Short, binding rules for keeping the Agentic OS docs honest. Read this once
before opening any docs-touching PR.

## Two sources, one rule each

**Repo docs are implementation truth at a commit.** Anything in this repo
under `docs/` is what shipped (or what will ship in this branch). If a spec
disagrees with what is on disk in the same commit, fix one of them — never
let both stand.

**Obsidian is product intent, project memory, working drafts, and handoff.**
Anything that is a sketch, an alternative under consideration, a session
log, a pre-acceptance review note, or the operator's personal next-step
list belongs in the Obsidian vault — not in the repo.

The boundary between the two is **acceptance**. The moment a spec is
accepted, it gets committed to the repo. The moment a decision is locked,
it gets written as an ADR. Working drafts stay in Obsidian until that
acceptance moment.

## What goes where

| In-repo location | Holds | Mutability |
|---|---|---|
| `docs/ARCHITECTURE.md` | Current-state architecture summary. | Edited every milestone. |
| `docs/ROADMAP.md` | Phase and milestone roadmap, status. | Edited every milestone. |
| `docs/decisions/ADR-NNNN-*.md` | One locked decision, with context and consequences. | **Immutable** once accepted. Supersede with a new ADR. |
| `docs/specs/<area>/` | Detailed design specs + milestone task specs. | Status header is updated as a milestone advances; body stays as the executed plan. |
| `docs/<MILESTONE>-ACCEPTANCE.md` | Operator-side acceptance checklist for one milestone. | Created at closeout; immutable after sign-off. |
| `CONTRIBUTING.md`, `docs/CONTRIBUTING.md` | How to contribute (code + docs). | Edited as conventions evolve. |
| Obsidian vault | Drafts, session handoff, intent, ideation, review notes. | Whatever the operator wants. |

## Accepted specs must be committed

If a spec is reviewed and accepted, it lands in the repo **before**
implementation starts. A spec living only in Obsidian is by definition a
draft and may not be cited as binding by a PR. This applies to:

- top-level architecture proposals (e.g. an "expandability foundation"
  consolidation);
- per-milestone task specs (`mN-task-spec.md` shape);
- security / threat-model notes once they go beyond `docs/SECURITY.md`.

## Milestone closeout — what "done" means

A milestone is **not done** until every one of these has landed on `main`:

1. **Code** — the implementation PR(s).
2. **Tests** — passing in CI; the failing-on-purpose count is zero or
   documented.
3. **ADR(s)** — one ADR per locked decision the milestone introduced (or
   amended). New `docs/decisions/ADR-NNNN-*.md` files only; never edit a
   merged ADR.
4. **`docs/ARCHITECTURE.md` updated** — the current-state summary
   reflects what shipped, with backward cross-references to the new
   ADRs / specs.
5. **`docs/ROADMAP.md` updated** — phase / milestone status, exit
   criteria checkpoints, follow-on milestones named.
6. **Spec status header refreshed** — under
   `docs/specs/<area>/` the task spec's `Status:` line records the
   shipped state (PR numbers + merge commits), and the area `README.md`
   status table is updated.
7. **Acceptance checklist** — for operator-facing milestones, a
   `docs/<MILESTONE>-ACCEPTANCE.md` flat doc that the operator runs
   against a live server before declaring the milestone verified.
8. **Live acceptance pass** — recorded in the AutoMem current-state
   memory file and in this repo's PR thread.

A PR that ships code without (3) – (7) is **not done**. Opening a follow-
up issue does not count as done. The convention is one closeout PR per
milestone (`docs: <milestone> closeout`), opened immediately after the
last implementation PR merges.

## When you discover a doc gap

If you find a doc that no longer matches the code:

1. **Stop the change you were about to make.** A docs gap is a real bug —
   the next reader will trust the wrong description.
2. **Open a small docs-only PR** with the correction. Keep it surgical —
   no opportunistic rewrites.
3. **Cite the source** — the file/line in the codebase that the doc was
   contradicting.
4. **Cross-link** the relevant ADR, spec, and ROADMAP entry if any are
   touched.

The PR title pattern is `docs: <thing> — <one-sentence summary>`.

## See also

- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — code + doc conventions.
- [`docs/specs/expandability-foundation/README.md`](specs/expandability-foundation/README.md) — status table for the foundation specs.
- [`docs/decisions/`](decisions/) — ADRs.
