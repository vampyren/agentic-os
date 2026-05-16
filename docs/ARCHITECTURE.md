# Architecture

This document describes the target architecture. Nothing is implemented yet.

## Goals and non-goals

**Goals**

- One process, local, no cloud dependency for the core loop.
- Adding a new brain (a CLI agent, an HTTP-callable model, an MCP server) is a config change, not a code change in five places.
- Live UI updates without polling: single SSE stream from a shared event bus.
- Markdown in Obsidian is the canonical store; SQLite is a derived index that can be rebuilt at any time.
- Honor the user's existing vault operating rules (inbox-first writes, broad-domain tags, frontmatter for metadata).

**Non-goals (for v1)**

- Multi-user. One operator, one machine.
- Remote access. Localhost-only in Phase 1; LAN/remote arrive later behind a proper auth boundary.
- Hosted SaaS. There is no "Agentic OS Cloud."
- Re-implementing Obsidian. The dashboard reads/writes `.md` files; it does not replace Obsidian's UI.

## High-level diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                            Browser (localhost:3000)                       │
│  Mission Control · Agent Panels · Goals · Journal · Memory · Missions    │
└────────────────────────────────┬─────────────────────────────────────────┘
                                 │ HTTP (one-shot) + SSE (live events)
┌────────────────────────────────▼─────────────────────────────────────────┐
│                       Next.js app (Node runtime)                          │
│                                                                           │
│  ┌──────────────┐  ┌─────────────────┐  ┌────────────────────────────┐   │
│  │  REST API    │  │  SSE Event Bus  │  │  Scheduler (node-cron)     │   │
│  │  /api/...    │◀─┤  /api/events    ◀──┤  daily / weekly missions   │   │
│  └─────┬────────┘  └────────▲────────┘  └────────────┬───────────────┘   │
│        │                    │                        │                    │
│        ▼                    │                        ▼                    │
│  ┌──────────────────────────┴──────────────────────────────────────────┐ │
│  │                          AGENT REGISTRY                              │ │
│  │  Loads YAML/TS manifests from agents/*.yaml + user overrides         │ │
│  │  Each manifest binds a name → Transport + Capabilities + Probes      │ │
│  └─────┬────────────────────────────────────────────────────────────────┘ │
│        │                                                                  │
│  ┌─────▼────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ Subprocess   │  │ StreamJson   │  │ Http         │  │ AgentSdk     │ │
│  │ Transport    │  │ Transport    │  │ Transport    │  │ Transport    │ │
│  │ (hermes -z)  │  │ (claude -p…) │  │ (openrouter) │  │ (opt-in)     │ │
│  └─────┬────────┘  └─────┬────────┘  └─────┬────────┘  └─────┬────────┘ │
│        │                 │                 │                 │           │
│  ┌─────▼─────────────────▼─────────────────▼─────────────────▼───────┐  │
│  │                       KNOWLEDGE LAYER                              │  │
│  │  VaultReader · VaultWriter (inbox-first) · SQLite FTS5 index       │  │
│  │  Source of truth: ~/Documents/Obsidian/Rex-Knowledge/              │  │
│  │  Derived index: ~/.agentic-os/index.db                              │  │
│  └─────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
        │                          │                            │
        ▼                          ▼                            ▼
   local CLIs              http providers              MCP servers
 (claude, hermes,         (openrouter, openai,        (playwright, git,
  openclaw, ollama)        anthropic-direct)           filesystem, ...)
```

## Layer breakdown

### 1. Agent Registry

A manifest-driven catalog of every brain the OS can talk to. See [`AGENT-MANIFEST.md`](AGENT-MANIFEST.md) for the schema.

- Manifests live at `agents/builtin/*.yaml` (shipped) and `~/.agentic-os/agents/*.yaml` (user overrides).
- A manifest declares: `name`, `displayName`, `transport` (one of `subprocess` / `streamJson` / `http` / `mcp` / `sdk`), transport-specific config, `capabilities` (`chat` / `streamingChat` / `tools` / `mcp`), `healthProbe`, optional `logsDir`.
- The registry exposes: `list()`, `get(name)`, `health(name)`, `chat(name, opts)`, `stream(name, opts)`, `runVerb(name, verb, args)`.
- No code anywhere else references agent names as a literal. The registry is the only source of truth.

This kills Julian's `"claude" | "openclaw" | "hermes"` union and unblocks adding ChatGPT/OpenRouter/Ollama/etc. without touching the kernel.

### 2. Transports

| Transport | Use case | Phase |
|---|---|---|
| `subprocess` | One-shot CLI agents that return JSON or text on stdout (hermes, openclaw). | 1 |
| `streamJson` | Specialized subprocess for `claude -p --output-format=stream-json` — parses the Claude Code event format and re-emits typed events on the bus. | 1 |
| `http` | Any HTTP-callable model API (OpenRouter, OpenAI, local Ollama, etc.). Reads API key from env or `~/.agentic-os/secrets.yaml`. | 2 |
| `mcp` | Talk to any MCP server as if it were an agent (or call its tools from another agent). | 2 |
| `sdk` | `@anthropic-ai/claude-agent-sdk` — opt-in; requires `ANTHROPIC_API_KEY`. See ADR-0001. | 3 |

A `Transport` is a small interface:

```typescript
interface Transport {
  health(): Promise<HealthReport>;
  chat(opts: ChatOpts): Promise<ChatResult>;             // one-shot
  stream(opts: ChatOpts): AsyncIterable<AgentEvent>;     // streaming
  runVerb?(verb: string, args: string[]): Promise<RunResult>;  // for CLI verbs
}
```

### 3. Event Bus + SSE

- In-process `EventEmitter` (single instance, exposed via a module-level singleton).
- Events have a typed envelope: `{ id, ts, source, kind, payload }` where `source` is the agent name or `"system"` / `"vault"` / `"scheduler"`.
- One SSE endpoint at `/api/events` fans the bus out to the browser.
- Filtering happens client-side (the bus is small, this keeps the server simple).
- Replaces Julian's REST polling for activity + vitals.

### 4. Scheduler

- `node-cron` in-process. Cron expressions + JS handlers.
- Handlers live at `missions/*.ts`, each exporting `{ cron: string, run: (ctx) => Promise<void> }`.
- Built-in missions:
  - `daily-summary` — at 20:00, summarize today's chats + journal into `00_Inbox/agentic-os/summaries/YYYY-MM-DD.md`.
  - `weekly-review` — Sundays, draft a weekly review note for promotion.
  - `vitals-heartbeat` — every 60s, ping each agent's health probe, emit bus events.
- Missions write to the inbox like everything else; promotion is the user's call.

### 5. Knowledge Layer

Markdown is canonical. SQLite is derived.

**Reader (`vault/reader.ts`):**
- Walks the vault honoring `.gitignore` and the configured skip list (`.obsidian`, `.trash`, `.git`).
- Exposes `searchFts(q)`, `recent(n)`, `byTag(tag)`, `byFrontmatter(key, value)`.

**Writer (`vault/writer.ts`) — inbox-first contract:**
- `draftInbox({ kind, title, frontmatter, body })` writes to `00_Inbox/agentic-os/YYYY-MM-DD-{slug}.md`. No approval needed (matches your existing `Hermes Obsidian Approved Write Workflow` decision).
- `promote(notePath, destFolder)` is the only path that touches anything outside the inbox, and it requires explicit confirmation from the dashboard UI.
- Frontmatter follows your existing template convention: `type`, `status`, `source`, `tags` (broad domains only), `aliases`, `created`. Plus one OS-specific field: `agent: <agent-name>` so we can filter "all notes Claude drafted last week."
- Never writes to `60_Attachments/` (your `.gitignore` excludes it from version control; agents shouldn't dump there).

**Index (`vault/index.ts`):**
- SQLite at `~/.agentic-os/index.db` with FTS5 over note title + body + frontmatter values.
- Built from a one-time walk on first run, then maintained via a `chokidar` filesystem watcher on the vault root.
- Future: add `sqlite-vec` for semantic recall using a local embedding model (e.g., `nomic-embed-text` via Ollama). Doesn't ship in Phase 1.

See [`VAULT-CONTRACT.md`](VAULT-CONTRACT.md) for the full rules and rationale.

### 6. UI shell

- Next.js 16 App Router (matches Julian's stack — his Tailwind v4 + Framer Motion + React 19 choices are good).
- Reuses Julian's aesthetic (aurora gradients, glass panels, pill statuses) — re-implemented from his components, not forked, to avoid carrying his hardcoded agent assumptions.
- New top-level: `<EventBusProvider>` opens the SSE stream on mount and pipes typed events into a React context that every panel can subscribe to.
- `AgentPanel` is generic — driven by the agent manifest, not per-agent React components. Custom panels can still be registered for agents that want bespoke UIs (e.g., a Hermes kanban view).

## Config and secrets

- `~/.agentic-os/config.yaml` — vault path, default agent, scheduler enable, location label, UI accent overrides.
- `~/.agentic-os/agents/*.yaml` — user-defined agent manifests, merged with built-ins.
- `~/.agentic-os/secrets.yaml` — API keys (OpenRouter, Anthropic, OpenAI). Mode 0600. Never logged.
- All paths resolvable from env vars: `AGENTIC_OS_CONFIG`, `AGENTIC_OS_VAULT`, etc.

## Security model (Phase 1)

- Bind 127.0.0.1 only. No CORS for non-localhost origins.
- Every subprocess invocation goes through a single `spawn()` helper that uses argv arrays (never `shell: true`), enforces arg-length caps, and rejects null bytes.
- CLI verbs exposed via `/api/run` use an allowlist per agent (Julian's pattern, kept).
- Vault paths normalized with `path.resolve` and rejected if they escape the vault root.
- Audit log at `~/.agentic-os/audit.log` records every agent invocation and every vault write. Append-only, daily rotation.
- See [`SECURITY.md`](SECURITY.md) for threat model and the plan for LAN/remote auth in later phases.

## What changes from Julian's v0.1

| v0.1 | This design |
|---|---|
| `AgentName = "claude" \| "openclaw" \| "hermes"` everywhere | Agent registry; agents are config |
| REST polling for activity/vitals | Single SSE stream off an event bus |
| `Agentic OS/` subfolder in vault | Inbox-first writes under `00_Inbox/agentic-os/` |
| `tags: [memory, agentic-os, 2026-05-11]` | Tags = broad domains only; type/agent/date in frontmatter |
| Linear `indexOf` over every `.md` | SQLite FTS5 (semantic later via sqlite-vec) |
| No scheduler | node-cron + `missions/*.ts` |
| No MCP | MCP transport + per-agent MCP server config |
| 15s subprocess timeout | Per-transport timeouts; streaming has no hard timeout |
| Hardcoded `ClaudePanel` / `HermesPanel` / `OpenClawPanel` | Generic `AgentPanel` driven by manifest; custom panels opt-in |
