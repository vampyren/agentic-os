# Contributing

This project ships in tagged releases. Every release follows [`docs/RELEASE-CHECKLIST.md`](docs/RELEASE-CHECKLIST.md) — read it before cutting one.

## Doc conventions

- One topic per file. If a doc is growing past ~400 lines, split it.
- ADRs use the lightweight MADR format under `docs/decisions/`. Numbered, immutable once accepted (supersede with a new ADR, don't rewrite history).
- Cross-link with relative paths (`../ARCHITECTURE.md#event-bus`), not full URLs.
- Default to plain text. Emojis only when the user asks for them.

## Code conventions (when code lands in Phase 1)

- TypeScript strict mode. No `any` without a justifying comment.
- Vitest for unit tests, Playwright for UI smoke tests. CI runs both on every PR.
- Avoid premature abstraction. Three repetitions before extracting a helper.
- No comments that explain *what* well-named code already shows. Comments for *why* (constraints, gotchas) only.
- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, ...) for commit messages.

## Workflow

1. Open an issue describing the change before non-trivial work.
2. One PR = one logical change. Keep diffs reviewable.
3. Reference the relevant ADR in the PR body. If your change contradicts an ADR, write a superseding ADR in the same PR.
