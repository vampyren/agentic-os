# M1 Task Spec — Feature Foundation (v2)

**Date:** 2026-05-21  
**Version:** v2 — incorporates fourth-pass cross-review fixes (config path, status-only gate, register validation, test reset helper, PR2 test scope)  
**Milestone:** M1 — Feature foundation  
**Status:** **DONE (2026-05-23)** — merged to `main` via **PR #11** (merge commit `35b6f26`); review fixes folded in commit `67d1c04`. The §11 acceptance script was run; Rex signed off. Open questions in §14 all defaulted as written.  
**Parent design:** `agentic-os-expandability-foundation-v8.md` (§5.1, §5.2, §5.3, §M1, §10.1)  
**Predecessor milestone:** M0 (ADR/design lock — must be accepted first)  
**Successor milestone:** M2 — Registry-driven shell  
**Audience:** Claude Code (executing agent) and Rex (approving)  
**Purpose:** Decompose M1 into concrete file-level work that Claude Code can deliver, plus the frontend acceptance script Rex runs to verify before approving M2.

This is the **proof** of the deliverable-decomposition layer. If this format works for M1, the same template generates M2–M10 task specs on demand.

**v2 changes from v1 (fourth-pass cross-review):**

- Locked the canonical feature-enablement config path as `features.<id>.enabled` (was ambiguous in v1, mentioned as both `scheduler.enabled` and `config.enabled`).
- Fixed `gateFeatureApi(..., "status-only")` to check feature existence before the mode branch. Unknown feature IDs now always 404; only *known* features can pass through in status-only mode.
- Added `registerFeature` validation that `exposures.featureId === module.id` (catches manifest/exposure mismatches at boot, not at first query).
- Added a test-only `__resetRegistry()` helper so module-level Map state doesn't make tests/hot-reload painful.
- Clarified PR2's "empty features array" test expectation: applies to PR2 only; PR3 onward expects Scheduler.

---

## 1. Scope (locked from v8 §M1)

Build the feature foundation primitives:

```text
FeatureModule core type
FeatureExposures type
Feature registry (register, get, list)
Feature lifecycle resolver (ready | disabled | degraded | unavailable)
UI-safe feature projection endpoint (GET /api/features)
Page route gate helper (requireFeatureReady, requireFeatureEnabled)
API route gate helper (gateFeatureApi)
```

Migrate one existing feature as proof-of-concept: **Scheduler** (the lowest-risk feature).

Out of scope (deferred to later milestones):

```text
Sidebar / command palette consuming the registry          → M2
Dashboard cards from feature exposures                    → M2
Settings UI for feature toggles                           → M2
Connector runtime                                         → M4a
Run ledger                                                → M3
Artifacts / approvals                                     → M5
Orchestration                                             → M6
```

---

## 2. Exit criteria (locked from v8 §M1)

```text
Scheduler registers as a feature using FeatureModule + FeatureExposures.
Feature projection endpoint returns UI-safe data only.
Disabled feature fails closed at route/API gate (returns 404).
Feature state has 4 statuses (ready | disabled | degraded | unavailable)
  plus a visibility computation.
No raw config / secrets / paths exposed to client.
```

---

## 3. File structure (new files Claude Code creates)

Working in the existing Next.js App Router codebase. Convention: TypeScript, Zod schemas, branded types where v8 says.

```text
src/core/features/
  types.ts                         FeatureModule, FeatureExposures, FeatureId, etc.
  registry.ts                      registerFeature, getFeature, listFeatures
  resolver.ts                      resolveFeature, computeLifecycleState, computeVisibility
  projection.ts                    toUiSafeFeature (strips secrets/paths/functions)
  gates.ts                         requireFeatureReady, requireFeatureEnabled, gateFeatureApi
  index.ts                         barrel exports

src/core/features/__tests__/
  registry.test.ts
  resolver.test.ts
  projection.test.ts
  gates.test.ts

src/app/api/features/
  route.ts                         GET /api/features  → UI-safe projection

src/features/scheduler/
  feature.ts                       NEW: Scheduler as a FeatureModule
  exposures.ts                     NEW: Scheduler's FeatureExposures
  (existing scheduler implementation files remain; this adds the manifest layer)
```

**Important:** Do not delete or restructure existing scheduler code. M1 adds the feature-module layer on top; the scheduler keeps working exactly as it does in v0.3.0.

---

## 4. Type definitions (copy from v8 §5.1)

Implement these types verbatim in `src/core/features/types.ts`:

