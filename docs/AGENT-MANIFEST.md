# Agent Manifest

How to plug a new brain into Agentic OS.

> An "agent" in this OS is anything the operator can chat with or assign work to. CLI tools, HTTP APIs, MCP servers, hosted models — same interface. The manifest tells the kernel how to talk to it.

## Where manifests live

```
agents/builtin/*.yaml           shipped with the repo, version-controlled
~/.agentic-os/agents/*.yaml     user-defined, never committed
```

User manifests override built-ins of the same `name`. This lets you tweak a shipped agent (different binary path, different default model, custom system prompt) without forking the repo.

## Schema

```yaml
# REQUIRED
name: string                    # unique slug, [a-z0-9-]+
displayName: string             # shown in UI
transport: subprocess | streamJson | http | mcp | sdk

# OPTIONAL — UI
description: string             # one-liner shown on the agent card
accent: string                  # CSS color or token reference (e.g. "var(--claude)")
icon: string                    # lucide-react icon name

# OPTIONAL — capabilities (used by UI to render the right panel)
capabilities:
  chat: boolean                 # one-shot prompt/response
  streamingChat: boolean        # token-stream responses
  tools: boolean                # tool use (Read, Write, Bash, etc.)
  mcp: boolean                  # can attach MCP servers
  sessions: boolean             # can resume prior conversations

# REQUIRED — transport-specific block
transportConfig:
  # ... depends on transport type, see below

# OPTIONAL — health probe
healthProbe:
  type: command | http | tcp
  intervalSec: 300              # how often to re-probe; default 300 (5 minutes)
  timeoutMs: 3000               # default 3000; hard ceiling 10000
  # for command:
  command: [binary, arg1, arg2]
  parse:                        # optional stdout parser to populate vitals
    versionRegex: "v(\\d+\\.\\d+\\.\\d+)"
    statusRegex: "(live|degraded|offline)"
  # for http:
  url: "http://localhost:11434/api/tags"
  expectStatus: 200

# OPTIONAL — Control Room actions (manifest-declared read-only CLI verbs
# surfaced as rows in the agent's Control Room view, called via
# /api/agents/[name]/actions/[action]). See "Control Room actions" section
# below for the full schema, security contract, and a Hermes example.
actions:
  - id: status
    label: Status
    hint: env
    command: ["hermes", "status"]
    # timeoutMs optional — default 5s, clamped at 60s max

# DEPRECATED — `verbs:` was a planned but never-implemented v0.1 design for
# an `/api/run` endpoint. Replaced before v0.2.11 by the `actions:` block
# above plus `/api/agents/[name]/actions/[action]`. Do not use `verbs:` in
# new manifests; the loader ignores it.

# OPTIONAL — log tailing for activity stream
logs:
  dir: "~/.openclaw/logs"
  pattern: "*.log"

# OPTIONAL — secrets (looked up in ~/.agentic-os/secrets.yaml)
secrets:
  apiKey: "openrouter.apiKey"

# OPTIONAL — MCP servers attached to this agent
mcpServers:
  - name: playwright
    command: npx
    args: ["@playwright/mcp@latest"]
```

## Transport types

> **Loader status (current):** only `subprocess` and `streamJson` are accepted by the manifest loader (`src/kernel/manifest.ts`). The others below (`http`, `mcp`, `sdk`) are documented as spec — they ship in later phases. A manifest declaring one of the not-yet-shipped transports fails validation at startup today with a Zod error. See `docs/ROADMAP.md` for which phase wires each transport.
>
> | Transport | Loader status | Lands in |
> |---|---|---|
> | `subprocess` | accepted | 1A (shipped) |
> | `streamJson` | accepted | 1A (shipped) |
> | `http`       | rejected by validator | 2A |
> | `mcp`        | rejected by validator | 2C |
> | `sdk`        | rejected by validator | 3 |

### `subprocess`

A CLI that takes a prompt as argv and returns a response on stdout. One-shot, no streaming.

```yaml
transport: subprocess
transportConfig:
  bin: hermes            # resolved via $PATH if not absolute
  args: ["-z", "{prompt}"]    # {prompt} is the placeholder
  timeoutMs: 120000
  env:
    NO_COLOR: "1"
  jsonParse: false       # set true if stdout is JSON
```

Used by: Hermes, OpenClaw (one-shot mode), any "give it a prompt, get a string back" CLI.

### `streamJson`

A CLI that emits a newline-delimited JSON event stream. Specifically built for `claude -p --output-format=stream-json --include-partial-messages`.

```yaml
transport: streamJson
transportConfig:
  bin: claude
  args: ["-p", "--output-format=stream-json", "--include-partial-messages", "--verbose", "{prompt}"]
  parser: claudeCode     # named parser; "claudeCode" handles the official format
```

Used by: Claude Code (the default and recommended transport — see ADR-0001).

### `http`

Any HTTP API. Body is rendered from a template; the response is extracted via a JSONPath-like selector.

