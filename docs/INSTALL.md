# Install

Current shipped version: **v0.2.4** — see [`CHANGELOG.md`](../CHANGELOG.md).

## Prerequisites

- **Node 22+** (`node -v` to check).
- **Claude Code CLI** — `claude --version` should print `2.x` or newer. Install from `claude.ai/code`.
- An operator account already logged into Claude Code (`claude` runs interactively first time to OAuth).
- **Optional but recommended:** an Obsidian vault. The OS works without one but the SELF layer (goals/journal/memory) is empty without it.

### Optional brain CLIs (any subset)

Each one is added at install time and shows up automatically if its manifest is present:

- `hermes` — [Hermes Agent by Nous Research](https://github.com/NousResearch/hermes-agent). `hermes --version` to verify.
- `openclaw` — `npm install -g openclaw@latest`. Then `openclaw onboard --install-daemon`. (Phase 1B ships without an OpenClaw manifest by default; add via `~/.agentic-os/agents/openclaw.yaml` per `AGENT-MANIFEST.md`.)
- `ollama` — for local-model agents via HTTP transport (Phase 2A).

---

## Quickstart — recommended (interactive wizard)

```bash
git clone git@github.com:vampyren/agentic-os.git
cd agentic-os
npm install
npm run setup
npm run dev
```

`npm run setup` is an interactive CLI that:

1. Detects installed agent CLIs via `which` (claude, hermes, openclaw, ollama).
2. Prompts for your Obsidian vault path. It tries to auto-detect candidates under `~/Documents/Obsidian/`.
3. Asks which agent to make default.
4. Writes `~/.agentic-os/config.yaml` and creates `~/.agentic-os/audit/`.

Then `npm run dev` boots Mission Control at **http://127.0.0.1:3000**.

---

## Alternative — manual config (skip the wizard)

If you'd rather hand-write the file (or you're scripting the install):

```bash
mkdir -p ~/.agentic-os
cat > ~/.agentic-os/config.yaml <<'EOF'
vault:
  root: /home/spawn/Documents/Obsidian/Rex-Knowledge
agents:
  default: claude-code
EOF
```

Then `npm install && npm run dev` (no `npm run setup` needed).

---

## Browser compatibility

The dashboard works in any modern browser. Two features have additional requirements:

| Feature | Works in | Notes |
|---|---|---|
| Streaming chat, markdown rendering, tokens card, ⌘K palette | Chrome, Edge, Firefox, Safari, Brave | All standard web APIs. |
| **Voice input (mic button)** | Chrome, Edge, Safari | Uses the Web Speech API. **Firefox** has no implementation. **Brave** typically blocks or fails because the Chrome implementation phones home to Google for transcription — Brave's privacy posture clashes with this. If you see the mic button briefly turn red and immediately go dark, hover over it for the actual error code (`not-allowed`, `network`, `service-not-allowed`, etc.). |

## Accessing the dashboard from another machine on your LAN

The dev server binds 127.0.0.1 only (Phase 1 security posture, see `docs/SECURITY.md`). To access from another device on the same network:

**Option A — SSH port forward** (recommended; no security implications):

```bash
# from your laptop:
ssh -L 3000:127.0.0.1:3000 spawn@<vm-hostname-or-ip>
```

Then open `http://localhost:3000` in your laptop's browser. The page comes from the VM over the tunnel; browser features that need local hardware (mic, clipboard, notifications) use your laptop's resources.

**Option B — VS Code / Cursor Remote** automatically forwards ports under the "Ports" tab when you're connected to the VM.

LAN-bind mode + bearer token auth lands in Phase 3.

---

## What gets written

- `~/.agentic-os/config.yaml` — your config (you wrote it, you can edit it).
- `~/.agentic-os/audit/YYYY-MM-DD.jsonl` — append-only JSONL audit log, one file per UTC day, kept 30 days by default.
- `~/.agentic-os/index.db` (+ `.db-wal`, `.db-shm`) — SQLite FTS5 vault index. Derived state; delete to rebuild on next boot.
- `<vault>/00_Inbox/agentic-os/chats/YYYY-MM-DD-HHMM-{agent}-{promptSha8}.md` — every chat lands here per the inbox-first vault contract. The filename's hash suffix is the first 8 hex chars of SHA-256(prompt); the filename never contains prompt-derived characters (see `docs/SECURITY.md`).
- `<vault>/00_Inbox/agentic-os/goals/...` — one file per goal.
- `<vault>/00_Inbox/agentic-os/journal/YYYY-MM-DD.md` — one file per day.

**Nothing else.** No writes outside the inbox; no writes outside `~/.agentic-os/`.

## Backup

The whole `~/.agentic-os/` directory is the OS's state. To back up:

```bash
tar -czf agentic-os-backup-$(date +%F).tgz ~/.agentic-os/
```

To restore on a new machine: extract the tarball, install prerequisites, `npm install`, `npm run dev`. Your vault is backed up separately (presumably via Obsidian Sync / git / your own backup scheme).

---

## Phase 2+ install changes (planned)

- **Phase 2A** adds `~/.agentic-os/secrets.yaml` for HTTP-transport agents (OpenRouter, OpenAI). Setup wizard will prompt for keys.
- **Phase 2C** adds MCP server installation prompts (Playwright, Filesystem, etc.).
- **Phase 3** adds a `--bind 0.0.0.0` flag + bearer-token issuance for LAN/remote access.

---

## Troubleshooting

- **"Claude not detected"** — `which claude` returns nothing. Either install Claude Code or set the bin path in your `~/.agentic-os/agents/claude-code.yaml` override.
- **"Vault not found"** — set `vault.root` in your config. The OS won't run with a missing or unreadable vault.
- **"Config file not found"** — run `npm run setup` to create one.
- **"Port 3000 in use"** — `PORT=3030 npm run dev`.
- **Voice mic button does nothing / turns red briefly** — Brave-specific. Try Chrome/Edge. Hover the mic for the actual error type.
- **A particular CLI fails inside Agentic OS but works in your terminal** — likely the env allowlist (see `docs/SECURITY.md`). Add the env var the CLI needs to its manifest's `env:` block.

## Uninstall

```bash
rm -rf ~/.agentic-os
# then delete the repo clone
```

The OS never writes anywhere else outside `00_Inbox/agentic-os/` in your vault. Those notes stay — delete them in Obsidian if you want.
