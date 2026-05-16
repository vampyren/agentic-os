# Agentic OS

A local-first mission control for your AI agents. Single dashboard. Pluggable brains. Your knowledge stays in your vault.

> **Status: planning.** No application code yet. This repository currently holds the design docs and ADRs that will guide the build.

---

## What this is

One process on your laptop that gives you:

- A **dashboard** showing the live status of every brain you've connected (Claude Code, Hermes, OpenClaw, ChatGPT, OpenRouter, local Ollama, anything CLI- or HTTP-callable).
- An **agent registry** so adding a new brain is one YAML/TS manifest, not a code refactor.
- A **streaming chat surface** for every agent, plus an action panel for that agent's CLI verbs.
- A **scheduler** for missions (overnight research, daily summary, weekly review).
- A **knowledge layer** that respects your existing Obsidian vault rules: writes land in the inbox first, promotion is gated, frontmatter carries metadata, tags stay broad.

What it is **not**: a cloud SaaS, a chatbot wrapper, or a fork of any closed source.

## Why this exists

Julian Goldie's `agentic-os v0.1` (kept under `source-julian/` for reference) showed the shape — a Mission Control with Claude / OpenClaw / Hermes panels and Obsidian writes. It's a strong demo and the UI aesthetic is worth keeping. But the architecture won't take a fourth agent, MCP, a scheduler, embeddings, or proper workflows without a re-pour. This project is that re-pour, with the same look-and-feel but a kernel that scales.

See [`docs/decisions/ADR-0006-rebuild-not-fork-of-julian-v01.md`](docs/decisions/ADR-0006-rebuild-not-fork-of-julian-v01.md) for the full rationale.

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
CONTRIBUTING.md
docs/
  ARCHITECTURE.md          layers, transports, event bus, knowledge layer
  ROADMAP.md               phase 0/1/2/3 with exit criteria
  AGENT-MANIFEST.md        how to add a brain (declarative schema + example)
  VAULT-CONTRACT.md        Obsidian integration rules (phase-2 scope, documented now)
  SECURITY.md              localhost defaults, auth boundary, audit log plan
  INSTALL.md               prereqs + first-run steps (placeholder until code lands)
  decisions/               ADRs
source-julian/             Julian Goldie's v0.1 zip + web page snapshot, kept for reference
```

## Sources

- **`source-julian/agentic-os-v0.1.zip`** — Julian Goldie's reference build. Audited; see ADR-0006.
- **`source-julian/web/`** — Snapshot of the AIPB classroom page that introduced the concept ("GOLDIE Mission Stack").
- **`source-julian/chatgpt_Prompts.docx`** — ChatGPT's distillation of Julian's 8 build prompts.

## Quickstart (will exist after Phase 1B; Phase 1A uses manual config — see [`docs/INSTALL.md`](docs/INSTALL.md))

```bash
# placeholder — not implemented yet
git clone git@github.com:vampyren/agentic-os.git
cd agentic-os
npm install
npm run setup        # detects installed agents, writes ~/.agentic-os/config.yaml
npm run dev          # opens http://127.0.0.1:3000
```

## License

MIT. See [`LICENSE`](LICENSE).