- `FeatureId` (string alias; consider branded type `Brand<string, "FeatureId">`)
- `FeatureCategory` (closed union: `"core" | "automation" | "creative" | "productivity" | "integration" | "orchestration"`)
- `FeatureModule<TConfig = unknown>` (with `lifecycle`, `config`, `requiredCapabilities`, `optionalCapabilities`, `sideEffects`, `vault?`, `artifacts?`, `health?`)
- `FeatureExposures` (with `nav?`, `commands?`, `dashboardCards?`, `settingsPanel?`, `workspacePanels?`)
- `FeatureLifecycleState` (closed union: `"ready" | "disabled" | "degraded" | "unavailable"`)
- `FeatureRuntimeStatus` (state + visibility + reasons)
- `FeatureReason` (with `code`, `severity`, `message`, optional `capabilityId`, `connectorId`)
- `NavExposure`, `CommandExposure`, `DashboardCardExposure`, `SettingsPanelExposure`, `WorkspacePanelExposure`

All `config.schema` uses Zod. No `z.unknown()` bags. No `z.passthrough()`. No raw secret fields.

**Forward-reference fields that don't have backing types yet:** `requiredCapabilities?: CapabilityId[]` and `optionalCapabilities?: CapabilityId[]` reference `CapabilityId` which doesn't exist until M4a. For M1, type these as `string[]` with a TODO comment, or temporarily inline a minimal `CapabilityId` union of the IDs Scheduler actually needs (probably none). Do not block M1 on M4a's type.

---

## 5. Registry (`src/core/features/registry.ts`)

In-process registry — a plain `Map<FeatureId, FeatureModule>` plus a parallel `Map<FeatureId, FeatureExposures>`.

API:

```ts
export function registerFeature<TConfig>(
  module: FeatureModule<TConfig>,
  exposures: FeatureExposures,
): void;

export function getFeature(id: FeatureId): FeatureModule | undefined;
export function listFeatures(): readonly FeatureModule[];
export function getExposures(id: FeatureId): FeatureExposures | undefined;
```

Behavior:

- `registerFeature` throws on duplicate `id`.
- `registerFeature` throws if `exposures.featureId !== module.id` (catches manifest/exposure mismatches at boot, not at first query).
- Registry is module-level state (initialized once per server process).
- Registration happens at app boot via an explicit list (no filesystem auto-discovery — per v8 §13 anti-pattern "third-party plugin loader too early").

