# ADR-0001 — Claude Code subprocess is the default transport

**Status:** Accepted
**Date:** 2026-05-16

## Context

The operator wants Claude Code embedded in Agentic OS using their existing Claude subscription, not via the Anthropic API (which would mean paying twice for the same capability). Two real options exist:

1. **Subprocess invocation:** spawn `claude -p --output-format=stream-json --include-partial-messages` and parse the NDJSON event stream. Uses the operator's existing Claude Code login. No extra API key required.
2. **`@anthropic-ai/claude-agent-sdk`:** the official TypeScript SDK that runs the same Claude Code agent loop in-process. Per Anthropic's documentation, **requires `ANTHROPIC_API_KEY`** — Anthropic explicitly disallows third-party apps from using claude.ai login.

The SDK is more powerful (in-process hooks, MCP, subagents, structured messages, sessions). The subprocess is simpler and free.

Anthropic announced that starting **2026-06-15**, both the SDK and `claude -p` on subscription plans will draw from a separate monthly "Agent SDK credit," tracked apart from interactive usage. This affects both options equally in cost terms once that change lands.

## Decision

The default Claude Code transport is **subprocess** via `streamJson`. The Agent SDK is supported as an opt-in transport (`sdk`) but is not the default and is not shipped wired-up in Phase 1.

The kernel exposes Claude Code through a manifest at `agents/builtin/claude-code.yaml` with `transport: streamJson`. The `streamJson` transport implementation parses Claude's stream-json event format (the same one Julian's v0.1 ClaudePanel already handles).

## Consequences

**Positive**

- Phase 1 ships with zero additional API key requirements. The operator's existing Claude Code login is all they need.
- The kernel inherits everything `~/.claude/` already configures: settings, hooks, plugins, skills, project-specific `CLAUDE.md`, the lot.
- Users who outgrow this (need in-process tool callbacks, want explicit session resume, want managed sessions) can flip to the SDK transport by editing one manifest field.

**Negative**

- Subprocess overhead per invocation (process spawn, OAuth token refresh check, settings load). Streaming chats amortize this; one-shot calls feel it.
- In-process hooks aren't available — every hook that fires inside Claude Code is opaque to the kernel. We can observe via stdout but not intercept.
- The forthcoming 2026-06-15 quota separation will apply. Documented in INSTALL.md when relevant.

**Neutral**

- Both transports remain in the codebase. The decision is which one is the default and which one needs config to enable.

## Alternatives considered

- **Default to SDK transport, document subprocess as a fallback.** Rejected because it forces every user to provision an `ANTHROPIC_API_KEY` from day one, contradicting the operator's stated requirement.
- **Build a custom mini-agent loop against the Anthropic Messages API.** Rejected — duplicates what Claude Code already provides, throws away the operator's existing `~/.claude/` configuration, and is more code to maintain.
- **Use only `--print` without `--output-format=stream-json`.** Rejected — kills the streaming UX that's central to Mission Control's "live channel" feel.

## References

- Claude Agent SDK overview: https://docs.claude.com/en/docs/agent-sdk/overview
- Julian's v0.1 ClaudePanel proves the stream-json parser works end-to-end (`source-julian/agentic-os-v0.1.zip` → `src/components/ClaudePanel.tsx`).
