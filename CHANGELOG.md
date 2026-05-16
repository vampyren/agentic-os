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

## [Unreleased]

Queued for v0.2.7 — UI inspiration pass (operator dropped 35 screenshots showing Julian's Agentic OS aesthetic):
- Per-agent action rail: `Status / Sessions / Skills / Plugins / Kanban / Doctor / Insights` for Hermes (mirrors Julian's pattern). Surface what each agent CLI already exposes instead of reinventing.
- Polished chat bubbles with agent avatars (Claude page in screenshot 162527).
- Memory page improvements: tabs (Local conversations / Obsidian vault), filter chips, right-pane preview (screenshot 163509).

Then v0.2.8+:
- "Send last prompt to agent X" action in the command palette.
- Voice input on the journal page (chat box already has it).
- Vault search results inside the command palette.

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