Test-only helper (export but don't call from production code):

```ts
/** Test-only. Clears all registered features so each test starts clean. */
export function __resetRegistry(): void {
  // Implementation: clear both Map instances.
}
```

Use `__resetRegistry()` in `beforeEach` hooks. Without this, tests pollute each other through module-level Map state, and hot reload during development gets noisy.

Boot-time registration file (new): `src/core/features/registered.ts`

```ts
import { schedulerFeature, schedulerExposures } from "@/features/scheduler/feature";
import { registerFeature } from "./registry";

let registered = false;
export function ensureFeaturesRegistered(): void {
  if (registered) return;
  registerFeature(schedulerFeature, schedulerExposures);
  // Future features register here.
  registered = true;
}
```

Call `ensureFeaturesRegistered()` from the API route handler and any server-side resolver entry point.

---

## 6. Resolver (`src/core/features/resolver.ts`)

```ts
export interface ResolvedFeature {
  module: FeatureModule;
  exposures: FeatureExposures;
  status: FeatureRuntimeStatus;
}

export async function resolveFeature(id: FeatureId): Promise<ResolvedFeature | undefined>;
export async function resolveAllFeatures(): Promise<readonly ResolvedFeature[]>;
```

`resolveFeature` logic (per v8 §5.2):

```text
1. Look up module + exposures via registry.
2. Read the canonical enablement flag from persisted config:
   path: features.<id>.enabled
   default: module.lifecycle.defaultEnabled
   This is the lifecycle switch. It is SEPARATE from feature-internal
   config (which lives under features.<id>.config.* and is parsed through
   module.config.schema). Do NOT collapse them into a single flag.
3. If features.<id>.enabled === false  →  state = "disabled"
4. Else:
   a. Check requiredCapabilities. If any required capability has no provider
      (no enabled connector implementing it), state = "unavailable", reasons +=
      "missing-required-capability".
      (For M1, no connectors exist yet — so any feature with non-empty
       requiredCapabilities goes to "unavailable". Scheduler should have no
       requiredCapabilities, so it stays ready.)
   b. If feature.health is defined and returns "down", state = "unavailable".
   c. If feature.health returns "degraded", state = "degraded".
   d. If optional capabilities missing, state = "degraded", reasons +=
      "missing-optional-capability".
   e. Else: state = "ready".
5. Compute visibility:
   - state in {ready, degraded, unavailable}  → visible
   - state === disabled  → visible UNLESS lifecycle.hiddenWhenDisabled === true
6. Return ResolvedFeature.
```

Visibility is a pure function of state + `lifecycle.hiddenWhenDisabled`. Extract it as `computeVisibility(state, lifecycle): "visible" | "hidden"` for unit testability.

---

## 7. UI-safe projection (`src/core/features/projection.ts` + `/api/features/route.ts`)

The projection strips ALL non-UI-safe fields. The browser must never see:

- `config.schema` (Zod schema is a function/object reference)
- `config.defaults` (may contain secrets)
- `health` (a function reference)
- `sideEffects` raw paths
- `vault.allowedWriteRoots` raw paths
- `artifacts.allowedRoots` raw paths
- Anything else that's a function, file path, or sensitive config value

UI-safe shape:

```ts
export interface UiSafeFeature {
  id: FeatureId;
  title: string;
  description: string;
  category: FeatureCategory;
  status: FeatureRuntimeStatus;
  exposures: FeatureExposures;
  // NO config, NO health fn, NO raw paths.
}

export function toUiSafeFeature(resolved: ResolvedFeature): UiSafeFeature;
```

Route handler `src/app/api/features/route.ts`:

```ts
export async function GET(req: Request) {
  ensureFeaturesRegistered();
  const all = await resolveAllFeatures();
  const safe = all.map(toUiSafeFeature);
  return Response.json({ features: safe });
}
```

Add origin check at the route level (existing `originOk()` helper from v0.3.0 if it exists, else a small helper). Return 403 on origin mismatch.

---

## 8. Route gates (`src/core/features/gates.ts`)

```ts
import { notFound } from "next/navigation";

export async function requireFeatureReady(id: FeatureId): Promise<ResolvedFeature> {
  ensureFeaturesRegistered();
  const feature = await resolveFeature(id);
  if (!feature || feature.status.state !== "ready") notFound();
  return feature;
}

export async function requireFeatureEnabled(id: FeatureId): Promise<ResolvedFeature> {
  ensureFeaturesRegistered();
  const feature = await resolveFeature(id);
  if (!feature || feature.status.state === "disabled") notFound();
  return feature;
}

export async function gateFeatureApi(
  req: Request,
  id: FeatureId,
  mode: "enabled" | "ready" | "status-only",
): Promise<Response | null> {
  if (!originOk(req)) return new Response("forbidden", { status: 403 });
  ensureFeaturesRegistered();

  // CRITICAL: unknown feature IDs must always 404, including in status-only mode.
  // status-only's purpose is "let this through even if the known feature is
  // disabled" — it is NOT "let anything through, including typos and removed
  // features."
  const feature = await resolveFeature(id);
  if (!feature) return new Response("not found", { status: 404 });

  if (mode === "status-only") return null;
  if (feature.status.state === "disabled") {
    return new Response("not found", { status: 404 });
  }
  if (mode === "ready" && feature.status.state !== "ready") {
    return Response.json(
      { error: "feature-not-ready", reasons: feature.status.reasons },
      { status: 503 },
    );
  }
  return null;
}
```

**Do not use Next middleware** for this (per v8 §5.3 — middleware may run in runtimes that should not load local config/state).

Each protected route file imports `requireFeatureReady` and calls it at the top of its handler / page.

---

## 9. Scheduler migration (`src/features/scheduler/feature.ts`)

Wrap the existing scheduler as a FeatureModule. The existing scheduler implementation stays where it is. Just add the manifest:

```ts
import { z } from "zod";
import type { FeatureModule, FeatureExposures } from "@/core/features/types";

const SchedulerConfigSchema = z.object({
  // existing scheduler config schema from v0.3.0 (cron expressions etc.)
});
type SchedulerConfig = z.infer<typeof SchedulerConfigSchema>;

export const schedulerFeature: FeatureModule<SchedulerConfig> = {
  id: "scheduler" as FeatureId,
  title: "Scheduler",
  description: "Time-based mission triggers (cron-style).",
  category: "automation",

  lifecycle: {
    defaultEnabled: true,
    canDisable: true,
    hiddenWhenDisabled: false,
    core: false,
  },

  config: {
    schema: SchedulerConfigSchema,
    defaults: { /* existing defaults */ },
  },

  requiredCapabilities: [],   // Scheduler doesn't need connectors in MVP
  sideEffects: ["timer", "file-write"],  // align with existing FeatureSideEffect enum if defined; else string[] for now

  // No vault writes, no artifacts in M1.
};

export const schedulerExposures: FeatureExposures = {
  featureId: "scheduler" as FeatureId,

  // No nav/commands/cards yet — those activate in M2 when the shell consumes them.
  // Leaving these out is correct; consuming side (M2 shell) tolerates absence.
};
```

The existing scheduler page (if any — verify in repo) gets one line added at the top:

```ts
import { requireFeatureReady } from "@/core/features/gates";

export default async function SchedulerPage() {
  await requireFeatureReady("scheduler" as FeatureId);
  // ... existing page implementation ...
}
```

Same for any existing scheduler API routes — add `gateFeatureApi(req, "scheduler", "ready")` at the top.

---

## 10. Tests (`src/core/features/__tests__/`)

Per v8 §10.1 testing strategy. Each item below = one test or test group.

`registry.test.ts`:

```text
- registerFeature succeeds for new id
- registerFeature throws on duplicate id
- registerFeature throws when exposures.featureId !== module.id
- getFeature returns the registered module
- getFeature returns undefined for unknown id
- listFeatures returns all registered modules
- getExposures returns the registered exposures
- __resetRegistry clears all registered features (used in test setup)
```

`resolver.test.ts`:

```text
- resolveFeature returns "ready" for an enabled feature with no missing deps
- resolveFeature returns "disabled" when config.enabled === false
- resolveFeature returns "unavailable" with reason "missing-required-capability"
  when a required capability has no provider
- resolveFeature returns "degraded" when an optional capability is missing
- resolveFeature returns "degraded" when health returns degraded
- resolveFeature returns "unavailable" when health returns down
- computeVisibility: ready/degraded/unavailable → visible
- computeVisibility: disabled → visible (default)
- computeVisibility: disabled + hiddenWhenDisabled → hidden
- resolveAllFeatures returns one entry per registered feature
```

`projection.test.ts`:

```text
- toUiSafeFeature includes id, title, description, category, status, exposures
- toUiSafeFeature does NOT include config (schema or defaults)
- toUiSafeFeature does NOT include health function reference
- toUiSafeFeature output is JSON-serializable (no functions, no symbols)
- toUiSafeFeature output contains no raw filesystem paths from vault/artifacts roots
- A round-trip through JSON.stringify/parse preserves the shape exactly
```

`gates.test.ts`:

```text
- requireFeatureReady returns the feature when state is "ready"
- requireFeatureReady calls notFound() when state is "disabled"
- requireFeatureReady calls notFound() when state is "unavailable"
- requireFeatureReady calls notFound() when state is "degraded"
- requireFeatureReady calls notFound() for unknown feature id
- requireFeatureEnabled returns the feature for ready/degraded/unavailable
- requireFeatureEnabled calls notFound() when state is "disabled"
- gateFeatureApi returns 403 on origin check failure
- gateFeatureApi returns 404 for unknown feature id in ALL modes
  (including status-only — this is the v2 fix)
- gateFeatureApi returns 404 for disabled known feature in enabled/ready modes
- gateFeatureApi returns null (passes through) for status-only mode when
  feature is known but disabled
- gateFeatureApi returns 503 for "ready" mode when known feature state is
  "degraded" / "unavailable"
```

Integration test (one): `src/app/api/features/__tests__/route.test.ts`:

```text
- GET /api/features returns 200
- Response shape: { features: UiSafeFeature[] }
- Scheduler appears in the list with status.state === "ready"
- No response field contains a function, a Zod schema, or a filesystem path
- POST /api/features returns 405 (method not allowed)
```

Test framework: use whatever v0.3.0 already uses (likely Vitest given the Next.js + TypeScript stack — verify). Match the existing test patterns.

---

## 11. Frontend acceptance script (Rex runs this)

This is what Rex actually does to verify M1 is shippable before approving M2.

M1 has no UI of its own (M2 builds the registry-driven shell). So acceptance is API-level plus a smoke check that nothing visible regressed.

```text
Step 1: Hit the projection endpoint.
  Open: http://localhost:<port>/api/features
  Expect: JSON response with shape { features: [...] }
  Verify: at least one entry with id="scheduler"
  Verify: that entry has status.state === "ready"
  Verify: that entry has NO "config" field
  Verify: that entry has NO "health" field
  Verify: no string in the response looks like an absolute filesystem path
           (no "/home/", no "/Users/", no "C:\\")

Step 2: Confirm the scheduler still works end-to-end.
  Trigger a manual mission run from the existing scheduler UI (same way as v0.3.0).
  Expect: mission runs, completes, writes to audit JSONL as before.
  This proves the feature-module layer didn't break the underlying scheduler.

Step 3: Disable the scheduler.
  Edit the local config to set features.scheduler.enabled = false. Save. Reload.
  (Note: this is the lifecycle switch. Scheduler-internal settings live
  under features.scheduler.config.* — do NOT touch those for this test.)
  Hit GET /api/features again.
  Verify: scheduler entry now has status.state === "disabled".
  Try to access the scheduler page in the browser.
  Expect: 404 (route gate fires).
  Try the scheduler API endpoint.
  Expect: 404.

Step 4: Re-enable.
  Set features.scheduler.enabled = true. Save. Reload.
  Verify: scheduler page works again, status === "ready".

Step 5: Run the test suite.
  npm test (or whatever the existing command is).
  Verify: all tests pass, including the new ones in src/core/features/__tests__/.
```

If all five steps pass, M1 is shippable.

---

## 12. PR breakdown (suggested for Claude Code)

Three small PRs are cleaner than one big one. They can land in sequence.

```text
PR 1: Feature foundation core
  - src/core/features/types.ts
  - src/core/features/registry.ts
  - src/core/features/resolver.ts
  - src/core/features/projection.ts
  - src/core/features/gates.ts
  - src/core/features/index.ts
  - src/core/features/registered.ts (with empty registration list)
  - All four __tests__ files
  Definition of done: tests pass; no existing feature touched.

PR 2: Projection endpoint
  - src/app/api/features/route.ts
  - Integration test
  Definition of done: GET /api/features returns 200.
  PR2-specific test expectation: response body is { features: [] } because
  no features are registered yet. (registered.ts intentionally still has
  an empty registration list at this point.)
  This expectation flips at PR3 — once Scheduler is registered, the
  integration test must be updated to expect Scheduler in the response.
  Do not leave the empty-array assertion in place after PR3 lands.

PR 3: Scheduler migration
  - src/features/scheduler/feature.ts
  - src/features/scheduler/exposures.ts
  - Add schedulerFeature to registered.ts
  - One-line gate added to existing scheduler page/route(s)
  Definition of done: GET /api/features returns scheduler; acceptance script
  steps 1–4 pass.
```

If Claude Code prefers one PR, that's fine — the breakdown is a suggestion, not a hard requirement.

---

## 13. Done definition

M1 is **DONE** when:

```text
✓ All three PRs merged to design/goal-1-feature-foundation (or main, Rex's call)
✓ Acceptance script (§11) passes end-to-end
✓ All new tests pass; existing tests still pass (no regression)
✓ No secrets, paths, schemas, or functions in /api/features response
✓ Disabled scheduler returns 404 at both page and API routes
✓ Rex signs off via comment "M1 verified, proceed to M2"
```

When DONE, the next step is generating M2's task spec.

---

## 14. Open questions for Rex (decide before M1 starts, or accept defaults)

1. **Branching strategy.** Land on `design/goal-1-feature-foundation` first and merge to main when all of M1 ships, or merge each PR to main as it lands? Default: land on the branch, merge to main on M1 acceptance.

2. **Naming for `featureId` type.** Use a Zod-branded string (`z.string().brand("FeatureId")`) for runtime parsing, or a TypeScript-only `Brand<string, "FeatureId">`? Default: Zod branded for consistency with existing v0.3.0 patterns.

3. **Side-effect enum scope.** v8 §5.1 says `sideEffects: FeatureSideEffect[]` but doesn't define the enum. Define it in M1 with values: `"network" | "file-write" | "file-read" | "process-spawn" | "timer" | "vault-write" | "external-api"`, or leave as `string[]` and tighten later? Default: define the enum in M1.

4. **Existing scheduler structure.** Does the v0.3.0 scheduler already have its own folder under `src/features/scheduler/`, or does it live elsewhere? Claude Code should verify on first read; if it lives elsewhere, the migration steps move accordingly without losing existing code.

If you skip these, defaults apply.

---

**End of M1 task spec.** M1 was accepted; M2 task spec was generated and M2 also shipped (PR #12, merge `0ae4070`). M3, M4a (6 sub-PRs), and the M4a-5 parked design followed. See AutoMem `agentic-os-current-state.md` and `docs/ARCHITECTURE.md` for the live milestone state.
