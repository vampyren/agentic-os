# Agentic OS

A local-first mission control for your AI agents. Single dashboard. Pluggable brains. Your knowledge stays in your vault.

> **Status: v0.3.0 released; Phase 1C scheduler + missions runtime complete.** Runnable. Two built-in agents (Claude Code, Hermes) work end-to-end. Mission Control UI, sidebar command palette, per-agent Chat ⇄ Control Room toggle with Hermes Status/Sessions/Insights actions, Hermes memory bars, context-fill chat usage strip, per-agent working-directory picker, Memory page with tabs + filter chips + right-pane preview, vault inbox-first writes, SQLite FTS5 search, setup wizard, JSONL audit log with full prompt redaction, and the Phase 1C mission execution/runtime spine (manual-run API, constrained writer, opt-in `node-cron` scheduled firing, built-in summary/review/heartbeat missions, and scheduler status API). See [`CHANGELOG.md`](CHANGELOG.md) for version history.

---

## What this is

One process on your laptop that gives you:

- A **dashboard** showing the live status of every brain you've connected (Claude Code, Hermes, OpenClaw, ChatGPT, OpenRouter, local Ollama, anything CLI- or HTTP-callable).
- An **agent registry** so adding a new brain is one YAML/TS manifest, not a code refactor.
- A **streaming chat surface** for every agent, plus a Control Room for manifest-declared read-only CLI verbs.
- A **scheduler** for missions (daily summary, weekly review, vitals heartbeat), disabled by default and enabled explicitly in config.
- A **mission execution spine** for safe manual and scheduled mission runs through the same runner, permission, constrained writer, and audit paths.
- A **knowledge layer** that respects your existing Obsidian vault rules: writes land in the inbox first, promotion is gated, frontmatter carries metadata, tags stay broad.

What it is **not**: a cloud SaaS, a chatbot wrapper, or a fork of any closed source.

## Why this exists

The conceptual model — Mission Control with multiple AI agents in panels, Obsidian as the second brain — was inspired by an AIPB-members-only build by Julian Goldie. That demo showed the shape; the architecture here is a clean re-pour designed to scale to N agents, MCP, a scheduler, embeddings, and real workflows.

The reference build itself is **not redistributed here** (AIPB members-only license). See [`docs/decisions/ADR-0006-rebuild-not-fork-of-julian-v01.md`](docs/decisions/ADR-0006-rebuild-not-fork-of-julian-v01.md) for the rebuild rationale.

## Design pillars

1. **Agents are plug-ins, not enums.** Declarative manifests + a `Transport` interface (subprocess / HTTP / MCP / Agent SDK).
2. **Claude Code is embedded, not paid for again.** Default transport is `claude -p --output-format=stream-json`, reusing your existing Claude subscription. `@anthropic-ai/claude-agent-sdk` is an opt-in alternative for users who want in-process tool callbacks.
3. **One event bus.** All agent stdout/stderr, vault writes, vitals changes, and scheduled job events flow through a single bus → one SSE stream to the UI. No REST polling.
4. **Markdown is source of truth, SQLite is the index.** Your `.md` files in Obsidian stay canonical and human-readable. A local SQLite FTS5 index (and later sqlite-vec for semantic recall) lives in `~/.agentic-os/index.db` for fast search.
5. **Inbox-first vault contract.** Agents write drafts freely to `00_Inbox/agentic-os/...`. Promotion to permanent folders is gated through the dashboard. Honors the existing `Hermes Obsidian Approved Write Workflow` decision in your vault.
6. **Localhost by default.** Phase 1 binds 127.0.0.1, no auth. LAN/remote modes ship later with proper auth.
7. **Ship in phases.** See [`docs/ROADMAP.md`](docs/ROADMAP.md). Phase 1 splits into 1A (kernel skeleton + intentionally ugly UI), 1B (operator UX + SELF layer + FTS5 index), 1C (scheduler + missions). Phase 2 splits into 2A (HTTP-transport agents), 2B (promotion UI + semantic recall), 2C (MCP). Phase 3 = remote access + plugin marketplace pattern + opt-in Claude Agent SDK transport.

## Repository layout

```
README.md                  this file
LICENSE                    MIT
CHANGELOG.md               Keep-a-Changelog format; phase → version mapping
CONTRIBUTING.md
docs/
  ARCHITECTURE.md          layers, transports, event bus, knowledge layer
  ROADMAP.md               phase 0/1/2/3 with exit criteria
  AGENT-MANIFEST.md        how to add a brain (declarative schema + example)
  VAULT-CONTRACT.md        Obsidian integration rules
  SECURITY.md              localhost defaults, auth boundary, audit log
  FEATURE-INTEGRATION.md   checklist/prompt for adding Studio, Kanban, providers, etc.
  INSTALL.md               prereqs + first-run steps
  decisions/               ADRs
agents/builtin/            shipped agent manifests (claude-code, hermes)
src/                       application code (kernel + UI)
tests/                     vitest unit + security tests
e2e/                       Playwright smoke tests
```

## Quickstart

```bash
git clone git@github.com:vampyren/agentic-os.git
cd agentic-os
npm install
npm run setup        # interactive wizard: detects installed agents, writes ~/.agentic-os/config.yaml
npm run dev          # opens http://127.0.0.1:3000
```

Then in the dashboard:
- Pick **Claude Code** or **Hermes** from the agent picker
- Type a prompt, send (or hit ⌘+Enter)
- Watch the response stream in with markdown rendering, token counts in the right rail, and the chat auto-saved to your Obsidian inbox
- Press **⌘+K** anywhere for the command palette

Latest release: see [`CHANGELOG.md`](CHANGELOG.md) and the [GitHub releases page](https://github.com/vampyren/agentic-os/releases).

## License

MIT. See [`LICENSE`](LICENSE).
