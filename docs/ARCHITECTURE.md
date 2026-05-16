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

> **This is the TARGET architecture (end-of-Phase-2).** See `ROADMAP.md` for what ships in each phase. Per-phase views are below this diagram so you can see exactly what's in scope for Phase 1A, 1B, and 1C.

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

### Phase 1A view — kernel skeleton

Intentionally ugly UI. No persistence beyond markdown in the vault and JSONL in the audit log. Two transports only. Just enough kernel to prove a prompt can flow end-to-end through the abstractions and produce a vault note.

```
┌─────────────────────────────────────────────────────────────────┐
│         Browser (127.0.0.1:3000) — intentionally unstyled       │
│  Agent list · Live event stream · One prompt box for selected   │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP one-shot + SSE
┌────────────────────────────▼────────────────────────────────────┐
│                  Next.js app (Node runtime)                      │
│   /api/agents · /api/agents/[name]/run · /api/events (SSE)       │
│                             │                                    │
│   ┌─────────────────────────▼─────────────────────────────────┐ │
│   │              AGENT REGISTRY (YAML manifests)               │ │
│   │   agents/builtin/{claude-code,hermes}.yaml                 │ │
│   └─────────┬──────────────────────────┬───────────────────────┘ │
│             ▼                          ▼                          │
│   ┌──────────────────┐        ┌──────────────────┐               │
│   │ subprocess       │        │ streamJson       │               │
│   │ Transport        │        │ Transport        │               │
│   │ (hermes -z)      │        │ (claude -p …)    │               │
│   └────────┬─────────┘        └────────┬─────────┘               │
│            │                           │                          │
│   ┌────────▼───────────────────────────▼─────────────────────┐   │
│   │     VAULT WRITER (inbox-first, collision-safe,            │   │
│   │                   atomic tmp+rename)                      │   │
│   └────────────────────────┬──────────────────────────────────┘   │
└────────────────────────────┼─────────────────────────────────────┘
                             ▼
        ~/Documents/Obsidian/Rex-Knowledge/00_Inbox/agentic-os/

Sidecar:  ~/.agentic-os/audit/YYYY-MM-DD.jsonl  (agent.invoke, vault.write)
Config:   ~/.agentic-os/config.yaml  (single durable file; see ADR-0007)
```

### Phase 1B view — adds operator UX, SELF layer, FTS5 index

Everything from 1A, plus: Julian's aesthetic ported (Tailwind + Framer Motion + cmdk), health probes, vitals card, activity stream UI, Goals/Journal/Memory pages, vault reader, SQLite FTS5 index with a chokidar watcher, and the `npm run setup` wizard.

```
[Everything from 1A, plus:]

┌─────────────────────────────────────────────────────────────────┐
│       Browser — Mission Control aesthetic                       │
│       (Tailwind + Framer Motion + cmdk; ported from v0.1)       │
│       Vitals card · Activity stream · Goals · Journal · Memory  │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
              [registry + transports from 1A]
                             │
            ┌────────────────┼─────────────────┐
            ▼                ▼                 ▼
   Health probe loop   Vault writer    Vault READER (file walk)
   (per-manifest      (from 1A)                 │
    intervalSec,                                ▼
    default 300s)                    SQLite FTS5 INDEX
                                     ~/.agentic-os/index.db
                                                ▲
                                                │
                                      chokidar watcher
                                      (vault → index sync)

Setup wizard: npm run setup (auto-detect agents, build initial index)
```

### Phase 1C view — adds scheduler and missions

Everything from 1B, plus an in-process `node-cron` scheduler (disabled by default) and a `missions/` directory of cron-triggered handlers that write their output through the inbox-first writer like any other agent action.

```
[Everything from 1B, plus:]

┌──────────────────────────────────────────────────────────────────┐
│  SCHEDULER (node-cron, in-process, opt-in via scheduler.enabled) │
│                                                                   │
│  missions/                                                        │
│  ├── daily-summary.ts    (cron: "0 20 * * *")                    │
│  ├── weekly-review.ts    (cron: "0 18 * * 0")                    │
│  └── vitals-heartbeat.ts (fires events only on state change)     │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
                  VAULT WRITER (inbox-first)
                           │
                           ▼
                  00_Inbox/agentic-os/summaries/
                  00_Inbox/agentic-os/reviews/

Audit:  mission.run events on the bus + JSONL log
```

## Layer breakdown

### 1. Agent Registry (Phase 1A)

A manifest-driven catalog of every brain the OS can talk to. See [`AGENT-MANIFEST.md`](AGENT-MANIFEST.md) for the schema.

- Manifests live at `agents/builtin/*.yaml` (shipped) and `~/.agentic-os/agents/*.yaml` (user overrides).
- A manifest declares: `name`, `displayName`, `transport` (one of `subprocess` / `streamJson` / `http` / `mcp` / `sdk`), transport-specific config, `capabilities` (`chat` / `streamingChat` / `tools` / `mcp`), `healthProbe`, optional `logsDir`.
- The registry exposes: `list()`, `get(name)`, `health(name)`, `chat(name, opts)`, `stream(name, opts)`, `runVerb(name, verb, args)`.
- No code anywhere else references agent names as a literal. The registry is the only source of truth.