```yaml
transport: http
transportConfig:
  url: "https://openrouter.ai/api/v1/chat/completions"
  method: POST
  headers:
    Authorization: "Bearer {{secrets.apiKey}}"
    Content-Type: "application/json"
  body:
    model: "anthropic/claude-3.5-sonnet"
    messages:
      - role: user
        content: "{prompt}"
    stream: true
  responseFormat: openai-sse    # named format; openai-sse handles the standard SSE chunked response
```

Used by: OpenRouter, OpenAI direct, Ollama (`http://localhost:11434/...`), any cloud or local model server.

### `mcp`

Talk to an MCP server as if it were an agent. The kernel speaks the MCP protocol over stdio or HTTP and exposes the server's tools through the same UI as any other agent.

```yaml
transport: mcp
transportConfig:
  command: npx
  args: ["@modelcontextprotocol/server-filesystem", "/home/spawn/Apps"]
  protocol: stdio
```

Used by: any MCP server you want to surface as a first-class agent. Most of the time you'll attach MCP servers to *another* agent via `mcpServers`, but standalone is supported.

### `sdk`

`@anthropic-ai/claude-agent-sdk`. In-process tool callbacks, hooks, structured messages. Requires `ANTHROPIC_API_KEY`.

```yaml
transport: sdk
transportConfig:
  model: "claude-sonnet-4-6"
  systemPrompt: "You are a research assistant for the operator's Agentic OS."
  allowedTools: ["Read", "Glob", "Grep", "WebSearch", "WebFetch"]
secrets:
  apiKey: "anthropic.apiKey"
```

Used by: opt-in only. See ADR-0001 for why subprocess is the default and when to consider SDK.

## Worked example — adding OpenRouter

You want to chat with `anthropic/claude-3.5-sonnet` and `meta-llama/llama-3.1-405b` via OpenRouter from the dashboard.

**Step 1:** Add your key to `~/.agentic-os/secrets.yaml`:

```yaml
openrouter:
  apiKey: "sk-or-v1-..."
```

**Step 2:** Drop a manifest at `~/.agentic-os/agents/openrouter-sonnet.yaml`:

```yaml
name: openrouter-sonnet
displayName: "Claude Sonnet (OpenRouter)"
transport: http
description: "Claude 3.5 Sonnet via OpenRouter — useful when you've burned your subscription quota."
accent: "#9eb6ff"
icon: "cloud"
capabilities:
  chat: true
  streamingChat: true
secrets:
  apiKey: "openrouter.apiKey"
transportConfig:
  url: "https://openrouter.ai/api/v1/chat/completions"
  method: POST
  headers:
    Authorization: "Bearer {{secrets.apiKey}}"
    Content-Type: "application/json"
  body:
    model: "anthropic/claude-3.5-sonnet"
    messages:
      - role: user
        content: "{prompt}"
    stream: true
  responseFormat: openai-sse
healthProbe:
  type: http
  url: "https://openrouter.ai/api/v1/auth/key"
  headers:
    Authorization: "Bearer {{secrets.apiKey}}"
  expectStatus: 200
```

**Step 3:** Restart the dev server. The new agent appears in the dashboard.

To add a second model (Llama), copy the manifest, change `name`, `displayName`, and the `model` field in `body`. No code changes.

## Worked example — adding a local Ollama model

```yaml
name: ollama-llama3
displayName: "Llama 3.1 (local via Ollama)"
transport: http
description: "Local Llama 3.1 served by Ollama on port 11434."
accent: "#10b981"
icon: "server"
capabilities:
  chat: true
  streamingChat: true
transportConfig:
  url: "http://localhost:11434/api/chat"
  method: POST
  headers:
    Content-Type: "application/json"
  body:
    model: "llama3.1:8b"
    messages:
      - role: user
        content: "{prompt}"
    stream: true
  responseFormat: ollama-ndjson
healthProbe:
  type: http
  url: "http://localhost:11434/api/tags"
  expectStatus: 200
```

## Control Room actions

A manifest may optionally declare an `actions:` block. Each entry becomes a row in the agent's Control Room view (the workbench mode toggled next to Chat on `/agents/<name>`). Each row is a **read-only** CLI invocation called via `/api/agents/[name]/actions/[action]`.

### Schema

```yaml
actions:
  - id: string                  # REQUIRED. kebab-case slug, used in the URL + as React key.
                                # ^[a-z0-9][a-z0-9-]{0,31}$
    label: string               # REQUIRED. Row text, 1–40 chars.
    command: [bin, arg1, ...]   # REQUIRED. argv passed to safeSpawn. Never `shell:true`.
                                # First element is the binary, rest are arguments.
    timeoutMs: integer          # OPTIONAL. Per-action timeout. Default 5000.
                                # Clamped at the route level to 60_000 max.
    hint: string                # OPTIONAL. Short text shown on the right of the row
                                # (e.g. "env", "history"). 1–20 chars.
    output: text | json         # OPTIONAL. UI render hint. Default "text".
```

Cap: **10 actions per agent**. The zod schema in `src/kernel/manifest.ts` is the authoritative shape; any drift fails manifest validation at startup.

