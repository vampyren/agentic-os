# Roadmap

Phased delivery. Each phase has explicit exit criteria. We don't start the next phase until the prior one ships.

## Phase 0 — Planning (this commit)

**In scope**

- This documentation set (README, ARCHITECTURE, ADRs, this roadmap, vault contract, security, install placeholder).
- Repository on GitHub with MIT license.
- `source-julian/` kept as reference, not as a fork base.

**Exit criteria**

- Docs reviewed by operator (you).
- Any pushback on architecture, ADRs, or vault contract resolved with new ADRs.
- Phase 1 work items broken into GitHub issues.

---

## Phase 1 — Working Mission Control on localhost

**Goal:** A single operator, on one machine, can open `http://127.0.0.1:3000` and:
- See live status of every configured agent (LIVE / BUSY / DEGRADED / OFFLINE).
- Stream chat with Claude Code and Hermes from one dashboard.
- Set goals and write a journal entry; both land in the Obsidian inbox.
- Search the vault from the dashboard.
- See an activity stream of recent agent runs.

**In scope**

- Next.js 16 App Router scaffold (mirror Julian's stack: Tailwind v4, Framer Motion, React 19, lucide-react, cmdk, react-markdown).
- Agent registry loading from `agents/builtin/*.yaml` + `~/.agentic-os/agents/*.yaml`.
- Built-in manifests for Claude Code (`streamJson` transport) and Hermes (`subprocess` transport).
- Transports: `subprocess`, `streamJson`. Others stubbed.
- Event bus + `/api/events` SSE endpoint. All agent stdout/stderr, vault writes, vitals flow through it.
- Vault reader + writer enforcing the inbox-first contract.
- Goals page (writes to `00_Inbox/agentic-os/goals/` — see VAULT-CONTRACT for the file layout debate).
- Journal page (writes to `00_Inbox/agentic-os/journal/YYYY-MM-DD.md`).
- Memory page (full-text search via SQLite FTS5 over the vault).
- Setup wizard: `npm run setup` detects installed agents, picks vault path, writes `~/.agentic-os/config.yaml`.
- Audit log at `~/.agentic-os/audit.log` (append-only, daily rotation).
- Vitest unit tests + Playwright smoke tests. GitHub Actions CI runs both on PRs.

**Out of scope (Phase 2+)**

- MCP support of any kind.
- Scheduler / cron / missions.
- Embeddings / semantic search.
- HTTP-transport agents (OpenRouter, OpenAI, Ollama).
- Agent SDK transport.
- Remote access / LAN / auth.
- Mobile UI.
- Promotion UI for inbox notes (Phase 1 writes only; you promote manually in Obsidian).

**Exit criteria**

- `npm install && npm run setup && npm run dev` works on a fresh clone with only Claude Code installed.
- All Phase 1 manifests' health probes return correct LIVE/OFFLINE.
- Streaming Claude chat works end-to-end and the conversation lands in `00_Inbox/agentic-os/chats/YYYY-MM-DD.md`.
- CI green on `main`.
- README quickstart actually works (verified by running it on a clean directory).

---

## Phase 2 — MCP, scheduler, deep Obsidian

**Goal:** The OS does work for you while you sleep, and your Obsidian vault becomes a first-class second brain that agents actually use, not just write to.

**In scope**

- `mcp` transport: register MCP servers in config; expose their tools to any agent that supports tool use.
- Per-agent MCP server attachments (e.g., give Claude Code access to a Playwright MCP server).
- Scheduler: `node-cron` + `missions/*.ts`.
- Built-in missions: `daily-summary` (20:00 daily), `weekly-review` (Sundays), `vitals-heartbeat` (every 60s).
- Custom missions: user-defined in `~/.agentic-os/missions/*.ts`.
- HTTP transport: OpenRouter and OpenAI providers shipped as built-in manifests. API keys in `~/.agentic-os/secrets.yaml` (mode 0600).
- Vault: filesystem watcher rebuilds the SQLite index on change. Drop the manual rebuild step.
- Vault: promotion UI in the dashboard — review inbox drafts, choose destination (`10_Projects/`, `40_Decisions/`, etc.), apply the matching template's frontmatter, move the file.
- Vault: `agent:` frontmatter field added on every OS-written note so we can filter "all notes Claude drafted last week."
- Memory: optional `sqlite-vec` index for semantic recall using a local embedding model (`nomic-embed-text` via Ollama).
- Agent-to-agent workflows: `/api/workflows` lets you chain agents (e.g., "Hermes researches → Claude drafts → human reviews").

**Out of scope (Phase 3)**

- Remote access.
- Multi-user.
- Hosted cloud.

**Exit criteria**

- At least one nightly mission has been running for 7 consecutive days and you've actually used its output.
- Inbox promotion UI handles all 8 of your existing templates (Decision, Project, Research, Runbook, Todo, Cheat Sheet, Inbox Capture, Troubleshooting).
- An MCP server (e.g., Playwright) is wired and Claude can use it from the dashboard chat.
- Semantic search returns useful results across 1000+ vault notes.

---

## Phase 3 — Remote access, plugin pattern, polish

**Goal:** Use the OS from your phone on the same network or from anywhere via a tunnel. Other people can write plug-ins.

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
