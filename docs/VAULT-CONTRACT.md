# Vault Contract

How Agentic OS interacts with the operator's Obsidian vault. This contract is **non-negotiable** — every transport, every mission, every dashboard write goes through it.

## Why we need a contract

The operator's vault (`/home/spawn/Documents/Obsidian/Rex-Knowledge`) is a durable knowledge system with conventions that predate this project:

- PARA-style folders: `00_Inbox`, `10_Projects`, `20_Knowledge`, `30_Operations`, `40_Decisions`, `50_Templates`, `60_Attachments`, `70_Todos`, `90_Archive`.
- A documented tag taxonomy (`20_Knowledge/Approved Tags.md`): tags are **broad domains only** (`ai`, `automation`, `linux`, `crypto`, `health`, ...). Type, status, source, app names go in frontmatter.
- Templates for `Decision`, `Project`, `Research`, `Runbook`, `Todo`, `Cheat Sheet`, `Inbox Capture`, `Troubleshooting` — each with required frontmatter keys.
- A signed-off decision (`40_Decisions/Hermes Obsidian Approved Write Workflow.md`) defining inbox-first agent writes.

Julian's v0.1 vault writer violates all four. This contract fixes that.

## The inbox-first rule

> Any agent, any mission, any dashboard action MAY create or update files inside `00_Inbox/agentic-os/`.
> Promotion or modification of anything outside that directory MUST be initiated by the operator through the dashboard's promotion UI (Phase 2) or manually in Obsidian.

This is a direct extension of the existing `Hermes Obsidian Approved Write Workflow` decision. The rationale is identical: inbox writes can't damage what already exists, so they're safe to ungated; promotion is where risk lives, so that's where the gate sits.

