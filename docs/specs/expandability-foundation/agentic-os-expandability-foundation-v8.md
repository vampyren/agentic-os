# Agentic OS Expandability Foundation — Final Consolidated Architecture v8

**Date:** 2026-05-21  
**Status:** Final consolidated architecture, fourth-pass — fixes contradictions and small type holes surfaced by cross-review; pre-execution ready for M1.  
**Implementation status (as of 2026-05-23):** M1 ✅ (PR #11), M2 ✅ (PR #12), M3 ✅ (PRs #14/#15/#16 + closeout #17), M4a ✅ (PRs #18→#23 code; closeout PR #26 open). The v8 "M4b" slot was retired during execution and replaced with the optional **M4a-5** (`m4a-5-task-spec.md` v1.2, parked design — connector hardening + model discovery). M5–M10 remain as described below.  
**Sources consolidated:** Jarvis proposal + Claude proposal + ChatGPT consolidation + Hermes Agent investigation + Hermes tool-pattern review + Rex's three independence principles + four rounds of fresh-eyes review  
**Scope:** Foundation architecture for Goals 1–3 and Goal 7, plus sequencing for Goals 4–6  
**Audience:** Rex, future contributors, Claude/Hermes/Jarvis agents, and any agent (Claude Code, Hermes, etc.) executing milestone deliveries from this document  
**Purpose:** Single source of truth — the design + the binding orchestration contract + the milestone graph. An agent reading this doc plus the per-milestone task specs should be able to deliver M1 through M10.

**Companion documents:**

- `m1-task-spec.md` — per-milestone implementation plan for M1 (proof of the deliverable-decomposition layer; M2–M10 task specs follow on demand once M1 is verified).
- The standalone `adr-0019-orchestration-message-mediation.md` from earlier sessions is **superseded** by §6.5 of this document. Keep or delete the standalone file as you prefer; v8 §6.5 is now the binding contract.

## The three independence principles (locked)

These are non-negotiable hard constraints. Every architectural decision in this document is checked against them:

1. **No system dependency on Hermes.** Agentic OS is not built on top of Hermes. If Hermes development changes direction or stops, every Agentic OS feature continues to work unaffected.
2. **Any-agent orchestration.** The orchestration runtime must work with any agent or LLM — Claude Code, Hermes, OpenRouter models, future providers. No part of orchestration assumes a Hermes-specific abstraction.
3. **Implementation independence.** Agentic OS does not adopt Hermes' state model, dispatcher implementation, or DB schema as its own. We borrow architectural *patterns* (claim/heartbeat/reclaim, fork/join distinction, swarm topology) and implement them natively.

**v5 changes from v4:**

- Restored Hermes-independence after v4's drift. Orchestration MVP (M6) and Kanban pilot (M7) are now **native**, not Hermes-backed.
- HermesConnector stays a first-class connector among many. ClaudeCodeConnector is equal priority in M4a.
- Hermes Kanban read-only projection (M4b) becomes an **optional** preview feature, with no orchestration or Kanban-pilot dependency on it.
- Removed v4's "Hermes ↔ Agentic OS object mapping table" that coupled our concepts to Hermes concepts. Patterns borrowed from Hermes are absorbed into the Run model in §5.6 with attribution, not architectural coupling.
- Removed v4's M8 "Native Agentic OS orchestration decision" — native is the foundation, period. There is no fork-in-the-road decision to make later.
- Hermes state demoted from a persistence layer (was §7.5) to a note about an optional external system that connectors interact with.
- Renumbered milestones after the M6/M7/M8 changes.

**v5 post-review fixes (after fresh-eyes review found four residual Hermes leaks):**

- Removed `externalSystems?: { hermes?: boolean }` from `FeatureModule`. Feature dependencies on external systems are expressed through generic `requiredCapabilities`, not a Hermes-shaped slot.
- Removed `backend?: { kind: "native" | "hermes" }` from `CollaborationMission`. Orchestration is always native; external references appear only on child runs, artifacts, and assignments via existing generic `externalRefs?: ExternalRef[]`.
- Removed Hermes-specific capability IDs (`hermes.status`, `hermes.kanban.*`, etc.) from the global `CapabilityId` enum. Replaced with generic capabilities (`kanban.task.*`, `kanban.board.list`, `subagent.delegate`). HermesConnector now *implements* generic capabilities; the implementation calls Hermes but the capability surface is connector-agnostic.
- Removed Hermes-specific `ApprovalKind` values (`hermes.task.complete`, `hermes.task.unblock`, `hermes.write`). Replaced with generic `external.system.write`. Connector identity goes in `payloadRef`, not in the global enum.
- Fixed downstream wording in §6.4 ("when backend = hermes" → connector-opaque external references) and §3.1 (HermesConnector capability list framed as "implements these generic capabilities" rather than exposing Hermes-specific IDs).

**v6 changes from v5 (after second-pass type-system audit):**

Residual Hermes leaks missed in the v5 post-review fixes:

- Removed Hermes-named error codes from `ConnectorValidation.errorCode` enum (§5.4). Replaced `"hermes-not-found" | "hermes-kanban-unavailable"` with generic `"capability-unavailable" | "external-system-unavailable" | "binary-not-found"`. Specific diagnostic text moves to a human-readable message field.
- Changed `ExternalRef.system` from `"hermes" | "future"` to `system: string` (carries the connector ID). The `"future"` placeholder was admitting the enum was wrong; the connector ID is the right shape.
- Renamed `RunStepRecord.kind` entries from `"external.hermes.task.create" | "external.hermes.task.observe"` to generic `"external.task.create" | "external.task.observe"`. Connector identity is already on the step via `connectorId`.
- Reworded §6 intro to remove "Hermes can execute early durable work graphs" — orchestration is connector-agnostic by design; singling out Hermes in the intro contradicts that.

Documentation consistency:

- Fixed ADR numbering inconsistency between §4 M0 and §12. Aligned both on §12's scheme: orchestration is ADR-0019, connector runtime is ADR-0018.

Type-system tightenings surfaced in the audit:

- Added `"cancelled"` to `AgentAssignment.status` so assignments aren't orphaned when a mission is aborted mid-revision.
- Made `HumanResolution.resumeContextArtifactId` optional and documented the abort case (an aborted mission produces an abort-summary packet, not a resume context).
- Documented that `DecisionGate.kind` enum is forward-aspirational; only `"consensus-failed"` is wired in the M6 MVP.
- Added §7.6 "Cross-store reference handling" — a tolerance policy for dangling refs (deleted vault notes, removed external tasks).
- Tightened §5.9 "Audit and events" — added explicit rules that SSE projections require per-event schema (no raw bus-payload passthrough) and that `AuditRecord.errorCode` values come from a fixed registry.
- Added forward-references in §6 pointing to ADR-0019 for the runtime gaps the design doc does not specify itself: heartbeat ownership, sibling/join policy for parallel runs, M6 independence test specification.

No structural changes: layer model, milestone graph, four-store persistence, FeatureModule/Exposures split, and the orchestration state machine are unchanged from v5.

**v7 changes from v6 (Hermes-tool-pattern review + orchestration contract folded in):**

Connector pattern enrichments (informed by Hermes' provider catalog UX — see §5.4, §5.10):

- Expanded `CapabilityId` enum to cover the well-known capability surface real LLM tooling needs: added `audio.tts`, `vision.analyze`, `video.analyze`, `code.execute`, `file.read`, `file.write`, `file.search`, `terminal.execute`, `computer.use`. Features and connectors communicate exclusively through this closed enum in v1. (v7 originally claimed connectors could expose connector-private extras; v8 walks that back — see v8 changes below.)
- Added §5.10 "Connector preset catalog" — generalizes the LLM-provider preset pattern (OpenAI / OpenRouter / Anthropic / Ollama / LM Studio / vLLM via one OpenAI-compatible connector type) to any capability with multiple providers (TTS, image-gen, transcription, video-gen). Adding a provider becomes "pick preset, supply credentials" in Settings — no code change.
- M4a scope expanded: ships four connector type families plus the preset catalog. Connector types: (1) OpenAI-compatible LLM, (2) OAuth-mediated LLM, (3) CLI/ACP-mediated agent, (4) Native vendor API. Initial presets for the most common providers in each family.
- Added explicit rule: each connector is responsible for its own context-window management (compression, summarization, truncation). The Capability Router does not manage context.

Per-Run resource budgets (informed by Hermes' `maxIterations` and `compressionThreshold` settings):

- Added optional budget slots to `RunRecord`: `maxIterations?`, `maxDurationMs?`, `maxToolCalls?`, `maxCostUsd?`. Not all enforced in M3 — schema slots only — but features can populate them and connectors can read them. The runtime can enforce when ready; M3 just persists.

Clarification primitive (informed by Hermes' first-class "Clarifying Questions" tool):

- Added `RunStatus: "waiting-clarification"` and `ApprovalKind: "agent.clarification"`. Agents can pause mid-run and ask Rex a question; Rex answers (free-form text or selection); run resumes. This complements decision packets: decision packets are "agents disagree, you arbitrate"; clarifications are "agent doesn't know enough, you fill in." Same Approval primitive, different intent.

Orchestration contract folded in:

- §6.5 "Binding orchestration contract" — full message-mediation contract, heartbeat ownership, join policy, M6 independence test specification, failure modes, recovery semantics. Content moved from the standalone ADR-0019 file. The standalone file is superseded; v7 is the single source of truth until you choose to extract ADR files back out for the repo's `decisions/` directory.

Decisions from the previous review round (architecture-vs-implementation, global maxRounds, multi-endpoint connectors):

- `DecisionGate.kind` keeps `"architecture"` and `"implementation"` as the meaningful values for current and post-MVP runtime behavior. Others (`"risk"`, `"release"`, `"scope"`) marked future-aspirational.
- `maxRoundsPerPhase` is a **global Settings value** (default 2), not per-mission. Rex's "send back for another round" uses the `request-more` action on the decision packet (adds +1 to budget; already in design).
- New paragraph in §6 explaining: M6 ships pause-everything-on-disagreement. Post-M6 hierarchical missions ship pause-affected-only for `"implementation"` decisions, pause-tree for `"architecture"` decisions. The `DecisionGate.kind` discriminator is locked now so this is a runtime change later, not a schema migration.

Anti-pattern added to §13:

- "Connector definitions that hardcode a single endpoint or single provider variant" — connector types must support multi-endpoint configuration via the preset catalog. A connector that only talks to one URL is a future migration burden.

**v8 changes from v7 (fourth-pass cross-review — fixes contradictions and small type holes):**

Six precision fixes (contradictions and bugs surfaced by cross-review):

- §14 was listing items as "open questions" that §6.5.9 had already locked. §14 replaced with "Closed decisions (consolidated)" — a single readable summary; no more contradictory state.
- §6.1 had a forward-reference paragraph pointing to "ADR-0019" while the top of v7 says that ADR is superseded by §6.5. Forward-reference updated to point at §6.5.
- §10.3 HermesConnector test text still said `hermes -> hermes-not-found` (a Hermes-named error code that no longer exists in the enum after v6's cleanup). Fixed to `binary-not-found`.
- `DecisionGate.kind` was conflating two concepts — *why the gate fired* and *what scope of decision*. Split into two fields per the cross-review: `trigger: "consensus-failed" | "manual-escalation"` and `scope: "architecture" | "implementation"`. Maps cleanly to post-M6 pause behavior: architecture pauses the tree, implementation pauses the affected sub-mission. Updated all references in §6.2, §6 pause-policy paragraph, and §6.5.
- `RunStatus` gained `"blocked"`. The `autoBlockedAt` field on `RunRecord` existed but the status enum had no corresponding state; auto-blocked runs were implicit. Now explicit, with transition rules documented in §5.6: blocked → queued/running (on manual unblock) or → failed/cancelled.
- `ApprovalRecord.decision` gained `"answer"` variant and `responsePayloadRef?: string` field — the clarification primitive (added in v7) had no place to record Rex's answer. Now durable for replay/resume.

Documentation precision:

- Removed the v7 prose claim that "connectors MAY also expose connector-specific capabilities with arbitrary string IDs." The type didn't support it and no MVP feature needs it. Replaced with a short "future extension" note in §5.4: connectors expose only well-known `CapabilityId` values to the runtime in v1; the `connectorCapabilities` outlet can be added when a real use case appears.
- §M4a gained a note on internal PR sub-split (M4a-1 through M4a-4) as a delivery-time decomposition; same milestone scope, smaller PRs.

No structural changes from v7. The layer model, milestone graph, four-store persistence, FeatureModule/Exposures split, capability preset catalog, and orchestration state machine are unchanged. Six precision fixes + two doc clarifications.

**v8 post-acceptance mechanical fixes (final cross-review):**

- §5.3 `gateFeatureApi` snippet: unknown feature IDs now 404 before the `status-only` mode branch (matches the corrected M1 task spec; original v8 snippet still had the unsafe ordering). Page-level `requireFeatureReady` / `requireFeatureEnabled` also hardened to handle missing-feature case.
- §12 "Status of ADR-0019 content" paragraph: replaced stale `v7` references with `v8` (v8 is the source of truth; the paragraph was carried over from v7's pre-rename state).

No design change. Both are mechanical doc cleanup.

---

## 0. TLDR

This is the final recommended direction after the Hermes investigation and the independence-principle correction.

### The most important framing

Hermes has useful multi-agent coordination primitives:

```text
delegate_task  -> short fork/join subagent calls, not durable
Kanban         -> durable multi-agent work queue with comments, claims,
                  heartbeats, retries, blocking, dispatcher, and workers
Swarm          -> root task + parallel workers + verifier + synthesizer
```

This validates the architecture direction. It does **not** become the foundation. The three independence principles above govern the relationship: HermesConnector is one connector among many; orchestration is native and connector-agnostic; we borrow patterns, not coupling.

Best use of Hermes:

```text
Use Hermes as:
1. a first-class connector (one of several),
2. a reference implementation whose validated patterns we absorb natively,
3. an optional read-only preview feature in the UI.
```

Do **not** use Hermes as:

```text
- the execution backend for orchestration
- the state store for any Agentic OS data
- a required dependency for any Agentic OS feature
```

Agentic OS owns:

```text
Feature registry
UI shell
Route gates
Run ledger (native; absorbs Hermes patterns)
Approvals
Artifacts
Vault promotion
Obsidian output policy
CEO/CTO decision UX
Final source-of-truth decisions
Native orchestration runtime
Native Kanban primitives
```

### The core platform

Agentic OS should become a local-first internal feature platform with these primitives:

```text
UI Shell
Feature Registry + Lifecycle Resolver
UI Exposures
Route/API Gates
Run Ledger
Artifact Registry
Approval Queue
Capability Router
Connector Runtime
Safe Kernel Services
Obsidian Vault Integration
Audit/Event System
```

HermesConnector and ClaudeCodeConnector live inside Connector Runtime — they are not separate platform primitives.

### The critical architecture calls

1. **Use 4 feature states, not 9.**

```text
ready
disabled
degraded
unavailable
```

Visibility is computed separately. Permission/approval is per-action, not feature lifecycle.

2. **Split `FeatureModule` from `FeatureExposures`.**

```text
FeatureModule      = stable core contract
FeatureExposures   = UI surfaces such as nav, commands, cards, settings panels
```

This avoids turning the core feature type into a 50-field monster.

3. **Use a four-store persistence model.**

```text
Audit JSONL     -> immutable neutral facts: "what happened"
SQLite state    -> mutable Agentic OS state: runs, approvals, artifact metadata, orchestration
Filesystem      -> artifact bytes under allowlisted roots
Obsidian vault  -> durable user-facing notes, inbox-first and promotion-gated
```

Hermes has its own state:

```text
~/.hermes/kanban.db
~/.hermes/kanban/...
```

Agentic OS may read/control Hermes through a connector, but should not treat Hermes DB as its own authoritative state.

4. **Split Goal 3 into two parts.**

Goal 3 is too important to treat as one later block.

```text
M3: SQLite run ledger foundation
M5: Artifacts + approvals
```

The run ledger should exist before real connector/test workflows, because connector tests, long provider calls, cancellation, retry, and orchestration child tasks are all runs.

5. **Design orchestration early, implement it after primitives.**

Write the orchestration ADR before run/artifact/approval schemas are locked. Implement the runtime after runs, connectors, artifacts, and approvals exist.

6. **Start connector runtime with local agents first.**

Use existing Claude Code and Hermes/GPT-5.5 as the first real connectors. Add cloud providers after the local connector path is proven.

7. **Use HermesConnector as a connector, not a bridge dependency.**

Hermes is exposed through HermesConnector with capabilities like `agent.run`, `kanban.task.list`, `kanban.task.create`. Orchestration and Kanban features call capabilities, not Hermes specifically — any connector that implements the capability is interchangeable. A read-only Hermes Kanban projection is an optional preview feature that users can install or skip; orchestration MVP and Kanban pilot do not depend on it.

8. **Build a thin CEO/CTO orchestration MVP, but do not make agents a chat room.**

The CEO/CTO loop is the product identity. Keep the MVP thin:

```text
two agents
one brief
one independent proposal round
one critique/revision round
decision packet if unresolved
Rex resolution
resume
```

Agents are invoked through the capability router; any combination of connectors (Claude Code, Hermes, OpenRouter, future) can fulfill the roles. Agentic OS owns the mission state, decision packet, and approval gate regardless of which agents execute the work.

9. **Kanban pilot is native.**

Native Agentic OS Kanban primitives, owned by the Agentic OS run/artifact model:

```text
Native Kanban Lite first
Optional Hermes Kanban view as a separate feature
```

The Hermes Kanban view (M4b) is a read-only preview feature for users who already have Hermes installed. It does NOT replace native Kanban primitives and is not a prerequisite for the Kanban pilot.

### Final sequence

```text
M0   ADR/design lock
M1   Feature foundation
M2   Registry-driven shell
M3   SQLite run ledger foundation
M4a  Connector runtime + ClaudeCodeConnector + HermesConnector
M4b  Hermes Kanban read-only projection  (optional preview feature)
M5   Artifacts + approvals
M6   Native multi-agent orchestration MVP  (connector-agnostic)
M7   Native Kanban Lite pilot
M8   Obsidian promotion workflow
M9   Studio/media pilot
M10  NotebookLM/research pilot
```

M4b is **optional** and parallel to M5. It does not block M6 or M7. Users who never install Hermes still get every Agentic OS feature.

Alternative lower-risk ordering — swap M6 and M7 if foundation-validation matters more than product identity in that moment:

```text
M6  Native Kanban Lite pilot
M7  Native orchestration MVP
```

Both stay native. The product-led recommendation keeps the orchestration MVP first because the CEO/CTO loop is the defining Agentic OS experience.

---

## 1. What changed after the Hermes investigation

### Before Hermes investigation

The v3 architecture assumed Agentic OS would build native primitives first:

```text
Feature foundation
Registry-driven shell
Run ledger
Connector runtime
Artifacts/approvals
Native orchestration MVP
Kanban pilot
```

### After Hermes investigation

Hermes already has proven concepts that map to Agentic OS goals:

| Agentic OS concept | Hermes equivalent / inspiration |
|---|---|
| Run ledger | Kanban task_runs / task_events |
| Long-running work | Kanban task with claim, heartbeat, stale reclaim |
| Agent assignment | Task assignee/profile |
| Durable handoff | Task comments / completion summary / metadata |
| Blocking / human input | Blocked task with reason, unblock/comment |
| Multi-agent swarm | Root task + parallel workers + verifier + synthesizer |
| Scoped tools | Worker tools vs orchestrator tools |
| Safety boundary | Worker ownership enforcement |
| Dashboard/API bridge | Kanban dashboard plugin API |
| Short subtask | delegate_task |

Important repo/docs references:

- Hermes Kanban DB: `hermes_cli/kanban_db.py`
- Hermes Kanban CLI: `hermes_cli/kanban.py`
- Hermes Kanban tools: `tools/kanban_tools.py`
- Hermes Kanban swarm: `hermes_cli/kanban_swarm.py`
- Hermes Kanban dashboard API: `plugins/kanban/dashboard/plugin_api.py`
- Hermes docs:
  - https://hermes-agent.nousresearch.com/docs/user-guide/features/delegation
  - https://hermes-agent.nousresearch.com/docs/user-guide/features/kanban-tutorial
  - https://hermes-agent.nousresearch.com/docs/user-guide/features/kanban-worker-lanes
  - https://hermes-agent.nousresearch.com/docs/user-guide/features/code-execution
  - https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks
  - https://hermes-agent.nousresearch.com/docs/user-guide/features/batch-processing
- Hermes source:
  - https://github.com/NousResearch/hermes-agent

### Final interpretation

The Hermes investigation gives us **validated patterns to absorb into native primitives**, plus an **optional connector** for users who run Hermes. It does not change the foundation:

```text
Agentic OS runs natively.
Patterns borrowed from Hermes (claim/heartbeat/reclaim, fork-join vs durable,
swarm topology) are absorbed into Agentic OS's Run model with attribution.
HermesConnector lets Agentic OS invoke Hermes when the operator has it
installed. Other connectors (Claude Code, OpenRouter, future) are equally
first-class.
Hermes Kanban read-only projection is an optional preview feature, not
infrastructure.
```

---

## 2. Consolidated architecture diagram

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ UI SHELL                                                                 │
│ Sidebar · Command Palette · Dashboard · Settings · Workspaces            │
│ Consumes UI-safe feature exposures. No duplicated hardcoded feature lists.│
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │
                                   │ UI-safe projection
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ FEATURE REGISTRY + LIFECYCLE RESOLVER                                    │
│ FeatureModule core + FeatureExposures                                    │
│ Resolves: ready | disabled | degraded | unavailable                      │
│ Provides route/API gate helpers                                          │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │
                                   │ feature requests capability/run/action
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ RUNS · ARTIFACTS · APPROVALS                                             │
│ Run: durable Agentic OS work + cancellation + restart recovery           │
│ Artifact: opaque local file metadata + guarded serve route               │
│ Approval: risky action gate + resume semantics                           │
│ Backed by ~/.agentic-os/state.db                                         │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │
                                   │ invokes work through capability router
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ CAPABILITY ROUTER                                                        │
│ agent.run · llm.chat · image.generate · mcp.tool · ...                   │
│ Features ask for verbs, not concrete providers                           │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │
                                   │ selects enabled/authorised connector
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ CONNECTOR REGISTRY + CONNECTOR RUNTIME                                   │
│ ClaudeCodeConnector · HermesConnector · OpenRouter · Ollama · MCP · ...  │
│ Code definitions + strict settings + authRef-only secret resolution      │
│ No connector is the "default"; the router picks by capability+health     │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │
          ┌────────────────────────┼─────────────────────────┐
          │                        │                         │
          ▼                        ▼                         ▼
┌───────────────────┐   ┌────────────────────────┐   ┌───────────────────┐
│ Claude Code local │   │ Hermes Agent local     │   │ Future providers  │
│ streamJson/CLI    │   │ (optional, peer)       │   │ HTTP/MCP/SDK      │
└───────────────────┘   └────────────────────────┘   └───────────────────┘
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ SAFE KERNEL SERVICES                                                     │
│ Event Bus · SSE · Audit JSONL · Vault Writer · Constrained Writer        │
│ safeSpawn · Config · Secrets · Permission Gates                          │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │
                                   │ persists to
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ PERSISTENCE — four stores, four jobs, no overlap                         │
│                                                                          │
│ Agentic OS audit   ~/.agentic-os/audit/YYYY-MM-DD.jsonl                  │
│ Agentic OS state   ~/.agentic-os/state.db                                │
│ Agentic OS files   ~/.agentic-os/artifacts/...                           │
│ Obsidian           vault.root / 00_Inbox/agentic-os/... first            │
└──────────────────────────────────────────────────────────────────────────┘
```

External system state (e.g. `~/.hermes/kanban.db`) is **not** part of Agentic OS persistence. Connectors reach external systems; Agentic OS features never see those paths. See §7.5.

Hard rules:

```text
Features never import other features.
Features never call connectors directly.
Connectors never call other connectors.
Anything that writes Agentic OS files goes through a kernel writer.
Secrets are resolved only server-side.
Routes are gated server-side.
Audit stays neutral and content-free.
Hermes state is external state, not Agentic OS source-of-truth state.
```

---

## 3. Hermes-specific architecture impact

## 3.1 Add HermesConnector

Agentic OS should include a first-class HermesConnector. It implements generic capabilities from the global enum (see §5.4) — not Hermes-specific capability IDs. The capability surface is generic; the implementation happens to call Hermes.

Generic capabilities HermesConnector implements:

```text
agent.run
subagent.delegate
kanban.board.list
kanban.task.list
kanban.task.show
kanban.task.create
kanban.task.comment
kanban.task.block
kanban.task.unblock
kanban.task.complete
```

Connector health (`connector.test`) is the per-connector health/availability check — common to all connectors, not a Hermes capability.

Do not expose all capabilities at once.

Start read-only:

```text
agent.run
kanban.board.list
kanban.task.list
kanban.task.show
```

Then add safe writes:

```text
kanban.task.create
kanban.task.comment
kanban.task.block
kanban.task.unblock
```

Delay destructive/terminal writes:

```text
kanban.task.complete
archive
delete
board admin
dispatcher config
```

## 3.2 Adapter choice

### Option A — CLI adapter first

Use safe subprocess calls:

```text
hermes kanban list --json
hermes kanban show <id> --json
hermes kanban create ... --json
```

Pros:

```text
fastest
least invasive
uses public Hermes surface
works without importing Python
keeps Agentic OS/Next isolated from Hermes internals
```

Cons:

```text
slower
CLI JSON parsing
must map stderr/errors neutrally
```

### Option B — Hermes dashboard/API adapter

Pros:

```text
structured HTTP
closer to Hermes dashboard state
better for UI-like operations
```

Cons:

```text
requires Hermes dashboard running
requires session token/auth flow
more coupling
```

### Option C — Direct SQLite read-only adapter

Pros:

```text
fast
good for read-only dashboards
```

Cons:

```text
schema coupling
WAL/locking concerns
dangerous if writes creep in
```

Final recommendation:

```text
Start with CLI adapter.
Add direct read-only DB adapter later only if performance requires it.
Avoid direct DB writes.
```

## 3.3 HermesConnector as a peer connector — not a bridge

HermesConnector is one of several connectors. Orchestration, Kanban, and any future feature consume capabilities through the capability router; they never reach Hermes directly.

```text
Feature (orchestration, kanban, ...)
   ▼
Capability router    (e.g. "agent.run", "kanban.task.list")
   ▼
HermesConnector  -or-  ClaudeCodeConnector  -or-  OpenRouterConnector  -or- ...
```

A feature that uses HermesConnector must also work with at least one other connector implementing the same capability. If Hermes is the only implementer of a capability, that capability is feature-flagged behind the optional Hermes preview feature.

### Patterns absorbed into the Run model (not coupled)

The Hermes investigation surfaced patterns that are absorbed natively into Agentic OS's Run model (see §5.6). These are documented with attribution comments in code but do not create runtime dependencies on Hermes:

| Pattern absorbed natively | Inspiration source |
|---|---|
| Claim / heartbeat / reclaim semantics | Hermes Kanban dispatcher |
| Stale-claim detection + auto-block on repeated failure | Hermes Kanban dispatcher |
| Fork/join (non-durable) vs durable work distinction | Hermes `delegate_task` vs Kanban split |
| Comments-as-protocol for cross-agent durable handoff | Hermes task comments |
| Worker-scoped vs orchestrator-scoped tools | Hermes tool gating |
| Swarm topology (root → parallel → verifier → synthesizer) | Hermes `kanban_swarm.py` |
| Atomic task claim with worker identity | Hermes Kanban claim flow |

These are *patterns implemented in TypeScript inside Agentic OS*. They do not import from Hermes, do not call Hermes at runtime, and remain functional with HermesConnector disabled or absent.

### What stays in Hermes

The Hermes installation (if present) keeps its own state, its own dashboard, and its own CLI. Agentic OS does not write to `~/.hermes/kanban.db` directly. All interaction goes through HermesConnector's CLI adapter.

---

## 4. Final sequencing with Hermes included

## M0 — ADR/design lock

Write the foundation ADRs before code.

Required before implementation:

```text
ADR-0013 Feature lifecycle state model
ADR-0014 Four-store persistence model and stateDbVersion
ADR-0015 FeatureModule vs FeatureExposures split
ADR-0017 HermesConnector and external work bridge
ADR-0019 Multi-agent orchestration and CEO/CTO decision loop
```

Recommended but not strictly blocking (can land alongside the milestone they belong to):

```text
ADR-0016 Run ledger foundation       (lands with M3)
ADR-0018 Connector runtime + authRef (lands with M4a)
```

Exit criteria:

```text
Rex approves the sequence, state model, persistence model, three independence
principles, and orchestration stance.
No implementation starts before ADR-0013, ADR-0014, ADR-0015, ADR-0017,
and ADR-0019 are accepted.
```

---

## M1 — Feature foundation

Build:

```text
FeatureModule core type
FeatureExposures type
Feature registry
Feature lifecycle resolver
UI-safe feature projection endpoint
Page route gate helper
API route gate helper
```

Migrate one low-risk feature first. Recommended: Scheduler.

Exit criteria:

```text
Scheduler registers as a feature.
Feature projection endpoint returns UI-safe data.
Disabled feature fails closed at route/API gate.
Feature state has 4 statuses plus visibility.
No raw config/secrets/paths are exposed to client.
```

---

## M2 — Registry-driven shell

Build:

```text
Sidebar consumes feature nav exposures.
Command palette consumes feature command exposures.
Dashboard consumes feature card exposures.
Settings shows read-only feature status/config summary.
```

Do not build full settings editing yet.

Exit criteria:

```text
Adding one feature nav item requires registering feature exposures,
not editing sidebar + command palette + dashboard separately.
```

Core shell items such as Mission Control and Settings may remain shell-owned.

---

## M3 — SQLite run ledger foundation

Build:

```text
~/.agentic-os/state.db
stateDbVersion
migration runner
runs table
run_steps table
external_refs table or linked refs field
restart recovery
cancellation model
run status API
basic run events
```

Do not put audit into SQLite.

Audit remains JSONL.

Exit criteria:

```text
A dummy long-running run can start, update progress, finish, fail, cancel,
and restore after server refresh/restart.
Active runs are marked interrupted/resumed/cancelled based on policy.
Scheduler mission fires can be represented as Run records.
A run can link to an external system reference such as Hermes task/run ID.
```

---

## M4a — Connector runtime + local connectors + preset catalog

Build:

```text
ConnectorRuntime
strict ConnectorSettings
authRef resolver
testConnection as Run
capability router calls real connectors
preset catalog mechanism (§5.10)
four connector type families:
  1. openai-compatible-llm    (one definition, multi-endpoint via presets)
  2. oauth-mediated-llm       (xAI Grok, Qwen, Gemini Code Assist, Copilot)
  3. cli-acp-agent            (Claude Code, Hermes, Anthropic ACP, Copilot ACP)
  4. native-vendor-api        (Anthropic native, Google Gemini, GLM, DeepSeek)
initial preset catalog with the most common providers
```

The two locally-installed agents (ClaudeCodeConnector via `cli-acp-agent`, HermesConnector via `cli-acp-agent`) are equal-priority first connectors. Both must work end-to-end before M4a is complete. Neither is the "default" — the capability router picks based on availability and capability fit.

Initial connector instances at M4a sign-off:

```text
Claude Code           type: cli-acp-agent          capability: agent.run
Hermes (CLI)          type: cli-acp-agent          capabilities: agent.run,
                                                                  kanban.* (read-only)
```

Plus at least one provider configured per type family for end-to-end validation:

```text
OpenAI                type: openai-compatible-llm  capability: llm.chat
                      (requires Rex to add API key via Settings → "Add Provider")
```

The preset catalog mechanism is exercised by adding OpenAI through Settings. If that workflow works, M4a's promise — "adding new providers is configuration, not code" — is verified.

**Suggested internal PR sub-split** (delivery decomposition; same M4a scope, smaller PRs):

```text
M4a-1  Connector runtime core
       - ConnectorDefinition / ConnectorSettings types
       - authRef resolver
       - capability router
       - testConnection as Run (depends on M3)

M4a-2  Local CLI/ACP agent connectors
       - cli-acp-agent connector type family
       - ClaudeCodeConnector instance
       - HermesConnector instance (agent.run only)
       - end-to-end agent.run test for both

M4a-3  Preset catalog + OpenAI-compatible LLM connector type
       - openai-compatible-llm type family
       - preset catalog mechanism (§5.10)
       - Add Provider UI flow in Settings
       - end-to-end test: Rex adds OpenAI via Settings, llm.chat works

M4a-4  Hermes read-only Kanban capabilities
       - kanban.board.list, kanban.task.list, kanban.task.show on HermesConnector
       - rounds out M4a exit criteria for kanban.* read-only

The other two type families (oauth-mediated-llm, native-vendor-api) can be
deferred to M4a-5 / post-M4a if delivery time is constrained — the type
family slots exist in the design; specific implementations land when needed.
```

Exit criteria:

```text
Claude Code can be invoked through capability router with agent.run.
Hermes can be invoked through capability router with agent.run.
kanban.task.list/show works through capability router via HermesConnector (read-only).
A user can add OpenAI (or any openai-compatible provider) via Settings → "Add Provider"
  without writing code; the preset picker shows the catalog; auth dialog asks for key;
  connector becomes available immediately on save.
Connector testConnection creates a Run.
Disabled connector cannot invoke.
Raw secrets never leave server runtime.
Connector failures are neutral.
A feature can work with ANY connector implementing the required capability — no
  feature hardcodes a specific connector ID.
```

---

## M4b — Hermes Kanban read-only projection (optional preview feature)

**This milestone is optional and parallel to M5.** It does not block any other milestone. Users who never install Hermes still get every other Agentic OS feature.

Build:

```text
Feature: hermes-kanban-preview
API: list boards/tasks, show task detail (via HermesConnector)
UI: read-only board/list/detail
No writes
No approvals
No native Kanban state
```

Feature state when Hermes is not installed: `unavailable` (with neutral diagnostic). Other features remain `ready`.

Exit criteria:

```text
Agentic OS can show Hermes Kanban tasks without direct DB access.
No raw ~/.hermes paths exposed to browser.
Malformed Hermes output is handled neutrally.
Disabled HermesConnector makes the feature unavailable.
Feature can be turned off without affecting any other Agentic OS feature.
```

---

## M5 — Artifacts + approvals

Build:

```text
artifacts table
artifact file root
guarded artifact serve route
approvals table
approval inbox API/UI
approval resume callbacks
```

Exit criteria:

```text
A run can produce an artifact.
Browser can view artifact only through artifact ID route.
Traversal/symlink/MIME tests pass.
Risky action can pause for approval and resume.
Rejected approval produces no side effect.
```

---

## M6 — Native multi-agent orchestration MVP

Build the orchestration runtime natively, on top of M3 (Run ledger) + M4a (Connector runtime) + M5 (Artifacts + approvals). Agents are invoked through the capability router — any combination of connectors can fulfill the roles.

Scope:

```text
CollaborationMission feature
  intake -> proposal -> critique -> revision -> consensus -> resolved -> completed
  bounded debate: maxRoundsPerPhase = 2 (Rex can request +1)
  decision packet generated when consensus fails
  Rex resolution via approval gate (uses M5 Approval primitive)
  resume from resolution

Agent invocation:
  capability: agent.run
  fulfilled by: ClaudeCodeConnector, HermesConnector, OpenRouterConnector, ...
  feature does not branch on which connector

Storage:
  CollaborationMission, AgentAssignment, Proposal, Critique, DecisionGate,
  HumanResolution all in SQLite state.db
  Proposal/critique bodies as artifacts (M5) referenced by hash
  Audit records IDs/hashes/counts only
```

Exit criteria:

```text
Rex submits one architecture brief.
Two agents — assigned to two roles via the capability router — produce
  independent proposals.
The two agents critique each other once.
If they converge: mission moves to resolved without escalation.
If they disagree: Agentic OS generates a CTO decision packet, Rex resolves
  via the approval UI, mission resumes.
State survives server refresh.
Audit contains IDs/hashes/counts only.
The same orchestration code works regardless of which connectors are
  enabled — verified by §6.5.7 Test A (unit-level guardrail,
  ClaudeCodeConnector + shape-different stub) and Test B (integration-level,
  Hermes binary absent from PATH). Test C runs automatically once
  OpenRouterConnector lands.
```

The last exit criterion is the independence check. If the orchestration code only works with HermesConnector specifically, M6 is not done. Tests A and B are the binding enforcement.

---

## M7 — Native Kanban Lite pilot

Build a small native Kanban feature on top of Agentic OS primitives. State lives in Agentic OS's SQLite state.db, not in any external system.

Scope:

```text
board (one or many)
columns
cards
create / update / move
local persistence in state.db
comments
block / unblock state
vault export of completed cards (optional)
```

Out of scope:

```text
full GTD
workflow automation
multi-tenant management
worktree management
deep external integrations
```

The optional Hermes Kanban preview feature (M4b) is a separate, side-by-side feature. A user can have both, either, or neither. The two do not share state.

Exit criteria:

```text
Kanban uses the feature registry.
Kanban state lives in Agentic OS state.db.
No native Kanban code references HermesConnector.
Cards can be created, moved, commented, blocked, completed.
Optional vault export uses the approval flow (M5).
A user can run the Kanban pilot without Hermes installed.
```

---

## M8 — Obsidian promotion workflow

Promotion is fundamentally an approval-backed action.

Exit criteria:

```text
Inbox output can be promoted through UI.
Final notes are never overwritten without approval.
Templates/frontmatter are applied consistently.
Run/provenance links are preserved.
```

---

## M9 — Studio/media pilot

Do not start before artifacts and approvals are mature.

Needs:

```text
connector runtime
provider model selection
run state
artifact serving
preview URLs
retention policy
cost/external call approval
vault references
```

Exit criteria:

```text
Generated media is an Artifact.
Media preview uses guarded artifact route.
Provider calls are Runs.
Cost/risk approval exists where needed.
No raw paths exposed.
```

---

## M10 — NotebookLM/research pilot

Do not start before connectors, artifacts, citations, and promotion exist.

Needs:

```text
document ingestion
source tracking
citations
summarization
retrieval
promotion workflow
```

Exit criteria:

```text
Research output preserves source/provenance.
Citations link to source records/artifacts.
Final notes are promoted intentionally.
No provider body/raw transcript leaks to audit.
```

---

## 5. Core architecture types

## 5.1 FeatureModule and FeatureExposures

Final decision:

```text
Split stable feature core from evolving UI exposures.
```

```ts
export type FeatureId = string;

export type FeatureCategory =
  | "core"
  | "automation"
  | "creative"
  | "productivity"
  | "integration"
  | "orchestration";

export interface FeatureModule<TConfig = unknown> {
  id: FeatureId;
  title: string;
  description: string;
  category: FeatureCategory;

  lifecycle: {
    defaultEnabled: boolean;
    canDisable: boolean;
    hiddenWhenDisabled?: boolean;
    core?: boolean;
  };

  config: {
    schema: z.ZodType<TConfig>;
    defaults: TConfig;
  };

  requiredCapabilities?: CapabilityId[];
  optionalCapabilities?: CapabilityId[];

  sideEffects: FeatureSideEffect[];

  vault?: {
    read?: boolean;
    allowedWriteRoots?: VaultRelativePath[];
  };

  artifacts?: {
    allowedRoots?: string[];
    mimeAllowlist?: string[];
  };

  health?: (ctx: FeatureHealthContext<TConfig>) => Promise<FeatureHealth>;
}
```

UI exposures:

```ts
export interface FeatureExposures {
  featureId: FeatureId;

  nav?: NavExposure[];
  commands?: CommandExposure[];
  dashboardCards?: DashboardCardExposure[];
  settingsPanel?: SettingsPanelExposure;
  workspacePanels?: WorkspacePanelExposure[];
}

export interface NavExposure {
  id: string;
  label: string;
  href: string;
  iconKey: string;
  order: number;
  group?: "platform" | "feature" | "admin";
  visibility?: "always" | "when-ready" | "when-enabled";
}

export interface CommandExposure {
  id: string;
  label: string;
  keywords?: string[];
  action:
    | { type: "navigate"; href: string }
    | { type: "start-run"; runKind: string; payload?: unknown }
    | { type: "open-panel"; panelKey: string };
  visibility?: "always" | "when-ready" | "when-degraded-or-better";
}

export interface DashboardCardExposure {
  id: string;
  componentKey: string;
  order: number;
  span?: 1 | 2;
}

export interface SettingsPanelExposure {
  componentKey: string;
  summary?: string;
}

export interface WorkspacePanelExposure {
  id: string;
  componentKey: string;
  title: string;
}
```

Why this is better:

```text
FeatureModule stays stable.
UI can evolve without bloating core.
No generic low-code UI renderer.
Premium components remain hand-built.
```

---

## 5.2 Feature lifecycle

Final public states:

```ts
export type FeatureLifecycleState =
  | "ready"
  | "disabled"
  | "degraded"
  | "unavailable";
```

Why `ready` instead of `enabled`:

```text
config.enabled is already a boolean.
Using lifecycle state "enabled" creates confusion.
"ready" means enabled + usable.
```

Feature runtime status:

```ts
export interface FeatureRuntimeStatus {
  state: FeatureLifecycleState;
  visibility: "visible" | "hidden";
  reasons: FeatureReason[];
}

export interface FeatureReason {
  code:
    | "config-disabled"
    | "missing-required-capability"
    | "missing-optional-capability"
    | "missing-connector"
    | "missing-auth"
    | "config-invalid"
    | "health-degraded"
    | "health-down"
    | "runtime-unavailable"
    | "external-system-unavailable";

  severity: "info" | "warn" | "error";
  message: string;
  capabilityId?: CapabilityId;
  connectorId?: string;
}
```

Rules:

```text
disabled = operator/config turned it off
unavailable = enabled but cannot operate because required dependency missing
degraded = enabled and usable, but optional dependency missing or health degraded
ready = enabled and usable
```

Visibility computation:

```text
ready/degraded/unavailable -> visible
disabled -> visible unless hiddenWhenDisabled true
```

Per-action permission is **not** lifecycle.

---

## 5.3 Route gating

Do not list routes inside FeatureModule.

Next.js route files are the route source of truth.

Each route imports a shared gate:

```ts
export async function requireFeatureReady(featureId: FeatureId): Promise<ResolvedFeature> {
  const feature = await resolveFeature(featureId);
  if (!feature || feature.status.state !== "ready") notFound();
  return feature;
}

export async function requireFeatureEnabled(featureId: FeatureId): Promise<ResolvedFeature> {
  const feature = await resolveFeature(featureId);
  if (!feature || feature.status.state === "disabled") notFound();
  return feature;
}
```

API helper:

```ts
export async function gateFeatureApi(
  req: Request,
  featureId: FeatureId,
  mode: "enabled" | "ready" | "status-only",
): Promise<Response | null> {
  if (!originOk(req)) return forbidden();

  // CRITICAL: unknown feature IDs must always 404, including in status-only
  // mode. status-only's purpose is "let this through even if the known
  // feature is disabled" — NOT "let anything through, including typos and
  // removed features."
  const feature = await resolveFeature(featureId);
  if (!feature) return notFoundJson();

  if (mode === "status-only") return null;
  if (feature.status.state === "disabled") return notFoundJson();
  if (mode === "ready" && feature.status.state !== "ready") {
    return unavailableJson(feature.status.reasons);
  }

  return null;
}
```

Do not use Next middleware for this. Middleware may run in runtimes that should not load local config/state.

---

## 5.4 Connector runtime

ConnectorDefinition lives in code.

ConnectorSettings lives in config.

No unknown bags.

```ts
export type CapabilityId =
  // LLM and agent
  | "llm.chat"
  | "llm.stream"
  | "agent.run"
  | "agent.code.modify"
  | "subagent.delegate"
  // Media generation
  | "image.generate"
  | "audio.transcribe"
  | "audio.tts"
  | "video.generate"
  // Media understanding
  | "vision.analyze"
  | "video.analyze"
  | "doc.extract"
  // System / runtime
  | "code.execute"
  | "terminal.execute"
  | "file.read"
  | "file.write"
  | "file.search"
  | "browser.operate"
  | "computer.use"
  // Integration
  | "mcp.tool"
  | "vault.note.write"
  // Kanban (any connector that implements these can fulfill the Kanban pilot)
  | "kanban.board.list"
  | "kanban.task.list"
  | "kanban.task.show"
  | "kanban.task.create"
  | "kanban.task.comment"
  | "kanban.task.block"
  | "kanban.task.unblock"
  | "kanban.task.complete";

export interface CapabilityDefinition<TInput = unknown, TOutput = unknown> {
  id: CapabilityId;
  title: string;
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
  sideEffects: CapabilitySideEffect[];
}

export interface ConnectorDefinition<TSettings = unknown> {
  id: string;
  title: string;
  kind:
    | "agent"
    | "llm-provider"
    | "media-provider"
    | "mcp-server"
    | "local-tool"
    | "knowledge-system"
    | "external-agent-runtime";

  transport: "subprocess" | "streamJson" | "http" | "mcp" | "sdk" | "manual";

  settingsSchema: z.ZodType<TSettings>;
  defaultSettings: TSettings;

  auth?: {
    required: boolean;
    supportedRefs: Array<"env" | "file" | "keychain">;
  };

  trust: "first-party" | "community" | "untrusted";
  capabilities: CapabilityDefinition[];

  health?: (ctx: ConnectorContext<TSettings>) => Promise<ConnectorHealth>;

  testConnection?: (
    ctx: ConnectorContext<TSettings>,
    opts?: { signal?: AbortSignal; runId?: RunId },
  ) => Promise<ConnectorValidation>;

  invoke: (
    ctx: ConnectorInvokeContext<TSettings>,
    capability: CapabilityId,
    input: unknown,
  ) => Promise<CapabilityResult>;
}
```

Capability ID set semantics:

```text
The CapabilityId union above is the closed set of well-known IDs
that features and connectors use to communicate. Connectors implement
a subset; features declare a subset in requiredCapabilities and
optionalCapabilities.

Connector-specific capabilities are a future extension. In v1, connectors
expose only well-known CapabilityId values to the runtime. Features must
not depend on connector-private capability IDs. If a real use case appears
for connector-private capabilities, a separate `connectorCapabilities`
field will be added to ConnectorDefinition; until then, the type surface
stays tight.

Adding a new well-known CapabilityId is a core type change (one line
+ an ADR if structural).
```

Context-window management:

```text
Each connector is responsible for managing its own context window:
compression, summarization, truncation, prompt-cache use. The
Capability Router does not manage context. Features assume any
capability invocation handles its own context concerns and returns
either a clean result or a neutral failure code.
```

Settings:

```ts
export interface ConnectorSettings<TSettings = unknown> {
  enabled: boolean;
  authRef?: AuthRef;
  settings: TSettings;
  trustOverride?: "community" | "untrusted";
}
```

Important:

```text
settings is parsed through connector.settingsSchema.
No z.unknown bags.
No passthrough.
No raw apiKey/token/password fields.
```

Validation result:

```ts
export interface ConnectorValidation {
  status: "valid" | "invalid" | "unreachable" | "misconfigured" | "unknown";
  errorCode?:
    | "auth-failed"
    | "rate-limited"
    | "network-unreachable"
    | "config-invalid"
    | "capability-not-supported"
    | "capability-unavailable"
    | "external-system-unavailable"
    | "binary-not-found"
    | "unknown";
  message?: string;        // human-readable diagnostic; never includes secrets/paths
  testedAt: string;
  durationMs: number;
}
```

`errorCode` is from the fixed registry above. Per-connector diagnostic detail goes in `message`, which is rendered to UI and must follow the same neutrality rules as audit (no secrets, no raw filesystem paths, no provider tokens). The previous `"hermes-not-found"` / `"hermes-kanban-unavailable"` codes were a Hermes-named precedent that would have grown into per-connector enum creep; they map to the generic codes above.

---

## 5.5 HermesConnector-specific settings

```ts
export interface HermesConnectorSettings {
  hermesBin: string; // default: "hermes"
  mode: "cli";
  board?: string;
  timeoutMs: number;
  allowWrites: boolean;
  allowTerminalTaskCompletion: boolean;
}
```

Defaults:

```ts
const defaultHermesConnectorSettings: HermesConnectorSettings = {
  hermesBin: "hermes",
  mode: "cli",
  timeoutMs: 60_000,
  allowWrites: false,
  allowTerminalTaskCompletion: false,
};
```

Rules:

```text
read-only first
writes require allowWrites
complete/archive/delete require stronger approval or stay disabled
all calls go through safeSpawn
stdout/stderr caps apply
errors are neutralized
no raw ~/.hermes paths returned to browser
```

---

## 5.6 Run model

```ts
export type RunId = string;

export type RunKind =
  | "scheduled-mission"
  | "manual-mission"
  | "capability-invoke"
  | "connector-test"
  | "external-work-bridge"
  | "orchestration-phase"
  | "artifact-generate"
  | "approval-action"
  | "user-action";

export interface ExternalRef {
  system: string;          // connector ID (e.g. "hermes-connector", "openrouter-connector")
  kind: string;            // connector-defined external entity type (e.g. "task", "thread", "run")
  id: string;              // opaque external ID; never a filesystem path
  scope?: string;          // optional sub-scope (e.g. "board:ops" for Hermes Kanban boards)
}

export type RunStatus =
  | "queued"
  | "running"
  | "waiting-approval"
  | "waiting-clarification"
  | "blocked"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted-by-restart";

export interface RunRecord {
  id: RunId;
  kind: RunKind;
  featureId: FeatureId;

  parentRunId?: RunId;
  correlationId?: string;
  externalRefs?: ExternalRef[];

  trigger:
    | "manual"
    | "scheduled"
    | "replay"
    | "orchestrator"
    | "connector"
    | "approval";

  status: RunStatus;

  currentStep?: string;
  totalSteps?: number;
  completedSteps?: number;

  capabilityId?: CapabilityId;
  connectorId?: string;

  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  updatedAt: string;
  durationMs?: number;

  // Pattern absorbed from Hermes Kanban dispatcher: claim/heartbeat/reclaim.
  // These fields let a stalled run be detected and either resumed by another
  // worker (orchestrator child runs) or auto-blocked (after retry limit).
  // No runtime dependency on Hermes — implemented natively in TypeScript.
  claimedBy?: string;              // worker identifier
  claimedAt?: string;
  claimExpiresAt?: string;
  lastHeartbeatAt?: string;
  failureCount?: number;           // increments on each retry
  autoBlockedAt?: string;          // set when failureCount exceeds limit

  inputHash?: string;
  inputSummary?: string;

  // Round attribution for orchestration runs. Set on orchestration-phase
  // parent runs and on their child agent.run runs; unset for non-orchestration
  // runs. Per §6.5.6.
  round?: number;

  // Per-run resource budgets (Hermes-inspired). Optional in M3 (schema slots
  // only — runtime enforcement comes later). Features can populate; connectors
  // can read and self-enforce. When the runtime enforces, exceeding any budget
  // transitions the run to "failed" with errorCode "budget-exceeded".
  maxIterations?: number;        // max agent tool-call iterations (default 150 if unset)
  maxDurationMs?: number;        // wall-clock cap; null means no cap
  maxToolCalls?: number;         // total tool invocations across iterations
  maxCostUsd?: number;           // estimated cost cap, when connector reports cost

  artifactIds: ArtifactId[];
  approvalIds: ApprovalId[];

  errorCode?: string;
  cancelledBy?: "user" | "parent-run" | "timeout" | "stale-claim";

  // Join policy for parent runs that fan out child runs (e.g. an
  // orchestration-phase parent with N parallel agent.run children).
  // Default in v1 MVP is "all-must-succeed". Other policies reserved
  // for forward compatibility. See §6.5.6 for full semantics.
  joinPolicy?: "all-must-succeed" | "best-effort" | "first-success";

  onRestart: "resume" | "mark-interrupted" | "cancel";
}
```

Run steps:

```ts
export interface RunStepRecord {
  id: string;
  runId: RunId;
  index: number;

  kind:
    | "capability.invoke"
    | "mission.run"
    | "artifact.write"
    | "approval.wait"
    | "agent.proposal"
    | "agent.critique"
    | "decision.resolve"
    | "external.task.create"
    | "external.task.observe";

  status: RunStatus;
  startedAt?: string;
  endedAt?: string;

  capabilityId?: CapabilityId;
  connectorId?: string;
  agentId?: string;

  outputArtifactIds?: ArtifactId[];
  externalRefs?: ExternalRef[];
  errorCode?: string;
}
```

Restart policy:

```text
scheduled missions -> mark-interrupted
manual missions -> mark-interrupted
connector tests -> cancel
orchestration phases -> mark-interrupted
artifact generation -> mark-interrupted or cancel depending on feature
Hermes external refs -> re-observe external state, do not assume completion
```

### Heartbeat ownership (binding contract in §6.5.5)

Brief summary of the runtime contract; the full spec is in §6.5.5.

```text
The connector owning the underlying work writes lastHeartbeatAt.
Default interval: every 10s for native subprocess invocations.
External-work-bridge runs mirror the external system's heartbeat
  (or write one based on last poll if the external system has none).
A server-side periodic sweep (every 30s) detects stale claims, reclaims
  with failureCount++, or auto-blocks when failureCount exceeds 3.
Short capability-invoke runs that complete in under one heartbeat
  interval do not write heartbeats.
```

This contract applies to all long-running runs with claim fields populated, not just orchestration child runs.

### Blocked status transitions

`RunStatus: "blocked"` is the explicit terminal-or-recoverable state for runs that auto-blocked after exceeding their retry budget (via the heartbeat sweep above) or were blocked by an operator/system intervention. It is intermediate, not terminal — a blocked run can move back into the active set or be terminated.

```text
blocked = stalled or waiting on operator/system intervention after retry
          budget is exceeded (autoBlockedAt is set) OR blocked by explicit
          operator action.

Transitions:
  blocked -> queued      manual unblock; run will retry from the beginning
  blocked -> running     manual unblock with resume; run continues from
                         last checkpoint if the run kind supports resume
  blocked -> failed      operator decides the run cannot succeed; run is
                         marked terminal failure with errorCode = "unblock-abandoned"
  blocked -> cancelled   operator decides the run should be discarded entirely

A blocked run produces no further side effects on its own. It waits.
UI surfaces blocked runs in the same inbox as approvals so Rex sees them.
```

---

## 5.7 Artifact model

```ts
export type ArtifactId = string;

export interface ArtifactRecord {
  id: ArtifactId;
  runId: RunId;
  featureId: FeatureId;

  kind:
    | "image"
    | "audio"
    | "video"
    | "document"
    | "markdown"
    | "json"
    | "diff"
    | "proposal"
    | "critique"
    | "decision-packet"
    | "external-summary";

  mediaType: string;
  sizeBytes: number;
  sha256: string;

  storageKey: string; // internal only
  createdAt: string;

  title?: string;
  description?: string;

  retention: "temporary" | "keep" | "promoted";
  expiresAt?: string;

  metadata?: NeutralMetadata;
  linkedVaultNotes?: VaultRelativePath[];
  externalRefs?: ExternalRef[];
}
```

Artifact routes:

```text
GET /api/artifacts/:artifactId/content
GET /api/artifacts/:artifactId/thumb
```

Must enforce:

```text
origin/method check
opaque artifact id lookup
no raw path params
realpath containment
symlink escape prevention
MIME allowlist
feature gate
neutral errors
```

---

## 5.8 Approval model

```ts
export type ApprovalId = string;

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled";

export type ApprovalKind =
  | "vault.promote"
  | "vault.overwrite"
  | "artifact.delete"
  | "artifact.promote"
  | "provider.cost"
  | "process.execute"
  | "code.applyPatch"
  | "external.publish"
  | "external.system.write"
  | "orchestration.decision"
  | "agent.clarification";

export interface ApprovalRecord {
  id: ApprovalId;
  runId: RunId;
  featureId: FeatureId;
  kind: ApprovalKind;

  status: ApprovalStatus;
  risk: "low" | "medium" | "high";

  title: string;
  summary: string;
  payloadRef: string; // internal reference, not raw payload in audit

  createdAt: string;
  expiresAt?: string;
  decidedAt?: string;

  decidedBy?: "rex";
  decision?: "approve" | "reject" | "edit" | "request-more" | "answer";
  decisionSummary?: string;

  // For clarification approvals (kind === "agent.clarification"), Rex's
  // answer is stored as an artifact and referenced here. Required when
  // decision === "answer"; absent for approve/reject/edit/request-more.
  // The answer body lives at the referenced artifact so replay/resume
  // can reconstruct exactly what Rex told the agent — decisionSummary
  // is too weak for that (intended for short human notes only).
  responsePayloadRef?: string;
}
```

### Clarification primitive

The `agent.clarification` ApprovalKind plus the `waiting-clarification` RunStatus together form a complementary primitive to decision packets:

```text
decision packet      "agents disagree; you arbitrate"
                     - Triggered when consensus check fails after maxRounds
                     - Surfaces two competing proposals
                     - Rex picks one, merges, asks for another round, or aborts

clarification        "agent doesn't know enough; you fill in"
                     - Triggered by agent mid-run when it needs context that
                       isn't in its inputs
                     - Surfaces the agent's question as a free-text prompt
                       (or a small set of suggested answers)
                     - Rex answers; agent's run resumes with answer in context
```

Both use the same `Approval` primitive, with two clarification-specific extensions on `ApprovalRecord`: `decision = "answer"` (a new variant alongside approve/reject/edit/request-more) and `responsePayloadRef?: string` (a reference to the artifact containing Rex's answer). The UI renders both kinds of approval in the same inbox. The semantic difference matters for audit and for Rex's mental model: clarifications don't represent disagreement, just missing context.

Agents request clarifications by returning a structured response from their `agent.run` invocation: the connector recognizes the request, the orchestrator creates the `ApprovalRecord` with `kind: "agent.clarification"`, marks the run `waiting-clarification`, and resumes when Rex answers. Rex's answer is written to a new artifact (kind: `"markdown"`); the artifact ID becomes `responsePayloadRef`. This keeps the answer durable for replay and resume — `decisionSummary` is reserved for short human-readable notes.

---

## 5.9 Audit and events

Audit:

```ts
export interface AuditRecord {
  id: string;
  at: string;
  kind: string;

  featureId?: string;
  runId?: string;
  stepId?: string;
  connectorId?: string;
  capabilityId?: string;
  approvalId?: string;
  artifactId?: string;

  status: "started" | "succeeded" | "failed" | "cancelled" | "blocked";
  durationMs?: number;

  counts?: Record<string, number>;
  hashes?: Record<string, string>;
  errorCode?: string;

  externalRefs?: ExternalRef[];
}
```

Bus events:

```ts
export interface BusEvent<TPayload = unknown> {
  id: string;
  at: string;
  source: string;
  kind: string;
  runId?: string;
  featureId?: string;
  payload?: TPayload;
}
```

Rules:

```text
Bus events may be richer than audit.
SSE projection is narrower than bus.
Audit is most restrictive.
Do not blindly mirror bus payloads into audit.
Hermes raw task body/comments/results must not flow into audit.

SSE projection MUST conform to a per-event schema. No raw bus-payload
passthrough to the browser. Each SSE event kind has a typed shape
defined alongside the feature/connector that emits it.

AuditRecord.errorCode values come from a fixed registry maintained
alongside the audit schema. No dynamic content in errorCode (no
templated strings, no provider-returned text). Dynamic diagnostic
detail goes to the bus event payload, not audit.
```

---

## 5.10 Connector preset catalog

Adding a new provider to Agentic OS should be as easy as it is in Hermes: pick from a list, supply credentials, done. The preset catalog mechanism delivers this by separating *connector type definitions* (code, ~150 lines each) from *provider presets* (config, declarative).

### Connector type families

M4a ships four connector type families covering the four real-world LLM-access patterns:

```ts
export type ConnectorTypeFamily =
  | "openai-compatible-llm"     // OpenAI, OpenRouter, Together, Groq, Ollama,
                                //   LM Studio, vLLM, AWS Bedrock (OAI mode),
                                //   Azure (OAI mode), DeepSeek (OAI mode), NIM
  | "oauth-mediated-llm"        // xAI Grok OAuth, Qwen OAuth, Google Gemini
                                //   Code Assist, GitHub Copilot via gh auth
  | "cli-acp-agent"             // Claude Code, Anthropic ACP, GitHub Copilot
                                //   ACP via stdio, Hermes (CLI subprocess)
  | "native-vendor-api";        // Anthropic native, Google AI Studio Gemini,
                                //   GLM/Zhipu, native DeepSeek, etc.
```

Each family is one `ConnectorDefinition` in code. The `settingsSchema` is the family-level schema (e.g. `openai-compatible-llm` accepts `{ baseUrl, model, maxTokens, ... }`).

### Preset entries

A preset is a declarative pre-fill of a connector's settings:

```ts
export interface ConnectorPreset {
  id: string;                    // e.g. "openrouter", "ollama-local", "anthropic-claude-sonnet"
  label: string;                 // displayed in Settings ("OpenRouter")
  description?: string;          // ("100+ models, pay-per-use")
  typeFamily: ConnectorTypeFamily;
  defaultSettings: unknown;      // parsed through the type family's settingsSchema
  authPrompt?: {                 // what to ask the user for in the Add dialog
    apiKey?: { label: string; helpUrl?: string };
    baseUrl?: { label: string; default?: string };
    oauthFlowUrl?: string;
  };
  trust: "first-party" | "community" | "untrusted";
}
```

### How adding a provider works

```text
User clicks "Add Provider" in Settings → Connectors:

  1. Preset picker opens (the catalog list — like the Hermes screenshot).
  2. User selects "OpenRouter".
  3. Auth dialog asks for API key (per the preset's authPrompt).
  4. User pastes key.
  5. Agentic OS stores authRef = "env:OPENROUTER_API_KEY" (or keychain ref).
  6. ConnectorSettings record is created with the preset's defaultSettings.
  7. testConnection runs as a Run (per §5.4); result shown in UI.
  8. If valid, connector is enabled. New capability instances available.
```

No code change. New presets are JSON files in `~/.agentic-os/presets/` (first-party presets ship with the app; community presets can be dropped in).

### Catalog generalization beyond LLMs

The same preset mechanism works for any capability with multiple providers. Initial catalog scope at M4a:

```text
LLM:           OpenAI, OpenRouter, Anthropic, Anthropic Claude Code (CLI),
               Hermes (CLI), Ollama (local), LM Studio (local), Groq, Together,
               DeepSeek, custom OpenAI-compatible endpoint
TTS:           Edge TTS (free), OpenAI TTS, ElevenLabs, Google Gemini TTS,
               NeuTTS (local), KittenTTS (local)
Transcription: OpenAI Whisper, local Whisper, Deepgram, ElevenLabs
Image gen:     OpenAI Images, Stability, OpenRouter image models, local SD
Vision:        OpenAI Vision, Google Gemini Vision, Anthropic Vision,
               Ollama with vision models
```

This is the M4a starting catalog. New presets can be added later without milestone work.

### Anti-pattern: hardcoded endpoints

A connector definition that talks to exactly one URL (e.g., hardcodes `api.openai.com`) is a future migration burden. Every connector type must support multi-endpoint configuration through its preset entries.

---

## 6. Multi-agent orchestration model

Orchestration is **not** a peer-to-peer agent chat.

Agentic OS mediates:

```text
state
rounds
message routing
summaries
decision gates
approval flow
resume context
```

Connectors execute durable work when delegated; Agentic OS remains the UX and decision owner regardless of which connector is fulfilling which role. The state machine in §6.1 is connector-agnostic — see §6.5 for the binding orchestration contract (message-mediation, heartbeat, join policy, M6 independence test, failure modes).

### Pause policy on decision-required (MVP vs post-MVP)

In M6 MVP, every mission has exactly one active phase at a time. When the mission enters `decision-required`, everything pauses: there are no concurrent sub-tasks to continue with, so "pause everything" is the only meaningful behavior.

Post-M6, Agentic OS will ship **hierarchical missions** — a top-level mission decomposes into N parallel sub-missions (one architect → many implementations). At that point, two pause behaviors are needed:

```text
DecisionGate.scope = "architecture"    -> pause the whole mission tree
                                          (architecture decisions cascade
                                          everywhere; nothing safe to continue)

DecisionGate.scope = "implementation"  -> pause only the affected sub-mission
                                          (siblings working on independent
                                          modules continue normally)
```

The `DecisionGate.scope` discriminator is locked in v8's schema today so the post-M6 runtime upgrade is a code change, not a schema migration. Until hierarchical missions ship, both scopes collapse to "pause everything" because there's nothing else running. The `trigger` field (`"consensus-failed" | "manual-escalation"`) is orthogonal — it records *why* the gate fired, not *what scope*.

### Round budget (global setting, not per-mission)

`maxRoundsPerPhase` is a **global Settings value** (default `2`) maintained alongside other Agentic OS-wide preferences. New missions start at this value. Rex can change the global default in Settings; the change applies to new missions, not in-flight ones.

Per-mission overrides are not in MVP scope. The `request-more` resolution action on a decision packet adds `+1` to the budget for that specific mission, which serves the use case "this particular debate needs one more round."

## 6.1 Minimal MVP state machine

Linear phases with one dispute branch and a bounded debate loop. `maxRounds = 2` by default.

```text
                          [ intake ]
                              │
                              ▼
                         [ proposal ]
                              │
                              ▼
                         [ critique ]  ◀─ ─ ─ ─ ─ ┐
                              │                   │
                              ▼                   │ if rounds < max
                         [ revision ]              │
                              │                   │
                              ▼                   │
                      [ consensus check ] ─ ─ ─ ─ ┘
                          /         \
                        yes          no
            all endorse/caveat     any block remains
                       │              │
                       │              ▼
                       │     [ decision-required ]   (amber, off main path)
                       │              │
                       │       Rex resolves via
                       │       approval gate
                       │              │
                       ▼              ▼
                       └──▶ [ resolved ]
                                  │
                                  ▼
                            [ completed ]
```

Phase semantics:

```text
intake            brief received, role assignments confirmed
proposal          each agent submits an independent proposal
critique          agents review each other's proposals
revision          agents revise based on critiques
consensus check   if rounds < max and any block remains, loop back to critique
                  otherwise branch on stance: all endorse/caveat -> resolved
                                              any block remains  -> decision-required
decision-required Rex sees the CTO decision packet and resolves via approval
resolved          source of truth chosen; downstream phases can resume
completed         mission finished
```

Each phase invokes agents through the capability router. The connector layer is opaque to the state machine — `proposal` invokes `agent.run` and gets back a proposal regardless of whether the fulfilling connector is `ClaudeCodeConnector`, `HermesConnector`, or another. The state machine cannot tell which connector ran which agent.

**Runtime contract — see §6.5.** The state machine, types, and storage shape are specified here in §6. The runtime details — message-mediation, heartbeat ownership, sibling/join policy, M6 independence test, failure modes — are specified in §6.5 "Binding orchestration contract." If §6.5 is later extracted into `decisions/adr-0019-*.md` for the repo, that extraction must be a mechanical copy. There is no other source of truth.

---

## 6.2 Core types

```ts
export type CollaborationMissionId = string;

export type AgentRole =
  | "architect"
  | "implementer"
  | "reviewer"
  | "critic"
  | "researcher"
  | "tester"
  | "summarizer";

export type CollaborationPhase =
  | "intake"
  | "proposal"
  | "critique"
  | "revision"
  | "decision-required"
  | "resolved"
  | "completed"
  | "failed"
  | "cancelled";

export interface CollaborationMission {
  id: CollaborationMissionId;
  runId: RunId;
  title: string;
  specArtifactId: ArtifactId;

  status: CollaborationPhase;

  maxRounds: number;
  currentRound: number;

  roleAssignments: AgentAssignment[];
  proposalIds: ProposalId[];
  critiqueIds: CritiqueId[];
  decisionGateIds: DecisionGateId[];

  createdAt: string;
  updatedAt: string;
}

export interface AgentAssignment {
  id: string;
  missionId: CollaborationMissionId;
  role: AgentRole;
  connectorId: string;
  status: "assigned" | "running" | "done" | "failed" | "cancelled";
  externalRefs?: ExternalRef[];
}

export type ProposalId = string;

export interface AgentProposal {
  id: ProposalId;
  missionId: CollaborationMissionId;
  assignmentId: string;
  round: number;

  title: string;
  summary: string;
  artifactId: ArtifactId;
  recommendation: string;

  confidence?: number;
  risks: string[];
  tradeoffs: string[];

  contentHash: string;
  contentLength: number;
  createdAt: string;
  externalRefs?: ExternalRef[];
}

export type CritiqueId = string;

export interface AgentCritique {
  id: CritiqueId;
  missionId: CollaborationMissionId;
  assignmentId: string;
  targetProposalId: ProposalId;
  round: number;

  summary: string;
  objections: string[];
  suggestedChanges: string[];
  stance: "block" | "caveat" | "endorse";

  artifactId?: ArtifactId;
  contentHash: string;
  contentLength: number;
  externalRefs?: ExternalRef[];
}

export type DecisionGateId = string;

export interface DecisionGate {
  id: DecisionGateId;
  missionId: CollaborationMissionId;
  runId: RunId;

  // Why the gate fired. In M6 MVP, every gate is triggered by consensus
  // failure. Manual escalation is reserved for post-MVP (when Rex can
  // force a decision packet mid-debate without waiting for max rounds).
  trigger: "consensus-failed" | "manual-escalation";

  // What scope of decision Rex is being asked to make. Drives the
  // post-M6 pause behavior:
  //   "architecture"   -> pauses the whole mission tree (decisions cascade
  //                       across all sub-missions; nothing safe to continue)
  //   "implementation" -> pauses only the affected sub-mission (siblings
  //                       working on independent modules continue normally)
  // In M6 MVP, both scopes collapse to "pause everything" because
  // hierarchical missions don't exist yet — but the discriminator is
  // locked now so the post-M6 runtime upgrade is non-breaking.
  // Default for M6: "architecture".
  scope: "architecture" | "implementation";

  status: "pending" | "resolved" | "cancelled";

  title: string;
  decisionQuestion: string;

  proposalIds: ProposalId[];
  packetArtifactId: ArtifactId;
  approvalId: ApprovalId;
}

export interface HumanResolution {
  id: string;
  decisionGateId: DecisionGateId;

  selected:
    | { type: "proposal"; proposalId: ProposalId }
    | { type: "merged"; summary: string }
    | { type: "custom"; summary: string }
    | { type: "request-more"; instructions: string }
    | { type: "abort"; reason: string };

  rationale?: string;
  resumeContextArtifactId?: ArtifactId;   // present for proposal/merged/custom/request-more;
                                          // absent for abort (the mission terminates and
                                          // produces only an abort-summary artifact)
  createdAt: string;
}
```

---

## 6.3 Bounded disagreement

Default:

```text
maxRounds = 2
```

Flow:

```text
Round 1: independent proposals
Round 2: critique + revision
Then consensus check
If unresolved: decision gate for Rex
```

Consensus MVP:

```text
all critiques endorse/caveat -> proceed
any block remains -> decision-required
```

Do not build scoring/ML confidence automation in v1.

---

## 6.4 Context sharing

Agents get:

```text
original spec
role brief
constraints
selected artifacts
latest proposal summaries
Rex decisions/resolutions
external references on child runs/artifacts (connector-opaque)
```

Agents do not get by default:

```text
all raw transcripts
secrets
private config
provider errors
unbounded debate logs
raw Hermes DB paths
```

Full proposal bodies can be passed by orchestrator as needed, but durable audit records only IDs, hashes, lengths, external refs, and run IDs.

---

## 6.5 Binding orchestration contract

This subsection is the binding implementation contract for M6 — what was previously the standalone `ADR-0019`. It locks the runtime behavior that §6.1–6.4 only sketch. M6 is not done until this contract is satisfied.

### 6.5.1 Message-mediation: what each agent sees per phase

**Phase: proposal.** Each agent gets, in this order:

```text
1. Mission brief (full, from specArtifactId)
2. Role brief for the agent's assigned role (1–2 paragraphs)
3. Constraints (max length, required structure: title, summary, recommendation,
   risks, tradeoffs)
4. Selected context artifacts the orchestrator chose for this mission
5. Explicit instruction: "Produce your proposal independently. Do not reference
   what other agents might propose. Do not ask clarifying questions of other
   agents." (Use the clarification primitive — §5.8 — to ask Rex if needed.)
```

Each agent does NOT see in proposal phase: other agents' assignments or identities; any prior proposals from this mission; raw audit entries; connector settings or secrets; other features' state.

**Phase: critique.** Each agent gets:

```text
1. Mission brief
2. Role brief (now in critique mode)
3. The OTHER agent's proposal — full body, from its artifactId
4. Instruction: "Review the other agent's proposal. Produce a critique with
   exactly one of three stances: block, caveat, endorse. Include specific
   objections and suggested changes. Do not produce a counter-proposal."
5. Constraints (max length, required structure)
```

The agent does NOT see: its own proposal from round 1 (it is expected to be reasoning fresh about the other's work); any third-party critiques (in v1 MVP there are only 2 agents).

**Phase: revision.** Each agent gets:

```text
1. Mission brief
2. Role brief
3. The agent's OWN proposal from round 1 (full body)
4. The critique of that proposal (full body)
5. Instruction: "Revise your proposal in response to the critique. You may
   incorporate, reject, or acknowledge each suggested change. Maintain the
   same structure as the original proposal."
```

**Phase: decision-required.** No agent invocation. Rex sees the decision packet.

**Phase: resolved → downstream (post-M6).** When implementation phases exist after `resolved`, the downstream agent receives:

```text
1. Mission brief
2. Role brief for the downstream phase
3. The resolved decision (HumanResolution body — the source of truth)
4. The selected proposal (if Rex chose A or B)
5. Any merged/custom directive Rex wrote
6. Instruction appropriate to the downstream phase
```

### 6.5.2 What is summarized vs full content

| Item | Sent to agent | Stored | Audit projection |
|---|---|---|---|
| Mission brief | Full | Artifact (`specArtifactId`) | artifactId, sha256 |
| Role brief | Full | In `CollaborationMission` record | counts, lengths |
| Other agent's proposal | Full body | Artifact | artifactId, hash, length |
| Other agent's critique | Full body | Artifact | artifactId, hash, length, stance |
| Connector raw output | Never sent forward verbatim | Not stored | Not in audit |
| Provider transcripts | Never | Not stored | Not in audit |
| Decision packet | (rendered for Rex, not agents) | Artifact (`packetArtifactId`) | artifactId, hash, length |
| Rex's resolution | Full to downstream agents | `HumanResolution` record | resolutionId, selected.type, length |

Rule: agents see full bodies for everything they need to reason. Audit sees only neutral metadata (IDs, hashes, counts, lengths, stances, durations, error codes). Full bodies live as artifacts; audit references them by ID.

### 6.5.3 Storage layout

```text
state.db tables:
  collaboration_missions       one row per mission
  agent_assignments            one row per agent role assignment
  proposals                    metadata; body in artifact
  critiques                    metadata; body in artifact
  decision_gates               one row per consensus failure
  human_resolutions            one row per Rex decision

artifacts (under ~/.agentic-os/artifacts/<missionFeatureId>/):
  mission-<id>-brief.md                       kind: "markdown"
  mission-<id>-proposal-<round>-<agent>.md    kind: "proposal"
  mission-<id>-critique-<round>-<agent>.md    kind: "critique"
  mission-<id>-decision-packet.md             kind: "decision-packet"
  mission-<id>-resolution.md                  kind: "markdown"
  mission-<id>-abort-summary.md               kind: "markdown" (abort case only)

audit (~/.agentic-os/audit/YYYY-MM-DD.jsonl):
  mission.created                 missionId, runId, hashes
  mission.phase.entered           missionId, phase, round, durationMs
  proposal.generated              proposalId, artifactId, hash, length
  critique.generated              critiqueId, artifactId, hash, length, stance
  consensus.check                 result, missionId, round
  decision.gate.created           decisionGateId, approvalId
  human.resolution.recorded       resolutionId, selected.type
  mission.completed               missionId, status, durationMs
  agent.clarification.requested   runId, approvalId  (per §5.8 clarification primitive)
  agent.clarification.answered    runId, approvalId

vault (Obsidian):
  NEVER written automatically. Promotion is a separate Rex action via M8.
```

### 6.5.4 Rex's resolution → source-of-truth mechanics

When Rex resolves a decision gate:

```text
1. UI POST to /api/missions/:id/decisions/:gateId/resolve with the
   chosen action (proposal A | B | merged | custom | request-more | abort).

2. Server validates: gate is "pending", approval is "pending" (not expired),
   Rex is authenticated.

3. Server writes in a single SQL transaction:
   - HumanResolution record with selected, rationale, resumeContextArtifactId
   - DecisionGate.status = "resolved"
   - Approval.status = "approved" (or "reject" if abort), decidedAt, decidedBy
   - resumeContextArtifact (markdown) for downstream phases to consume
   - CollaborationMission.status = "resolved"
   - Bus events (mission.resolved, decision.gate.resolved)
   - Audit records (decision.resolved, mission.resolved)

4. Server returns 200 with { missionId, status: "resolved" }.

5. State machine advances to "resolved" → "completed" (no downstream in MVP).
```

The `HumanResolution` body — including any merged/custom directive Rex wrote — is THE source of truth. Downstream agents must treat it as authoritative; the decision packet and proposals are reference context only.

If Rex chooses `request-more`, the mission instead transitions back to `critique` with `currentRound + 1`, an extra round budget granted, and Rex's instructions added to each agent's context. The decision gate is marked `cancelled` (not `resolved`).

If Rex chooses `abort`, the mission transitions to `cancelled`. No downstream phase runs. The decision gate is marked `cancelled`. Audit records the abort with Rex's stated reason. An `abort-summary` artifact is produced; `HumanResolution.resumeContextArtifactId` is omitted.

### 6.5.5 Heartbeat ownership

```text
The connector that owns the underlying work writes lastHeartbeatAt.
Default interval: every 10s for native subprocess invocations.
External-work-bridge runs mirror the external system's heartbeat
  (or write one based on last poll if the external system has none).
A server-side periodic sweep (every 30s) detects stale claims and either
  reclaims (incrementing failureCount) or auto-blocks (when failureCount > 3).
Short capability-invoke runs that complete in under one heartbeat interval
  do not write heartbeats.
```

Applies to all long-running runs with claim fields populated, not just orchestration child runs.

### 6.5.6 Join policy for parallel agent calls

The proposal phase fans out N independent runs (one per agent assignment). The orchestrator creates a parent run (`kind: "orchestration-phase"`, `currentStep: "proposal"`) with `joinPolicy: "all-must-succeed"` and N child runs with `parentRunId = parent.id`.

```text
"all-must-succeed"  (DEFAULT for proposal, critique, revision in v1 MVP)
  - Parent transitions to "succeeded" when all children succeed.
  - Parent transitions to "failed" if any child fails.
  - One slow child blocks the phase (until heartbeat-timeout).

"best-effort"  (RESERVED, not used in MVP)
  - Parent succeeds when at least 1 child succeeds.
  - Use case: "ask N reviewers, take whichever respond".

"first-success"  (RESERVED, not used in MVP)
  - Parent succeeds as soon as 1 child succeeds; siblings cancelled.
  - Use case: "race two agents for a quick answer".
```

For v1 MVP every orchestration-phase parent uses `"all-must-succeed"`. Other policies exist in the type for forward compatibility.

### 6.5.7 Independence test specification (M6 exit criterion)

**Test A — unit-level guardrail:**

```ts
describe("orchestration independence — Test A", () => {
  it("runs full mission with ClaudeCodeConnector + shape-different stub", async () => {
    const stub = makeStubConnector({
      // Deliberately different from HermesConnector:
      latencyProfile: "instant",         // Hermes is ~1-3s
      errorShape: "json-with-stack",     // Hermes returns CLI error strings
      outputStructure: "wrapped-array",  // Hermes returns flat object
      capabilities: ["agent.run"],
    });

    const result = await runMission({
      brief: testBrief,
      connectors: [claudeCodeConnector, stub],
      assignments: [
        { role: "architect", connectorId: "claude-code" },
        { role: "reviewer", connectorId: "test-stub" },
      ],
    });

    // No Hermes contamination
    const allRecords = await getAllPersistedRecords(result.missionId);
    for (const record of allRecords) {
      expect(JSON.stringify(record).toLowerCase()).not.toContain("hermes");
    }
  });
});
```

**Test B — integration-level proof:**

```bash
# CI step: run with hermes binary absent and HERMES_* env unset
env -i PATH=/usr/bin:/bin npm run test:orchestration:integration
```

The test environment has HermesConnector registered but its `testConnection` returns `status: "unreachable", errorCode: "binary-not-found"`. Orchestration uses ClaudeCodeConnector + stub. Mission completes without errors leaking to UI. Features requiring only `agent.run` stay `ready` (claude-code provides it). Features requiring `kanban.task.list` go to `unavailable` cleanly (only HermesConnector provides it; it's unreachable).

**Test C — deferred to OpenRouterConnector landing:**

Same orchestration code, ClaudeCodeConnector + OpenRouterConnector (no Hermes, no stub). Runs automatically once OpenRouter preset is wired. If Test C ever fails, orchestration has drifted toward connector-specific assumptions.

### 6.5.8 Failure modes and recovery

**Server restart mid-mission.** `orchestration-phase` runs use `onRestart: "mark-interrupted"`. On restart, the orchestrator sweep:

```text
1. Find missions with status NOT IN ("resolved", "completed", "failed", "cancelled").
2. For each, find the latest orchestration-phase parent run.
3. If parent was mark-interrupted with all children mark-interrupted:
   - Re-emit the phase as a new run with same round number.
   - Originals remain in DB with "interrupted-by-restart" for audit.
4. If parent had some children succeeded, some interrupted:
   - Interrupted children restart; succeeded children's outputs are reused.
   - Requires idempotency: artifact IDs are deterministic for a given inputHash.
5. If mission was in decision-required at restart:
   - Approval record is preserved; UI re-renders decision packet from artifacts.
   - Rex can still resolve normally.
```

**Connector failure mid-phase.** Child fails → parent's `joinPolicy` decides:

- `"all-must-succeed"`: parent → `failed`, mission → `failed`, audit records the connector error code. Rex sees the failed mission and can retry or abort.
- `"best-effort"`: parent waits for remaining children; logs failure.
- `"first-success"`: parent succeeds if another child has succeeded; cancels failed child's siblings.

For v1 MVP, all parents use `"all-must-succeed"`, so connector failure = mission failure.

**Approval expiry.** Orchestration decision gates expire at 7 days (per session-summary Q7). If `expiresAt` is reached without Rex acting:

```text
1. Approval.status = "expired".
2. DecisionGate.status = "cancelled".
3. CollaborationMission.status = "failed" with errorCode "decision-gate-expired".
4. Audit records the expiry.
5. Mission is no longer actionable; new mission needed to retry.
```

**Rex aborts.** From mission UI at any time:

```text
1. CollaborationMission.status = "cancelled".
2. All active child runs cancelled (cancelledBy: "user").
3. Active approval cancelled.
4. Audit records the abort with Rex's stated reason.
5. abort-summary artifact written.
```

Cancelled missions are terminal. A new mission can be created from the same brief.

### 6.5.9 Locked sub-decisions (from prior reviews)

```text
agent.run capability split            NOT split. Role/phase passed as input,
                                      not as separate capability IDs.

MockConnector availability            Test-only. Exported from a
                                      @agentic-os/test-helpers package.
                                      NOT registered in production connector
                                      registry.

Mid-mission connector health failure  Mission pauses; surfaced to Rex as an
                                      approval-style notification. Same UX
                                      pattern as CTO escalation.

Decision packet retention             Kept until manually deleted. Decision
                                      packets are Rex's history; do not auto-
                                      prune with mission retention.

request-more round budget             Grants +1 round on top of the existing
                                      budget. Does not reset.

inputHash idempotency                 Locked as a contract. Same inputHash
                                      always produces same artifactId. Safe
                                      to re-run after restart.

Concurrent missions                   Allowed. No special UX for one operator;
                                      mission list shows all in-flight.

Hermes Kanban preview placement       Separate sidebar item ("Hermes Kanban")
                                      when M4b is enabled, distinct from
                                      native Kanban (M7).

Connector test approval expiry        connector-test runs fall under low-risk
                                      / 1-day bucket per Q7.
```

### 6.5.10 Acceptance criteria for §6.5

```text
- Rex reads §6.5 end-to-end
- Closed decisions for §6.5 are recorded in §14 of this document
- Tests A and B (§6.5.7) implemented and passing in CI
- If §6.5 is later extracted to decisions/adr-0019-*.md for the repo,
  the extraction must be a mechanical copy of §6.5 — no divergence
- M6 deliverable cannot ship without all exit-criterion bullets in §M6
```

---

## 7. Persistence model

## 7.1 Audit JSONL

Path:

```text
~/.agentic-os/audit/YYYY-MM-DD.jsonl
```

Purpose:

```text
append-only "what happened"
neutral facts only
grep/debug/review friendly
```

Do not store:

```text
raw prompts
raw provider responses
raw stdout/stderr
full note content
private paths
secrets
stack traces
raw Hermes task body/comment/result
```

---

## 7.2 SQLite state

Path:

```text
~/.agentic-os/state.db
```

Purpose:

```text
mutable Agentic OS state
fast queries
transactions
recovery after refresh/restart
external references to Hermes work
```

Tables:

```text
_meta
runs
run_steps
artifacts
approvals
connector_health
external_refs
collaboration_missions
agent_assignments
proposals
critiques
decision_gates
human_resolutions
```

Include:

```text
stateDbVersion
forward guard
migration runner
backup before migrations
```

---

## 7.3 Filesystem artifacts

Path:

```text
~/.agentic-os/artifacts/<featureId>/<artifactId>.<ext>
```

Purpose:

```text
opaque bytes
media outputs
proposal bodies
decision packets
diffs
documents
external summaries copied from Hermes when needed
```

Served only through guarded API routes.

---

## 7.4 Obsidian vault

Purpose:

```text
durable user-facing notes
curated summaries
promoted research
decision records Rex chooses to keep
runbooks
final docs
```

Default:

```text
do not dump every working transcript into Obsidian
```

Use promotion workflow for durable vault outputs.

---

## 7.5 External system state (note, not a persistence layer)

Some optional connectors back features by communicating with external local systems that have their own state. The most concrete example is Hermes:

```text
~/.hermes/kanban.db
~/.hermes/kanban/...
```

These paths are **not** part of Agentic OS's persistence model. Agentic OS persistence is exactly four stores (§7.1–7.4). External system state is reached through the connector layer and is invisible to Agentic OS features — they see capability invocations and results, not external paths or DB rows.

Treatment rules:

```text
External state is owned by the external system, never written to directly.
HermesConnector uses the CLI adapter for all interaction (see §3.2).
External paths and DB details are never exposed to the browser.
If the external system is absent, the relevant connector reports
  status: unreachable, and any feature depending on it goes to
  state: unavailable. Other features remain ready.
```

---

## 7.6 Cross-store reference handling (dangling refs)

Agentic OS records several reference fields that point across stores: `ArtifactRecord.linkedVaultNotes` → Obsidian vault; `RunRecord.externalRefs` / `AgentAssignment.externalRefs` / `AgentProposal.externalRefs` / `AgentCritique.externalRefs` / `AuditRecord.externalRefs` → external systems via connectors; `ApprovalRecord.payloadRef` → an internal storage entry or artifact.

These references can dangle when the target is moved or deleted out-of-band: a vault note renamed in Obsidian, a Hermes task deleted via the Hermes CLI, an old artifact garbage-collected. Agentic OS does not currently observe vault filesystem events or external-system change feeds, so dangling refs are inevitable.

Policy:

```text
Dangling refs are tolerated, not errors. No background sweep tries to
reach out and "fix" them.

Resolution attempts at fetch-time return neutral diagnostics:
  - vault note moved/deleted        -> UI shows "note no longer at this path"
  - external task removed           -> UI shows "external work no longer available"
  - artifact storageKey missing     -> UI shows "artifact unavailable"

Audit records are never rewritten when a referenced item disappears.
The historical reference stays as it was logged; the resolution is
neutral at read time.

Retention/cleanup missions (when implemented) MAY rewrite ArtifactRecord
to clear linkedVaultNotes and externalRefs that have been unreachable
for a configured period. Default: never rewrite. Opt-in per feature.
```

`ApprovalRecord.payloadRef` is opaque. By convention it is one of:

```text
artifact:<artifactId>     -> resolves to an ArtifactRecord (the most common case)
inline:<storageKey>       -> opaque storage entry, never raw payload
external:<connectorId>:<externalId>
                          -> resolved through the connector at read-time
```

The convention is enforced by helper functions, not by union type, because new ref shapes may appear as connectors are added. The opacity rule is: the browser never sees `payloadRef` directly — it sees the resolved payload through a guarded route, or a neutral "payload unavailable" diagnostic.

---

## 8. UI/UX architecture

## 8.1 Registry-driven but not generic

The registry discovers surfaces.

The shell owns visual quality.

Do not auto-generate ugly forms from schemas.

```text
Feature declares it has a settings panel.
Feature writes a custom premium settings component.
Shell renders it in the standard settings frame.
```

---

## 8.2 Settings page

Layout:

```text
Left rail: Features · Connectors · Permissions · Vault · Advanced
Center: current section
Right rail: contextual help
```

Features section:

```text
title
description
state badge
reasons
enable/disable if canDisable
health check if available
settings panel link
```

Connectors section:

```text
title
kind
transport
enabled toggle
authRef reference only
test connection
capabilities
trust level
Hermes status if connector = Hermes
```

Permissions section:

```text
defaults
recent permission decisions
approval policy summary
```

---

## 8.3 Hermes Kanban preview UI

Initial UI should be read-only:

```text
board selector
columns/status summary
task list
task detail
comments
runs/events summary
```

Do not expose:

```text
raw ~/.hermes paths
full DB schema
dispatcher controls
dangerous task completion/archive/delete actions
```

---

## 8.4 Orchestration CEO/CTO view

Dedicated page, not a dashboard card.

Dashboard gets a compact Active Missions card linking to it.

Layout when the mission is in the `decision-required` state — the most consequential UI moment, where the CTO Decision Packet is presented and Rex resolves:

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Mission · Design caching layer for vault index                                │
│                                       [decision-required]  Round 2 / 2 · 47m │
├─────────────┬────────────────────────────────────────────────────────────────┤
│             │                                                                │
│ phases      │ decision packet                                                │
│             │ Should the cache layer be in-process or a separate process?    │
│ ✓ intake    │                                                                │
│ ✓ proposal  │ ┌───────────────────────────┐  ┌────────────────────────────┐  │
│ ✓ critique  │ │ Option A      in-process  │  │ [recommended]              │  │
│ ✓ revision  │ │ architect · Claude Code   │  │ Option B      subprocess   │  │
│ ✓ consensus │ │                           │  │ architect · Hermes         │  │
│ ▸ decision  │ │ Same process, shared      │  │                            │  │
│ ○ resolved  │ │ memory, lower latency.    │  │ Separate cache process;    │  │
│ ○ completed │ │ Cache invalidation hooks  │  │ IPC overhead but memory    │  │
│             │ │ directly into the vault   │  │ isolated. Survives main    │  │
│             │ │ writer.                   │  │ app restart cleanly.       │  │
│             │ │                           │  │                            │  │
│             │ │ ⚠ reviewer (Hermes):      │  │ ✓ reviewer (Claude Code):  │  │
│             │ │   BLOCK — memory growth   │  │   ENDORSE — memory         │  │
│             │ │   concern                 │  │   isolation worth IPC cost │  │
│             │ └───────────────────────────┘  └────────────────────────────┘  │
│             │                                                                │
│             │ [ Choose A ] [ Choose B ] [ Merge / edit ]                     │
│             │ [ Ask another round ] [ Abort ]                                │
│             │                                                                │
├─────────────┴────────────────────────────────────────────────────────────────┤
│  Artifacts: 7       Runs: 9       Audit events: 38       Linked notes: 0     │
└──────────────────────────────────────────────────────────────────────────────┘
```

Why this layout:

```text
Timeline on the left makes phase progression scannable at a glance.
Decision packet center keeps focus on what Rex must decide.
Two competing proposals side by side enable direct comparison.
Stance pills communicate critique outcomes without requiring full-body reading.
Recommended option is visually accented but not auto-selected.
Footer metrics give an audit-volume sanity check without leaving the page.
```

Controls:

```text
Choose A             commits Option A as the resolved direction
Choose B             commits Option B as the resolved direction
Merge / edit         opens an editor seeded with both summaries; Rex writes
                     a merged directive
Ask another round    extends the mission with one more critique/revision pass
                     plus an optional instruction text to guide the round
Abort                marks the mission abandoned with audit
```

---

## 9. Security and privacy

## 9.1 Leak surfaces

```text
operator config
connector settings
provider errors
subprocess stderr
raw prompts
agent proposals
artifact URLs
approval payloads
audit JSONL
SSE events
UI error messages
Hermes task bodies/comments/results
Hermes DB paths
Hermes worker logs
```

## 9.2 Required mitigations

```text
No z.unknown config bags.
No passthrough config schemas.
Secrets by authRef only.
Resolved secrets stay server-side.
Capability failures are neutral.
Connector test failures are neutral.
Hermes CLI/API errors are neutralized.
Hermes raw paths are never sent to browser.
Artifact IDs are opaque.
No raw filesystem paths in browser.
Artifact serving has decode + realpath + symlink + MIME checks.
Audit records IDs/counts/hashes/durations/error codes only.
SSE is narrower than internal bus.
Routes are gated server-side.
MCP disabled by default and tool-allowlisted.
Untrusted connectors cannot run orchestration roles by default.
Hermes writes require connector write flag and, for risky actions, approval.
```

## 9.3 Permission chain

```text
feature enabled?
  -> connector enabled?
      -> category allowed?
          -> action requires approval?
              -> execute
```

If not:

```text
disabled feature -> 404/notFound
disabled connector -> unavailable
permission prompt -> approval
denied -> neutral error
```

---

## 10. Testing strategy

## 10.1 Feature foundation

```text
register/get/list
duplicate id rejection
lifecycle resolution
visibility matrix
UI projection strips secrets/paths/functions
disabled feature route gate returns 404
sidebar/palette consume same source
```

## 10.2 Connector runtime

```text
raw secret config rejected
authRef resolved server-side only
disabled connector cannot invoke
testConnection neutral failure
provider body not exposed
connector failure redaction
capability fallback behavior
```

## 10.3 HermesConnector

```text
safeSpawn invoked with argv arrays only
hermes missing -> neutral binary-not-found
bad JSON output -> neutral parse failure
stderr with path/secret -> not returned
read-only mode rejects write capabilities
disabled connector returns unavailable
task list/show projection hides raw paths
malformed board/task id rejected
```

## 10.4 Run ledger

```text
queued -> running -> succeeded
running -> failed
running -> cancelled
waiting-approval -> resumed
restart recovery
cancel cascade
external refs persisted
audit neutral metadata only
```

## 10.5 Artifacts

```text
serve by id
reject path traversal
reject encoded traversal
reject symlink escape
reject bad MIME
reject disabled feature artifact
never return raw path
```

## 10.6 Approvals

```text
risky action creates approval
no side effect before approval
approve resumes
reject does nothing
expiry works
audit stays neutral
Hermes writes that require approval do not execute before approval
```

## 10.7 Orchestration

```text
two agents receive same brief
independent proposals stored
critique round bounded
max rounds enforced
decision gate created
Rex resolution resumes mission
audit contains hashes/IDs only
refresh restores mission state
orchestration works with EITHER HermesConnector OR a fake stub connector
  in place of HermesConnector (independence check)
external connector references stored without leaking raw paths to UI
```

---

## 11. Migration plan from v0.3.0

Step-by-step:

```text
1. Add FeatureModule + FeatureExposures types, resolver, manifest API.
2. Migrate one low-risk feature, preferably Scheduler.
3. Migrate Sidebar and CommandPalette to consume feature exposures.
4. Register core pages as core features: Agents, Goals, Journal, Memory.
5. Add state.db with stateDbVersion and empty tables.
6. Represent scheduler runs in state.db.
7. Add ClaudeCodeConnector and HermesConnector (equal priority).
8. Add Hermes Kanban read-only projection as an OPTIONAL preview feature.
9. Add guarded artifact registry and approval queue.
10. Build native multi-agent orchestration MVP (connector-agnostic).
11. Build native Kanban Lite pilot.
12. (No native-vs-Hermes decision step — native is the foundation.)
```

Do not change immediately:

```text
vault writer
constrained writer
safeSpawn
audit JSONL
scheduler behavior
Hermes internals
```

Only the registration/state/connector shape changes.

---

## 12. ADRs to write

Recommended ADR order:

```text
ADR-0013 Feature lifecycle state model
ADR-0014 Persistence four-store split and stateDbVersion
ADR-0015 FeatureModule vs FeatureExposures
ADR-0016 Run ledger foundation
ADR-0017 HermesConnector and external work bridge
ADR-0018 Connector runtime and authRef contract
ADR-0019 Multi-agent orchestration and CEO/CTO decision loop
ADR-0020 Artifact and approval primitives
ADR-0021 Artifact serving security contract
ADR-0022 Permission gate chain
ADR-0023 Content retention classes
ADR-0024 Connector preset catalog and provider-add UX
```

Most important before code:

```text
ADR-0013
ADR-0014
ADR-0015
ADR-0017
ADR-0019
```

**Status of ADR-0019 content:** the binding orchestration contract that ADR-0019 would carry is currently inline in v8 §6.5. The standalone `adr-0019-orchestration-message-mediation.md` file from earlier sessions is **superseded**. When you're ready to commit ADRs to `decisions/` in the repo, extract v8 §6.5 into the ADR file format (mechanical copy). Until then, v8 is the single source of truth.

ADR-0024 (connector preset catalog) is a small new ADR covering the mechanism in v8 §5.10. It can land alongside M4a; not pre-M1-blocking.

---

## 13. Risks and anti-patterns

Avoid:

```text
workflow DSL creep
third-party plugin loader too early
generic schema-generated UI
hardcoded sidebar/palette/settings lists
raw prompts/provider bodies in audit
features directly calling providers
connectors calling other connectors
agents doing peer-to-peer chats
unknown config bags
MCP filesystem/network access without allowlists
artifact serving by raw file path
building Studio before artifacts/approvals
building NotebookLM before source/citation/provenance
making Hermes DB the Agentic OS state store
direct Hermes DB writes from Agentic OS
exposing Hermes paths/logs/results raw in UI
connector definitions that hardcode a single endpoint or single provider variant
connector-named values in core type enums (CapabilityId, ApprovalKind, RunStatus, etc.)
capability router managing connector context windows
features depending on connector-specific (non-well-known) capability IDs
```

Risk table:

| Risk | Failure mode | Mitigation |
|---|---|---|
| Workflow DSL creep | Orchestration becomes YAML/graph workflow engine | Hand-coded TypeScript state machine only |
| Plugin creep | Feature loading becomes sandbox/security problem | Internal code-registered modules only |
| Generic UI | Settings/cards become low-quality schema forms | Human-written components, registry only discovers |
| Audit leakage | Rich events copied to audit | Separate bus/SSE/audit projections |
| Connector secret leakage | Raw `apiKey` appears in config | authRef only, strict schemas |
| Orchestration chat-room | Agents talk uncontrolled | Orchestrator-mediated proposal/critique only |
| State growth | SQLite/artifacts grow forever | Retention policy and cleanup mission |
| Direct route access | Hidden feature still reachable | Server route gates required |
| Hermes state confusion | Agentic OS treats Hermes DB as source of truth | External refs only; Agentic OS owns product state |
| Hermes write overreach | Agentic OS mutates Hermes tasks unsafely | Read-only first; writes gated by connector flags and approvals |
| Connector lock-in | Hardcoded endpoint blocks adding alternates | Multi-endpoint via preset catalog (§5.10) |
| Connector-naming creep | Hermes/Claude/OpenAI names in core enums | Generic enums; connector ID lives in `connectorId` and `payloadRef` |
| Context blow-up | Long agent runs exceed context window | Connector self-manages compression; router doesn't |
| Capability fragmentation | Connector-private cap IDs leak into feature contracts | v1 uses closed `CapabilityId` enum only; no per-connector extras until a real use case appears |

---

## 14. Closed decisions (consolidated)

All cross-cutting design decisions are locked. This section is the single readable summary; the binding contracts live in the referenced sections.

Sources: session summary 2026-05-21 (Q1–Q10), v5 post-Hermes review, v6 second-pass audit, v7 cross-review, v8 fourth-pass cross-review. No open questions remain at the design level. Implementation-level open questions for M1 live in `m1-task-spec.md §14`; M2–M10 task specs may surface their own.

Locks from session summary Q1–Q10:

| # | Decision | Binding location |
|---|---|---|
| 1 | First connectors: Hermes + Claude Code locally; OpenRouter as first cloud (via openai-compatible-llm preset, not as a separate milestone) | §3.1, §5.10, §M4a |
| 2 | "Mission" reserved for multi-agent CEO/CTO orchestration; scheduler units called "Scheduled Jobs" | §6, §M1 (scheduler keeps existing terminology under the FeatureModule wrapper) |
| 3 | `maxRoundsPerPhase` default = 2; global Settings value, not per-mission. `request-more` adds +1 to budget. | §6 pause-policy paragraph, §6.5.4 |
| 4 | Decision packets stored in SQLite by default; promotion to Obsidian only by explicit Rex action | §6.5.3, §6.5.9 |
| 5 | Orchestration roles: fixed enum (architect, implementer, reviewer, critic, researcher, tester, summarizer); no YAML/user-defined roles in v1 | §6.2 |
| 6 | Kanban pilot scope: Kanban Lite (board/task/comment/block; no GTD, no workflow automation) | §M7 |
| 7 | Approval expiry per-kind: decision gates 7d; external/provider-cost 1d; vault promotion 30d; destructive 7d; connector-test 1d (low-risk bucket) | §5.8, §6.5.8 |
| 8 | Retention defaults: runs 90d; proposal/critique bodies 30d; approvals 180d; temporary artifacts 30d; promoted/kept artifacts retained until manually deleted | §13 (state-growth mitigation) |
| 9 | Orchestration ADR includes message-mediation contract (what agents see, what's summarized, what's stored, what hits audit, how Rex's resolution becomes source of truth) | §6.5 (the ADR content is folded inline here) |
| 10 | Untrusted connectors not allowed in orchestration roles by default; only via dev-mode override + per-mission approval | §6.5.1 (agent invocation), §9 (security) |

Locks from §6.5.9 (orchestration-specific sub-decisions):

| Decision | Lock |
|---|---|
| `agent.run` capability split | NOT split. Role/phase passed as input. |
| MockConnector availability | Test-only. Exported from `@agentic-os/test-helpers`. Not registered in production. |
| Mid-mission connector health failure | Mission pauses; surfaced as approval-style notification. |
| Decision packet retention | Kept until manually deleted (separate from mission retention). |
| `request-more` round budget | Grants +1 round; does not reset. |
| `inputHash` idempotency | Locked as contract. Same input → same artifact ID. |
| Concurrent missions | Allowed. No special UX for one operator. |
| Hermes Kanban preview placement | Separate sidebar item ("Hermes Kanban") distinct from native Kanban (M7). |

Locks from v6/v7/v8 cross-reviews:

| Decision | Lock |
|---|---|
| `ExternalRef.system` | Generic `string` (connector ID), not a Hermes-named enum. |
| `RunStepRecord.kind` external entries | Generic `external.task.*`, not `external.hermes.*`. |
| `ConnectorValidation.errorCode` | Generic codes (`binary-not-found`, `external-system-unavailable`, etc.). No Hermes-named codes. |
| `CapabilityId` extensibility | Closed enum in v1. No connector-private extras. `connectorCapabilities` outlet deferred until a real use case appears. |
| Connector preset catalog | Mechanism in §5.10; four type families ship in M4a; new providers add via Settings without code. |
| `RunRecord.round` | Set on orchestration-phase parent runs and child agent.run runs; unset otherwise. |
| `RunRecord.joinPolicy` | Defaults to `"all-must-succeed"` for orchestration phases; other policies reserved for forward compatibility. |
| `RunRecord.maxIterations/maxDurationMs/maxToolCalls/maxCostUsd` | Schema slots; runtime enforcement deferred. |
| `RunStatus: "blocked"` | Intermediate state for auto-blocked runs. Transitions: blocked → queued/running (manual unblock) or → failed/cancelled. |
| `ApprovalKind: "agent.clarification"` + `decision: "answer"` + `responsePayloadRef` | Clarification primitive complements decision packets. Answer stored as artifact for replay durability. |
| `DecisionGate` split | `trigger` (consensus-failed \| manual-escalation) + `scope` (architecture \| implementation). Scope drives post-M6 pause behavior. |
| Pause behavior on `decision-required` | M6: pause everything (only one active phase). Post-M6 hierarchical missions: architecture-scope pauses tree; implementation-scope pauses only affected branch. |
| Heartbeat ownership | Connector writes; orchestrator sweeps every 30s; default 10s interval; failureCount > 3 → blocked. |
| M6 independence test | Test A (stub with shape difference) + Test B (Hermes binary absent) required for M6 sign-off; Test C deferred to OpenRouter landing. |

If anything in this table reads as a question rather than a lock, it's a doc bug — flag it.

---

## 15. Final source-of-truth recommendation

Use this as the project direction:

```text
M0   ADR/design lock
M1   Feature foundation
M2   Registry-driven shell
M3   SQLite run ledger foundation
M4a  Connector runtime + ClaudeCodeConnector + HermesConnector
M4b  Hermes Kanban read-only projection  (optional preview feature)
M5   Artifacts + approvals
M6   Native multi-agent orchestration MVP  (connector-agnostic)
M7   Native Kanban Lite pilot
M8   Obsidian promotion workflow
M9   Studio/media pilot
M10  NotebookLM/research pilot
```

Key principles:

```text
Three independence principles (locked):
  - No system dependency on Hermes.
  - Any-agent orchestration: works with any connector.
  - Independent of how Hermes works: borrow patterns, never coupling.

Four feature lifecycle states (ready/disabled/degraded/unavailable).
FeatureModule core separated from FeatureExposures.
Four-store persistence (audit JSONL + state.db + FS artifacts + Obsidian vault).
No third-party plugin system yet.
No workflow DSL.
Runs before live connector workflows.
Local connectors (ClaudeCode + Hermes) are equal-priority first connectors.
HermesConnector is one connector among many; Hermes Kanban view is optional.
Orchestration is native. Agents are reached through the capability router.
Agentic OS owns approvals, artifacts, vault promotion, UX, and final decisions.
```

If foundation-validation risk needs prioritizing over product identity, swap M6 and M7:

```text
M6 Native Kanban Lite pilot
M7 Native multi-agent orchestration MVP
```

Both stay native. The product-led recommendation keeps orchestration first because the CEO/CTO loop is the defining Agentic OS experience.
