# Feature Integration Guide

Reusable checklist for adding larger Agentic OS capabilities after the Phase 1C M4 foundation, such as Studio, Kanban, NotebookLM, provider integrations, or future workspace panels.

This guide exists to prevent one-off feature blobs. New features should plug into the existing config, registry, capability, permission, event, audit, and vault-writing contracts.

## When to use this guide

Use it before implementing any feature that adds one or more of:

- a new top-level app surface, sidebar item, command-palette command, or workspace panel;
- a new provider, connector, MCP server, or capability adapter;
- media or asset serving;
- vault reads/writes beyond existing chat/goals/journal/memory routes;
- background/manual mission behavior;
- new audit or event kinds.

Small cosmetic-only UI changes do not need this guide, but still need the normal UI/testing/security checks.

## Required design brief

Before code, write a short design brief in Obsidian or repo docs with:

1. Operator goal: what Rex can do after this lands.
2. User-facing surfaces: routes, nav entries, command-palette entries, settings panels.
3. Data/config shape: exact typed schema additions and defaults.
4. Capability/connector model: what capability IDs and connector definitions are needed.
5. Permissions: what side effects are possible and how the runner/API gates them.
6. Vault contract: what is read/written, exact inbox path(s), and whether the constrained writer is reused.
7. Asset serving: any local files exposed to the browser and the allowlist/path/MIME guard.
8. Audit/event story: new event kinds, audit fields, and privacy guarantees.
9. Testing plan: unit/security/API/UI tests and required screenshot/browser smoke.
10. Non-goals: what similar-looking work is intentionally deferred.

## Implementation checklist

### 1. Typed config first

- Extend `src/kernel/schemas/` with strict Zod objects.
- No `.passthrough()` and no `z.unknown()` bags for operator config.
- Secrets are references (`authRef` / env / secret resolver), not raw config values.
- Add example config only with placeholder-safe values.
- Add tests for valid config, rejected unknown keys, rejected unsafe paths, and cross-reference checks.

### 2. Register capabilities/connectors/features explicitly

- Add or extend registry definitions; avoid hardcoded feature names scattered through UI/API code.
- Connector definitions declare a flat `CapabilityId[]`.
- Capability failures must be neutral: generic message + error code, no raw input, secrets, private paths, connector stack, or provider body.
- If a feature uses MCP, validate `mcpServer` references against the configured `mcpServers` block.

### 3. Gate side effects by permission

- Decide which permission(s) are required before any side effect.
- Check permission before filesystem writes, event emits, subprocess/provider invocations, and local asset exposure.
- For missions, keep the existing rule: missions return outputs; the runner performs side effects.
- For external/provider calls, do not let a feature bypass the capability router or its neutral-result contract.

### 4. Preserve the vault contract

- Writes must land under `00_Inbox/agentic-os/...` unless Rex explicitly approves a new final-destination flow.
- Mission `vault-note` outputs must use `src/vault/constrainedWriter.ts`; do not create a second mission write path.
- Any new writer must perform lexical validation and realpath/symlink-escape checks before writing.
- Never write into `60_Attachments/` or arbitrary configured filesystem paths without a dedicated security design.

### 5. Serve local assets safely

- Do not expose raw filesystem paths directly to the browser.
- Use a guarded API route with:
  - fixed root or explicit allowlist;
  - URL decoding before validation;
  - path normalization + realpath/symlink containment checks;
  - MIME allowlist;
  - method/origin checks;
  - neutral errors.
- Add tests for traversal, encoded traversal, symlink escape, bad MIME, and missing file behavior.

### 6. Register UI dynamically but keep UX premium

- Add sidebar/command-palette entries through a central registry or feature definition, not duplicated hardcoded lists.
- Keep categories compact and readable; avoid cheap emoji/glyph icons and oversized nav tiles.
- Use existing shell chrome, card, status, and badge patterns.
- For major surfaces, require screenshot/browser smoke at common widths and compare against the intended design, not only functional presence.

### 7. Audit and event privacy

- Audit records carry counts, IDs, neutral status/error classes, byte/char lengths, and hashes where useful.
- Audit records must not carry raw prompts, provider responses, mission options, note content, raw stdout/stderr, secrets, private paths, or stack traces.
- Bus events shown live may carry richer UI data, but do not mirror that data blindly into audit JSONL.

### 8. Tests and gates

At minimum:

- unit tests for schema/registry/capability behavior;
- API tests for origin gate, strict body shape, neutral errors, and path guards;
- writer/asset tests for traversal, encoded traversal, and symlink escape;
- permission-denied tests proving no side effect occurred;
- UI smoke or Playwright test for any new visible surface;
- `npm run typecheck`, `npm test`, `npm run build`, and `git diff --check`.

After `npm run build`, re-check `git status`; Next.js can rewrite `next-env.d.ts`. Restore it if it is review noise.

## Reusable worker prompt

```text
Agentic OS feature integration — <feature name>

Repo: /home/spawn/Apps/agentic-os
Branch: <branch name>

Implement <feature name> using the Feature Integration Guide.

Scope:
- <exact routes/components/config files allowed>
- <exact capability/connector/mission behavior allowed>
- <exact vault/asset paths allowed>

Hard requirements:
- Typed strict config/schema; no passthrough or z.unknown config bags.
- Secrets by reference only; no raw secrets in config, audit, errors, tests, or docs.
- Connector/capability failures are neutral.
- Side effects are permission-gated before they happen.
- Vault writes use the approved writer path and stay under the allowed inbox roots.
- Local files/assets are served only through guarded API routes with decode + realpath containment + MIME checks.
- UI follows the existing premium compact Agentic OS patterns and includes screenshot/browser smoke when visible.

Tests/gates:
- Add tests for config, permissions, neutral errors, path/asset guards, and visible UI if applicable.
- Run: git status --short --branch, npm run typecheck, npm test, npm run build, git diff --check, git status --short --branch.
- If build dirties next-env.d.ts as review noise, restore it and re-check status.

Boundaries:
- Do not broaden scope.
- Do not commit, push, merge, tag/release, install dependencies, restart services, delete branches, force-push, or run destructive commands unless Rex explicitly approves.
- Report back with files changed, verification results, known risks, and prohibited-action statement.
```

## Review checklist

Before acceptance, verify:

- The feature can be disabled or omitted without breaking existing app paths.
- Unknown config keys fail closed where appropriate.
- Permission-denied paths produce no side effects.
- Failure responses do not echo raw input, paths, secrets, provider messages, or stack traces.
- Audit JSONL stays neutral and count/hash based.
- Browser-visible UI matches the design quality bar.
- Docs and Obsidian project notes identify future-phase work separately from shipped behavior.