This kills Julian's `"claude" | "openclaw" | "hermes"` union and unblocks adding ChatGPT/OpenRouter/Ollama/etc. without touching the kernel.

### 2. Transports (phased)

| Transport | Use case | Phase |
|---|---|---|
| `subprocess` | One-shot CLI agents that return JSON or text on stdout (hermes, openclaw). | 1A |
| `streamJson` | Specialized subprocess for `claude -p --output-format=stream-json` — parses the Claude Code event format and re-emits typed events on the bus. | 1A |
| `http` | Any HTTP-callable model API (OpenRouter, OpenAI, local Ollama, etc.). Reads API key from `~/.agentic-os/secrets.yaml` (priority: env > file > error). | 2A |
| `mcp` | Talk to any MCP server as if it were an agent (or call its tools from another agent). Lands after `http` and the promotion UI are boring and stable. | 2C |
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

### 3. Event Bus + SSE (Phase 1A)

- In-process `EventEmitter` (single instance, exposed via a module-level singleton).
- Events have a typed envelope: `{ id, ts, source, kind, payload }` where `source` is the agent name or `"system"` / `"vault"` / `"scheduler"`.
- One SSE endpoint at `/api/events` fans the bus out to the browser.
- Filtering happens client-side (the bus is small, this keeps the server simple).
- Replaces Julian's REST polling for activity + vitals.

### 4. Scheduler (Phase 1C)

- `node-cron` in-process. Cron expressions + JS handlers. Opt-in via `scheduler.enabled: true` in config.
- Handlers live at `missions/*.ts`, each exporting `{ cron: string, run: (ctx) => Promise<void> }`.
- Built-in missions:
  - `daily-summary` — at 20:00, summarize today's chats + journal into `00_Inbox/agentic-os/summaries/YYYY-MM-DD.md`.
  - `weekly-review` — Sundays at 18:00, draft a weekly review note for promotion.
  - `vitals-heartbeat` — emits bus events only when an agent's health state changes (LIVE → DEGRADED → OFFLINE). Probe cadence itself is per-manifest `intervalSec` (default 300s), not a fixed 60s tick.
- Missions write to the inbox like everything else; promotion is the user's call.

### 5. Knowledge Layer (Phase 1A writer; 1B reader + FTS5 index)

Markdown is canonical. SQLite is derived.

**Reader (`vault/reader.ts`):**
- Walks the vault honoring `.gitignore` and the configured skip list (`.obsidian`, `.trash`, `.git`).
- Exposes `searchFts(q)`, `recent(n)`, `byTag(tag)`, `byFrontmatter(key, value)`.

**Writer (`vault/writer.ts`) — inbox-first contract:**
- `draftInbox({ kind, title, frontmatter, body })` writes to `00_Inbox/agentic-os/<kind>/...`. Chat kind uses `YYYY-MM-DD-HHMM-{agent}-{promptSha8}.md` (hash-based filename — no prompt-derived characters land in the filename, see `docs/VAULT-CONTRACT.md`). Non-chat kinds use `YYYY-MM-DD-{slug}.md` from operator-authored titles. No approval needed for inbox writes (matches your existing `Hermes Obsidian Approved Write Workflow` decision).
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
- **Phase 1A UI is intentionally unstyled and functional-only.** Plain HTML, default browser fonts, no Tailwind classes, no animation. The goal is to verify the kernel works end-to-end without spending time on aesthetics until the API surface is stable.
- **Phase 1B** ports Julian's aesthetic (aurora gradients, glass panels, pill statuses) — re-implemented from his components, not forked, to avoid carrying his hardcoded agent assumptions.
- New top-level: `<EventBusProvider>` opens the SSE stream on mount and pipes typed events into a React context that every panel can subscribe to.
- `AgentPanel` is generic — driven by the agent manifest, not per-agent React components. Custom panels can still be registered for agents that want bespoke UIs (e.g., a Hermes kanban view).

## Config and secrets

- `~/.agentic-os/config.yaml` — vault path, default agent, scheduler enable, location label, UI accent overrides.
- `~/.agentic-os/agents/*.yaml` — user-defined agent manifests, merged with built-ins.
- `~/.agentic-os/secrets.yaml` — API keys (OpenRouter, Anthropic, OpenAI). Mode 0600. Never logged.
- All paths resolvable from env vars: `AGENTIC_OS_CONFIG`, `AGENTIC_OS_VAULT`, etc.

## Security model (Phase 1, all slices)

- Bind 127.0.0.1 only. No CORS for non-localhost origins.
- Every subprocess invocation goes through a single `spawn()` helper that uses argv arrays (never `shell: true`), enforces arg-length caps, and rejects null bytes.
- CLI verbs exposed via `/api/run` use an allowlist per agent (Julian's pattern, kept). `/api/run` itself lands in Phase 1B with the action panels.
- Vault paths normalized with `path.resolve` and rejected if they escape the vault root.
- Audit log: JSONL, one file per UTC day at `~/.agentic-os/audit/YYYY-MM-DD.jsonl`. See [`SECURITY.md`](SECURITY.md#audit-log) and [`decisions/ADR-0009-jsonl-audit-log.md`](decisions/ADR-0009-jsonl-audit-log.md) for the schema and redaction rules.
- See [`SECURITY.md`](SECURITY.md) for the full threat model and the plan for LAN/remote auth in later phases.

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
