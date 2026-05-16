# Release Checklist

For every tagged release (`vX.Y.Z`). Run top-to-bottom. Skip nothing unless explicitly noted.

> **Why this exists:** v0.2.2 shipped with the in-app sidebar still showing `v0.2.1` and `package.json` still at `0.1.0` (had never been bumped). Both are exactly the kind of metadata drift this checklist prevents. Run through it for every release.

---

## 0. Decide what kind of release

- **PATCH (`X.Y.Z` → `X.Y.Z+1`)**: bug fixes, security fixes, doc fixes, dependency bumps. No new operator-visible features.
- **MINOR (`X.Y.0` → `X.Y+1.0`)**: new features within the same phase / slice.
- **MAJOR (`X.0.0` → `X+1.0.0`)**: breaking changes. Reserved for Phase 3 (`1.0.0`).

Phase → version mapping (from `CHANGELOG.md`):

| Phase | Version | What lands |
|---|---|---|
| 1A | 0.1.x | Kernel skeleton |
| 1B | 0.2.x | Operator UX, SELF, FTS5 |
| 1C | 0.3.x | Scheduler + missions |
| 2A | 0.4.x | HTTP transport |
| 2B | 0.5.x | Promotion UI + semantic recall |
| 2C | 0.6.x | MCP |
| 3  | 1.0.x | Remote access + plugin pattern + SDK |

---

## 1. Pre-flight

- [ ] On `main` branch: `git rev-parse --abbrev-ref HEAD`
- [ ] Working tree clean: `git status --short` (no output)
- [ ] Pulled latest: `git fetch && git rev-parse @ = $(git rev-parse @{u})`
- [ ] Previous release's CI is green: `gh run list --limit 1`

---

## 2. Version sync — must match the target `vX.Y.Z`

Every place that displays or declares the version must agree. Use the grep below to catch every match:

```bash
grep -rn -E "\"version\":|v[0-9]+\.[0-9]+\.[0-9]+" \
  --include='*.json' --include='*.tsx' --include='*.ts' --include='*.mjs' \
  . | grep -v node_modules | grep -v .next | grep -v package-lock.json
```

Known places that need bumping every release:

- [ ] `package.json` → `"version": "X.Y.Z"`
- [ ] `src/components/Sidebar.tsx` → version badge `vX.Y.Z`

Conditional (only if a phase/feature surface changed):

- [ ] `README.md` → "Status: vX.Y.Z — Phase ___ shipped"
- [ ] Any inline `vX.Y.Z` references in `docs/*.md` that point at a now-superseded version (search and judge)

Comments that quote a historical version (e.g. `// Phase 1B note: in v0.2.0 commit 1...`) are fine — they're history, not current state.

---

## 3. Code health

