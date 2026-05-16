# ADR-0002 — Agent registry and Transport interface

**Status:** Accepted
**Date:** 2026-05-16

## Context

Julian's v0.1 hardcodes the set of supported agents as a TypeScript union type:

```typescript
type AgentName = "claude" | "openclaw" | "hermes";
```

This name is referenced in:
- `src/lib/runner.ts` — binary resolution and validation.
- `src/lib/config.ts` — config keys, env var names, auto-detection list.
- `src/lib/vaultWriter.ts` — `agent` field on memory entries.
- `src/app/api/run/route.ts` — allowlist map keyed by agent name.
- `src/app/api/vitals/route.ts` — hardcoded `Promise.all` of three probes.
- Each of `src/components/ClaudePanel.tsx`, `HermesPanel.tsx`, `OpenClawPanel.tsx` — one per agent.

Adding a 4th agent (ChatGPT, OpenRouter, Ollama, OpenClaw later, anything) touches 6+ files. The operator explicitly asked for a system "easy for adding new agent or brains like chatgpt, or openrouter etc."

## Decision

Introduce two abstractions:

1. **Agent Registry** — declarative manifests loaded from `agents/builtin/*.yaml` (shipped) and `~/.agentic-os/agents/*.yaml` (user overrides). The registry is the only thing in the codebase that knows the list of agents.
2. **Transport interface** — a small TypeScript interface every "way to talk to an agent" implements. Five transports planned:
   - `subprocess` (Phase 1)
   - `streamJson` (Phase 1; specialized subprocess for Claude Code)
   - `http` (Phase 2)
   - `mcp` (Phase 2)
   - `sdk` (Phase 3, opt-in)

```typescript
interface Transport {
  health(): Promise<HealthReport>;
  chat(opts: ChatOpts): Promise<ChatResult>;
  stream(opts: ChatOpts): AsyncIterable<AgentEvent>;
  runVerb?(verb: string, args: string[]): Promise<RunResult>;
}
```

The registry resolves manifest → transport instance. Everything else in the codebase (UI, REST API, scheduler, audit log) calls `registry.get(name).<method>()` and never names a specific agent.

The manifest schema is defined in `docs/AGENT-MANIFEST.md`.

## Consequences

**Positive**

- Adding a new agent is a one-file YAML drop. The Worked Examples in AGENT-MANIFEST.md show how to add OpenRouter and Ollama with zero code changes.
- The UI's agent panel can be generic (driven by capabilities declared in the manifest). Custom React panels remain possible for agents that want bespoke UIs.
- Tests can mock a `Transport` directly — no need for full process fixtures.
- The audit log key (`agent: <name>`) is stable across transport changes.

**Negative**

- More indirection. A call from the UI to "send a prompt to Claude" goes through registry → manifest → transport → process. More cognitive overhead for a contributor reading the code for the first time.
- YAML manifests are stringly-typed. A typo in `transportConfig` won't fail at compile time. Mitigation: zod schema validation at load time with clear error messages.

**Neutral**

- Built-in manifests still live in the repo, version-controlled. They're not "config" in the sense that the operator routinely edits them.

## Alternatives considered

- **Plug-in modules per agent (`agents/claude/index.ts`, `agents/hermes/index.ts`, ...).** Rejected — requires shipping code for every new agent, contradicts the "config not code" goal.
- **One big switch statement keyed by agent name.** This is what Julian has. Doesn't scale and is the problem we're solving.
- **Per-agent npm packages.** Overkill for a single-operator system. Could become relevant in Phase 3 if a real plugin ecosystem emerges.

## References

- [`docs/AGENT-MANIFEST.md`](../AGENT-MANIFEST.md) — manifest schema and worked examples.
- [`docs/ARCHITECTURE.md#1-agent-registry`](../ARCHITECTURE.md#1-agent-registry) — registry placement in the overall architecture.
