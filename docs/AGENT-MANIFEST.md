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
  # for command:
  command: [binary, arg1, arg2]
  timeoutMs: 6000
  parse:                        # optional stdout parser to populate vitals
    versionRegex: "v(\\d+\\.\\d+\\.\\d+)"
    statusRegex: "(live|degraded|offline)"
  # for http:
  url: "http://localhost:11434/api/tags"
  expectStatus: 200

# OPTIONAL — verb allowlist for /api/run (action panel in the UI)
verbs:
  - { name: "status",   args: ["status"] }
  - { name: "doctor",   args: ["doctor"] }
  - { name: "sessions", args: ["sessions", "list"] }

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

## Naming conventions

- `name` is the unique slug used in URLs (`/agents/openrouter-sonnet`) and event sources. Stable, lowercase, hyphens.
- `displayName` is for humans, can change freely.
- Don't reuse a `name` across two providers of the same model — disambiguate (e.g., `claude-code` vs `openrouter-sonnet`).

## Forward compatibility

The schema is versioned implicitly by the kernel: unknown keys are ignored with a warning, missing required keys are an error. Breaking changes will arrive as an explicit `apiVersion:` field with a migration note in an ADR.
