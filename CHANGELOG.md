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

Tracking what's queued for 0.1.1 (point fixes only — 0.2.0 begins Phase 1B).

### Planned
- `AGENTIC_OS_AUDIT_DIR` env override so unit tests don't write into the production audit log.
- README quickstart updated to reflect the now-real Phase 1A install path (`npm install && npm run dev`).

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
