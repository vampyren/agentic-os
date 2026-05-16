# Roadmap

Phased delivery. Each phase has explicit exit criteria. We don't start the next phase until the prior one ships.

## Phase 0 — Planning (this commit)

**In scope**

- This documentation set (README, ARCHITECTURE, ADRs, this roadmap, vault contract, security, install placeholder).
- Repository on GitHub with MIT license.

**Exit criteria**

- Docs reviewed by operator (you).
- Any pushback on architecture, ADRs, or vault contract resolved with new ADRs.
- Phase 1A work items broken into GitHub issues.

---

## Phase 1 — Working Mission Control on localhost

Split into three slices so each is small enough to review end-to-end. See ADR-0007 for the rationale.

> **Phase sequencing — no interleaving.** Do not start 1B until all 1A exit criteria pass and the operator explicitly signs off. Same for 1B → 1C. The split exists specifically to keep each slice's blast radius small; jumping ahead defeats the purpose. If a 1B-shaped need surfaces during 1A work, file it as a 1B issue and continue with 1A.

### Phase 1A — Kernel skeleton (the minimum viable spine)

**Goal:** Prove the abstractions work end-to-end with one real agent. Ugly UI is fine. No persistence beyond markdown + JSONL audit log.

**In scope**

- Next.js 16 App Router project skeleton with strict TypeScript.
- Config loading from `~/.agentic-os/config.yaml` (env override allowed).
- Agent manifest loading from `agents/builtin/*.yaml` + `~/.agentic-os/agents/*.yaml`.
- Agent registry: `list()`, `get(name)`, `health(name)`, `chat(name, opts)`, `stream(name, opts)`.
- Two transports only: `subprocess` and `streamJson` (Claude Code via `claude -p --output-format=stream-json`).
- One built-in manifest each for Claude Code and Hermes.
- Typed in-process event bus + `/api/events` SSE endpoint.
- REST endpoints: `/api/agents` (list), `/api/agents/[name]/run` (one-shot).
- Vault writer for inbox-first drafts only (`00_Inbox/agentic-os/`). Collision-safe naming. Atomic write (tmp + rename).
- JSONL audit log (`~/.agentic-os/audit/YYYY-MM-DD.jsonl`) for `agent.invoke` and `vault.write`.
- **Minimal unstyled UI:** lists loaded agents, shows live event stream, has one prompt box that sends to a selected agent and renders the streamed response. No animations, no aurora gradients, no glass panels yet — those are 1B.
- Test scaffolding: `vitest` + 3 unit tests (registry resolution, subprocess transport happy path, vault writer collision-safe naming). CI runs them on every PR.

**Out of scope for 1A (deferred to 1B/1C or later)**

- Health probes / vitals card / agent status indicators.
- Activity stream UI.
- Goals page, journal page, memory page.
- SQLite FTS5 index.
- File watcher.
- Custom UI styling.
- Setup wizard (`npm run setup`) — operators write config by hand in 1A.

**Exit criteria for 1A**

- `npm install && npm run dev` works on a fresh clone with only Claude Code installed.
- Operator can type a prompt, see it stream from Claude, see the event flow on `/api/events`, see the chat land in `00_Inbox/agentic-os/chats/`.
- Two writes with the same slug produce two distinct files (no overwrite).
- A killed write leaves no `.md.tmp` lying around after restart.
- CI green: typecheck + vitest pass on `main`.
- Operator signs off on the kernel API surface before 1B starts.

---

### Phase 1B — Operator UX (port Julian's aesthetic, add the SELF layer)

**Goal:** The dashboard looks like Mission Control and the operator can do their daily SOP from it. Still no scheduler.

**In scope**

- Port Julian's UI aesthetic: Tailwind v4 + Framer Motion, aurora gradients, glass panels, pill statuses, command palette (cmdk).
- Generic `AgentPanel` driven by manifest capabilities. Custom panels remain possible but none ship in 1B.
- Health probes (per-agent `intervalSec`, default 300s). Vitals card on the dashboard.
- Activity stream UI subscribed to the event bus.
- Goals page → writes to `00_Inbox/agentic-os/goals/`.
- Journal page → writes to `00_Inbox/agentic-os/journal/YYYY-MM-DD.md`.
- Memory page: vault search via SQLite FTS5. `better-sqlite3` + `chokidar` watcher for incremental index updates.
- Setup wizard (`npm run setup`): detects installed agents, picks vault path, writes `~/.agentic-os/config.yaml`.
- Playwright smoke tests for the dashboard (loads, lists agents, sends a chat).

**Out of scope for 1B**