**Forbidden, always:**
- Writing anywhere outside `00_Inbox/agentic-os/` without explicit operator promotion action.
- Touching `60_Attachments/` (excluded from git in the vault's `.gitignore`).
- Touching `.obsidian/`, `.trash/`, `.git/`.
- Deleting any file the OS did not itself create.

**Allowed without confirmation:**
- Create or append to any file under `00_Inbox/agentic-os/`.
- Read any file in the vault.

## Folder layout inside `00_Inbox/agentic-os/`

```
00_Inbox/agentic-os/
├── chats/
│   ├── 2026-05-16-1430-claude-code-a1b2c3d4.md   (hash suffix, not slug)
│   └── 2026-05-16-1015-hermes-9f0c2a4b.md
├── journal/
│   └── 2026-05-16.md
├── goals/
│   └── 2026-05-16-ship-phase-1c-scheduler.md     (operator-authored title -> slug)
├── summaries/
│   └── 2026-05-16.md     (from the daily-summary mission)
├── reviews/
│   └── 2026-05-17-weekly.md   (from weekly-review mission)
└── drafts/
    └── 2026-05-16-research-output.md   (free-form agent drafts)
```

**Important — privacy invariant for chats:** chat filenames are
`YYYY-MM-DD-HHMM-{agent}-{promptSha8}.md` where `promptSha8` is the first 8
hex chars of SHA-256 over the prompt. The filename contains NO prompt-
derived characters. The `vault.write` audit entry's `path` field — which
includes this filename — therefore cannot be used to reconstruct the
prompt. The H1 title and body inside the markdown remain human-readable.

**Other kinds (goals, journal, summaries, reviews, drafts) keep slugified
filenames** because the title is operator-authored — what the operator
typed into the goals form, or the date itself for journal. That's not
prompt content, so it's not a leak path.

Files are named `YYYY-MM-DD-{slug}.md` (non-chat) or
`YYYY-MM-DD-HHMM-{agent}-{promptSha8}.md` (chat) so they sort chronologically.

### Collision-safe naming

Two writes in the same day with the same base name **must not** overwrite. The writer:

1. Computes the candidate path.
2. If it exists, tries `<base>-02.md`, `<base>-03.md`, ... up to `-99`.
3. If `-99` is taken (won't happen in practice), the write fails with a clear error in the audit log and the UI.

For chats, the base name is `YYYY-MM-DD-HHMM-{agent}-{promptSha8}` — same-minute, same-agent, identical-prompt collisions get `-02` etc. This is also a useful tell when the operator clicks Send twice on the same prompt by accident.

### Atomic write

Every vault write follows this sequence:

1. Compute final path (with collision resolution above).
2. Write content to a sibling `.tmp` file (`<final>.tmp`) in the same directory.
3. `fsync` the `.tmp` file (best-effort; OS-dependent).
4. `rename()` `.tmp` → final path.

Same-directory rename is atomic on POSIX filesystems. This means a crashed write never leaves Obsidian seeing a half-written `.md` file with truncated frontmatter — it sees either nothing or the complete note. The `.tmp` files are cleaned up on next start if any survived a crash.

## Frontmatter convention

Every OS-written note carries this frontmatter, matching the operator's existing template conventions plus one OS-specific field:

```yaml
---
type: chat | journal | goal | summary | review | research | decision-draft
status: draft                # always "draft" for OS-written notes; operator changes on promote
source:                       # who created the note (matches existing template convention)
  - claude-code              # the agent's manifest `name`
agent: claude-code            # OS-specific: easier to query than `source` array
tags:                         # broad domains ONLY — see Approved Tags
  - ai
aliases: []
created: 2026-05-16
session: 9f0c2-...           # OS-specific: chat session id, optional
mission: daily-summary       # OS-specific: mission name if scheduler-generated
---
```

**Rules:**
- `tags` only ever contains values from the operator's `Approved Tags` list. Never `agentic-os`, `chat`, `2026-05-16`, or anything else type/source/date-related.
- `type` is one of the values above and must match what a promotion would map to (a `decision-draft` promotes into `40_Decisions/` using the Decision template).
- `agent` mirrors the manifest `name` of the agent that authored the note. For mission-generated notes, `agent: scheduler`.
- `created` is the date the file was created (YYYY-MM-DD). Time goes in the body section header, not here.
- `aliases` follows the operator's existing convention (lowercase candidate search terms).

## Body structure

A complete OS-written note looks like this on disk (frontmatter at the very top of the file, then the title heading, then body sections):

```markdown
---
type: chat
status: draft
source:
  - claude-code
agent: claude-code
tags:
  - ai
aliases: []
created: 2026-05-16
session: 9f0c2-a4b1-...
---

# Claude — research MCP servers

## 14:30 · claude-code · chat

**Operator:** Find the top 3 MCP servers for browser automation.

**claude-code:** Here are three options...
```

For multi-turn chat sessions, each turn is a `### HH:MM` subheading. For mission output, the body is whatever the mission produces (markdown, table, list).

## Tag policy (cite chain)

The operator's `20_Knowledge/Approved Tags.md` is the only source of truth for tags. As of 2026-05-16 the approved list is:

```
ai, crypto, homelab, linux, networking, remote-access, work, business,
health, food, personal, gaming, security, automation
```

Notes generated by the OS that don't fit any of these tags get `tags: []`. We do **not** invent new tags. If a new tag is genuinely needed, the operator updates `Approved Tags.md` first.

### Implementation (1A vs 1B)

- **Phase 1A** has no vault reader yet, so the manifest validator hardcodes the snapshot above. If the operator updates `Approved Tags.md` during 1A, the validator won't notice until the snapshot is re-pulled in code.
- **Phase 1B** has the vault reader. The validator switches to a dynamic read of `20_Knowledge/Approved Tags.md` so the operator can add or remove an approved tag without a code change.

The snapshot in this doc tracks the current vault state and should be updated alongside the operator's `Approved Tags.md` if it changes before 1B ships.

## Promotion (Phase 2)

When the operator clicks "promote" on an inbox draft:

1. Dashboard shows a destination picker based on the note's `type`:
   - `decision-draft` → `40_Decisions/`
   - `research` → `20_Knowledge/`
   - `goal` → `10_Projects/`
   - `summary` / `review` → operator chooses (often stays in inbox until archived)
2. The matching template's frontmatter is merged into the note (any missing required fields are flagged).
3. The note is moved (not copied) to the destination.
4. The OS records the promotion in the audit log with the source path and destination path.
5. If the operator promotes inside Obsidian manually instead of via the dashboard, the OS doesn't know and won't track it. That's fine — Obsidian is the authority on file location.

## Indexing

- A SQLite FTS5 index lives at `~/.agentic-os/index.db`.
- A `chokidar` watcher on the vault root keeps it fresh.
- The index is **derived state**. If it gets corrupted, delete it and the kernel rebuilds on next start.
- The index never modifies the vault.

## What the OS never does

- Never edits a note it did not author (no autoformatting, no link-fixing, no tag-cleanup).
- Never moves notes outside `00_Inbox/agentic-os/` without explicit operator action.
- Never deletes notes (even ones it authored) without operator confirmation.
- Never writes to `60_Attachments/`, `.obsidian/`, `.trash/`, `.git/`.
- Never adds a tag not in `Approved Tags.md`.
- Never bypasses this contract "just for one feature."

## Conflict with the user's vault git repo

The vault has its own `.git/` and `obsidian-git` plugin syncing it. The OS writes touch tracked files, so vault commits will include OS output. That's the desired behavior: every OS-generated note has full git history alongside hand-written notes. The OS does **not** run `git` commands inside the vault — `obsidian-git` handles that on its own schedule.

## Open questions deferred to Phase 1 implementation

- **Goals storage:** one file per goal (current proposal) vs. a single `Goals.md` with checkboxes (Julian's pattern). One-file-per-goal fits the templates better and lets each goal carry its own frontmatter and history. To be confirmed when the Goals UI is designed.
- **Chat session continuity:** when the operator continues a Claude conversation with `--continue`, do we append to the existing day's chat file or open a new one? Default proposal: new file per session (every `--print` invocation is a session), with the session id in frontmatter so we can group later.

Both questions will be settled in a Phase 1 ADR before code lands.
