# M2 Task Spec — Registry-Driven Shell (v1)

**Date:** 2026-05-22
**Version:** v1 — first draft for Rex review (M1 committed at `67d1c04`, review fixes folded in)
**Milestone:** M2 — Registry-driven shell
**Status:** **DONE (2026-05-23)** — merged to `main` via **PR #12** (merge commit `0ae4070`). Also includes side-fix PR #13 (`bda3145`) for TopBar route titles `/scheduler` + `/settings` that M2 missed. §13 acceptance ran; open questions in §16 all defaulted.
**Parent design:** `agentic-os-expandability-foundation-v8.md` (§M2, §5.1, §8.1, §8.2)
**Predecessor milestone:** M1 — Feature foundation (DONE — merged via PR #11, merge `35b6f26`).
**Successor milestone:** M3 — SQLite run ledger foundation
**Audience:** Claude Code (executing agent) and Rex (approving)
**Purpose:** Decompose M2 into concrete file-level work, adapted to the *live* v0.3.0 shell, plus the acceptance script Rex runs before approving M3.

This spec follows the M1 template. Section 3 is the M2 equivalent of M1's corrective guardrails — it is baked into the spec because the shell already exists and the v8 §M2 prose predates it.

---

## 1. Scope (locked from v8 §M2)

Make the existing shell consume the feature registry instead of hardcoded lists:

```text
Sidebar consumes feature nav exposures.
Command palette consumes feature command exposures.
Dashboard consumes feature dashboard-card exposures.
Settings page shows read-only feature status / config summary.
```

Proof feature stays **Scheduler** — M2 populates its (currently empty)
`FeatureExposures` and the shell renders them with zero shell-file edits
beyond the one-time registry wiring.

Out of scope (deferred):

```text
Settings editing / enable-disable toggles            → later (M2 is read-only)
Connector / Permissions / Vault settings sections    → M4a onward
Command actions of type start-run / open-panel       → M3+ (no run-trigger UI yet)
workspacePanels rendering                            → later milestone
Run ledger                                           → M3
Connector runtime                                    → M4a
```

---

## 2. Exit criteria (locked from v8 §M2)

```text
Adding one feature nav item requires registering feature exposures only —
  NOT editing Sidebar + CommandPalette + Dashboard separately.
Sidebar, command palette and dashboard all render Scheduler's exposures.
A settings page lists every registered feature with state + reasons,
  read-only, no raw config / secrets / paths.
Disabled / not-ready features are filtered from the shell per their
  exposure `visibility` rule.
Core shell items (Mission Control, Agents, Self, Settings) remain
  shell-owned — M2 does not migrate them into the registry.
```

---

## 3. Repo-reality adaptations (READ FIRST — adapt the v8 prose to the live shell)

v8 §M2 was written before the v0.3.0 shell existed. The shell is real and
shipped. Adapt, do not invent a parallel shell.

1. **The shell components are client components.** `src/components/Sidebar.tsx`
   and `src/components/CommandPalette.tsx` are `"use client"` with hardcoded
   arrays (`WORKSPACE`, `SELF`, `NAV_ROUTES`) and inline lucide icon nodes.
   `src/components/Shell.tsx` is a server component; `src/app/page.tsx`
   (Mission Control dashboard) is a client component. Feature exposures must
   reach client components as **serializable props/context** — `UiSafeFeature`
   is plain JSON (M1 projection guarantees this), so this works.

2. **`/api/features` already exists** (`src/app/api/features/route.ts`) and
   returns `{ features: UiSafeFeature[] }` with `status` + `exposures`,
   deep-sanitized by M1's projection. M2 does NOT change the projection or
   the endpoint. The shell consumes resolved features — see §5 for delivery.

3. **`iconKey` and `componentKey` are strings.** Exposures carry string keys,
   not React components (they cross the projection as JSON). M2 must add
   **closed allowlist registries** mapping key → component. NEVER resolve a
   key by dynamic `import()` or by indexing an open object with caller text.
   Unknown key → a defined fallback. (§6, §7)

4. **No Settings page exists.** `src/app/` has no `settings/` route. M2
   creates it. v8 §8.2's left rail lists Features · Connectors · Permissions ·
   Vault · Advanced — M2 builds **only the Features section**; the rest are
   later milestones. No editing.

5. **No Scheduler page exists** — only API routes (`/api/scheduler/status`,
   `/api/missions/[id]/run`). A `nav` exposure needs a real `href`. M2 builds
   a **minimal read-only Scheduler page** at `/scheduler`, gated by
   `requireFeatureReady("scheduler")` — this also wires up M1's page gates,
   which M1 delivered + unit-tested but left unwired (M1 work-log risk #1).

6. **Settled UI shell decisions stand** (see Rex memory `agentic-os-ui-shell-decisions`):
   content hugs the sidebar (no `mx-auto`), TopBar = title only, sidebar
   footer = version only, aurora static. M2 must not regress these.

7. **Shell groups don't map 1:1 to `NavExposure.group`.** The sidebar today
   has Workspace / Agents / Self. `NavExposure.group` is
   `"platform" | "feature" | "admin"`. M2 renders feature nav items in a new
   **"Features"** group between Self and the footer, sorted by `order`. The
   `group` field is carried but not used to pick a sidebar section in M2
   (single Features section); revisit if a second feature needs it.

8. **Keep M1's security posture.** Exposures already crossed M1's deep
   allowlist; do not re-widen. The shell renders only `UiSafeFeature` data.
   Do not add a new endpoint that returns raw `FeatureModule` / config.

9. **Per-step git approvals remain a hard rule.** Commit only on Rex's
   explicit go-ahead, milestone doc-sync at the end.

---

## 4. File structure

```text
NEW — app layer (shell-specific, pure where possible):
  src/app/_lib/shellSelectors.ts      pure selectors: visible nav / commands
                                      / cards / settings rows from
                                      UiSafeFeature[]  (DOM-free, unit-tested)
  src/app/_components/FeaturesProvider.tsx
                                      client context carrying UiSafeFeature[]
  src/app/_components/iconRegistry.tsx
                                      closed iconKey -> lucide icon map
  src/app/_components/componentRegistry.tsx
                                      closed componentKey -> React component map
  src/app/settings/page.tsx           Settings page — Features section only
  src/app/scheduler/page.tsx          minimal read-only Scheduler page (gated)

NEW — scheduler feature UI components (hand-built, premium — v8 §8.1):
  src/features/scheduler/components/SchedulerStatusCard.tsx
  src/features/scheduler/components/SchedulerSettingsPanel.tsx

MODIFIED — shell:
  src/components/Shell.tsx            resolve features server-side, wrap tree
                                      in FeaturesProvider
  src/components/Sidebar.tsx          render feature nav from context
  src/components/CommandPalette.tsx   render feature commands from context
  src/app/page.tsx                    render feature dashboard cards from context

MODIFIED — scheduler manifest:
  src/features/scheduler/exposures.ts populate nav + dashboardCards +
                                      settingsPanel

NEW — tests (repo `tests/` pattern — Vitest):
  tests/shell-selectors.test.ts       the pure selectors (no DOM)
  tests/scheduler-exposures.test.ts   scheduler exposures shape + keys resolve
  tests/api-features-exposures.test.ts (optional) end-to-end: /api/features
                                      now carries scheduler nav/card/panel
```

**Do not** delete or restructure existing shell code. M2 swaps hardcoded
arrays for registry-driven rendering; Mission Control / Agents / Self
sections keep working exactly as in v0.3.0.

---

## 5. Feature data delivery to the shell (`FeaturesProvider`)

The shell needs `UiSafeFeature[]` in client components. Three options were
considered; **locked choice: server-resolve once + React context.**

- `Shell.tsx` becomes an `async` server component. It calls
  `ensureFeaturesRegistered()` then `resolveAllFeatures()` and maps
  `toUiSafeFeature` — the same path `/api/features` uses.
- It wraps its subtree in `<FeaturesProvider value={features}>`.
  `FeaturesProvider` is a thin `"use client"` context
  (`createContext<UiSafeFeature[]>([])` + `useFeatures()` hook).
- Sidebar, CommandPalette and the dashboard page read `useFeatures()`.

Why not client `fetch("/api/features")`: avoids a loading flash in the
sidebar and an extra round-trip on every navigation. The endpoint stays
for external/debug callers.

Notes:
- Resolving features in the shell makes the root layout dynamic. Acceptable
  for a local-first app; add `export const dynamic = "force-dynamic"` only
  if Next complains during build.
- `resolveAllFeatures()` reads config per request via `loadConfig()` — same
  cost as `/api/features`. No caching added in M2.

---

## 6. Icon registry (`src/app/_components/iconRegistry.tsx`)

`NavExposure.iconKey` / `CommandExposure` icons are strings. Map them
through a **closed** record to lucide components:

```ts
import { Clock, CalendarClock, LayoutGrid /* … */ } from "lucide-react";

const ICONS = {
  "clock": Clock,
  "calendar-clock": CalendarClock,
  "layout-grid": LayoutGrid,
  // add only keys features actually declare
} as const;

export type IconKey = keyof typeof ICONS;

/** Resolve an iconKey to a component; unknown keys fall back. */
export function iconFor(key: string): LucideIcon { … }   // fallback: a neutral dot/Circle
```

Rules:
- No dynamic `import()`. No indexing with unsanitized input beyond this
  closed record.
- Unknown key → fallback icon, never a crash.
- The Scheduler nav item uses `iconKey: "clock"` (or `"calendar-clock"`).

---

## 7. Component registry (`src/app/_components/componentRegistry.tsx`)

`DashboardCardExposure.componentKey`, `SettingsPanelExposure.componentKey`
(and later `workspacePanels`) map to **hand-built** components — per v8 §8.1,
the shell owns visual quality; there is no generic schema-to-form renderer.

```ts
const CARD_COMPONENTS = {
  "scheduler.status-card": SchedulerStatusCard,
} as const;

const SETTINGS_COMPONENTS = {
  "scheduler.settings-panel": SchedulerSettingsPanel,
} as const;

export function cardComponentFor(key: string): React.ComponentType | null { … }
export function settingsComponentFor(key: string): React.ComponentType | null { … }
```

Rules:
- Closed records. Unknown key → `null`; the consumer skips it (renders
  nothing, never throws). The selector layer (§8/§10) should drop exposures
  whose `componentKey` is unknown so the shell never reserves empty space.
- Card components fetch their own data client-side (e.g.
  `SchedulerStatusCard` fetches `/api/scheduler/status`) — exposures carry
  no payload.

---

## 8. Pure selectors (`src/app/_lib/shellSelectors.ts`)

All filter/sort/visibility logic lives in **pure, DOM-free functions** so it
is unit-testable under Vitest without a React renderer (no new test deps —
see §11). The client components only render selector output.

```ts
export function visibleNavItems(features: UiSafeFeature[]): NavRenderItem[];
export function visibleCommands(features: UiSafeFeature[]): CommandRenderItem[];
export function visibleDashboardCards(features: UiSafeFeature[]): CardRenderItem[];
export function featureSettingsRows(features: UiSafeFeature[]): SettingsRow[];
```

Each selector:
- iterates `features`, reads `feature.status.state` + `feature.exposures.*`,
- applies the visibility rule (§9),
- drops items whose `iconKey` / `componentKey` does not resolve,
- sorts by `order` (nav, cards) — see §9,
- returns a small render-ready record (id, label, href, resolved icon key,
  etc.) — NOT the raw exposure.

`featureSettingsRows` returns every registered feature regardless of state
(the settings page must show disabled features too) with: id, title,
description, state, reasons, `canDisable` (note: `canDisable` is NOT in
`UiSafeFeature` today — see Open Question 5), and whether a settings panel
key resolves.

---

## 9. Visibility & ordering rules (locked)

**Nav (`NavExposure.visibility`):**

```text
"always"        → render in every state, including disabled
"when-enabled"  → render when status.state !== "disabled"
"when-ready"    → render only when status.state === "ready"
undefined       → treated as "when-enabled"
```

**Commands (`CommandExposure.visibility`):**

```text
"always"                  → always render
"when-ready"              → status.state === "ready"
"when-degraded-or-better" → status.state ∈ { "ready", "degraded" }
undefined                 → treated as "when-ready"
```

**Dashboard cards:** rendered when `status.state ∈ { "ready", "degraded" }`
(a card with no live data is useless; cards have no `visibility` field).

**Settings rows:** every registered feature, all states (so the operator
can see a disabled feature and its reason).

**Ordering:** nav and cards sort ascending by `order`; ties break by `id`.
Commands have no `order` field — sort by `label`. Feature nav renders
*after* the shell-owned Workspace/Agents/Self groups, under a "Features"
group label.

---

## 10. Shell consumption — what each file does

**`Sidebar.tsx`** — after the Self group, add a `GroupLabel "Features"` and
map `visibleNavItems(useFeatures())` through the existing `NavLink`
component (icon via `iconFor`). Empty result → render nothing (no empty
group label). Keep Workspace/Agents/Self exactly as-is.

**`CommandPalette.tsx`** — add a `Command.Group heading="Features"` after
"Navigate", rendering `visibleCommands(useFeatures())`. M2 implements
`action.type: "navigate"` only (router push). If a `start-run` /
`open-panel` command appears, the selector drops it in M2 (logged as
deferred) — Scheduler ships only `navigate` commands in M2.

**`page.tsx` (Mission Control)** — add a feature-cards region rendering
`visibleDashboardCards(useFeatures())` through `cardComponentFor`. Respect
`span` (1 = single column, 2 = double) within the existing grid. Place the
region per Rex's layout preference (default: below the agent portal cards).

**`settings/page.tsx`** — new. Server component; left rail with a single
"Features" entry (other sections are stubbed/"coming soon"). Center:
`featureSettingsRows` → one card per feature with title, description, a
state badge (ready=green / degraded=amber / unavailable=red /
disabled=grey), the reason list (derived messages — already safe from M1),
and, if a settings panel key resolves, render that panel component inside
the standard settings frame. Read-only — no toggle control in M2.

**`scheduler/page.tsx`** — new. `await requireFeatureReady("scheduler")` at
the top (404s when disabled/not-ready — exercises M1's page gate). Renders a
minimal read-only view: scheduler running state + scheduled missions from
`/api/scheduler/status`, and the mission list. No controls beyond what
v0.3.0 already exposes.

---

## 11. Scheduler exposures (`src/features/scheduler/exposures.ts`)

Populate the currently-empty manifest:

```ts
export const schedulerExposures: FeatureExposures = {
  featureId: SCHEDULER_FEATURE_ID,
  nav: [{
    id: "scheduler", label: "Scheduler", href: "/scheduler",
    iconKey: "clock", order: 10, group: "feature",
    visibility: "when-enabled",
  }],
  commands: [{
    id: "scheduler.open", label: "Open Scheduler",
    keywords: ["cron", "missions", "schedule"],
    action: { type: "navigate", href: "/scheduler" },
    visibility: "when-ready",
  }],
  dashboardCards: [{
    id: "scheduler.status", componentKey: "scheduler.status-card", order: 10,
    span: 1,
  }],
  settingsPanel: { componentKey: "scheduler.settings-panel",
    summary: "Cron-style mission triggers." },
};
```

Exact ids/labels/order are Claude Code's call within these shapes; keep
`featureId === module.id` (M1 registry asserts this at boot).

---

## 12. Tests (`tests/` — Vitest, repo pattern)

No new test dependencies. Component-rendering tests would need
`@testing-library/react` + jsdom (not installed; M1 guardrails forbid
installing). M2 therefore tests the **pure selectors** exhaustively and
keeps component files thin.

`tests/shell-selectors.test.ts`:

```text
- visibleNavItems: includes a "ready" feature's nav item
- visibleNavItems: "when-enabled" item hidden when feature disabled
- visibleNavItems: "when-ready" item hidden when feature degraded
- visibleNavItems: "always" item shown even when disabled
- visibleNavItems: undefined visibility behaves as "when-enabled"
- visibleNavItems: drops an item whose iconKey does not resolve
- visibleNavItems: sorts by order, ties by id
- visibleCommands: "when-degraded-or-better" shown for degraded, hidden for unavailable
- visibleCommands: drops non-navigate actions in M2
- visibleDashboardCards: shown for ready + degraded, hidden for disabled/unavailable
- visibleDashboardCards: drops a card whose componentKey does not resolve
- featureSettingsRows: returns EVERY feature incl. disabled, with reasons
```

`tests/scheduler-exposures.test.ts`:

```text
- schedulerExposures.featureId === schedulerFeature.id
- every nav.iconKey resolves in the icon registry
- every dashboardCards.componentKey resolves in the component registry
- settingsPanel.componentKey resolves in the component registry
- every command action.type is "navigate" (M2 constraint)
```

`tests/api-features-exposures.test.ts` (optional but recommended):

```text
- GET /api/features: scheduler entry now carries nav + dashboardCards + settingsPanel
- response still leaks no function / schema / filesystem path (M1 regression guard)
```

Icon/component registries: a tiny test that `iconFor`/`cardComponentFor`
return the fallback / `null` for an unknown key (proves no throw).

All existing tests must still pass.

---

## 13. Acceptance script (Rex runs this before approving M3)

```text
Step 1 — Shell renders the registry.
  Start the app. With features.scheduler.enabled = true:
  - Sidebar shows a "Features" group with a "Scheduler" item.
  - ⌘K palette shows an "Open Scheduler" command under a Features group.
  - Mission Control shows a Scheduler status card.

Step 2 — Settings page.
  Open /settings. Verify the Features section lists Scheduler with a state
  badge ("ready"), its description, and (if rendered) the settings panel.
  Verify NO raw config value, file path, or schema text appears anywhere.

Step 3 — Scheduler page + page gate.
  Click the Scheduler nav item → /scheduler renders the read-only view.

Step 4 — Disable the scheduler.
  Set features.scheduler.enabled = false. Reload.
  - Sidebar "Scheduler" item gone; "Features" group empty/absent.
  - Palette "Open Scheduler" command gone.
  - Dashboard Scheduler card gone.
  - /settings still lists Scheduler, now badged "disabled" with a reason.
  - Navigating to /scheduler directly → 404 (page gate fires).

Step 5 — Re-enable; confirm everything returns.

Step 6 — The exit-criteria proof.
  Confirm that Steps 1–5 required editing ONLY exposures.ts + the registries
  — Sidebar/CommandPalette/page.tsx contain no Scheduler-specific code.

Step 7 — npm run typecheck && npm test  → all green.
Step 8 — npm run build  → succeeds (then `git checkout -- next-env.d.ts`).
```

---

## 14. PR breakdown (suggested)

```text
PR 1 — Shell data plumbing
  shellSelectors.ts, FeaturesProvider.tsx, iconRegistry.tsx,
  componentRegistry.tsx, Shell.tsx (resolve + provide).
  tests/shell-selectors.test.ts. No visible change yet.
  DoD: typecheck + tests green; shell still renders unchanged.

PR 2 — Sidebar + command palette consume exposures
  Sidebar.tsx, CommandPalette.tsx, scheduler/exposures.ts (nav + commands),
  scheduler/page.tsx, tests/scheduler-exposures.test.ts.
  DoD: acceptance steps 1 (sidebar/palette), 3, 4 (sidebar/palette) pass.

PR 3 — Dashboard cards + Settings page
  page.tsx (cards), settings/page.tsx, SchedulerStatusCard,
  SchedulerSettingsPanel, scheduler/exposures.ts (dashboardCards +
  settingsPanel), api-features-exposures.test.ts.
  DoD: full acceptance script passes.
```

One combined PR is acceptable if Claude Code prefers — the breakdown is a
suggestion.

---

## 15. Done definition

M2 is **DONE** when:

```text
✓ Sidebar, command palette, dashboard all render Scheduler from exposures.
✓ /settings lists every feature read-only with state + reasons, no leaks.
✓ /scheduler page exists and is gated by requireFeatureReady.
✓ Disabled / not-ready features filtered per their visibility rule.
✓ Adding a feature nav item needs only exposures.ts + registry entries
  (exit-criteria proof — acceptance step 6).
✓ npm run typecheck, npm test, npm run build all pass; no regression.
✓ End-of-milestone doc sync: ARCHITECTURE / relevant ADR updated for the
  shell-consumption pattern (icon + component registries, FeaturesProvider).
✓ Rex signs off via "M2 verified, proceed to M3".
```

---

## 16. Open questions for Rex (decide before M2 starts, or accept defaults)

1. **Feature data delivery.** Server-resolve in `Shell.tsx` + React context
   (locked default, §5), or client `fetch("/api/features")` in each
   consumer? Default: server-resolve + context.

2. **Sidebar placement of feature nav.** New "Features" group after Self
   (default), or fold feature items into an existing group? Default: new
   "Features" group.

3. **Build the minimal Scheduler page in M2?** Default: yes — a nav `href`
   needs a real route and it exercises M1's page gate. Alternative: defer
   the page and have Scheduler expose no `nav` until then (weakens the M2
   proof). Default: build it.

4. **Dashboard card placement.** Feature cards below the agent portal cards
   (default), or a dedicated row above Self? Default: below agent portals.

5. **`canDisable` in the projection.** The settings page wants to show
   whether a feature *can* be disabled, but `UiSafeFeature` does not carry
   `lifecycle.canDisable` today. Options: (a) add `canDisable: boolean` to
   the M1 projection allowlist — small, safe, one-line; (b) omit the
   affordance in M2's read-only settings. Default: (a) — extend the
   projection by one boolean field (no editing logic, just display).

6. **Settings left rail.** Render only "Features" and omit the other v8
   §8.2 sections, or show them greyed-out "coming soon"? Default: show
   Connectors/Permissions/Vault/Advanced greyed-out as disabled rail items
   so the layout is final and M4a+ just fills them in.

If Rex skips these, the defaults apply.

---

**End of M2 task spec (v1).** M2 shipped (PR #12, merge `0ae4070`); M3 task
spec was generated (`m3-task-spec.md` v2) and M3 also shipped (PRs #14–#17).
M4a followed (6 sub-PRs #18–#23, closeout PR #26). The M4a-5 spec
(`m4a-5-task-spec.md` v1.2) is the next parked design.
