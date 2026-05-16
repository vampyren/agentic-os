# ADR-0005 — Vault inbox-first contract for agent writes

**Status:** Accepted
**Date:** 2026-05-16

## Context

The operator's Obsidian vault (`/home/spawn/Documents/Obsidian/Rex-Knowledge`) is a durable knowledge system with established conventions:

- PARA-style folder hierarchy (`00_Inbox`, `10_Projects`, `20_Knowledge`, `30_Operations`, `40_Decisions`, `50_Templates`, `60_Attachments`, `70_Todos`, `90_Archive`).
- A documented tag taxonomy (`20_Knowledge/Approved Tags.md`): tags are broad domains only; type/status/source/app names go in frontmatter.
- Templates with required frontmatter for each note type (Decision, Project, Research, Runbook, Todo, Cheat Sheet, Inbox Capture, Troubleshooting).
- A signed-off decision (`40_Decisions/Hermes Obsidian Approved Write Workflow.md`) that already governs how Hermes writes to the vault: inbox-first, no preview for inbox drafts, approval gate for promotion or edits to anything outside the inbox.

Julian's v0.1 vault writer (`src/lib/vaultWriter.ts`) violates this contract in multiple ways:

- Creates and writes to a top-level `Agentic OS/` folder, which conflicts with the PARA structure.
- Emits tags like `[memory, agentic-os, 2026-05-11]`, which violates the tag taxonomy (using tags for type, app name, and date).
- Has no concept of promotion gates; every write is a direct mutation.

If we let any of this through, the vault becomes inconsistent and the operator's existing tooling (templates, search by frontmatter, link graph) breaks.

## Decision

The OS adopts the existing Hermes Approved Write Workflow as its own contract, extended to cover every transport, mission, and dashboard action. Specifically:

1. **Every OS-initiated write lands under `00_Inbox/agentic-os/`.** No exceptions.
2. **Promotion** (moving a draft to `10_Projects/`, `40_Decisions/`, etc.) **is operator-initiated** through the dashboard's promotion UI (Phase 2) or done manually in Obsidian.
3. **Tags are restricted to the `Approved Tags.md` list.** If a note's content doesn't fit any approved tag, the note ships with `tags: []`.
4. **Type, status, source, agent, date go in frontmatter, never in tags.**
5. **`60_Attachments/`, `.obsidian/`, `.trash/`, `.git/` are off-limits** for writes.

The full contract — folder layout under `00_Inbox/agentic-os/`, required frontmatter shape, body structure, what the OS never does — is documented in [`docs/VAULT-CONTRACT.md`](../VAULT-CONTRACT.md).

The vault writer (`src/lib/vault/writer.ts` in Phase 1) is the only module that may write to the vault. Every transport, every mission, every dashboard endpoint goes through it. Direct `fs.writeFile` to the vault from anywhere else is a code-review failure.

## Consequences

**Positive**

- The operator's existing knowledge system stays consistent. Templates, tag taxonomy, link graph all keep working.
- No surprise promotions, no agent-driven destruction of human-curated notes.
- The contract is testable: a writer test asserts every path stays under the inbox; a manifest test asserts no tag in any default note creation matches outside the approved list.
- Aligns the OS with the operator's existing Hermes workflow — one mental model for "how agents write."

**Negative**

- Operator effort: promotion is manual (Phase 1) or via a UI click (Phase 2). The OS won't autonomously promote notes into knowledge folders.
- Goals and journal entries that operators "expect" in dedicated locations (`10_Projects/Goals.md`) instead land in `00_Inbox/agentic-os/`. The promotion step is the operator's "save this as a real goal" moment.
- Adds an indirection layer the operator has to learn: "OS wrote a note, but it's in the inbox, I need to review and promote."

**Neutral**

- The OS does not enforce the contract in the operator's Obsidian client — the operator can still manually move OS-written notes anywhere. That's their vault, their call.

## Alternatives considered

- **Write into dedicated PARA folders directly** (e.g., journal entries straight to `10_Projects/Journal/`). Rejected — bypasses the operator's review step, defeats the existing Hermes inbox-first decision.
- **Top-level `Agentic OS/` folder** (Julian's approach). Rejected — conflicts with PARA, pollutes the operator's clean folder structure.
- **No write at all; OS shows transient UI only, operator copies what they want into the vault manually.** Rejected — loses the entire SELF-layer feature, makes mission output ephemeral.
- **Configurable per-folder write permissions.** Over-engineered. The inbox-first contract is binary and clear; folder-level permissions would invite "well, this one folder is OK because..." erosion.

## References

- `~/Documents/Obsidian/Rex-Knowledge/40_Decisions/Hermes Obsidian Approved Write Workflow.md` — the source decision this ADR extends.
- `~/Documents/Obsidian/Rex-Knowledge/20_Knowledge/Approved Tags.md` — the tag whitelist.
- [`docs/VAULT-CONTRACT.md`](../VAULT-CONTRACT.md) — the full contract spec.
