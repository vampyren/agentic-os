# Changelog

All notable changes to Agentic OS are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Phase ↔ version mapping

| Phase | Version | What lands |
|---|---|---|
| 0     | n/a    | Planning docs + ADRs |
| 1A    | 0.1.x  | Kernel skeleton, two transports, intentionally unstyled UI |
| 1B    | 0.2.x  | Mission Control aesthetic, vitals, SELF layer (goals/journal/memory), SQLite FTS5 index, setup wizard |
| 1C    | 0.3.x  | Scheduler + missions (daily summary, weekly review) |
| 2A    | 0.4.x  | HTTP transport (OpenRouter, OpenAI, Ollama) |
| 2B    | 0.5.x  | Promotion UI + semantic recall (sqlite-vec) |
| 2C    | 0.6.x  | MCP transport + per-agent MCP server attachments |
| 3     | 1.0.x  | Remote access (LAN/tunnel), plugin pattern, opt-in Claude Agent SDK transport |

---

## [Unreleased] — Goal 1: feature foundation

Next planned work: feature lifecycle registry, dynamic UI extension points, and a minimal enabled-state / feature-flag model. Keep Studio, Kanban, NotebookLM-style research, providers, media, and MCP as validation pilots until the shared platform primitives exist.

## [0.3.0] — 2026-05-21 — Phase 1C: scheduler and missions runtime

Phase 1C is now a complete runtime line: the M1–M4 config/registry/mission-runner spine is merged, and the final scheduled runtime slice fires enabled missions automatically through the same safe runner and vault/audit contracts as manual runs. The scheduler is disabled by default and must be explicitly enabled with `features.scheduler.enabled: true`.

### Added

- Mission runner for manual and scheduled mission execution: resolves effective mission plans, strict-parses each mission's own `optionsSchema`, builds `MissionContext`, enforces declared permissions before side effects, and returns neutral failure/skipped/success messages.
- Constrained mission vault writer at `src/vault/constrainedWriter.ts`: URL-decodes path-like inputs, enforces the `00_Inbox/agentic-os/...` output allowlist, rejects traversal and symlink escapes before write-time side effects, applies collision policy, and writes atomically.
- Manual mission-run API: `POST /api/missions/[id]/run` with origin gate, URL-decoded mission id, strict `{ options?: object }` envelope, builtin-mission registration, and single-object JSON responses.
- Automatic in-process scheduled firing via `node-cron`, bootstrapped from `src/instrumentation.ts` in the Node.js runtime.
- `GET /api/scheduler/status` for neutral runtime visibility: disabled/running/degraded state, scheduled mission ids, and diagnostics without exposing private config or mission output.
- Useful built-in mission implementations: `daily-summary` writes a daily inbox summary draft, `weekly-review` writes a weekly review draft, and `vitals-heartbeat` emits a lightweight scheduler heartbeat event.
- `mission.run` audit entries with counts/status/errorClass only; no mission options, note content, or vault paths.
- Feature Integration Guide at `docs/FEATURE-INTEGRATION.md` for adding Studio, Kanban, NotebookLM, providers, media surfaces, or other large feature integrations without bypassing the config/registry/capability/permission/vault contracts.

### Changed

- Built-in mission concurrency now aligns with runtime behavior: `vitals-heartbeat` uses skip semantics until a dedicated queue exists.
- The scheduler runtime uses a process-wide `globalThis` / `Symbol.for("agentic-os.mission-scheduler")` singleton so status APIs report the same runtime instance that instrumentation started.

### Fixed

- Optional scheduler bootstrap is fail-soft. Missing or invalid operator config no longer crashes `next dev` or Playwright `webServer` startup; the scheduler reports disabled/degraded diagnostics instead.
- `cron.schedule()` registration failures are caught per mission, recorded as neutral `schedule-failed` diagnostics, and do not prevent other missions or the app server from starting.

### Security

- Mission vault-note outputs can only persist through the constrained writer; missions themselves still return output objects and receive no write path.
- Event outputs require `event-emit`; vault-note outputs require `vault-write`; capability invocation requires `external-api`.
- Failed, skipped, and success runner/API/scheduler messages are generic and do not echo raw mission text, paths, secrets, options, stacks, provider errors, connector details, or private config.
- Scheduled missions call `runMission({ trigger: "scheduled" })`, so automatic execution follows the same permission checks, constrained-writer chokepoint, and neutral audit path as manual runs.

### Tests

- Vitest: **364 passing** after the Phase 1C runtime slice, including constrained writer traversal/symlink tests, mission runner permission/neutrality/audit tests, manual API tests, built-in mission tests, scheduler singleton/runtime tests, scheduler status API tests, and mission audit tests.
- Local gates before PR #10 merge: `npm run typecheck`, `npm test`, `npm run build`, and `npm run e2e` (19/19) passed.
- GitHub Actions PR #10 CI passed on `2a3df43`; main CI run `26237255986` passed after squash merge to `6dfb5bb`.

### Migration

- Existing configs without `features.scheduler.enabled: true` keep the scheduler disabled. To enable scheduled missions, add the scheduler feature block to `~/.agentic-os/config.yaml` and configure/enable the desired mission plans.

## [0.2.12] — 2026-05-18 — Track 2 UI/UX polish: shell, chat, control room, Hermes memory, usage, cwd

Track 2 UI/UX polish is implemented across PR #2, PR #3, PR #4, PR #5, and PR #6. The line now includes shell/Mission Control polish, chat and Control Room polish, Hermes memory bars, a context-fill chat usage strip, per-agent working-directory persistence, and Memory page chip/preview polish. Backend changes are additive and local-only: Hermes memory usage is read-only, cwd persistence is origin-gated and path-validated, vault metadata is exposed through a read-only origin-gated endpoint, and no vault-write contract changes.

