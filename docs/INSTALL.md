# Install

> **Phase 0 status:** application code is not yet shipped. Phase 1A code lands per `ROADMAP.md`. This page tracks the install experience for each phase as it ships.

## Prerequisites (all phases)

- **Node 22+** (`node -v` to check).
- **Claude Code CLI** — `claude --version` should print `2.x` or newer. Install from `claude.ai/code`.
- An operator account already logged into Claude Code (`claude` runs interactively first time to OAuth).
- **Optional but recommended:** an Obsidian vault. The OS works without one, but the SELF layer is empty without it.

### Optional brain CLIs (any subset)

Each one is added at install time and shows up automatically if its manifest is present:

- `hermes` — [Hermes Agent by Nous Research](https://github.com/NousResearch/hermes-agent). `hermes --version` to verify.
- `openclaw` — `npm install -g openclaw@latest`. Then `openclaw onboard --install-daemon`. (Phase 1A ships without an OpenClaw manifest by default; add via `~/.agentic-os/agents/openclaw.yaml` per `AGENT-MANIFEST.md`.)
- `ollama` — for local-model agents via HTTP transport (Phase 2A).

---

## Phase 1A — manual install (ships first)

Phase 1A has no setup wizard. The operator writes one small YAML file by hand, then runs the dev server. This is intentional: ADR-0007 keeps 1A's surface narrow so the kernel API can be reviewed before tooling is built around it.

### Steps

```bash
git clone git@github.com:vampyren/agentic-os.git
cd agentic-os
npm install
```

Create `~/.agentic-os/config.yaml` (minimal example):

```yaml
# ~/.agentic-os/config.yaml
vault:
  root: /home/spawn/Documents/Obsidian/Rex-Knowledge

agents:
  default: claude-code
```

Then:

```bash
npm run dev
```

Opens `http://127.0.0.1:3000`. You should see:

- A list of agents loaded from `agents/builtin/*.yaml` (claude-code, hermes).
- A live event stream view subscribed to `/api/events`.
- One prompt box that sends to the selected agent and streams the response.

That's all 1A does. No vitals card, no goals page, no journal, no memory search, no styling — those are 1B.

### What gets written

- `~/.agentic-os/config.yaml` — the file you just created. Operator-owned.
- `~/.agentic-os/audit/YYYY-MM-DD.jsonl` — append-only JSONL audit log, one file per UTC day. Auto-created on first event.
- `<vault>/00_Inbox/agentic-os/chats/YYYY-MM-DD-{slug}.md` — every chat lands here per the inbox-first vault contract.

Nothing else.

### Backup

The entire `~/.agentic-os/` directory is the OS's state. To back up:

```bash
tar -czf agentic-os-backup-$(date +%F).tgz ~/.agentic-os/
```

To restore on a new machine: extract the tarball, install the prerequisites, `npm install`, `npm run dev`.

---

## Phase 1B — setup wizard (planned, not yet shipped)

When Phase 1B lands, the manual config step above will be optional. `npm run setup` will:

1. Detect installed agent CLIs via `which` (claude, hermes, openclaw, ollama).
2. Prompt for the Obsidian vault path (auto-detect attempts: `~/Documents/Obsidian/<any>`, `~/Obsidian`, `~/Documents/Obsidian Vault`).
3. Write `~/.agentic-os/config.yaml` with the detected/chosen paths.
4. Stub `~/.agentic-os/secrets.yaml` with mode 0600.
5. Build the initial SQLite FTS5 index of the vault.

Until 1B ships, follow the Phase 1A manual install above.

---

## Phase 2+ install changes (planned)

- **Phase 2A** adds `~/.agentic-os/secrets.yaml` requirement for HTTP-transport agents (OpenRouter, OpenAI). Setup wizard prompts for keys.
- **Phase 2C** adds MCP server installation prompts (Playwright, Filesystem, etc.).
- **Phase 3** adds a `--bind 0.0.0.0` flag and bearer-token issuance for LAN/remote access.

---

## Troubleshooting (Phase 1A)

- **"Claude not detected"** — `which claude` returns nothing. Either install Claude Code or set `agents.builtin.claude-code.bin` in your `~/.agentic-os/config.yaml` to the absolute path.
- **"Vault not found"** — pass `vault.root` explicitly in config. The OS won't run with a missing or unreadable vault.
- **"Config file not found"** — Phase 1A requires `~/.agentic-os/config.yaml`. Use the minimal example above.
- **"Port 3000 in use"** — `PORT=3030 npm run dev`.

## Uninstall

```bash
rm -rf ~/.agentic-os
# then delete the repo clone
```

The OS never writes anywhere else outside `00_Inbox/agentic-os/` in your vault. Those notes stay — delete them in Obsidian if you want.