- [ ] `npm run typecheck` — clean (no output)
- [ ] `npm test` — all passing (note the count before/after)
- [ ] `npm run e2e --list` — discovers expected number of tests (CI actually runs them; locally Ubuntu 26.04 can't install Playwright browsers)
- [ ] No new dependencies added without bumping the right SemVer slot

If you added new features in this release:

- [ ] Each new public function / API endpoint has at least one unit test
- [ ] Each new security claim in `docs/SECURITY.md` has a paired test (lesson from v0.2.2)

---

## 4. End-to-end smoke

Open a dev server in another terminal: `npm run dev`. Verify against the operator's actual vault:

- [ ] `curl http://127.0.0.1:3000/api/agents` returns both built-in agents
- [ ] Send a real prompt to **Claude Code** via `POST /api/agents/claude-code/run` — confirm streaming tokens, usage events, vault save
- [ ] Send a real prompt to **Hermes** via `POST /api/agents/hermes/run` — confirm token + vault save
- [ ] Open the dashboard in a browser, click through every sidebar route — no console errors
- [ ] If a new feature shipped, exercise it manually with the actual UI

Kill the dev server when done: `pkill -f "next dev"`.

---

## 5. Docs

For each, ask "did anything change since the last release that touches this file?" — if yes, update.

- [ ] `CHANGELOG.md` — **always** add a new `## [X.Y.Z]` entry above `## [Unreleased]`. The entry has: a one-paragraph summary, an Added/Changed/Fixed/Security/Tests breakdown, a "Verified" subsection if real-machine smoke was done, and a "Migration" note if operators need to do anything.
- [ ] `CHANGELOG.md` — refresh the `## [Unreleased]` queue to reflect what's now planned for the next release.
- [ ] `README.md` — Status line + Quickstart if either changed.
- [ ] `docs/ROADMAP.md` — mark a slice's exit criteria as ✓ if a phase completed.
- [ ] `docs/INSTALL.md` — only if the install procedure changed.
- [ ] `docs/SECURITY.md` — if the security posture or any explicit claim changed.
- [ ] `docs/AGENT-MANIFEST.md` — if the manifest schema or loader status changed.
- [ ] `docs/VAULT-CONTRACT.md` — if vault rules changed (rare; would be a phase event).
- [ ] `docs/ARCHITECTURE.md` — if architecture diagrams or layer breakdown changed.
- [ ] `docs/decisions/` — add a new ADR if a real architectural decision was made. **Never edit accepted ADRs**; supersede with a new numbered one.

---

## 6. Commit

- [ ] Single commit per logical change (or a short commit train for multi-part releases — Phase 1B was 5 commits).
- [ ] Subject format: `<type>(<scope>): <imperative summary>` where:
  - `<type>` ∈ {`feat`, `fix`, `chore`, `docs`, `test`, `refactor`}
  - `<scope>` is the version or phase slice: `1B`, `0.2.2`, etc.
  - Example: `feat(1B): AgentRoom + per-manifest health probe loop`
- [ ] Commit body details the *why*, not just the *what* — link ADRs / external review feedback / known limits.

---

## 7. Push and wait for CI

```bash
git push
gh run watch                          # blocks until CI completes
```

- [ ] CI green: typecheck + vitest + Playwright all pass
- [ ] If CI fails: fix on `main` with new commits, **do not amend the published commit**

---

## 8. Tag

Only after CI is green.

- [ ] Annotated tag:
  ```bash
  git tag -a vX.Y.Z -m "vX.Y.Z — <short summary>

  <one paragraph of context>

  See CHANGELOG.md for full release notes."
  ```
- [ ] Push tag: `git push origin vX.Y.Z`
- [ ] Verify on remote: `git ls-remote --tags origin vX.Y.Z`

**Tag immutability:** never re-tag. If a tag points at the wrong commit, ship a new one (`vX.Y.Z+1`).

---

## 9. GitHub release

- [ ] Draft release notes at `/tmp/vX.Y.Z-notes.md`. Style: curated summary (not a CHANGELOG dump) — what landed, what's verified, what's known-broken, what's next.
- [ ] Create release:
  ```bash
  gh release create vX.Y.Z \
    --title "vX.Y.Z — <short summary>" \
    --notes-file /tmp/vX.Y.Z-notes.md
  ```
- [ ] Verify in browser: `gh release view vX.Y.Z --web`
- [ ] Markdown renders cleanly (code blocks, tables, links resolve)

---

## 10. Post-release verification

- [ ] Pull a fresh state somewhere and confirm: `git pull && git tag --list | tail -3`
- [ ] In-app version badge matches the new tag (load the dashboard, check sidebar)
- [ ] `npm pkg get version` matches the new tag
- [ ] If anything is broken, file an issue immediately — do not silently patch

---

## 11. Communication (if applicable)

For a personal project, this is optional. For anything operator-facing or with external users:

- [ ] Update any pinned operator-facing message (Slack pin, project README badge, etc.)
- [ ] If a security fix shipped, note it loudly in the release notes
- [ ] If a breaking change shipped, link the migration guide

---

## Common pitfalls

- **Tool-call edit silently failing on stale read.** If a doc edit doesn't show up in `git status`, re-read the file before retrying — the Edit tool sometimes errors quietly when the file's been modified outside the in-context snapshot. (Happened with v0.2.2 CHANGELOG — caught only because of post-commit verification.)
- **Bumping `package.json` but forgetting the sidebar badge.** Run the grep in section 2 unconditionally.
- **Tagging before CI passes.** Don't. CI catches the bugs you didn't.
- **Editing an accepted ADR.** Don't. Write a superseding one.
- **Releasing during a long-running dev test session.** Kill background dev servers first; they hold ports and confuse the verification step.