- Scheduler / missions.
- HTTP-transport agents.
- MCP.

**Exit criteria for 1B**

- Operator's daily morning SOP (check vitals → review yesterday's chats → set today's intent) is doable in <5 minutes through the dashboard.
- FTS5 index returns results in <50ms on the operator's vault (~50 notes today; benchmarked to project to 5000+).
- Playwright smoke green on `main`.
- Operator signs off on UX before 1C.

---

### Phase 1C — Scheduler and missions

**Goal:** The OS does work for the operator on a schedule.

**In scope**

- `node-cron` scheduler in-process. Disabled by default; opt-in via `scheduler.enabled: true` in config.
- `missions/*.ts` registry. Each mission: `{ cron, run(ctx) }`.
- Built-in missions: `daily-summary` (20:00 daily), `weekly-review` (Sundays 18:00), `vitals-heartbeat` (only fires events when state changes, not every tick).
- Mission output writes to `00_Inbox/agentic-os/summaries/` and `reviews/` via the inbox-first writer.
- Mission audit entries in the JSONL log (`kind: "mission.run"`).
- One Playwright test that runs a mission and asserts the output file is created.

**Exit criteria for 1C**

- Operator can disable a built-in mission without editing kernel code.
- A failing mission logs the failure and does not crash the kernel.
- At least one custom user-defined mission has been written by the operator and runs successfully for 3 consecutive days.

---

## Phase 2 — Beyond the kernel: HTTP providers, then MCP, then deep Obsidian

**Goal:** Real second-brain — cloud models, browser automation, semantic recall, promotion UI.

Ordered so the base transports become boring before MCP arrives (see ADR-0007 / ChatGPT-review).

### Phase 2A — HTTP transport

- `http` transport implementation.
- Built-in manifests: OpenRouter, OpenAI direct, Ollama.
- `~/.agentic-os/secrets.yaml` enforced (mode 0600, env > file > error priority per SECURITY.md).
- Streaming response parsers: `openai-sse`, `ollama-ndjson`, `anthropic-events`.

### Phase 2B — Promotion UI and deep Obsidian

- Promotion UI: review inbox drafts, choose destination (`10_Projects/`, `40_Decisions/`, ...), apply matching template frontmatter, move the file.
- `agent:` frontmatter field on every OS-written note.
- All 8 of the operator's existing templates supported in the promotion picker.
- Semantic recall: optional `sqlite-vec` index using `nomic-embed-text` via Ollama. FTS5 stays primary.
- Workflow primitive: `/api/workflows` lets operator chain agents ("Hermes researches → Claude drafts → human reviews").

### Phase 2C — MCP

Only after 2A and 2B are stable.

- `mcp` transport implementation.
- Per-agent MCP server attachments (`mcpServers:` in manifest).
- Built-in MCP servers documented: Playwright, Git, Filesystem.
- MCP tool calls visible in the event bus and audit log like any other agent action.

**Out of scope for Phase 2 (Phase 3)**

- Remote access.
- Multi-user.
- Hosted cloud.

**Exit criteria for Phase 2**

- At least one nightly mission consumes HTTP-transport agent output and writes to the inbox.
- Promotion UI handles all 8 templates.
- An MCP server (Playwright minimum) is wired and Claude uses it from the dashboard chat.
- Semantic search returns useful results across 1000+ vault notes.

---

## Phase 3 — Remote access, plugin pattern, polish

**Goal:** Use the OS from a phone on the same network or from anywhere via a tunnel. Other people can write plug-ins.

**In scope**

- Bind 0.0.0.0 mode with bearer token auth (per-device tokens issued from the dashboard).
- Audit log includes source IP + token name for every action.
- Documented Cloudflare Tunnel / Tailscale deployment guides.
- PWA shell for mobile-friendly Mission Control.
- Voice replies (TTS via browser Web Speech API).
- Plug-in pattern: third-party agent manifests + custom panels distributed as npm packages or `~/.agentic-os/plugins/<name>/`.
- `sdk` transport: optional `@anthropic-ai/claude-agent-sdk` for users who want in-process tool callbacks and have an `ANTHROPIC_API_KEY`.

**Exit criteria**

- The full system runs successfully behind Tailscale and is usable from a phone.
- At least one third-party manifest is documented and tested (the OpenRouter manifest counts as a self-test).
- A documented "Agent SDK opt-in" path exists for users who outgrow the subprocess approach.

---

## Non-roadmap (explicitly never)

- Hosted SaaS version.
- Anything that requires a centralized backend Anthropic doesn't already operate.
- Anything that ships the operator's chat history off-machine without an explicit per-session opt-in.