**Slice 1 — Sidebar redesign.** `Sidebar.tsx` reshaped into three semantic groups with section overlines: `Workspace` (Mission Control), `Agents` (runtime-loaded from `/api/agents`, sorted by display name), and `Self` (Goals / Journal / Memory). Active item gets accent-tinted background + animated left accent bar via `motion.layoutId="nav-indicator"`. Per-agent identity rendered via new `AgentAvatar.tsx` (runtime-agnostic circular tile with the agent's first initial, full accent gradient + glow ring in the active state). New `--panel`, `--panel-border`, `--panel-border-hot` tokens in `globals.css` give the rail its purple-navy translucent character + subtle right-edge glow. Brand block top: `LOCAL · 127.0.0.1` overline + gradient `Agentic OS` wordmark.

**Slice 2 — TopBar + shell control relocation.** New `src/lib/titles.ts` per-route page-identity registry (static map + `/agents/[name]` slug-to-title fallback). `TopBar.tsx` is now title-only: `HH:MM · Local` overline + 34px page title + 14px subtitle, fades in (y: 6 → 0) on every route change. Page-identity `<h2>`s removed from `goals`, `journal`, `memory`, `events`, `agents` route files (sidebar active row + TopBar h1 own identity now). Home-page section h2s (`Agents`, `Live activity`) preserved.

Shell controls moved into the sidebar bottom block (no waste of vertical space in the main content area): `⌘K Command palette` button, `All systems` pill (border-tinted by aggregate tone from `/api/vitals`), and a single micro footer line with clock-left / version-right. The `⌘K` chip dispatches a `CustomEvent("open-command-palette")` that `CommandPalette.tsx` listens for alongside its existing keyboard shortcut — no global store refactor needed.

New CSS primitives in `globals.css`: `.tick-bar` (4×12 vertical bars for the aggregate status chip, distinct from the existing `.tick` dots used in Pill), `.heartbeat` (8px glow-dot for vitals/portal status), `.metric` (tabular-numeric monospace for headline numbers), `.panel-hover` (transition + hover lift).

**Slice 3 — Mission Control rebuild.** `src/app/page.tsx` rebuilt to match the reference design.
- New `Vitals.tsx` — N per-agent tiles (auto-adapts to whatever the registry has loaded) + Heartbeat tile (poll-tick counter, 4s interval) + Latency tile (combined ms across loaded agents). Each tile has an accent-coloured outer glow, lucide icon + label overline, LIVE/WARN/DOWN heartbeat indicator, `.metric` primary value, sub line.
- New `AgentPortal.tsx` — portal card with a large accent glow blob behind the top-right corner (intensifies on hover), accent-tinted identity tile (top-left) with its own glow ring, status text with `.heartbeat` dot (top-right), accent-coloured title, manifest-description tagline, 2-metric grid (Version, Latency), `Open agent workspace →` CTA. Card is the link; lifts ~3px on hover. Internal spacing tightened in a post-review pass to keep cards compact.
- New `SelfCard.tsx` — smaller card for Goals/Journal/Memory, accent glow at bottom-right corner, accent-tinted icon tile + accent title + tagline + single stat line.
- Pointless `all agents →` link removed from the Agents section header (whole card is the link; redundant chevron deleted).
- Live activity stream preserved at bottom.

**Shell layout.** Main content container has `mx-auto` removed so content hugs the sidebar (no dead horizontal space). `max-w-[1400px]` cap retained for line-length sanity on ultra-wide monitors.

**Background.** `body` background now layers a top cyan light haze + five corner aurora pools (cyan top-left, magenta top-right, amber mid-right, purple bottom-left, deep magenta bottom-right) + a centre-bottom deep-purple pool for depth under the live activity area + a navy lift over the obsidian `--bg`. New `body::before` blueprint grid overlay (56px lines, ~2.4% white, ellipse-mask centred at 38%·50% so the grid fades through the content column and reappears on the empty right gutter). New `body::after` soft inner vignette (radial dark ring from 55% out to 45% opacity) gently focuses the eye toward content. All layers static — `prefers-reduced-motion` automatically satisfied.

**Slice 4 — Chat surface declutter.** `AgentRoom.tsx` is now a single-column chat surface: the right rail/Vitals/About cards are removed from Chat mode, token usage collapses into a slim strip below the composer when usage exists, and the header focuses on accent identity + agent name + compact `New session`. Chat persistence, route-switch abort/orphan guards, Alt+1/Alt+2 agent shortcuts, and Control Room behavior are preserved. Header first paint now uses the exported `slugToTitle()` fallback so `/agents/hermes` shows `Hermes` instead of a lowercase slug before the manifest fetch resolves.

**Hermes version display.** New `src/lib/agentVersion.ts` extracts versions from richer CLI strings such as `Hermes Agent v0.14.0 (2026.5.16)`, so Mission Control shows `v0.14.0` instead of an arbitrary fallback.

**Reduced-motion live signal decision.** The sidebar `.tick-bar.live` pulse is intentionally preserved even when `prefers-reduced-motion: reduce` is enabled, because the gentle 1.4s pulse is the live status signal for the `All systems` chip. Decorative `.heartbeat` and `.tick.live` animations remain disabled under reduced motion. CSS comments and Playwright coverage pin this explicit UX trade-off.

**Slice 5 — Control Room polish + agent branding.** `ControlRoom.tsx` now presents the left rail as agent identity → vitals → `Actions`, strengthens the active action row with a deeper accent tint and soft glow, and bumps the viewer header label to an accent-coloured 18px semibold anchor. A small fail-soft client-side severity scanner (`src/lib/severity.ts`) adds advisory `WARN` / `ALERT` pills when already-cleaned action output contains conservative uppercase severity tokens; it never affects action success classification, abort behavior, audit, or backend routes. `AgentAvatar.tsx` now renders branded Hermes/Claude glyphs shared across Mission Control, sidebar, and chat surfaces; sidebar Self icons are larger and Memory uses a Brain icon.

**E2E.** `e2e/dashboard.spec.ts` updates: heading-existence assertions for `/goals`, `/journal`, `/events` (which no longer have route-level identity h2s) replaced with page-specific input-placeholder presence checks. Sidebar link clicks scoped to `page.locator("aside")` to disambiguate from the new SelfCard links on the home page. Event Log link click swapped to `page.goto("/events")` since Event Log was removed from the sidebar nav.

**Independent of Track 2 (carried in this branch):** chat `New session` button SSR/CSR hydration fix in `src/components/AgentRoom.tsx` (added a `mounted` state to gate the `disabled` prop) — prevents a hydration-mismatch warning on first paint.

**Hermes memory bars.** New `GET /api/hermes/memory-usage` route reads character counts from `~/.hermes/memories/MEMORY.md` and `~/.hermes/memories/USER.md`, parses the caps from `~/.hermes/config.yaml` (`memory.memory_char_limit` / `memory.user_char_limit`, default 5000 each per [Hermes docs](https://hermes-agent.nousresearch.com/docs/integrations/#memory--personalization)), and returns `{ available, memory: { chars, cap }, user: { chars, cap } }`. Fail-soft if Hermes isn't installed on the host (`available: false` → bars hidden). Fixed paths only — no traversal surface; reuses the same `originOk` CSRF gate as the other API routes.

New `HermesMemoryBars.tsx` component renders two thin bars (Brain icon for MEMORY, User icon for USER) with accent fill, a subtle color shift at 80% → amber and 95% → red, and a hover tooltip showing `N / cap chars · XX%`. Two variants: `compact` (4px bars, no labels) for the Mission Control portal card, and `full` (6px bars, labelled rows) for a new Hermes-only `Memory` card in the per-agent Control Room left rail (under Vitals, above Actions). `AgentPortal.tsx` gained an optional `extras` slot rendered between the metrics grid and the CTA; only the Hermes card uses it.

**Polish — severity scanner + avatar a11y.** `detectSeverity` (Slice 5) now scans output line-by-line and suppresses zero-count / negated summary lines such as `0 ERRORS`, `NO WARNINGS`, `ERRORS: 0`, `ERROR = none`, `FAILURES: NONE`. A clean status report no longer trips a false WARN pill, while a real `ERROR:` line on a later row still wins (`err` outranks `warn`). Two new tests in `tests/severity.test.ts` cover the zero-count suppression and the mixed-line (clean summary + later error) case. `AgentAvatar` swaps `aria-label` for `aria-hidden="true"` so screen readers don't double-announce the agent name (the visible text label adjacent to the avatar already carries the name); hover `title=` preserved.

**Chat surface: viewport-capped + internal scroll.** The redundant top-row Agent tabs (Claude / Hermes chips) were deleted from the per-agent workspace — the sidebar already lists every agent, and the duplicated row was pushing chat content below the fold so operators had to scroll on every visit. `AgentTabs.tsx` is gone; its Alt+1/Alt+N keyboard shortcut was moved into `AgentWorkspace.tsx` so jump-by-index still works. In chat mode, the workspace now caps to `calc(100dvh - 220px)` (TopBar + paddings + mode-toggle row) so the chat panel scrolls **internally**: composer is pinned at the bottom of the panel, latest message is always visible on entry. First scroll-to-bottom uses `behavior: "instant"` so operators don't see an animated top→bottom pan on agent entry; subsequent scrolls smooth-follow as content streams. Resets per agent so jumping between agents lands at the bottom each time. Control Room keeps its existing loose layout (the action viewer panel owns its own internal scroll).

**Chat usage strip — context-fill bar.** The Slice 4 single-line "session N turns · last in/out" strip was promoted to a two-row visualisation that mirrors what Hermes shows in its own TUI. New `ChatUsageStrip.tsx`: row 1 carries model name + a thin context-fill bar + `used / max` token counts + percentage (with the same 80%/95% color-shift severity treatment as the Hermes memory bars). Row 2 condenses the session accounting (`session N turns · last A in / B out · total X in / Y out · $cost`). Token formatter switched to uppercase-K (`45.7K / 272K`) for consistency with the Hermes screenshot convention. The strip renders nothing on a fresh chat with no usage reported yet, preserving the e2e contract from Slice 4. Bar resolves the context window via `src/lib/models.ts` (`resolveModel` + `contextBreakdown`), which already shipped with the family-prefix fallbacks (`claude-`, `gpt-5`, `gpt-4`, `gemini`, `gemma`, `qwen`, `llama`) and Anthropic-style `[1m]` annotation overrides; Hermes via `postRunUsage: hermes-session-export` and Claude via `streamJson` both populate `usage.model`, so the strip is consistent across the two transports. `chatStore.newSession` preserves the `model` field across a session reset so the strip stays visible as a 0% empty bar after the New Session click (token counts + cost are still discarded; only the model identity survives the reset).

**Per-agent working directory.** New `src/kernel/agentCwd.ts` reads/writes `~/.agentic-os/agent-cwd.json` (overridable via `AGENTIC_OS_AGENT_CWD_FILE` for tests) which maps agent name → absolute filesystem path. The kernel's run route (`POST /api/agents/<name>/run`) resolves the per-agent cwd before invoking the transport and passes it via `StreamOpts.cwd` **only when defined** — non-defaulted agents (Hermes etc.) get `undefined`, so the transport's `opts.cwd ?? cfg.cwd` chain correctly falls through to the manifest's own cwd or the parent process's cwd. Per-agent default registry: Claude Code resolves to `$HOME/Documents` when that directory exists and is a directory, otherwise falls back to `$HOME` itself (we never hand `spawn()` a non-existent path); other agents have no configured default. Path validation: absolute, exists, is a directory; soft warning (not block) when the path is **outside `$HOME` after `fs.realpath` resolves any symlinks** — a path lexically under `$HOME` but pointing outside via symlink still warns. Persistence is atomic (tmp file + rename) and serialised via an in-process write-chain so concurrent set/clear calls don't lose updates or corrupt the JSON on an interrupted write. New `GET/PUT/DELETE /api/agents/<name>/cwd` routes (originOk-gated) surface the snapshot and let the operator change or reset the path; every handler wraps its helper calls in `try/catch` that returns a structured JSON 500 on unexpected I/O errors. New `AgentCwdPicker` component renders on the Claude Code portal card via the `extras` slot — small Folder icon + inline path caption with `~` collapsing for readability, with a null-safe client/server snapshot contract (`cwd` / `defaultCwd` may be null for agents with no default); click the icon for a popover (rendered via `createPortal` at `document.body`, so it escapes the card's `<Link>` ancestor) with a text input, Save, and a "Use default" button (renamed from "Reset" so it can't be confused with the chat's "New session" button). `AgentPortal` was refactored so `extras` renders OUTSIDE the navigation `<Link>` (interactive content inside an anchor is a WHATWG content-model violation) — the whole card still lifts on hover because the `motion.div` owns the hover state, but only the upper block navigates. 29 unit + integration tests in `tests/agentCwd.test.ts` cover the per-agent default registry, `$HOME/Documents` fallback when Documents is absent, symlink-aware `$HOME` validation, atomic write durability, concurrent-write serialisation, and the structural invariant that `chatStore.newSession` does NOT touch the persisted cwd.

**Slice 6 — Memory tabs as chips + rendered preview.** `/memory` now uses compact accent-tinted scope chips instead of underline tabs, renders search-term highlights as React `<mark>` nodes (no `dangerouslySetInnerHTML`), and shows an empty preview state with Brain icon, vault root, and indexed-note count via a small origin-gated read-only `GET /api/vault/info` endpoint. The preview pane now renders note bodies through the existing safe Markdown renderer (GFM tables/code/headings/lists; no raw HTML) and widens responsively at `xl` widths while stacking below that breakpoint to avoid horizontal overflow. New `src/lib/highlight.ts` plus `tests/highlight.test.ts` add 21 unit cases for query highlighting, FTS5 `«...»` marker parsing, regex escaping, malformed marker fail-soft behavior, and Unicode preservation. `/api/memory/note` path traversal guard is unchanged.

### Queued after v0.2.12

- Future: secure inline audio playback in chat messages (allowlisted `/api/audio?path=` route with strict path-traversal + MIME guards).
- "Send last prompt to agent X" action in the command palette.
- Voice input on the journal page (chat box already has it).
- Vault search results inside the command palette.
- "Clear all chat cache" affordance (Hermes review of v0.2.7 — localStorage UX).
- localStorage opt-out toggle (operator setting → in-memory only).

---

## [0.2.11] — 2026-05-17 — Feature: per-agent Control Room workspace + Memory page UX + route-switch regression test

The operator's two outstanding v0.2.11 UI items both ship. Per-agent action workspace ("Control Room") gates behind a top-level mode pill toggle on `/agents/<name>` — chat stays the central conversation surface, never a container for management panels. Control Room is a 260px-left-rail + viewer-pane workbench matching Julian's v0.1 reference. The action set is manifest-driven, so any future agent (OpenClaw, Ollama-host doctor, etc.) gets one for free with an `actions:` block in its YAML. The Memory page gains a scope tab, type filter chips, and a right-pane preview. A Playwright regression test locks down the v0.2.10 unmount cleanup so future refactors of AgentRoom can't silently regress the route-switch race that Hermes flagged.

### Layout — Chat ⇄ Control Room mode toggle (fixes pre-release UX review)

A read-only review against Julian's v0.1 source + reference screenshots before release flagged the initial v0.2.11 placement (action chips inside the chat right column) as a blocker-level UX mismatch. Fixed before shipping:

- **`src/components/AgentWorkspace.tsx`** (new) — owns the agent + vitals fetch and renders the top-row agent picker, the Chat/Control Room pill toggle, then the active mode's component. Mode toggle pills render only when the agent declares actions; Claude (no actions) stays chat-only by construction.
- **`src/components/ControlRoom.tsx`** (new) — the action workbench: 260px left rail with vitals card + vertical action rows (label + hint badge), right viewer pane with header / monospace output / footer (Last run · char count). Mirrors `source-julian/agentic-os-v0.1/src/components/AgentRoom.tsx`. Default-selects the first action and auto-runs it on entry.
- **`src/components/AgentRoom.tsx`** — stripped of the inline action rail. Returns to a pure chat surface (chat panel + Vitals + Tokens + About) — the contract Julian's `UnifiedChat` enforces.
- **`src/components/AgentActionRail.tsx`** — deleted. Superseded by ControlRoom; its abort/generation guards carried forward.
- **`src/app/agents/[name]/page.tsx`** — thin server component that renders `<AgentWorkspace>`.

### Added — per-agent Control Room actions

- **`AgentActionConfig` in `src/kernel/types.ts`** — optional `actions: AgentActionConfig[]` on `AgentManifest`. Each action declares `{ id, label, command: string[], timeoutMs?, hint?, output? }`. Cap of 10 per agent. All read-only; no `{prompt}` placeholder substitution — actions don't take operator input.
- **`agents/builtin/hermes.yaml` action block** — 7 actions matching Julian's v0.1 reference order: `Status` (`hermes status`), `Sessions` (`hermes sessions list`), `Skills` (`hermes skills list`), `Plugins` (`hermes plugins list`), `Kanban` (`hermes kanban list`), `Doctor` (`hermes doctor`), `Insights` (`hermes insights`). Each row has a one-word hint (env / history / installed / marketplace / tasks / check / analytics) displayed to the right of the label. Per-action `timeoutMs` overrides set explicitly for slower verbs: Sessions 15s, Skills 10s, Plugins 20s, Kanban 10s, Doctor 20s, Insights 45s; Status uses the route-level default of 5s.
- **`GET /api/agents/[name]/actions/[action]`** — runs the manifest-declared action through `safeSpawn` (same hardening as the chat path: no `shell:true`, env allowlist, argv length cap). Hard 256 KiB cap on stdout + stderr each. Per-action `timeoutMs`: default **5s**, clamped at **60s max** (raised from the original 10s during this release to give slow read-only verbs like `hermes insights` room to finish). Captured output is sanitised server-side before reaching the UI — `stripAnsi` removes terminal escape sequences (CSI / SGR / OSC / single-char ESC), CRLF is normalised to LF + bare CR dropped, and each line is clamped to 1000 chars with a visible `… [+N chars]` marker so pathological rows (e.g. a `hermes sessions list` Preview cell dumping a multi-kilobyte system prompt) don't break the viewer. Returns the cleaned output to the localhost UI but **never** writes raw output to the JSONL audit log. Bus + audit `stdoutChars` / `stderrChars` record the CLEANED-text lengths so what's logged matches what the operator saw. Emits `agent.action.invoke` / `agent.action.complete` / `agent.action.error` on the bus.
- **`src/app/api/agents/route.ts`** — public `/agents` shape now includes `actions: [{ id, label, command, hint?, output? }]` so ControlRoom can render without a second round-trip.

### Added — audit envelope for action invocations

- **`auditAgentAction()` in `src/kernel/audit.ts`** — neutral envelope only: `{ agent, actionId, exitCode, durationMs, stdoutChars, stderrChars, errorClass?, status }`. **No raw stdout/stderr text.** Hermes session-list and insight-show output can carry operator-private content (prompt previews, model responses), and the same prompt-leak risk that drove v0.2.4's stderr fix applies here too.
- **`agent.action` kind** added to the canonical set in `src/kernel/audit.ts`. Reserved alongside `agent.invoke` / `agent.invoke.complete` / `agent.invoke.error` / `vault.write`.

### Fail-soft contract — actions never affect the chat path

Control Room and Chat live in different React state trees (sibling modes inside `AgentWorkspace`, never nested). They cannot influence each other:
1. An action endpoint returning `200 { ok: false }` is a UI hint only — the chat textarea, Stop button, and chat history are untouched.
2. The action's AbortController is per-action and held inside `ControlRoom`; AgentRoom's `ctrlRef` is for the run endpoint only.
3. Unknown agent / unknown action returns 404 with `{ ok: false, errorClass: "unknown-agent" | "unknown-action" }` — no audit write, no bus event.
4. Spawn failure, timeout, or non-zero exit returns `{ ok: false, errorClass: "spawn-failed" | "timeout" | "non-zero-exit" }` with a neutral operator-facing message (the route never copies stderr text into the message field, to avoid surfacing prompt-shaped text in a status line).

### Added — Memory page UX

- **Scope tabs** at the top of `/memory`: "Obsidian vault" (current behavior — all notes) and "Local conversations" (filters to `type: chat` notes, i.e. the snapshots written by agents to `00_Inbox/agentic-os/chats/`). Switching scope resets type chips because the available types differ between scopes.
- **Type filter chips** derived from current hits' frontmatter `type`. Click a chip to hide that type; chips show count badges; "clear filters" appears when any are toggled off.
- **Right-pane preview** when a result is selected. Loads via new `GET /api/memory/note?path=<rel>` route — uses `vault/reader.ts`'s existing `assertUnderRoot()` traversal guard. Pane shows path header, parsed frontmatter as a key/value grid, then truncated body (200k chars cap). Close button or re-clicking the row dismisses.
- **`/api/memory/search`** gained a `scope=all|chats` parameter — defaults to `all`, gracefully falls back if the value isn't on the allowlist. The chats filter is JS-side over the FTS5 hits since we don't index meta columns.

### Added — regression test for route-switch race (v0.2.10 carry-forward)

Hermes v0.2.8 review called out that the unmount cleanup behavior in v0.2.10 needed a test to lock it down. New e2e case `route switch during in-flight stream — no orphan commits, no stale streaming UI` does exactly that:
1. Playwright intercepts `POST /api/agents/claude-code/run` with a 60s-hung handler.
2. Triggers a send → asserts Stop button appears (streaming = true).
3. Navigates to `/agents/hermes` → asserts Stop is NOT visible in the new room, textarea is enabled, marker text from the prior agent is NOT visible.
4. Navigates back to `/agents/claude-code` → asserts the user message is still there (persistence works), Stop is still hidden, textarea enabled, and crucially **no `(no output)` orphan** got committed by the aborted run's `finally` block.

A second new case exercises Control Room actions end-to-end (Status row → API call → result pill) and asserts the chat textarea stays enabled regardless of action outcome — encodes the fail-soft contract as a test.

### Fixed — HIGH: `(no output)` orphan committed on full-page navigation during streaming

**The gap (caught by the new regression test above):** the v0.2.10 unmount-cleanup pattern (bump `sendGenRef` + abort fetch) is correct for SPA navigation, but on full page navigation (Playwright `page.goto`, browser refresh, hard reload) the browser kills the fetch at the network layer before React can run the unmount cleanup. The `send()` finally then sees `stillCurrent = true` (generation was never bumped) and writes a `"(no output)"` placeholder into `chatStore`. That message gets persisted to localStorage and resurrects on the next visit to the agent.

**The fix:** added a second guard in `AgentRoom.send()`'s finally. A new local `errored` flag captures whether the try block threw. The finally now refuses to commit when the run errored AND no token content was accumulated:
```ts
const wouldOrphan = errored && acc.length === 0;
if (stillCurrent && !wouldOrphan) {
  chatStore.appendAssistantMessage(name, { text: acc || "(no output)", ... });
}
```
A real agent reply that legitimately produced zero tokens still gets the `"(no output)"` marker because `!errored`. A partial response that errored mid-stream still commits the partial because `acc.length > 0`. The only case suppressed is the empty-aborted-stream case — which is exactly the orphan path.

### Tests + CI

- Vitest: 94 → **106 passing** — adds `tests/textSanitize.test.ts` (12 cases covering SGR colours, chained sequences, cursor / CSI moves, OSC hyperlinks, CRLF + bare-CR normalisation, idempotence, and per-line clamping).
- Playwright: 7 → **11 passing** — route-switch regression (caught the `(no output)` orphan bug above), Chat/Control Room mode toggle, Claude-without-actions assertion, Control Room action runner.
- Typecheck: clean.
- Release hygiene gate green across all 6 surfaces (package.json, package-lock.json, Sidebar badge, README status line, CHANGELOG heading, INSTALL current-version line).
- No new dependencies.

### Migration

Manifests without an `actions:` block work exactly as before — no rail renders. Manifests adding actions immediately get chips. The new `/api/memory/note` route is additive. No breaking changes; no data migration. The new `agent.action` audit kind appears only when an action is invoked.

### Known limitations

- The `hermes insights` chip assumes the verb exists on the operator's `hermes` CLI; on CLIs without it the chip surfaces a neutral `non-zero-exit` / `spawn-failed` error and the chat path is untouched. If a future Hermes release deprecates a verb, the manifest can be patched without code changes.
- The Memory page's "Local conversations" tab filters on `frontmatter.type == "chat"` — older chat snapshots without that frontmatter (none exist; `writeDraft` has always set it) would be hidden from that tab. Vault tab shows everything.
- Action stdout is capped at 256 KiB; a chatty CLI hits the cap and the panel shows `output truncated (256 KiB cap)`. Operator can re-run after narrowing the CLI command in `~/.agentic-os/agents/<agent>.yaml`.

---

## [0.2.10] — 2026-05-16 — Feature: top-row agent picker + nav-abort cleanup + Hermes v0.2.8 review carry-overs

The operator-requested top-row agent picker ships, AND the navigation-abort gap Hermes flagged is closed (was previously claimed in `docs/SECURITY.md` but the code wasn't delivering). Plus three small "worth tightening" items from the same review.

### Added — top-row agent picker

- **`src/components/AgentTabs.tsx`** — clickable agent chips in the AgentRoom header. Current agent highlighted with its accent color + a tiny status dot. Click to navigate (`router.push("/agents/<name>")`).
- **Alt+1 / Alt+2 / ... keyboard shortcuts** — jump to the Nth agent in the chip row. Alt avoids conflicts with browser/OS shortcuts.
- Operator-frequent action surfaced at the top of every AgentRoom instead of buried in the sidebar nav. Matches the visual pattern from Julian's screenshots — agent context where the action is.

### Fixed — HIGH: AgentRoom unmount cleanup

**The gap (Hermes v0.2.8 review):** `docs/SECURITY.md` claimed "switching agents mid-stream uses the same abort path", but the code had no `AgentRoom` unmount cleanup. Navigating away mid-stream left the fetch running and the old `send()`'s `finally` block could still write to a freshly-unmounted component's store (race with the new room's state).

**The fix:** new `useEffect(cleanup, [name])` in `AgentRoom`. On unmount or agent-name change:
1. Bumps `sendGenRef.current` so any in-flight `send()`'s `finally` sees `myGeneration !== sendGenRef.current` and skips the commit.
2. Aborts the fetch via `ctrlRef.current?.abort()`.
3. Clears the controller ref.

SECURITY.md's "Aborts, races, and reloads" table updated to match the now-honest behavior with a v0.2.10 note crediting the review.

### Fixed — small Hermes "worth tightening" items

- **`registry.stream()` catch path duration was epoch-ms, not elapsed-ms.** The transport-error path set `durationMs: Date.now()` instead of `Date.now() - startedAt`. Telemetry was always ~1.7 trillion ms. Captured `startedAt` at the top of the stream and now reports elapsed. Test: `expect(durationMs).toBeLessThan(60_000)` on an instant-throw transport.
- **`hasMeaningfulUsage()` trims model strings.** `"   "` or `"\t\n"` no longer count as meaningful. `.trim().length > 0` instead of `.length > 0`.

### Added — direct tests for the Hermes "worth tightening" gaps

- **`tests/registry-stream-order.test.ts`** gained 4 new cases:
  - `postRunUsage` yields usage event BEFORE terminal `done` (mocks `runPostRunUsage`).
  - `postRunUsage` returning `undefined` does NOT emit an empty usage event.
  - `postRunUsage` throwing is fail-soft — exit code stays 0, no usage event.
  - Registry catch path's `durationMs` is elapsed, not epoch.

### Tests + CI

- Vitest: 90 → **94 passing**.
- Typecheck + Playwright unchanged (clean).
- Release hygiene gate green across all 6 surfaces.

### Migration

None. The top-row picker is purely additive — sidebar nav still works. AgentRoom unmount cleanup is invisible to operators except for the now-correct behavior (no ghost messages from prior agents).

### Known limitations remaining (v0.2.12+)

- "Clear all chat cache" UI affordance — still queued.
- localStorage opt-out toggle — still queued.
- Track 2 visual polish — Sidebar redesign starts v0.2.12; later slices cover TopBar, Mission Control, chat, Control Room, Memory chips, and shared CSS utilities.

---

## [0.2.9] — 2026-05-16 — Fix: SSR/CSR hydration mismatch in chat persistence

**Patch release for a real bug introduced in v0.2.7.** The chat-persistence work added a `localStorage`-backed store, but `chatStore.get()` synchronously read from `localStorage` on first access. Server-side render had no `window`, so it returned an empty session. The client first paint then read localStorage and returned the populated session. React saw a mismatch (button `disabled` flipped, empty-state `<p>` swapped for the actual ChatBubble tree), tore down the hydrated tree, and re-rendered from scratch. Loud red error in the dev console and a layout flash for the operator.

### Fixed

- **`chatStore.get()` is now pure in-memory.** Never touches localStorage. Server render + client first render both return an empty session → HTML matches → React hydrates cleanly.
- **New `chatStore.hydrate(agent)` method** does the localStorage read. Idempotent (second call same tab is a no-op). Replaces the in-memory session in-place and notifies subscribers so React components re-render with the restored data.
- **`useChatSession` calls `hydrate()` inside `useEffect`** — runs after first paint, never during render. The brief flash of empty state on hard reload is intentional and required for hydration correctness.
- **`newSession()` marks the agent as hydrated** so stale localStorage data can't reload after a clear.

### Tests added (+3)

- `chatStore.test.ts` — three new cases verifying the hydration contract:
  - `get()` returns empty synchronously, no storage read.
  - `hydrate()` is idempotent.
  - `newSession()` blocks subsequent `hydrate()` from reloading stale data.

### Tests + CI

- Vitest: 87 → **90 passing**.
- Typecheck + Playwright clean.

### Verified end-to-end

In a browser hard-reload of `/agents/claude-code`:
- Server response: empty chat shell.
- Client hydration: empty chat shell (matches → no React warning).
- useEffect fires → `hydrate()` runs → localStorage data loads → store notifies → component re-renders with persisted messages.
- Console clean. No layout flash beyond the intended one-frame transition.

### Migration

None. Public API of `chatStore` gained one method (`hydrate`); the existing `get` / `appendUserMessage` / `appendAssistantMessage` / `setLastUsage` / `newSession` / `subscribe` all keep their signatures. The hook is used the same way.

---

## [0.2.8] — 2026-05-16 — Maintenance: kernel-level empty-usage + race fix + event ordering

Pure correctness pass closing the four Hermes findings from the v0.2.6 + v0.2.7 reviews. No new features. Hermes specifically called out the v0.2.7 fixes as **not actually working** — both were patched only at the UI layer and the underlying bugs were still live. Fixed properly here at the kernel/parser/store level.

### Fixed — HIGH: New session during in-flight stream resurrects orphan messages

**The bug:** v0.2.7's `newSession()` aborted the fetch and cleared the chatStore, but the original `send()` function's `finally` block still ran and unconditionally called `chatStore.appendAssistantMessage()`. The aborted fetch threw, jumped to `finally`, and wrote `"(no output)"` or a partial response into the freshly-cleared session. Clicking "New session" mid-stream actually left a ghost message behind.

**The fix:** generation counter (`sendGenRef`) in `AgentRoom`. `send()` captures the generation at entry and checks `myGeneration === sendGenRef.current` in its `finally` before committing to the store. `newSession()` bumps the generation FIRST (before aborting), so any in-flight `send()`'s finally sees `stillCurrent === false` and skips the commit. The new session stays clean.

### Fixed — MEDIUM: Empty `{}` usage events still bumped turn counters

**The bug:** v0.2.7 claimed to track `usageSeen` and skip empty usage, but flipped `usageSeen = true` for ANY usage event including `usage: {}`. Then the assistant message got `usage: {}`, the store treated `{}` as truthy, and `sessionUsage.turns` incremented with zero data.

**The fix:** real suppression at all four boundaries via a new `hasMeaningfulUsage()` helper in `src/kernel/types.ts`:
1. **Parser** (`hermesSessionJsonToUsage`) — returns `undefined`, not `{}`, when no usage fields are meaningful.
2. **Registry** — drops empty usage at the kernel boundary; `evt.kind === "usage"` with `!hasMeaningfulUsage(evt.usage)` is filtered before yield + bus emit.
3. **chatStore.setLastUsage** — silent no-op on empty input.
4. **chatStore.appendAssistantMessage** — strips empty usage from the persisted message AND skips the sessionUsage rollup.

"Meaningful" = any of `inputTokens > 0`, `outputTokens > 0`, `cacheReadInputTokens > 0`, `cacheCreationInputTokens > 0`, `totalCostUsd !== 0`, or `typeof model === "string"`. Model-only events still count (the model name arrives early via Claude's `system.init` event and is genuinely useful).

### Fixed — MEDIUM: postRunUsage emitted AFTER `done`

**The bug:** `registry.stream()` yielded the transport's `done` event immediately, then ran `postRunUsage`, then yielded `usage`. Any consumer treating `done` as terminal (a future SDK, a CLI wrapper, a Python client) would close the stream before seeing the usage event.

**The fix:** the registry now buffers the transport's `done` event in a `pendingDone` variable and yields it AFTER the postRunUsage extractor has run + emitted (or fail-softed). Canonical run order — documented in `docs/SECURITY.md` and the registry source — is now:
1. `token | usage` (interleaved as transport emits)
2. `error` (only on failure)
3. `usage` (from postRunUsage, if any, only if meaningful)
4. `done` ← terminal event
5. `saved` (added by the run endpoint after stream completes)

### Added — integration test for event ordering

**`tests/registry-stream-order.test.ts`** (5 cases). New `__TEST__.newRegistry()` + `__TEST__.injectAgent()` helpers in `src/kernel/registry.ts` let tests construct an isolated Registry with a fake transport (no real Claude/Hermes needed in CI):
- Token + done ordering (no postRunUsage).
- Interleaved token + usage events preserve order; done is last.
- Empty `{}` usage filtered at the kernel boundary; meaningful usage passes through.
- Unknown agent name yields `error` then `done`.
- Transport-emitted error: error yielded, done still terminal.

### Hardened — localStorage shape validation

**`chatStore.loadFromStorage`** previously trusted whatever was in `localStorage` as long as it parsed as JSON. Malformed payloads could produce odd UI state (Hermes review of v0.2.7). Now validates:
- Top-level is an object.
- `msgs` is an array; each element has `role` ∈ `{user, assistant}`, `text: string`, `ts: number`. Anything else is dropped.
- `sessionUsage.turns` is a number (defaulted to 0); other numeric fields type-checked.
- `lastUsage`, if present, must be an object.

Not a security boundary (localStorage is operator-owned), but prevents bad UI states from a corrupted cache.

### Docs

- **`docs/SECURITY.md`** — new "Browser localStorage — per-agent chat history" section explaining the data scope, what's stored, and how to clear it (DevTools, `localStorage.clear()`, or the upcoming UI affordance).
- **`docs/SECURITY.md`** — new "Aborts, races, and reloads — guaranteed behavior" table covering: New session mid-stream, agent switch mid-stream, page reload mid-stream, multi-tab simultaneity, aborted-stream audit shape.

### Tests + CI

- Vitest: 80 → **87 passing** (+5 integration ordering tests, +2 strengthened parser tests).
- Typecheck clean.
- Playwright: 7/7 unchanged.
- Release hygiene gate green across all 6 surfaces.

### Migration

None for operators. For anyone with custom kernel code:
- `hermesSessionJsonToUsage` return type changed from `AgentUsage` → `AgentUsage | undefined`.
- New `hasMeaningfulUsage()` helper exported from `src/kernel/types`.
- `__TEST__` export on registry lets tests inject fake agents (use for integration tests only).

### Known limitations remaining

- The Hermes "latest CLI session" race (acknowledged in v0.2.6 CHANGELOG) is unchanged — still single-operator-safe; a stronger correlation needs `--pass-session-id` plumbing through the subprocess transport. Queued for whenever a multi-CLI-user need arises.
- localStorage opt-out is documented but not yet a UI setting — queued for v0.2.9+.

---

## [0.2.7] — 2026-05-16 — Feature: chat persistence + polished chat bubbles

Closes a real UX bug: switching between agents reset the chat. Now per-agent chat history survives navigation and page reloads, with explicit "New session" / "Clear" controls. Plus a chat-surface visual polish inspired by Julian's screenshots — bubbles with agent-tinted avatars instead of flat cards.

### Added — chat persistence

- **`src/lib/chatStore.ts`** — module-level singleton `Map<agentName, ChatSession>` lives in browser memory across React lifecycles. Each session has `msgs`, `sessionUsage`, `lastUsage`, plus a `rev` counter for subscription notifications.
- **`src/lib/useChatSession.ts`** — React hook that subscribes a component to one agent's session and re-renders on mutation. Replaces `useState`-only state in `AgentRoom`.
- **localStorage backup** — `localStorage[agentic-os.chat.<name>]` mirrors every committed message. Page reload restores the session. Wiped only by "New session" / "Clear".
- **"New session" button** in the AgentRoom header — clears that agent's history (vault notes untouched), aborts any in-flight stream, refocuses the prompt textarea. Disabled when the session is already empty.

### Added — polished chat bubbles

- **`<ChatBubble>` component** — rounded bubbles (tail on the speaker's side), user messages right-aligned with accent tint, assistant messages left-aligned. Per-message footer carries saved-path + tokens/cost in tabular nums, padded clear of the bubble itself.
- **`<Avatar>` component** — small circular badge using the first letter of the agent name (or "you"), tinted with the agent's accent color and a soft glow. No image assets needed.
- **Empty-state copy** updated to mention `New session` + chat persistence explicitly.
- **Streaming partial** now also uses the avatar + bubble layout — consistent with finalized messages.

### Improved — partial Hermes v0.2.6 review carry-over

- AgentRoom tracks `usageSeen` and only attaches `usage` to the committed assistant message when ≥1 real usage event arrived during the stream. Avoids bumping session-turn counters with empty `{}` usage, addressing part of Hermes's Low/Medium finding. The deeper fix (in the registry + parser) lands in v0.2.8.

### Tests added (+9, total 80)

- **`tests/chatStore.test.ts`** (9 cases): empty state, per-agent isolation, cumulative usage rollup, no-usage messages don't increment turns, `newSession` clears only one agent, subscribers notified on append/clear, subscribers unsubscribed don't fire, agent-specific notification, `setLastUsage` merges streaming updates, doesn't touch sessionUsage.
- **`e2e/dashboard.spec.ts`** +2 cases: inject a marker message via `chatStore` → nav away → nav back → marker still visible. Then click "New session" → marker disappears.

### What was *not* included

Per Hermes's recommendation, v0.2.7 stayed UI-focused. The four findings from Hermes's v0.2.6 review (event ordering, registry-level empty-usage suppression, integration tests, race documentation) are bundled into **v0.2.8 maintenance pass**.

### Tests + CI

- Vitest: 71 → **80 passing**.
- Typecheck clean.
- Playwright: 5 → 7 cases.
- Hygiene gate green across all 6 version surfaces.

### Migration

None. The browser-side chat store is invisible to operators except for the new behavior (chat persists). Existing vault notes unchanged. No kernel/security paths touched.

---

## [0.2.6] — 2026-05-16 — Feature: Hermes usage card + polished context bar + review carry-overs

Three things in one focused release: Hermes finally shows its own usage stats (sourced from `hermes sessions export` — uses Hermes's own data, doesn't reinvent), the context-window bar got a visual polish, and three low-priority items from Hermes's review of v0.2.5 are closed.

### Added — Hermes usage card

The Tokens card in `/agents/hermes` now populates after every chat. Previously empty because `hermes -z` doesn't emit usage in stdout. Solution: introduce an **optional `postRunUsage` hook** on agent manifests. For Hermes:

1. After a successful `hermes -z` call, run `hermes sessions list --source cli --limit 1` to get the most recent CLI session id (single-operator system; very low race risk).
2. Run `hermes sessions export --session-id <id> -` which returns a single JSON object with `model`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `actual_cost_usd` / `estimated_cost_usd`, `message_count`, `tool_call_count`.
3. Map to the standard `AgentUsage` shape and emit a normal `usage` event. The existing card renders it identically to Claude's.

**Fail-soft by design**: any error in the extractor (Hermes not installed, command schema changed, parse fail, timeout) silently yields no usage event. The operator already got their chat reply — bonus telemetry isn't worth marking the call as failed. Per Hermes review's recommendation.

### Added — `postRunUsage` field on agent manifests

- New optional `postRunUsage: { parser: "hermes-session-export" }` on subprocess + streamJson manifest schemas. Currently one parser; future agents (OpenRouter via http transport, others) get their own parser names.
- Zod-validated. A manifest with an unknown parser fails at startup with a clear error.
- Documented in the manifest schema. `agents/builtin/hermes.yaml` uses it.

### Changed — ContextBar polish

The bar is now **3× thicker** (h-1.5 → h-2.5), has a header with a big colored percentage (`14%` in agent accent), and a compact legend chip row showing `context Xk · out Yk`. Transitions animate width changes smoothly when streaming usage updates land. Same data — much easier to read at a glance.

### Fixed — review carry-overs (Hermes v0.2.5)

- **`docs/INSTALL.md`** was stuck at `v0.2.4`. Updated to current version. Added to the release-hygiene test (was previously conditional and got missed).
- **`ContextBar` render gate** previously required `inputTokens || outputTokens || cacheReadInputTokens`. A usage event with only `cacheCreationInputTokens` would have hidden the bar. Now includes all four.
- **`resolveModel()` provider-prefix normalization** — `openai/gpt-5.5` now resolves the same as `gpt-5.5`. Same for `anthropic/claude-opus-4-7[1m]`, `ollama/qwen3-coder:30b`, etc. Hermes uses provider-qualified model strings, so this is required for the new usage card.
- **`docs/RELEASE-CHECKLIST.md`** §2: moved INSTALL.md from "conditional" to "every release", added README + CHANGELOG to the same list, and the hygiene test now covers all six surfaces.

### Tests added (+12, total 71)

- `tests/models.test.ts` — 2 new cases for provider-prefix normalization.
- `tests/postRunUsage.test.ts` — 9 new cases covering the Hermes parser:
  - Session-id parsing from list output (single row, cron-prefixed, multi-row newest-wins, empty).
  - JSON-to-`AgentUsage` mapping (full sample, prefers actual cost over estimated, falls back when actual is null, ignores non-numeric, returns `{}` for empty input).
- `tests/release-hygiene.test.ts` — 1 new case for INSTALL.md version line.

### Verified end-to-end

```
POST /api/agents/hermes/run "what is 2+2"
→ token: "2 + 2 = 4"
→ done
→ saved → 00_Inbox/agentic-os/chats/2026-05-16-1700-hermes-{hash}.md
→ usage: { model: "gpt-5.5", inputTokens: 14691, outputTokens: 9, totalCostUsd: 0.07 }   ← NEW
```

The Hermes AgentRoom now shows the same Tokens card Claude does, with model, in/out token counts, cost, and the polished fill bar.

### Migration

None for operators. For anyone with custom manifests: `postRunUsage` is optional; existing manifests work unchanged. The only currently-supported `parser` value is `"hermes-session-export"`.

---

## [0.2.5] — 2026-05-16 — Feature: context-window fill bar (per-model max)

Cleared by Hermes's third review of v0.2.4 — security gate now genuinely closed across argv / vault paths / stderr. v0.2.5 starts the feature pass with the single item Hermes recommended as the safest first move: **the context-window fill bar in the AgentRoom tokens card**. Bounded UI work, no audit/security surfaces touched.

### Added — context-window fill bar

- **`src/lib/models.ts`** — per-model context-window lookup. Exact-match table for the models the operator already uses (Claude Opus/Sonnet/Haiku, GPT-5.5, Gemini, Gemma, Qwen), plus family-prefix fallbacks so future model versions in the same family resolve sensibly without an exact entry. Default fallback is 200K (Claude family standard), which underestimates the bar fraction rather than overestimating it.
- **Anthropic `[1m]` annotation handling** — model strings like `claude-opus-4-7[1m]` correctly resolve to 1,000,000 tokens. `[200k]` and other annotations supported via the same parser.
- **`contextBreakdown()` helper** — computes `usedTotal = input + cacheRead + cacheCreation + output` and `contextTotal = input + cacheRead + cacheCreation` (the prompt-side portion). Used by the bar to render two segments (context vs. generated output).
- **`<ContextBar>` component in `AgentRoom.tsx`** — replaces the old in/out ratio bar. Visualizes `usedTotal / max(model.contextTokens)`. Inside the bar, a dim segment represents the context portion and the agent's accent color tip represents generated output. Hover tooltip shows the full breakdown (in / cache read / cache create / out). Below the bar: `{usedK} / {maxK}` and percentage in tabular nums.

### Why this replaces the old bar

The previous `<UsageBar>` was an input-vs-output ratio. With Claude Code's prompt caching, a typical call looked like `{ inputTokens: 6, outputTokens: 86, cacheReadInputTokens: 17922 }` — input was 0.03% of total tokens, so the bar rendered as "all output color" and told the operator nothing. The new bar shows what fraction of the model's actual context window the turn consumed (in your screenshots' example: `25.9k / 1M = 2.6%`), which is the metric that matches Claude Code's own `/context` view and the gpt-5.5 bar Hermes displays.

### Tests added

- **`tests/models.test.ts`** (8 cases):
  - Exact model match.
  - `[1m]` and `[200k]` annotation override.
  - Family-prefix fallback for unknown model versions.
  - Unknown models fall back to safe default.
  - Empty model string handled gracefully.
  - `contextBreakdown` sums input + caches correctly.
  - `contextBreakdown` handles missing fields as zero.

### Docs

- **`docs/decisions/ADR-0009-jsonl-audit-log.md`** — Hermes review carry-over (low-priority cleanup). The "Event kinds" list was still describing `agent.invoke.error` as having a sanitized `message` field. Updated to match the v0.2.4 stricter no-message schema (`errorClass` + `stderrSha8` + `stderrChars` + neutrals only). Added a "Test enforcement" subsection listing the three regression test files that prove the redaction invariants hold.

### Tests + CI

- Vitest: 51 → **59 passing** (+8 model tests).
- Typecheck clean.
- Playwright unchanged (5/5).
- Release hygiene gate verified consistent across `package.json` / `package-lock.json` / sidebar / README / CHANGELOG.

### Verified end-to-end

Smoke against the operator's real Claude:
```
POST /api/agents/claude-code/run "test"
→ model resolves to claude-opus-4-7[1m] = 1,000,000 ctx
→ used 25.9k tokens (6 in + 17.9k cache read + 8k cache creation + 86 out)
→ bar fills to 2.6%, hover shows full breakdown
```

### Migration from 0.2.4

None. The `UsageBar` component was renamed to `ContextBar` and its props shape changed (now takes the full `usage` object plus `accent` instead of split in/out tokens), but it's a private component inside `AgentRoom.tsx` — no external API affected.

---

## [0.2.4] — 2026-05-16 — Security patch: audit stderr redaction + release hygiene

Closes SEC-001 from Hermes's review of v0.2.3: `agent.invoke.error` entries could carry raw transport stderr text verbatim. If an agent CLI echoes the prompt, argv, or secret-bearing text to stderr on failure (Claude does this on certain error paths), that text leaks into the audit JSONL — breaking the documented invariant "raw prompts never appear anywhere in the audit log".

### Security — fixed

- **`auditAgentInvokeError` signature is now redaction-by-construction.** Removed the `message: string` field that previously held raw stderr. New fields: `errorClass` (neutral enum), `exitCode`, `stderrSha8` (8-char correlation hash, not content), `stderrChars` (length only), `transport`. Caller cannot accidentally pass raw text.
- **`classifyAgentError(message, exitCode)` in `src/kernel/audit.ts`** — buckets a raw error into one of `non-zero-exit` / `spawn-failed` / `timeout` / `killed` / `transport-error` / `unknown`. Returns a value from a fixed enum, never a string derived from the input.
- **`src/kernel/registry.ts`** — both error sites (transport-emitted error event AND routing failure for unknown agent) now classify+hash before audit. The verbose error message stays on the in-memory bus for live UI display; never reaches JSONL.

### Test added — SEC-001 regression

`tests/audit-stderr-security.test.ts` (3 cases):
1. **Real subprocess emits a nonce on stderr** (`/bin/sh -c "echo NONCE >&2; exit 7"`). Run through the actual `subprocess` transport. Assert: transport's `evt.message` captures the nonce (sanity), AND the audit JSONL — written via the new neutral signature — contains the nonce **nowhere**. Deep walk through every parsed entry's every string field.
2. **`classifyAgentError` bucket coverage** — explicit cases for each enum value.
3. **`classifyAgentError` defense-in-depth** — feeding a crafted prompt-like message returns only enum values, never a string containing the input.

### Test strengthened — SEC-002 exact hash

`tests/audit-pipeline-security.test.ts` — the chat-filename regression now asserts the **exact** hash, not just a hex shape:
```
expect(path.basename(result.path)).toMatch(new RegExp(`-${sha256(fullPrompt).slice(0,8)}\\.md$`));
```
Plus a sanity check that the title-only hash would have been different — proves the full prompt is the hash seed, not the truncated 60-char title.

### Test added — release hygiene (REL-001 regression)

`tests/release-hygiene.test.ts` (5 cases) — CI-enforced version consistency:
- `package.json.version` === `package-lock.json.version` === `package-lock.json.packages[""].version`
- Sidebar badge `vX.Y.Z · ⌘K` matches `package.json.version`
- README "Status: vX.Y.Z" matches
- CHANGELOG has a `## [X.Y.Z]` heading for the current version

This would have caught v0.2.2 → v0.2.3's sidebar drift AND v0.2.3 → v0.2.4's package-lock drift. CI runs it on every push; any version-bump that forgets a file fails the build before tag.

### Release hygiene — fixed

- **`package-lock.json`** was stuck at `0.1.0` since the initial scaffold; regenerated with `npm install --package-lock-only` so root + `packages[""]` both reflect `0.2.4`.
- **`docs/RELEASE-CHECKLIST.md` §2** updated to list `package-lock.json` as a place that needs bumping every release, with the exact command + a pointer to the new hygiene test.

### Docs swept

Per Hermes review's DOC-001 / DOC-002 / DOC-003:

- **`docs/INSTALL.md`** — `v0.2.2` → `v0.2.4`; `chats/YYYY-MM-DD-{slug}.md` → `chats/YYYY-MM-DD-HHMM-{agent}-{promptSha8}.md`.
- **`docs/SECURITY.md`** — JSONL example records updated to match the actual shape from `src/kernel/audit.ts` (includes `id`, omits invented `command`/`status` fields, adds `agent.invoke.complete` + new `agent.invoke.error` shape). Chat filename example uses hash. Added explicit "Note on `agent.invoke.error`" paragraph explaining the SEC-001 fix.
- **`docs/ARCHITECTURE.md`** — `draftInbox` description corrected: chats use hash filename, non-chats use slug.
- **`docs/AGENT-MANIFEST.md`** — "Loader status as of v0.2.2" → "Loader status (current)".
- **`README.md`** — Status line, plus `src/` description no longer says "Phase 1A application code".

### Tests + CI

- Vitest: 43 → **51 tests passing**. New files: `audit-stderr-security.test.ts` (3), `release-hygiene.test.ts` (5). Strengthened: `audit-pipeline-security.test.ts` (+1 inside an existing case).
- Typecheck clean.
- Playwright unchanged (5/5).

### Migration from 0.2.3

None required for operators. For anyone forking and writing custom transports / kernel code: `auditAgentInvokeError`'s signature is now stricter — pass `errorClass` + `stderrSha8` + `stderrChars` + `transport`, not `message`. Use `classifyAgentError({ message, exitCode })` to get the class from raw input.

---

## [0.2.3] — 2026-05-16 — Security patch: chat filenames no longer leak prompts

Closes the residual leak documented (but not fixed) in v0.2.2: chat filenames recorded in `vault.write` audit entries were derived from the slugified prompt prefix. A prompt like "what is my password" landed in audit as a filename containing `-what-is-my-password.md`.

### Security — fixed

- **Chat filenames are now hash-based, not slug-based.** Format changed from `YYYY-MM-DD-HHMM-{agent}-{slug}.md` to `YYYY-MM-DD-HHMM-{agent}-{promptSha8}.md` where `promptSha8` is the first 8 hex chars of SHA-256(prompt). Filename contains **zero prompt-derived characters**.
- The H1 title and chat body inside the markdown remain human-readable — only the filename (which leaves the operator's vault and lands in `vault.write` audit entries) is hashed.
- Other note kinds (goals, journal, summaries, reviews, drafts) **keep slugified filenames**. Those titles are operator-authored — not prompt content. No leak there.
- New `filenameSeed?: string` field on `WriteDraftInput`. For chat kind, this is the source for the hash (full prompt is now passed from the run endpoint rather than the truncated 60-char title).

### Test — added

`tests/audit-pipeline-security.test.ts` — 4 full-pipeline regression tests:
1. Chat written with a nonce in title + body + filename-seed: filename matches `^\d{4}-\d{2}-\d{2}-\d{4}-claude-code-[0-9a-f]{8}\.md$`. Nonce in the file body (operator's chat content, expected) but **not anywhere in the audit log**. Assertion is deep: raw-string scan AND recursive walk of every parsed entry's string fields.
2. `auditAgentInvoke` direct call with a nonce-bearing prompt: nonce never reaches `argsRedacted` via `renderArgsForAudit`.
3. Full simulated round-trip (`agent.invoke` + `vault.write`): nonce absent from both entry types, with sanity assertions that entries were actually written (no vacuous test).
4. Non-chat kinds (goals etc.) still use slugified filenames as expected.

### Docs

- `docs/SECURITY.md` — Audit log section rewritten. Removed the "known residual" caveat. Documents the two-layer guarantee: `renderArgsForAudit` for argv + hash filenames for `vault.write` paths.
- `docs/VAULT-CONTRACT.md` — folder layout example updated; added privacy invariant explaining why chat filenames differ from other kinds.

### Verified end-to-end against the operator's vault

```
POST /api/agents/claude-code/run "v023-smoke-XYZQ7-must-not-leak — just reply OK"
→ saved → 00_Inbox/agentic-os/chats/2026-05-16-1331-claude-code-ad022b45.md
                                                          ^^^^^^^^ hash, not slug
→ grep "v023-smoke-XYZQ7" ~/.agentic-os/audit/2026-05-16.jsonl   →  0 matches
→ grep "v023-smoke-XYZQ7" <the saved file>                       →  PRESENT (chat body)
```

### Migration

None required. Old slug-named chats in `00_Inbox/agentic-os/chats/` stay as they are (filenames; nothing depends on the format). New chats from v0.2.3 onward use the hash format.

### What's next

Security gate fully closed. v0.2.4 is the feature pass that was originally queued for 0.2.3.

---

## [0.2.2] — 2026-05-16 — Security gate + correctness fixes

Pure security + docs + correctness pass; no new user-facing features. Closes the two must-fix items from an external review:

1. **Audit log was leaking raw prompts** via the `argsRedacted` field. The registry rendered `{prompt}` to the real prompt string, then passed those rendered args to `redactArgs()`, which only matched secret-shaped values — a prompt like "fix the bug in auth.py" passed through unredacted.
2. **Spawned agent CLIs inherited the entire parent environment**, including any API keys / tokens the operator had exported (`OPENAI_API_KEY`, `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`, etc.). SECURITY.md claimed otherwise; the code contradicted the doc.

Both fixed, both with unit tests that would have caught the original bugs.

### Security — fixed

- **`renderArgsForAudit()` in `src/kernel/spawn.ts`** — companion to `renderArgs()`. Substitutes `{prompt}` with the literal `[PROMPT_REDACTED]` placeholder. Registry uses this when building the audit-version of argv. The real prompt is passed to the transport via `opts.prompt`, never via argv that lands in the audit log.
- **`buildChildEnv()` + `ENV_ALLOWLIST` in `src/kernel/spawn.ts`** — replaces the previous `...process.env` spread. Strict allowlist of base env vars (PATH, HOME, USER, SHELL, TERM, LANG, LC_*, TZ, TMPDIR, XDG_*, NODE_PATH, plus any `AGENTIC_OS_*`). Manifest-declared `env:` blocks add to that on top. `NO_COLOR=1` / `FORCE_COLOR=0` forced.
- **Tests:**
  - `tests/audit-security.test.ts` — nonce test: pass a unique string as the prompt, assert it never appears in the JSONL file.
  - `tests/spawn-security.test.ts` — env allowlist tests: fake `OPENAI_API_KEY` is filtered out; `PATH`/`HOME` are kept; `AGENTIC_OS_*` is forwarded; manifest extras win; `renderArgsForAudit` produces the redacted placeholder.

### Security — known residual + planned fix

- The `vault.write` audit entry records the full file path. Chat filenames include the slugified prompt prefix (lowercased, dashes, max 40 chars). For most prompts uninteresting (operator owns both the audit log and the vault), but short prompts can be partly reconstructed from the chat filename in audit. Documented in SECURITY.md. Planned fix in v0.2.3: optional hash-based filenames.

### Bug — fixed

- **`streamJson` transport had unreachable code.** Both the `assistant.message.usage` handler and the assistant-content handler matched the same event type — the first branch returned early so the usage extraction never ran. Merged usage extraction into the first branch; dropped the dead second branch. Confirmed live: a Claude call now emits **three** `usage` events (system.init → assistant.message.usage → result.usage cumulative) where 0.2.1 only emitted two.
- **`extractUsage()` exported** from the transport for unit testing.
- **`tests/streamjson-usage.test.ts`** — 5 fixture tests covering system.init / assistant.message.usage / result.usage / non-usage events / partial-shape tolerance.

### Correctness — fixed

- **VoiceButton unmount cleanup.** `useEffect` cleanup now calls `recRef.current?.abort()` and nulls the event handlers on unmount, so navigating away mid-recording properly releases the microphone instead of leaving a dangling SpeechRecognition session.
- **VoiceButton error surfacing.** `onerror` now captures the actual error type (`not-allowed`, `network`, `service-not-allowed`, etc.) and exposes it via the button tooltip + an amber border. The previous version swallowed errors silently, which made debugging Brave's Web Speech limitations impossible.

### Docs — fixed (stale items called out in review)

- **README:** "Status: planning. No application code yet" → "Status: v0.2.2 — Phase 1B shipped" with a CHANGELOG link.
- **INSTALL.md:** rewritten. `npm run setup` (which shipped in v0.2.0) is now the recommended quickstart. Manual config kept as alternative. Added browser compatibility table (mic = Chrome/Edge/Safari; Brave blocks; Firefox unsupported) + SSH port-forward instructions for accessing the dashboard from another machine.
- **AGENT-MANIFEST.md:** added a "Loader status as of v0.2.2" note + table marking `http` / `mcp` / `sdk` as **not yet accepted by the validator** — a manifest using one fails at startup today. Schema documented now so it doesn't churn when transports land.
- **SECURITY.md:** rewrote the Subprocess + Audit sections to match the new code. Subprocess section explains the env allowlist and what to do when a CLI breaks because of it. Audit section explains how prompts are kept out of the JSONL and acknowledges the residual chat-filename leak.

### Tests + CI

- Vitest: 19 → **39 tests passing**. 3 new test files (`audit-security`, `spawn-security`, `streamjson-usage`).
- Playwright still 5/5.
- Typecheck clean.

### Verified end-to-end against the operator's machine

```
POST /api/agents/claude-code/run "audit-nonce-q9k2x7 just reply with OK"
```
Streams 3 usage events (was 2 in 0.2.1) — the dead-code merge now actually fires the per-turn usage path. Audit log contains `[PROMPT_REDACTED]` placeholders in `argsRedacted`. Hermes confirmed still working after the env allowlist change.

### Migration from 0.2.1

No migration required. If you had `OPENAI_API_KEY` or similar exported in your shell and a CLI was implicitly using it, that CLI now sees a clean env unless you declare the var in its manifest's `env:` block.

---

## [0.2.1] — 2026-05-16 — Polish: markdown chat, tokens card, voice input, command palette

Quality-of-life pass over Phase 1B. The dashboard now feels like an actual product to use day-to-day.

### Added

- **Markdown rendering of agent responses** — react-markdown + remark-gfm + rehype-highlight (github-dark theme). Code blocks get syntax highlighting; tables, lists, blockquotes all styled for the dark theme. User messages remain plain text. Streaming partials render markdown live.
- **Tokens card in the AgentRoom side rail** — shows model, input/output tokens with a slim horizontal bar, cache-hit count, and per-message cost in USD. A "Session" sub-section accumulates totals across all messages in the room. Only renders for transports that report usage (Claude Code today; HTTP agents in v0.4.0). Hermes shows nothing — its subprocess output doesn't include usage and we don't fake it.
- **Per-message stats footer** — each assistant message gets a small `in / out / $cost` line under the body alongside the saved-to-vault path.
- **Voice input on chat** — mic button next to the prompt textarea using the browser's Web Speech API. Click to start, click to stop. Final transcripts get appended to the textarea. Firefox shows the button disabled with a tooltip (no Web Speech API there).
- **Command palette (⌘K / Ctrl+K)** — global modal overlay (cmdk). Two sections: Navigate (all pages) and Open agent room (every registered agent, live-fetched from `/api/agents` each time the palette opens). Fuzzy search, ↑↓ to navigate, ↵ to select, Esc to close.

### Changed — kernel

- `AgentEvent` gained a `usage` variant carrying `model`, `inputTokens`, `outputTokens`, `cacheReadInputTokens`, `cacheCreationInputTokens`, `totalCostUsd`.
- `streamJson` transport parses Claude Code's `system.init`, `assistant.message.usage`, and `result.usage`/`result.total_cost_usd` events and emits a `usage` event for each.
- Registry's stream() forwards `usage` events to callers, audit log, and bus (`agent.usage` kind).

### Changed — audit log

- `AGENTIC_OS_AUDIT_DIR` env override now respected. `audit.ts` evaluates the path lazily on each write so tests (and future use cases) can redirect at runtime.
- `tests/vault-writer.test.ts` redirects the audit log to a throwaway tmpdir in `beforeAll`, restoring the previous env in `afterAll`. Unit tests no longer pollute the operator's `~/.agentic-os/audit/`.

### Changed — UI

- Sidebar version badge: `v0.2.1 · ⌘K` (was `v0.2.0 · phase 1B`).
- README quickstart now lists the real install steps (it ships) and mentions `⌘+K`.

### Tests + CI

- Vitest still 19/19, typecheck clean.
- Playwright still 5/5 on CI.
- No new tests in this release — all changes are UI polish or new event kinds piped through existing code paths. The new functionality is verified by manual smoke (Claude usage events confirmed flowing end-to-end with real cost and token numbers from a live call).

### Verified

`POST /api/agents/claude-code/run "Reply with the single word READY."`
yields the NDJSON event stream:
```
{"kind":"usage","usage":{"model":"claude-opus-4-7"}}
{"kind":"token","text":"READ"}
{"kind":"token","text":"Y"}
{"kind":"usage","usage":{"totalCostUsd":0.0598,"inputTokens":6,"outputTokens":6,"cacheReadInputTokens":17922,"cacheCreationInputTokens":8029}}
{"kind":"done","durationMs":1891,"exitCode":0}
{"kind":"saved","path":"00_Inbox/agentic-os/chats/...md","bytes":220}
```

---

## [0.2.0] — 2026-05-16 — Phase 1B: Operator UX + SELF layer + FTS5 search

**Mission Control now looks the part.** The kernel from 0.1.0 gets a proper UI on top: persistent sidebar, glass-panel dashboard, streaming agent rooms, real per-agent health probes, live event ticker, full SELF layer (Goals + Journal + Memory), SQLite FTS5 vault search with a chokidar watcher, and a first-run setup wizard. Five logical commits, one tag.

### Added — aesthetic foundation (commit 1)

- Tailwind v4 + @tailwindcss/postcss.
- `src/app/globals.css`: dark mission-control theme with CSS variable tokens (surfaces, borders, status colors, per-agent accents). Glass panel class, status pill geometry, slim scrollbars, animated `.tick.live` pulse.
- `src/components/Shell.tsx` + `Sidebar.tsx` + `TopBar.tsx`: persistent layout with multi-route nav. TopBar shows live vitals chips.
- `src/components/Pill.tsx`: status pill with `live` / `busy` / `degraded` / `offline` / `unknown` / `info` tones.
- `src/lib/accent.ts`: per-agent accent color (known names mapped + hash-rotation fallback).
- Pages live at `/`, `/agents`, `/agents/[name]`, `/goals`, `/journal`, `/memory`, `/events`.

### Added — agent rooms + health loop (commit 2)

- `src/kernel/health.ts`: per-manifest probe loop. Runs each agent's healthProbe at its declared `intervalSec` (default 300s, floor 15s). HMR-safe via globalThis state. Bus emits `agent.health.changed` ONLY on status transition — no spam.
- `src/components/AgentRoom.tsx`: polished streaming chat. Per-agent accent color, autoscroll, ⌘+Enter to send, Esc to stop. Shows "saved → 00_Inbox/..." after each chat lands in vault. Side rail with vitals (status, version, probe latency, last-checked).
- `/api/vitals`: returns the cached snapshot per agent (status, version, latency).

### Added — Goals + Journal (commit 3)

- `src/vault/reader.ts`: basic vault walker. `readNote`, `listInboxNotes`, `readInboxNotes`, `walkVaultNotes` (used by the FTS5 indexer).
- `src/vault/writer.ts` extensions:
  - `appendJournalEntry`: one-file-per-day with timestamped `### HH:MM` sections, creates on first entry, atomic append thereafter.
  - `updateFrontmatter`: patches frontmatter on existing inbox notes (used by the goals toggle), refuses anything outside the inbox-first directory.
- `/api/goals` (GET/POST), `/api/goals/toggle` (POST): one file per goal under `00_Inbox/agentic-os/goals/`. OS-specific `goalStatus: open | done` field, `category`.
- `/api/journal` (GET/POST + GET `?recent=N` + GET `?date=YYYY-MM-DD`): one file per day under `00_Inbox/agentic-os/journal/`.
- UI: `/goals` (add form, active list with optimistic toggle, completed list dimmed); `/journal` (today entries + recent-day picker, ⌘+Enter to log).

### Added — Memory page + FTS5 index + watcher (commit 4)

- `src/kernel/vaultIndex.ts`:
  - SQLite FTS5 (`notes_fts`) over note title + body. Sibling `notes_meta` carries type/agent/tags/created/mtime for filtering and sort.
  - `fullScan()`: walk vault, upsert each note, skip files whose mtime hasn't changed, drop rows for deleted files. Idempotent.
  - `chokidar` watcher on the vault root: incremental upsert on add/change, remove on unlink. Ignores `.obsidian`, `.git`, `.trash`, `node_modules`, `60_Attachments`.
  - `search(q, limit)`: BM25-ranked hits with FTS5 `snippet()` highlighting (« » delimiters rendered as `<mark>` in the UI).
  - Defensive coercion of YAML-parsed frontmatter values (gray-matter returns `Date` for ISO dates; SQLite needs primitives).
- `/api/memory/search?q=&limit=`: returns hits + total indexed + elapsedMs.
- `/memory` page: debounced search (200ms), result cards with title, highlighted snippet, type/agent badge, path, mtime.

**Verified against the operator's real ~43-note vault:** full first index 259ms, subsequent queries 1ms (SQLite) / 34ms wire. Comfortably hits the ROADMAP Phase 1B exit criterion (<50ms).

### Added — setup wizard + Playwright (commit 5)

- `scripts/setup.mjs` (`npm run setup`): interactive first-run wizard.
  - Detects which agent CLIs are installed (claude, hermes, openclaw, ollama).
  - Auto-detects candidate Obsidian vault paths (anywhere under `~/Documents/Obsidian/`).
  - Prompts for the vault path and default agent.
  - Writes `~/.agentic-os/config.yaml` + creates `~/.agentic-os/audit/`.
- `playwright.config.ts` + `e2e/global-setup.ts` + `e2e/dashboard.spec.ts`:
  - 5 Playwright smoke tests covering home page render, sidebar routing, `/api/agents` shape, goal creation, journal append.
  - `global-setup.ts` builds a throwaway vault + config in `/tmp` so tests don't depend on the operator's real `~/.agentic-os/` and can run on CI runners without Obsidian/claude/hermes installed.
- `.github/workflows/ci.yml` now runs typecheck → vitest → Playwright on every push.

### Tests + CI

- Vitest: 19/19 passing (up from 11 in 0.1.0).
  - New: `vault-reader.test.ts` (4 tests — read, list, path-escape, walk).
  - New: `vault-index.test.ts` (4 tests — scan + search, mtime re-index, deleted-file cleanup, empty-query handling).
- Playwright: 5 e2e smoke tests (CI-only locally — Ubuntu 26.04 host blocks the chromium install but Playwright config + tests are validated structurally via `playwright test --list`).
- CI workflow extended with Playwright job.

### Dependencies added

`tailwindcss`, `@tailwindcss/postcss`, `framer-motion`, `lucide-react`, `cmdk`, `react-markdown`, `rehype-highlight`, `remark-gfm`, `highlight.js`, `better-sqlite3`, `chokidar`, `gray-matter`, `@types/better-sqlite3`, `@playwright/test`.

### Known limits (deferred to 0.2.1 or later phases)

- Command palette (cmdk) not yet wired despite the dep being present.
- Markdown rendering of chat responses not yet wired (chats display as preformatted text).
- Voice input not yet wired.
- Inbox promotion UI (move drafts to `10_Projects/`, `40_Decisions/` etc.) is Phase 2B.
- Health probe loop emits status-change events on the bus but no UI shows a probe-error message — clicking degraded chip should open a diagnostic later.

### Migration from 0.1.0

If you already have `~/.agentic-os/config.yaml` from 0.1.0, no migration needed — the schema is unchanged. On first request the FTS5 index will build itself at `~/.agentic-os/index.db`. Safe to delete and let it rebuild.

---

## [0.1.0] — 2026-05-16 — Phase 1A: Kernel skeleton

**First runnable version.** The kernel takes a prompt, routes it through a registered transport, streams tokens back, persists the chat to the operator's Obsidian vault, and records every invocation in an append-only audit log. **Both Hermes and Claude Code work end-to-end** through the same registry / transport / event-bus abstractions — no per-agent code paths anywhere.

UI is intentionally unstyled (default browser fonts, plain HTML elements) so the kernel API can be reviewed in isolation before any aesthetic work in Phase 1B. See `docs/decisions/ADR-0007-phase-1-narrow-mvp.md`.

### Added — kernel

- **Agent registry** with manifest-driven loading from `agents/builtin/*.yaml` (shipped) and `~/.agentic-os/agents/*.yaml` (user overrides). User wins on name collision. Single source of truth for the set of agents — no hardcoded `"claude" | "hermes"` enum anywhere.
- **Transport abstraction** — a small `Transport` interface (`health()`, `stream()`). Two implementations:
  - `subprocess` — one-shot CLIs. Hermes uses this (`hermes -z "<prompt>"`).
  - `streamJson` — parses Claude Code's stream-json NDJSON output. Yields incremental token deltas as they arrive.
- **Typed in-process event bus**, fanned out via `GET /api/events` (Server-Sent Events). One subscription per browser tab; every kernel signal (agent invocations, vault writes, future scheduler events) flows through here.
- **Config loader** for `~/.agentic-os/config.yaml` (per ADR-0007 — single durable file is the canonical Phase 1A config path). Env overrides: `AGENTIC_OS_CONFIG`, `AGENTIC_OS_VAULT`.
- **Zod schema validation** for both config and agent manifests. Typos in user YAML fail at load time with a clear error pointing at the file.
- **Vault writer** with inbox-first contract (per `docs/VAULT-CONTRACT.md`):
  - Writes only to `<vaultRoot>/00_Inbox/agentic-os/<kind>/`.
  - Collision-safe filenames (`-02`, `-03`, ... up to `-99`).
  - Atomic write via sibling `.tmp` file + `rename()`. Best-effort `fsync`.
  - Tag filter: only the operator's approved-domain tags from `20_Knowledge/Approved Tags.md`; everything else dropped.
  - Path-escape protection: any resolved path outside the inbox-first directory throws.
- **JSONL audit log** at `~/.agentic-os/audit/YYYY-MM-DD.jsonl` (per ADR-0009). Records `agent.invoke`, `agent.invoke.complete`, `agent.invoke.error`, `vault.write`. **Raw prompts never logged** — only SHA-256 prefix (`promptSha256`) + character count (`promptChars`). Args matching secret-name patterns redacted as `[REDACTED]`.
- **Health probes** — per-manifest, distinguishes `live` / `degraded` / `offline` / `unknown`. ENOENT on the binary → `offline`. Non-zero exit → `degraded`. `--version` clean exit → `live`.

### Added — API

- `GET /api/agents` — list of loaded agents (name, displayName, transport, capabilities).
- `GET /api/agents/[name]/health` — on-demand health probe for a single agent.
- `POST /api/agents/[name]/run` — run an agent. Body: `{ prompt: string }`. Returns streaming NDJSON, one event per line: `token` → `done` → `saved`. The `saved` event arrives after the chat is persisted to the operator's vault.
- `GET /api/events` — SSE feed of every BusEvent. Auto-keepalive every 25s.

### Added — UI

- `http://127.0.0.1:3000` — single page, default browser styling.
- Agent list (loaded from `/api/agents`).
- Agent picker dropdown.
- Prompt textarea + send/stop buttons.
- Streaming response area (tokens append to a `<pre>` as they arrive).
- Live event bus ticker (last 50 events, newest first, via EventSource on `/api/events`).
- "saved → 00_Inbox/agentic-os/chats/..." status after each chat completes.

### Added — built-in agents

- **`claude-code`** — Anthropic's Claude via the local Claude Code CLI. Uses your existing Claude Code subscription (per ADR-0001). No `ANTHROPIC_API_KEY` required. Streams real tokens via `claude -p --output-format=stream-json --include-partial-messages --verbose`.
- **`hermes`** — Nous Research Hermes Agent in one-shot mode (`hermes -z "<prompt>"`). Output streamed as one token event on completion.

### Added — tests + CI

- 11 vitest unit tests, all passing:
  - Registry: load from fixture dirs, user override wins, malformed manifest rejection, empty-dir handling.
  - Subprocess transport: token + done events on success, `live` on healthy binary, `offline` on missing binary.
  - Vault writer: first write at bare filename, second gets `-02`, third gets `-03`, path-escape rejected, frontmatter sits at file top, non-approved tags filtered out.
- GitHub Actions CI workflow (`.github/workflows/ci.yml`): typecheck + tests on every push to `main` and every PR.

### Security

- Dev server binds `127.0.0.1` only (`next dev --hostname 127.0.0.1`).
- CORS rejects any cross-origin request whose `Origin` is not `http://127.0.0.1:3000` or `http://localhost:3000`.
- Subprocess invocations: argv arrays only, never `shell:true`, arg length capped at 32KB, null bytes rejected before spawn.
- Vault writer refuses any write path that escapes `<vaultRoot>/00_Inbox/agentic-os/`.
- Audit log redacts args matching `API_KEY|TOKEN|SECRET|PASSWORD|Bearer\s+`.

### Verified end-to-end (manual smoke)

```
GET  /api/agents               → both agents listed, transports correct
GET  /api/agents/claude-code/health → live, "2.1.143 (Claude Code)"
GET  /api/agents/hermes/health      → live, "Hermes Agent v0.13.0"
POST /api/agents/hermes/run    → real Hermes response, saved to vault
POST /api/agents/claude-code/run → two streamed delta tokens ("READ", "Y"), saved
```

JSONL audit log captured all four invocations + the four vault writes with redacted args and `promptSha256` only.

### Known limits (deferred — these are 1B scope or later)

- No health probe loop; `/api/agents/[name]/health` runs the probe synchronously per request.
- No vitals card, no activity stream UI beyond the raw bus event ticker.
- No goals / journal / memory pages.
- No SQLite FTS5 vault index — vault search not implemented.
- No `npm run setup` wizard — operator hand-writes `~/.agentic-os/config.yaml` from the example.
- No styling — Tailwind / Framer Motion / aesthetic port lands in 1B.
- No scheduler, no missions, no agent-to-agent workflows.
- No HTTP-transport agents (OpenRouter, OpenAI, Ollama) — that's 2A.
- No MCP — that's 2C.
- No remote access — that's Phase 3.
- Unit tests write to the operator's audit log directory. Mostly harmless (tests are deterministic and fast) but should be fixed in 0.1.1 with an `AGENTIC_OS_AUDIT_DIR` env override.

### How to run

```bash
# 1. Configure your vault path
cp agentic-os.config.example.yaml ~/.agentic-os/config.yaml
$EDITOR ~/.agentic-os/config.yaml   # set vault.root

# 2. Install + verify
npm install
npm run typecheck
npm test                            # 11 tests

# 3. Run
npm run dev
# open http://127.0.0.1:3000

# 4. Backup-friendly state lives in one place
tar -czf agentic-os-backup-$(date +%F).tgz ~/.agentic-os/
```

See `docs/INSTALL.md` → "Phase 1A — manual install" for the full procedure.
