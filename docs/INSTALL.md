# Install

> **Phase 0 status:** application code is not yet shipped. This page describes the planned install experience for Phase 1. The exact commands will land in the repo when Phase 1 code is merged.

## Prerequisites

- **Node 22+** (`node -v` to check).
- **Claude Code CLI** — `claude --version` should print `2.x` or newer. Install from `claude.ai/code`.
- An operator account already logged into Claude Code (`claude` runs interactively first time to OAuth).
- **Optional but recommended:** an Obsidian vault. The OS works without one, but the SELF layer is empty without it.

## Optional brain CLIs (any subset)

Each one is added at install time and shows up automatically if present:

- `hermes` — [Hermes Agent by Nous Research](https://github.com/NousResearch/hermes-agent). `hermes --version` to verify.
- `openclaw` — `npm install -g openclaw@latest`. Then `openclaw onboard --install-daemon`.
- `ollama` — for local-model agents via HTTP transport.

## Planned first-run flow (Phase 1)

```bash
git clone git@github.com:vampyren/agentic-os.git
cd agentic-os
npm install
npm run setup
```

`npm run setup` will:

1. Detect installed agent CLIs via `which`.
2. Prompt for the Obsidian vault path (auto-detect attempts: `~/Documents/Obsidian/<any>`, `~/Obsidian`, `~/Documents/Obsidian Vault`).
3. Write `~/.agentic-os/config.yaml` with the detected/chosen paths.
4. Stub `~/.agentic-os/secrets.yaml` with mode 0600.
5. Build the initial SQLite index of the vault.

Then:

```bash
npm run dev
```

Opens `http://127.0.0.1:3000`. Mission Control should show every detected agent's card.

## Manual configuration

If `npm run setup` doesn't suit you, drop a `~/.agentic-os/config.yaml` manually. Minimal example:

```yaml
vault:
  root: /home/spawn/Documents/Obsidian/Rex-Knowledge

agents:
  default: claude-code

scheduler:
  enabled: false   # Phase 2

ui:
  locationLabel: "Local"
```

User-defined agent manifests go under `~/.agentic-os/agents/*.yaml`. See [`AGENT-MANIFEST.md`](AGENT-MANIFEST.md).

## Troubleshooting (planned)

- **"Claude not detected"** — `which claude` returns nothing. Either install Claude Code or set `agents.builtin.claude-code.bin` in config to the absolute path.
- **"Vault not found"** — pass `vault.root` explicitly. The OS won't run with a missing or unreadable vault.
- **"Secrets file refused to load"** — `chmod 600 ~/.agentic-os/secrets.yaml`.
- **"Port 3000 in use"** — `PORT=3030 npm run dev`.

## Uninstall

```bash
rm -rf ~/.agentic-os
# then delete the repo clone
```

The OS never writes anywhere else outside `00_Inbox/agentic-os/` in your vault. Those notes stay — delete them in Obsidian if you want.