### Security + output contract

Each action invocation:

- Spawns via `safeSpawn` (argv arrays only, no `shell:true`, env allowlist per `src/kernel/spawn.ts`).
- Captures up to **256 KiB stdout + 256 KiB stderr**; beyond that the child is killed and `truncated: true` is returned.
- Cleans the captured text server-side via `src/kernel/textSanitize.ts`: `stripAnsi` removes terminal escape sequences, CRLF → LF + bare CR dropped, each line clamped to 1000 chars with a `… [+N chars]` marker.
- Returns the cleaned output to the localhost UI only. The raw text **never** reaches the JSONL audit log.
- Records `auditAgentAction` with neutral metadata: `agent`, `actionId`, `exitCode`, `durationMs`, `stdoutChars`, `stderrChars` (cleaned lengths), optional `errorClass`, `status`.
- On failure: returns HTTP 200 with `{ ok: false, errorClass, errorMessage }`. `errorClass` is one of the fixed enum from `classifyAgentError`; `errorMessage` is a stock neutral phrase — never derived from raw stderr.

See `docs/SECURITY.md` "Per-agent Control Room actions" for the full hardening contract.

### Hermes example (built-in)

`agents/builtin/hermes.yaml` declares the canonical 7-action set in Julian's v0.1 reference order. Per-action `timeoutMs` is tuned to observed durations:

```yaml
actions:
  - id: status
    label: Status
    hint: env
    command: ["hermes", "status"]
    # default 5s timeout

  - id: sessions
    label: Sessions
    hint: history
    timeoutMs: 15000
    command: ["hermes", "sessions", "list"]

  - id: skills
    label: Skills
    hint: installed
    timeoutMs: 10000
    command: ["hermes", "skills", "list"]

  - id: plugins
    label: Plugins
    hint: marketplace
    timeoutMs: 20000
    command: ["hermes", "plugins", "list"]

  - id: kanban
    label: Kanban
    hint: tasks
    timeoutMs: 10000
    command: ["hermes", "kanban", "list"]

  - id: doctor
    label: Doctor
    hint: check
    timeoutMs: 20000
    command: ["hermes", "doctor"]

  - id: insights
    label: Insights
    hint: analytics
    timeoutMs: 45000
    command: ["hermes", "insights"]
```

### When to add actions to a new agent

- The CLI exposes read-only verbs the operator wants visible without opening a terminal (status, doctor, list-sessions, etc.).
- The verbs run in seconds-to-tens-of-seconds (>60s won't fit the route's timeout ceiling — split into smaller verbs or skip).
- The output is text-shaped (tables, status reports). For long streamed output, keep it in the chat path instead.

Agents that are chat-only (e.g. Claude Code) should omit the `actions:` block entirely — the Control Room mode toggle then doesn't render at all, matching the "no fake affordances" rule.

## Naming conventions

- `name` is the unique slug used in URLs (`/agents/openrouter-sonnet`) and event sources. Stable, lowercase, hyphens.
- `displayName` is for humans, can change freely.
- Don't reuse a `name` across two providers of the same model — disambiguate (e.g., `claude-code` vs `openrouter-sonnet`).

## Health probes — keep them cheap

The kernel runs every agent's health probe on its declared `intervalSec`. A misconfigured probe wastes CPU and (for HTTP agents) bills real money. Rules:

**Allowed probe operations:**

- `<binary> --version` (cheap; just prints a string).
- `<binary> --help` (also cheap).
- `<binary> health` / `<binary> status` (only if the agent documents this as a no-op status check).
- HTTP GET against an agent's documented health endpoint (`/api/tags`, `/v1/auth/key`, etc.).
- TCP connect-and-close to confirm a port is listening.

**Forbidden in a health probe:**

- Sending an actual chat prompt to a model. Probes are not prompts.
- Calling a billed inference endpoint that charges per request.
- Long-running diagnostics (`openclaw doctor` is for the operator to run manually, not for a 60s loop).
- Any command whose typical wall time exceeds `timeoutMs` — the kernel will kill it and mark the agent degraded based on the timeout, not actual health.

**Default cadences (override per-manifest):**

| Agent kind | `intervalSec` default | Why |
|---|---|---|
| Local CLI on the same machine | 300 (5 min) | Process state changes slowly; faster polling wastes CPU. |
| Local HTTP (Ollama, OpenClaw gateway) | 300 | Same. |
| Cloud HTTP (OpenRouter, OpenAI, Anthropic API) | 900 (15 min) | API uptime is high; probing costs tokens or rate-limit budget. |
| Critical operator-facing agent (Claude Code default) | 120 (2 min) | Slight extra cost is worth fast failure detection. |

If a manifest doesn't declare `healthProbe`, the agent has no probe and is shown as `unknown` in the UI until invoked. That's a valid state.

## Forward compatibility

The schema is versioned implicitly by the kernel: unknown keys are ignored with a warning, missing required keys are an error. Breaking changes will arrive as an explicit `apiVersion:` field with a migration note in an ADR.
