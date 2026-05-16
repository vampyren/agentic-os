# ADR-0008 — Internal naming discipline: "kernel" and "registry," not "OS"

**Status:** Accepted
**Date:** 2026-05-16

## Context

The public-facing brand is **Agentic OS**. The GitHub repository is `vampyren/agentic-os`. The npm package will be `agentic-os`. The user picked the name; it inherits recognition from Julian Goldie's original work.

But the word "OS" carries baggage:

- It invites overdesign. "We have an OS — surely we need a process scheduler, a syscall layer, an IPC mechanism..."
- It misleads contributors who haven't read the docs. Someone seeing `class OperatingSystem` in the source might assume kernel-grade concerns that don't apply.
- It conflates the marketing surface with the engineering surface.

External review (ChatGPT, 2026-05-16) flagged this:

> "OS" makes people overdesign. This is really a local agent control center + Obsidian memory layer.

The right architecture-level mental model for what we're actually building is closer to:

- A **registry** that knows about agents.
- A **kernel** that routes work through transports and emits events.
- A **control center** that's the operator's window into the kernel.

## Decision

The public brand stays **Agentic OS** — repository name, package name, README headline, marketing copy.

Internal code, doc terminology, file and directory names use the disciplined terms:

| Concept | Internal name | Public name |
|---|---|---|
| The thing we ship | `agentic-os` (package) | "Agentic OS" |
| The kernel module | `src/kernel/` | "the kernel" |
| The agent registry | `src/kernel/registry.ts` | "agent registry" |
| The dashboard | `src/app/` (Next.js) | "Mission Control" |
| The transport interface | `src/kernel/transports/` | "transports" |
| The vault layer | `src/vault/` | "vault layer" |
| The event bus | `src/kernel/bus.ts` | "event bus" |
| The audit log | `src/kernel/audit.ts` | "audit log" |

**Rules:**

- Never use `OS` as an identifier in code (no `class OS`, no `function getOS()`, no `import { OS } from ...`).
- Never use "OS" in module names, file names, type names, or function names.
- In comments and docs, prefer "the kernel" or "Agentic OS the application" over bare "the OS."
- The string `"agentic-os"` appears in `package.json`, the repo URL, the manifest's default config path (`~/.agentic-os/`), and nowhere else routinely.

## Consequences

**Positive**

- New contributors see code that talks about agents, transports, registries, events — concrete things they can reason about.
- No accidental scope creep from "well, an OS needs X."
- The marketing/engineering separation is clear: "Agentic OS" sells; "kernel + registry + transports" builds.

**Negative**

- Some docs end up doing a small dance between "Agentic OS" (brand) and "the kernel" (component) in the same paragraph. The cost is real but small.
- New contributors who Ctrl-F for "OS" in the codebase will find very little. Mitigation: this ADR exists, and the README explicitly says the public brand is the product name only.

**Neutral**

- Naming is a discipline, not enforced by tooling. A lint rule could be added if it ever becomes a problem.

## Alternatives considered

- **Rename the brand to "Agentic Control Center" or "Agent Dashboard."** Rejected — the user picked "Agentic OS," the repo is already public under that name, and the connection to Julian's source material is part of the value.
- **Use "OS" freely everywhere.** Rejected per the Context — invites overdesign, misleads contributors.
- **Codify the rule in a custom ESLint plugin.** Premature. Re-evaluate if violations sneak in.

## References

- README.md — public brand.
- `docs/ARCHITECTURE.md` — already uses "kernel" terminology in module descriptions.
- External review by ChatGPT, 2026-05-16.
