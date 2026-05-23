# Architecture

This document describes the target architecture. Phases 1A, 1B, and
Phase 1C are implemented, plus the expandability-foundation milestones
M1 (feature foundation), M2 (registry-driven shell), M3 (SQLite run
ledger — see §7), and M4a (connector runtime — see §8). Phase 1C
includes the M1–M4 integration spine (PR #8 + PR #9) plus PR #10's
scheduled runtime slice: opt-in `node-cron` scheduled firing, useful
built-in mission outputs, and scheduler status visibility. The
scheduler remains disabled by default unless `features.scheduler.enabled:
true` is set.

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

### Phase 1C view — missions and scheduler runtime

Everything from 1B, plus a mission registry/planner/runner, constrained mission writer, manual-run API, and an opt-in in-process `node-cron` scheduler that fires registered missions automatically when `features.scheduler.enabled` is true.

```
[Everything from 1B, plus:]

┌──────────────────────────────────────────────────────────────────┐
│  SCHEDULER (node-cron, in-process, opt-in via scheduler.enabled) │
│                                                                   │
│  missions/                                                        │
│  ├── daily-summary.ts    (cron: "0 20 * * *")                    │
│  ├── weekly-review.ts    (cron: "0 18 * * 0")                    │
│  └── vitals-heartbeat.ts (cron: "*/15 * * * *", event-only)      │
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

### Phase 1C runtime slice — PR #10

M1–M4 are merged on `main`; PR #10 adds the scheduled runtime slice that
finishes Phase 1C:

- **Scheduler runtime.** `src/features/scheduler/runtime.ts` resolves
  effective plans, skips disabled/invalid/no-cron missions neutrally,
  schedules enabled plans through `node-cron`, and fires ticks through
  the same `runMission({ trigger: "scheduled" })` path used by manual
  execution.
- **Process bootstrap.** `src/instrumentation.ts` starts the global
  scheduler only in the Node.js server runtime. The feature remains
  disabled unless `features.scheduler.enabled: true` is set in config.
- **Built-in mission logic.** `daily-summary` and `weekly-review` now
  return useful dated inbox drafts; `vitals-heartbeat` emits a real
  heartbeat payload and has a 15-minute default cron.
- **Visibility.** `GET /api/scheduler/status` returns a neutral runtime
  snapshot with status, scheduled mission refs, and diagnostics.

The manual M4 runner remains the side-effect chokepoint: scheduled ticks
do not write files or emit events directly; they invoke `runMission()`.

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

> **Status (Phase 1C scheduled runtime):** config schema,
> registry triad, mission planning, mission runner, constrained writer,
> manual-run API, `node-cron` scheduled firing, scheduler status API, and
> `mission.run` audit entries are implemented by PR #10. The mission shape
> is a `MissionDefinition` whose `run()` returns `MissionOutput[]` for the
> central runner to persist (ADR-0011) — not a self-writing `{ cron, run }`
> handler.

- In-process `node-cron` scheduler, opt-in via `features.scheduler.enabled: true` in config.
- Handlers live as registered `MissionDefinition`s under `src/features/scheduler/missions/`; each `run(ctx)` returns `MissionRunResult` / `MissionOutput[]`.
- Built-in missions:
  - `daily-summary` — at 20:00, creates a dated summary draft in `00_Inbox/agentic-os/summaries/` through the constrained writer.
  - `weekly-review` — Sundays at 18:00, creates a weekly review draft in `00_Inbox/agentic-os/reviews/`.
  - `vitals-heartbeat` — every 15 minutes by default, emits an event-only heartbeat payload through the runner/bus path.
- Missions write to the inbox only through `src/vault/constrainedWriter.ts`; promotion is the user's call.

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

### 7. State store and run ledger (M3)

Agentic OS persistence is **four stores**, each with one role (see [`decisions/ADR-0014-persistence-four-store-split.md`](decisions/ADR-0014-persistence-four-store-split.md)):

- the Obsidian **markdown vault** — canonical user-facing content;
- the SQLite **state DB** (`~/.agentic-os/state.db`) — mutable, transactional platform state;
- **filesystem artifacts** (`~/.agentic-os/artifacts/`) — opaque generated bytes (a later milestone; the slot is named now);
- the **JSONL audit log** — append-only and immutable (ADR-0009).

`index.db` is a *derived* FTS index of the vault — disposable and rebuildable — not a fifth store.

**State DB versioning.** `state.db` carries a `stateDbVersion` in a `_meta` table. An ordered migration runner brings the schema up to date when the DB is opened; a forward guard refuses a DB stamped newer than the running build; a WAL-safe `db.backup()` snapshot is taken before any migration applies. Each milestone appends one immutable migration.

**Run ledger.** The state DB's first occupant is the run ledger — tables `runs` / `run_steps` / `external_refs`. A *run* is any tracked unit of work: a scheduled or manual mission today; connector tests and orchestration phases later. The `RunLedger` service (`src/kernel/state/runLedger.ts`) owns create / transition / cancel-with-cascade / steps / external refs, behind a locked transition validator. The scheduler runner mirrors every mission fire into the ledger — a ledger write failure never breaks the mission run; the audit JSONL line stays the source-of-truth record, joined to the ledger by `runId`.

**Restart recovery.** At server boot, before the scheduler starts (`src/instrumentation.ts`), every non-terminal run has its `onRestart` policy applied (`mark-interrupted` / `cancel` / `resume`-stub) so a run interrupted by a restart is never mistaken for a fresh one.

**`/api/runs`** exposes the ledger read-only plus cancel (`list` / `detail` / `cancel`) — a platform route: CORS-gated, neutral errors, `inputSummary` redacted. See [`decisions/ADR-0016-run-ledger-foundation.md`](decisions/ADR-0016-run-ledger-foundation.md).

### 8. Connector runtime (M4a)

Phase 1C ended with the capability router (ADR-0012) dispatching into a stub. M4a turns that stub into real connector dispatch — Claude Code + Hermes (CLI agents) and OpenAI-compatible LLMs (HTTP) are first-class.

**Three-level identity.** A connector is described at three never-blurred levels:

- **`ConnectorFamilyDefinition`** — the *type*, lives in code (`cli-acp-agent`, `openai-compatible-llm`). Owns `settingsSchema`, advertised `capabilities`, `invoke`, `testConnection`.
- **`ConnectorPreset`** — a declarative pre-fill of a family's settings, picked from a catalog at Add-Provider time. Lives in JSON (`presets/*.json` first-party + `~/.agentic-os/presets/*.json` operator/community). See [`decisions/ADR-0018-connector-preset-catalog.md`](decisions/ADR-0018-connector-preset-catalog.md).
- **`ConnectorInstanceConfig`** — the operator's specific configured copy, written to `~/.agentic-os/config.yaml` by the Add Provider flow. Carries its own `id`, `enabled`, `authRef`, `settings`, optional capability narrowing, and an optional `allowLocalNetwork` opt-in.

The router's `connectorId` is the **instance id** everywhere — in `RunRecord`, audit envelopes, `ConnectorInvokeContext`, and the API surface. Effective capabilities for an instance are `family.capabilities` ∩ `preset.capabilities` (if narrowed) ∩ `instance.capabilities` (if narrowed) — narrowing only.

**Secrets — env-only, name-only.** A connector instance stores an `authRef` (`"none"` or `"env:VAR_NAME"`), never a raw key. `resolveAuthRef()` reads from `process.env` server-side and hands the value to the family as `ConnectorInvokeContext.secret`. The resolved secret never reaches `~/.agentic-os/config.yaml`, the audit JSONL, `/api/runs`, `/api/connectors`, or any log line. A 14-name secret-key screen (`apiKey` / `api_key` / `token` / `password` / `bearer` / `secret` / `clientSecret` / `client_secret` / `accessToken` / `access_token` / `refreshToken` / `refresh_token` / `privateKey` / `private_key`, case-insensitive, any depth) rejects an operator pasting a key into `settings` before the config write commits. See [`decisions/ADR-0017-connector-runtime-and-authref.md`](decisions/ADR-0017-connector-runtime-and-authref.md).

**`testConnection` is a Run.** Hitting "Test connection" creates a `connector-test` RunRecord in the ledger (§7 above / ADR-0016), mirrors the family's `ConnectorValidationResult` into its terminal state, awaits the `connector.test` audit line before resolving, and never lets a raw provider error string cross — the audit carries the neutral `errorCode` only.

**Subprocess discipline.** CLI families (`cli-acp-agent`) spawn through the existing `safeSpawn` helper — argv arrays (never `shell: true`), per-arg length cap, null-byte rejection, env allowlist, `NO_COLOR` forced, per-call timeout. Stdout is bounded; stderr is read and never surfaced.

**HTTP discipline.** LLM families (`openai-compatible-llm`) pass through the SSRF guard (`assertPublicBaseUrl`) at config-add and testConnection time. At invoke time, `redirect: "manual"` blocks 3xx-based rebinding so a 3xx becomes `network-unreachable`, never auto-followed; pure DNS-TTL rebinding between testConnection and invoke is an acknowledged limitation tracked in the parked M4a-5 design (request-time DNS re-resolution / IP-pinning is a named follow-up, not shipped in M4a). Families send `Authorization: Bearer <ctx.secret>` only when a secret is present (Ollama-compatible endpoints work secret-less). The SSRF guard blocks `127/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`, `0.0.0.0`, `localhost`, `::1`, `::`, `fc00::/7`, `fe80::/10`, and IPv4-mapped IPv6 (`::ffff:…`). The deprecated IPv4-compatible IPv6 form (`::a.b.c.d`) is the parked M4a-5 hardening item.

**Capability router — real dispatch.** `router.invoke(capabilityId, input, { connectorId? })` resolves the instance, refuses a disabled instance neutrally, verifies the capability is in the instance's effective set, resolves `authRef`, calls the family, and sanitises any thrown or returned failure into the closed `RouterErrorCode` neutral envelope (`config-invalid`, `connector-unknown`, `connector-invoke-threw`, `connector-returned-failure`, `permission-denied` — per ADR-0012 / ADR-0017 / spec B13). `CapabilityInvokeResult.errorCode` is typed `RouterErrorCode | undefined` (M4a-5 PR AB tightening). `permission-denied` is the scheduler mission-runner adapter's pre-router gate; it implements `CapabilityRouter`, so the code sits on the router contract surface — it is NOT a `ConnectorErrorCode`, which remains a separate union that never crosses through `router.invoke`. A failing connector cannot leak a raw error or stack.

**Routes.** `/api/connectors` (list / add / detail), `/api/connectors/presets` (catalog), and `/api/connectors/[id]/test` (run testConnection). The Settings → Connectors UI consumes them; the Add Provider flow lets an operator add an OpenAI-compatible provider with no code, supplying only the env var NAME holding the key.

**Hermes read-only Kanban (M4a-4).** `cli-acp-agent` advertises the read-only kanban capabilities (`kanban.board.list`, `kanban.task.list`, `kanban.task.show`) via the Hermes instance, projecting Hermes JSON to neutral DTOs. Write capabilities (`kanban.task.create`) are declared in `CapabilityIdSchema` but no connector advertises them — M4a is read-only by design.

## Config and secrets

- `~/.agentic-os/config.yaml` — vault path, default agent, scheduler enable, location label, UI accent overrides.
- `~/.agentic-os/agents/*.yaml` — user-defined agent manifests, merged with built-ins.
- `~/.agentic-os/secrets.yaml` — legacy platform-flag secrets predating M4a. **Not the connector secret pathway** — M4a connectors read `process.env` only (`authRef: "env:VAR_NAME"`; see §8). Mode 0600. Never logged.
- `~/.agentic-os/state.db` — SQLite state DB (run ledger; see §7). Not config: mutable platform state, migrated on open.
- `~/.agentic-os/presets/*.json` — operator/community connector presets, walked at boot, trust-clamped downward (see §8 / ADR-0018).
- All paths resolvable from env vars: `AGENTIC_OS_CONFIG`, `AGENTIC_OS_VAULT`, `AGENTIC_OS_STATE_DB`, `AGENTIC_OS_AUDIT_DIR`, `AGENTIC_OS_PRESETS_DIR`, etc.

## Security model (Phase 1, all slices)

- Bind 127.0.0.1 only. No CORS for non-localhost origins.
- Every subprocess invocation goes through a single `spawn()` helper that uses argv arrays (never `shell: true`), enforces arg-length caps, and rejects null bytes.
- Per-agent Control Room actions (read-only CLI verbs surfaced as rows in the Control Room view) are declared in each manifest's `actions:` block and invoked via `/api/agents/[name]/actions/[action]`. The endpoint uses `safeSpawn` + the env allowlist, clamps timeouts at 60s, caps stdout/stderr at 256 KiB per stream, sanitises output server-side (strip ANSI / per-line clamp) before returning to the localhost UI, and records `agent.action` JSONL entries with cleaned-text lengths only — raw output never reaches the audit log. See [`SECURITY.md`](SECURITY.md) and [`AGENT-MANIFEST.md`](AGENT-MANIFEST.md) for the full contract.
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
