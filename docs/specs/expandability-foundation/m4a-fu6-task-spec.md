# M4a-FU6 Task Spec — UI Design System & Pattern Library (v1)

**Date:** 2026-05-24
**Version:** v1 — open questions O1–O12 pinned per Rex (2026-05-24); CW/Jarvis amendments folded in (token contradiction fix, scope tightening of PR A and PR C, token-sanity rules, `/dev/ui` mock-data-only rule, reduced-motion documentation). Markdown formatting cleaned up.
**Milestone:** M4a-FU6 — UI design system and pattern library (issue #37). Companion to M4a-FU5 (issue #36 — closed 2026-05-24); precedes any UI-heavy M4a-6a / M4a-6b work.
**Status:** **DESIGN ACCEPTED v1 — implementation-ready.** v1 accepted by Rex 2026-05-24; spec promoted to the repo via this spec-only PR (no code change). No code yet — FU6 **PR A** (additive `/dev/ui` skeleton + first-draft `docs/UI-GUIDELINES.md` + route smoke test; no existing component refactor) is the next gate AWAITING explicit green-light. Promotes to **CODE COMPLETE** only when all four PRs (A / B / C / D) merge and live acceptance per `docs/M4AFU6-ACCEPTANCE.md` passes.
**Parent design:** Issue #37 body + two clarification comments (round 1: whole-app inventory scope; round 2: 8 tightening points). v0 of this spec produced the first inventory + state matrix.
**Predecessor milestone:** M4a-FU5 — CODE COMPLETE 2026-05-24. Shipped the `connector_health` projection, fingerprint-gated hydration, and the rewritten `M4A5-ACCEPTANCE.md` Step 8. FU6 inventories the live UI that emerged from M4a / M4a-5 / FU5 and codifies it so M4a-6a / FU4 (#35) / future statusful surfaces build against one source of truth.
**Successor work:** **M4a-6a** (provider catalog UI; gated on green-light AFTER FU6 lands), FU4 / #35 (connector row management modal; consumes FU6 patterns), M4a-6b (UI-managed connector secrets; builds the real `SecretField` on top of FU6's preview placeholder).
**Goal:** Land an internal live visual reference of every reusable UI pattern Agentic OS currently uses (the `/dev/ui` page) and a written rules companion (`docs/UI-GUIDELINES.md`) that codifies the patterns, tokens, and non-leak posture. A contributor adding a new UI surface can see what the canonical shape looks like and copy from one place instead of re-inventing button styles, color mappings, focus behaviour, or success-flow UX. M4a-6a UI work shipping AFTER FU6 has a documented base to reference; the "every commit subtly reinvents the design" regression that bit M4a-5 PRs #33 and #34 does not recur.

## v0 → v1 changes (folded in)

- **Token contradiction fixed** — existing `--status-unknown` remains the Mission Control grey; connector-test "unknown" gets its own token `--status-test-unknown` (yellow). No silent recoloring of Vitals / AgentPortal. See §5.2.
- **O1–O12 pinned** — see §0.
- **PR A scope tightened** — additive skeleton only. No existing component/token refactor in PR A unless absolutely required to render the page. Token swap (the risky bit) is isolated in PR C. See §11.
- **PR C scope tightened** — color-token replacement only. No logic changes, no layout changes, no component-shape/API changes, no file moves, no "while we are here" refactors. Only components with inline color drift in **3+ sites** OR explicitly required by M4a-6a. Anything else becomes a follow-up issue. See §11.
- **Token sanity** — semantic vs visual mapping documented; `--status-valid` aliased to `--status-live` only with a written rationale; trust tokens conceptually separate from status tokens. See §5.4.
- **`/dev/ui` data safety** — mock/demo data only; no live provider data, no secrets, no env var values, no baseUrl values, no raw fetch errors. See §9 and §3.4.
- **Reduced-motion** — `prefers-reduced-motion: reduce` downgrade is documented per category AND demonstrated on `/dev/ui`. See §4.13.
- **O10 lightweight enforcement** — no PR template exists, so the reviewer checklist lives as a section in `docs/UI-GUIDELINES.md` rather than as a new template file. No heavy process.
- **Formatting** — Markdown cleaned up: prose paragraphs no longer hard-wrapped; tables for state matrices; bullets where they read better than wrapped paragraphs.

## Out of scope (carried verbatim)

- A full visual redesign of any existing surface.
- Tailwind plugin authoring or theme system overhaul.
- Production-grade accessibility audit (basic keyboard + ARIA conformance only; deeper a11y work is a separate milestone).
- Translation / i18n.
- Storybook or external pattern-library tooling — the internal `/dev/ui` page is enough.
- **Secret workflows.** The real `SecretField` (M4a-6b) is NOT in this spec. FU6's API-key / password field examples are PREVIEW ONLY: a single fake-placeholder example with the caption "preview only — full implementation belongs to M4a-6b."

---

## 0. Locked decisions (pinned open questions)

All twelve questions from v0 §13 are now pinned. The defaults shipped were broadly Rex's preference; the explicit pins lock them.

| # | Question | Decision |
|---|---|---|
| O1 | Route | **`/dev/ui` locked.** No alternatives. |
| O2 | Sidebar visibility | **Do NOT show `/dev/ui` in operator sidebar.** Reachable by URL only. |
| O3 | `--status-unknown` naming | **Default A, implemented correctly.** Keep existing `--status-unknown` grey (Mission Control / Vitals / AgentPortal). Add new `--status-test-unknown` (yellow) for connector-test "unknown" outcomes. Document the semantic difference (§5.2). |
| O4 | Inline-hex extraction threshold | **3+ sites OR explicitly required by M4a-6a.** See §5.3. |
| O5 | `/dev/ui` gated in production builds? | **Always reachable; not linked in operator sidebar.** Same default as O2. |
| O6 | Acceptance doc location | **Separate `docs/M4AFU6-ACCEPTANCE.md`.** See §12. |
| O7 | ADR | **No full ADR.** Closeout adds a short paragraph to `docs/ARCHITECTURE.md` stating that `docs/UI-GUIDELINES.md` + `/dev/ui` are the source of truth for UI consistency. See §10. |
| O8 | `useAgentAccent(name)` helper | **Deferred.** Pattern documented in `/dev/ui`; helper extraction is a future hardening item. |
| O9 | PR shape | **4 PRs** (A / B / C / D) as in §11. |
| O10 | Lightweight enforcement | **YES.** No PR template currently exists in the repo, so the reviewer checklist lives as a section in `docs/UI-GUIDELINES.md`. Do NOT create a heavy `PULL_REQUEST_TEMPLATE.md` file. See §9.4. |
| O11 | ESLint rule for inline colors | **No automated lint in FU6.** Reviewer-with-link is the v0 enforcement mechanism. ESLint rule is a future hardening candidate. |
| O12 | FU5 doc-drift leftovers | **None.** FU5 PR C (#41) absorbed the two text-alignment items (`test_started_at` sourcing rule + `hashAuthRefIdentity` example). Restated for completeness. |

---

## 1. Scope

### 1.1 In scope

| Artefact | Acceptance |
|---|---|
| **`/dev/ui` route** | Next.js app route under `src/app/dev/ui/page.tsx`. Internal/dev visual reference. NOT linked from the operator sidebar. Reachable at `http://127.0.0.1:3000/dev/ui` on a running dev server; renders all categories in §4 as LIVE React components (not screenshots, not markdown descriptions). |
| **`docs/UI-GUIDELINES.md`** | Written rules companion. Sections per §3.3. Cross-links to `/dev/ui` per component category. Carries the locked rules (§5.6), the non-leak rule (§9), and the reviewer checklist (§9.4). |
| **Status / trust color tokens** | Extend `:root` in `src/app/globals.css` with the new tokens listed in §5.2. Existing tokens unchanged. **No silent recoloring** of Mission Control / Vitals / AgentPortal "unknown" states. |
| **M4a-6a spec cross-reference** | `docs/specs/expandability-foundation/m4a-6-task-spec.md` (M4a-6a section) gains a reference to `docs/UI-GUIDELINES.md` as the source of truth for new UI work. Lands in FU6 PR D or in an M4a-6a spec amendment PR — whichever ships first. |
| **`docs/ARCHITECTURE.md` paragraph** | Short paragraph (per O7) stating that `docs/UI-GUIDELINES.md` + `/dev/ui` are the source of truth for UI consistency. Ships in FU6 PR D. |

### 1.2 Out of scope (explicit)

- **Full app refactor.** Existing components stay where they are. FU6 is additive. Two carve-outs (§5.3): mechanical token extraction when a hex appears in **3+ places**, and refactors a real M4a-6a consumer demands. Speculative "this might look nicer" refactors are rejected.
- **Visual redesign.** No new palette, font swap, or card-shape revision unless drift is documented and the carve-out applies.
- **Storybook / external pattern-library tooling.** Internal `/dev/ui` is sufficient.
- **i18n / RTL.** Single-language UI; right-to-left support is a future milestone.
- **Production-grade accessibility audit.** Basic keyboard navigation + ARIA on interactive primitives only.
- **Tailwind plugin authoring / theme system overhaul.**
- **The real `SecretField`** (M4a-6b scope). FU6 ships a preview-only fake-placeholder field with an explicit "preview only — M4a-6b" caption.
- **Component runtime tests.** FU6 ships visual reference + written rules. Runtime contracts (e.g. `StatusPill` doesn't echo a secret) are already enforced by M4a-5 + FU5 tests.
- **Operator-facing nav changes.** `/dev/ui` is unadvertised.
- **A heavyweight PR template** (per O10). Reviewer checklist lives in `UI-GUIDELINES.md`.

---

## 2. User stories

- **US-1 — A contributor adding a new UI surface.** "I need a status pill on this new card. Where's the canonical one?" Opens `/dev/ui`, sees the `StatusPill` example with its state matrix, copies the example code, references the token names. Doesn't invent a new pill style.
- **US-2 — A reviewer catching drift.** "This PR is adding `bg-red-500` inline." Points at `docs/UI-GUIDELINES.md`'s rule on canonical status tokens. The reviewer is armed with one place to point at instead of memorising the rules.
- **US-3 — Rex evaluating drift between releases.** "M4a-5 PRs #33 and #34 cleaned up duplicate-status, three-close-buttons, and the missing post-add UX. How do I prevent that from recurring?" Walks `/dev/ui`, sees that all the recovered patterns now live in one place. Future PRs review against the rules. The cleanup is durable.
- **US-4 — M4a-6a UI work landing.** "The provider catalog needs cards in a grid. What does a ProviderCard look like?" `/dev/ui` shows a card example in the relevant category; the M4a-6a spec already references `docs/UI-GUIDELINES.md`. M4a-6a's PR doesn't reinvent the card shape from scratch.
- **US-5 — M4a-6b building the real `SecretField`.** "FU6 had a preview-only API-key field. What were the focus / ARIA / visual states it expected?" `/dev/ui` shows the preview-only field with its state matrix. M4a-6b implements the real `SecretField` against the same shape, with the secret store plumbing on top.

---

## 3. Design decision

### 3.1 Two artefacts ship together

Three locks from the issue body + clarifications, restated:

1. **`/dev/ui` ships live React renders.** Markdown screenshots and prose descriptions are not enough. A contributor must be able to inspect element, copy the JSX, and see the live focus / hover / disabled state by tabbing through the page.
2. **`docs/UI-GUIDELINES.md` ships the written rules.** Living text the reviewer can quote. Cross-links to `/dev/ui` per category so the rules and the examples never drift apart.
3. **M4a-6a references `docs/UI-GUIDELINES.md`.** Without this, FU6 is a stranded artefact. M4a-6a is the first real downstream consumer; codifying that dependency makes FU6 land "for a reason."

### 3.2 Route + file layout

Route locked at `/dev/ui` (O1).

```
src/app/dev/ui/page.tsx       — the live reference page
src/app/dev/_lib/             — small helpers used by /dev/ui ONLY
                                (e.g. a <StateRow> wrapper that
                                renders a component once per state)
```

`/dev/ui` is reachable by typing the URL. It is **not linked from the operator sidebar** (O2 / O5). The URL is unadvertised in the operator UI. A future hardening item: gate `/dev/ui` behind a `DEV_UI_ENABLED` env var or `NODE_ENV !== "production"` if a shipped build ever needs to hide it.

The page imports production components from their source paths **where exported and safe** (e.g. `src/components/Pill.tsx`, default export, server-component-safe; sections doing this are labelled `kind="import"`). For components that are inline-only in production — most of the surface — the page **may hand-mirror the inline production shape** rather than refactor the production file to export it. The inline-only set includes `ConnectorsPanel.StatusPill` / `ConnectorRow` / `ValidationDetail`, `AddProviderFlow.Field` and the modal pieces, `Sidebar.NavLink` + `AgentAvatar` (client component / framer-motion), `Vitals.Tile`, `SelfCard`'s framer-motion shell, etc. Refactoring those production files to export their internals is out of scope for any FU6 PR (hard limit: "no existing component refactors") and would violate that limit; hand-mirroring keeps `/dev/ui` server-rendered and inside the PR scope. Sections doing this are labelled `kind="hand-mirror"`.

**After the visual-polish amend (PR B amend, 2026-05-25), `/dev/ui` defines the canonical visual target** for buttons, badges, sidebar items, settings rail items, and modal headers. Production may lag behind the canonical target until later scoped alignment PRs land. The `kind="target"` label marks sections where production has NOT yet implemented the canonical shape — these are not bugs in the demo; they are deliberate forward references. **PR C in the FU6 sequence stays narrowly scoped to color-token replacement only** (porting inline hex in existing production components to reference the new `--status-*` / `--trust-*` tokens). PR C is NOT full component-shape alignment. Bringing production button shells, modal headers, sidebar treatment, and so on into line with `/dev/ui` is the job of future scoped alignment PRs (some may ride along with M4a-6a for the consumers it touches; others will be standalone alignment passes).

For sections that need fixture inputs (e.g. a `ConnectorRow`), the page passes deterministic local mock props (§3.4) rather than spinning up the kernel. No section calls a live API route.

### 3.3 `docs/UI-GUIDELINES.md` shape

Sections:

1. **Why this file exists** — the M4a-5 PR #33/#34 regressions + the issue #37 body, distilled.
2. **Token catalog** — every CSS custom property with the rule for when to use it (§5).
3. **Rules — must / must-not** — the locked list from §5.6.
4. **UI non-leak rule** — verbatim from §9.
5. **Component index** — one short paragraph per component category with a link back to the relevant `/dev/ui` anchor.
6. **Successful-create-flow rule (softened)** — the auto-close + highlight pattern from PR #34, with the explicit carve-out for copy / download / one-time-confirmation cases.
7. **Reviewer checklist** (O10) — see §9.4.
8. **Out of scope** — what FU6 does NOT promise (i18n, a11y audit, etc.).

### 3.4 `/dev/ui` data safety — mock data only

`/dev/ui` MUST use mock/demo data only. The page does not call `/api/connectors`, `/api/runs`, `/api/scheduler/status`, or any other live route. Concretely:

- No live provider data.
- No real secrets, real env var values, or real env var NAMES.
- No real baseUrl values from operator config (use the deterministic fake `https://example.test/v1` instead).
- No raw fetch error strings.
- No raw stack traces.
- No raw provider response bodies.

API-key / password example fields are preview-only fake placeholders (e.g. the input value displays `••••••••` and changes to it are a no-op). The caption reads exactly: "preview only — full implementation belongs to M4a-6b."

The fixture strings used (e.g. `"openai-live"`, `"hermes"`) are illustrative-only and do not need to match any real operator config. The page header carries the line "Design-system reference — NOT an operator surface" so an operator stumbling on the URL is not confused.

### 3.5 Why not Storybook

- **Tooling overhead.** Storybook is a build dependency, a runtime dependency, and a separate config surface. The whole point of FU6 is reducing drift, not adding a tool to maintain.
- **Already have Next.js + React.** A page at `/dev/ui` uses the same React the rest of the app uses. No new runtime, no new bundler quirk, no separate `npm run storybook`.
- **External libraries solve the wrong problem.** Storybook's value is for component teams shipping a library to many consumers. Agentic OS ships one app; the consumers are its own code paths.
- **Operator surface stays clean.** `/dev/ui` is an unadvertised internal URL; no operator-facing chrome leaks in.

If a future consumer (a docs site, an external pattern-library publish) demands Storybook, FU6 has already produced the component inventory + state matrix that would feed it; migration would be mechanical.

### 3.6 What FU6 does NOT change in existing code

- **No changes to component APIs unless M4a-6a demands them.** `StatusPill`, `ConnectorRow`, `Sidebar` all keep their props.
- **No file moves unless drift extraction demands them.** A component currently in `src/app/settings/_connectors/` stays there. If M4a-6a needs to share it with the provider catalog, the move happens in M4a-6a's PR with the FU6 guideline as the justification.
- **No new lint rules.** ESLint rules to ban inline status colors are a future hardening track (O11).

---

## 4. Component inventory + state matrix

`/dev/ui` is structured as one section per category below. Each section renders the canonical component once per state, labels the state above each render, and is anchored so `docs/UI-GUIDELINES.md` can link to it.

### 4.1 Sidebar navigation items

**File of record:** `src/components/Sidebar.tsx`.

| State | Description |
|---|---|
| default | Idle nav item, no interaction |
| hover | Cursor over the item (foreground intensifies; subtle bg shift) |
| selected / active | Current route — visible distinct from hover |
| disabled | "Soon" / feature-flag-gated nav items |
| with icon | Icon color, glow, alignment |
| group label | Sub-header inside the sidebar (e.g. "Operator", "Self") |
| footer / version | Sidebar footer (version pill, build tag) |

**Tokens used:** `--fg` for the active label, `--fg-dim` for idle, `--fg-dimmer` for group labels; `--panel` for the sidebar surface; `--panel-border` / `--panel-border-hot` for separators; per-agent accents (`--accent-*`) when a nav item represents an agent.

**Rules:**

- The selected state must be visually distinct from hover — the operator can tell which route is active without moving the mouse.
- Group labels are not interactive (no hover effect).
- The sidebar footer carries the version string and nothing else (settled per the UI shell decisions).

### 4.2 Mission Control top status cards

**File of record:** `src/components/Vitals.tsx` and the cards on `src/app/page.tsx`.

| State | Description |
|---|---|
| live | Service is up; green dot |
| busy | A run is in progress; cyan |
| degraded | Partial outage; amber |
| offline | Down or unreachable; rose/red |
| unknown | No data; **muted grey** (uses existing `--status-unknown`) |
| info-only card | A card that does not track a live signal |

**Tokens used:** `--status-live`, `--status-busy`, `--status-degraded`, `--status-offline`, `--status-unknown` (all already in `globals.css`); `--shadow-glow` for the soft halo around live cards.

**Rules:**

- A status dot is the first element in the card's right-side column. The text label is secondary (subtle, lowercase tracking).
- Glow color references `currentColor` so the dot color flows through.
- A card without a live signal renders the `unknown` (grey) state, NOT empty.

### 4.3 Agent cards

**File of record:** `src/components/AgentPortal.tsx`, `src/components/AgentRoom.tsx`, `src/app/agents/page.tsx`.

| State | Description |
|---|---|
| normal | Idle agent card, hover-eligible |
| hover | Cursor over the card; subtle lift |
| online | Agent process/connector up |
| offline | Agent down |
| degraded | Agent reachable but with warnings |
| action affordance arrow | The right-arrow / "open" cue |
| metric boxes | Memory / CPU / token-spend boxes |
| progress / memory bars | The `HermesMemoryBars` family |

**Tokens used:** per-agent accents (`--accent-claude-code`, `--accent-hermes`, `--accent-openclaw`, etc.); status dot colors from §4.2.

**Rules:**

- Agent name and accent color must be paired everywhere (sidebar, card, room). A future `useAgentAccent(name)` helper can centralise the hash-mapped fallback (deferred per O8).
- Hover lifts the card by ~1px and raises border opacity (`--border` → `--border-hot`). No color shift that would conflict with status colors.

### 4.4 Feature dashboard cards

**File of record:** `src/app/page.tsx` and any feature-card components.

| State | Description |
|---|---|
| Scheduler card | The big-card pattern with status dot, label, sub-label |
| compact feature card | The narrower card variant on dashboard pages |
| status dot inside card | Uses the same `--status-*` mapping as Mission Control |
| disabled feature card | `gateFeatureApi` reports the feature off |

**Rules:**

- Feature cards use the same `--status-*` tokens as Mission Control. No parallel "feature-status" token set.
- A disabled feature card carries the "soon" label and dims to `--fg-dimmer`. It does NOT use the offline color — disabled is not a failure state.

### 4.5 Self cards

**File of record:** `src/components/SelfCard.tsx`, `src/app/{goals,journal,memory}/page.tsx`.

| State | Description |
|---|---|
| Goals card | The Goals dashboard surface |
| Journal card | The Journal surface |
| Memory card | The Memory surface |
| icon glow | The card's icon with its accent halo |
| hover | Mouse-over |
| action affordance | The implicit "open this surface" cue |

**Rules:**

- Self cards share the agent-card hover lift behaviour (§4.3).
- The Self icon is in the same position across all three (top-left), with a consistent accent treatment.

### 4.6 Settings layout

**File of record:** `src/app/settings/page.tsx`.

| State | Description |
|---|---|
| Left-rail section — idle | Each tab in the settings sidebar |
| Left-rail section — active | Current section |
| Soon / disabled section | Locked behind a feature flag |
| Section panel — cards inside | E.g. `ConnectorsPanel`, `FeaturesPanel` |
| Section selected via URL | `?section=connectors` per PR #34 |

**Rules:**

- Section state is persisted in `?section=…` (PR #34). Refresh preserves the section. Tab clicks use `router.replace` so the back button is not polluted.
- Soon / disabled tabs are dimmed AND non-clickable. A tooltip on hover explains why.

### 4.7 Connector rows

**File of record:** `src/app/settings/_connectors/ConnectorsPanel.tsx` (`ConnectorRow`, `StatusPill`, `ValidationDetail`).

| State | Description |
|---|---|
| normal | Idle row with valid connector |
| highlighted | The 3-second emerald ring + pulse on a fresh add (PR #34) — downgrades to a static ring under `prefers-reduced-motion: reduce` |
| selected | Placeholder — no select mode in M4a-5; reserved for FU4 (#35) |
| valid | Right-side pill green; no below-row detail |
| invalid | Pill red; below-row `errorCode <code>` |
| unreachable | Pill red; below-row `errorCode <code>` |
| misconfigured | Pill red; below-row `errorCode <code>` + `auth-missing` hint |
| unknown | Pill yellow (`--status-test-unknown`); below-row `errorCode <code>` |
| not tested | Pill dimmed text "not tested"; no dot, no below-row detail |
| loading / Testing… | Test button label flips to "Testing…" |
| with row actions | Test button visible; future edit/delete buttons reserved for FU4 |

**Rules:**

- The right-side `StatusPill` is the at-a-glance source of truth.
- `ValidationDetail` renders only for non-valid outcomes (PR #34 — no duplicate "valid" badges).
- Trust badges and status badges are different concepts (§4.9).
- The highlighted state respects `prefers-reduced-motion: reduce` (§4.13).

### 4.8 Status pills

**File of record:** `src/components/Pill.tsx` and the inline `StatusPill` in `ConnectorsPanel.tsx`.

There are TWO families of status pills, sourced from different token groups (see §5.2 for why):

| Pill family | State | Token | Purpose |
|---|---|---|---|
| Mission Control / Vitals | live | `--status-live` | Service is up |
| Mission Control / Vitals | busy | `--status-busy` | A run is in progress |
| Mission Control / Vitals | degraded | `--status-degraded` | Partial outage |
| Mission Control / Vitals | offline | `--status-offline` | Down |
| Mission Control / Vitals | unknown | `--status-unknown` (grey) | No data |
| Connector test | valid | `--status-valid` (= `--status-live` alias today) | Test passed |
| Connector test | invalid | `--status-invalid` | Test failed |
| Connector test | unreachable | `--status-unreachable` (= `--status-invalid` alias today) | Network/DNS failure |
| Connector test | misconfigured | `--status-misconfigured` (= `--status-invalid` alias today) | Pre-test config error |
| Connector test | unknown | `--status-test-unknown` (yellow) | Test inconclusive |
| Connector test | not tested | `--status-not-tested` (= `--fg-dimmer` alias) | Pre-test, fingerprint mismatch, or session-fresh row |
| Connector test | loading | neutral grey with subtle pulse | Mid-test |
| Connector test | warning | `--status-degraded` (amber) | Non-failure caution |

The aliasing is intentional and bounded — see §5.4 token sanity for the rationale.

**Rules:**

- Use status tokens by name, not inline hex. Carve-out per §5.3: inline hex stays when it appears in 1–2 places; extracted when 3+ OR when M4a-6a requires it.
- Mission Control's "unknown" and connector-test "unknown" are **semantically different** and use different tokens. Do not merge.

### 4.9 Trust badges

**File of record:** `src/app/settings/_connectors/ConnectorsPanel.tsx` (`TRUST_COLORS`).

| State | Token |
|---|---|
| first-party | `--trust-first-party` |
| community | `--trust-community` |
| untrusted | `--trust-untrusted` |
| unknown | `--trust-unknown` |

**Rules:**

- Trust badges live in the row's LEFT column (next to the connectorId).
- Trust is **provenance**, NOT test outcome. Trust tokens (`--trust-*`) are conceptually separate from status tokens (`--status-*`) — even if some hex values overlap today (§5.4).
- Trust mapping is downward-only (ADR-0018 preset trust clamp). No UI promotes trust upward.

### 4.10 Form fields

**File of record:** `AddProviderFlow.tsx` and future FU4 (#35) row management modal.

| State | Description |
|---|---|
| text input — idle | Default |
| text input — focused | Visible focus ring / outline |
| text input — disabled | Greyed; `aria-disabled` |
| env var NAME input | Carries the AUTHREF regex `pattern` attribute |
| API key / password input (preview only) | Single fake-placeholder example with "preview only — M4a-6b" caption. **No real `SecretField`.** Value renders as `••••••••`; onChange is a no-op. |
| checkbox | idle / checked / focused tri-state |
| textarea | E.g. notes / description fields |
| help text below input | `--fg-dimmer`, small caps |
| error text below input | Red-tinted; neutral message (see §9) |
| validation error inline | The `discoveryMessageFor(errorClass)` pattern from PR #30 |

**Rules:**

- The env var NAME field is the canonical pattern for capturing credential references. The pattern attribute is `^[A-Za-z_][A-Za-z0-9_]*$`.
- The API-key field on `/dev/ui` is preview-only. M4a-6b ships the real `SecretField`.
- Error messages route through a neutral-message map (`discoveryMessageFor` is the canonical example). Never the raw fetch error / raw provider response / raw stack trace.

### 4.11 Modals

**File of record:** `AddProviderFlow.tsx` (the canonical example).

| State | Description |
|---|---|
| header Close button (top-right) | Always present; Escape equivalent |
| ← Back affordance (top-left) | When the modal is mid-flow |
| primary action button (footer) | "Add", "Save", … — one per modal |
| secondary action (footer, optional) | Limited use; document why each appearance exists |
| modal body — loading | Skeleton state |
| modal body — error | Neutral inline error |
| success flow | Auto-close + list-highlight (PR #34) |
| success with carve-out | Copy / download / one-time-confirmation cases (round-2 #7) |

**Rules:**

- Close exits the modal; ← Back moves one step back. Do not duplicate. PR #33 dropped a redundant Cancel button for this reason.
- Successful create flows auto-close and highlight the new row in the list, **unless the success requires user action** (copy a generated value, download a file, confirm a one-time visible value — e.g. M4a-6b's "your API key is now stored; you will not see it again"). Each use of the carve-out must be documented.
- No "Added <id>" intermediate screen (PR #34 removed it).
- Focus returns to the trigger after close (PR #34's `onModelBlur` defer pattern is the prior art).
- Escape closes the modal. Escape inside a sub-picker (e.g. `ModelPicker`) closes the picker only, not the modal — PR #30 / #34's propagation-stop is the canonical pattern.

### 4.12 Loading / skeleton states

**Examples on `/dev/ui`:**

- Model picker "Loading…" state (the Load-models button mid-flight).
- Connector-test "Testing…" state on the row's Test button.
- AddProviderFlow modal-open / preset-load skeleton.
- A generic card skeleton (placeholder for future use).

**Rules:**

- Skeletons use a subtle pulse (`opacity 0.5 → 1 → 0.5`) at 1.5s cadence.
- Loading text labels read "Loading…" / "Testing…" / "Saving…" — consistent verb-ing. No "Please wait."
- Loading respects `prefers-reduced-motion: reduce` (downgrade pulse → static dimming; §4.13).
- Disabled-while-loading: the action that triggered the load becomes disabled until completion (per PR #30's Load-models button).

### 4.13 Interaction states (cross-cutting)

Every interactive primitive (button, link, row, input, tab, nav item) must render correctly in:

| State | Description / token |
|---|---|
| default | Idle |
| hover | Mouse-over; opacity bump and/or border shift |
| focus | Keyboard ring — visible, AA-contrast on the bg |
| selected / current | E.g. active nav item, current tab |
| disabled | Greyed; non-clickable; `aria-disabled` |
| loading | "—ing" verb; trigger disabled |
| error | Neutral inline error message (see §9) |
| success | Brief positive feedback (toast OR row highlight OR auto-close-with-highlight) |
| reduced-motion | `prefers-reduced-motion: reduce` downgrades pulses / lifts / fade transitions to static color/opacity changes |

**Reduced-motion handling (per category):**

- **Connector row highlight (PR #34's emerald ring + pulse):** downgrade to a static border-color highlight for the same 3-second window. The operator still locates the row visually; no animated pulse. Canonical demonstration on `/dev/ui`.
- **Loading skeletons:** downgrade pulse → static dimming.
- **Modal entry/exit:** downgrade transitions to instant show/hide.
- **Card hover lift:** keep (the lift is a discrete 1px transform on hover, not a continuous animation; harmless under reduced motion).
- **Status dot glow:** keep static; the glow is not animated.

`/dev/ui` MUST demonstrate the reduced-motion downgrade for the pulse / highlight states. The page includes a top-of-page note: "Toggle `prefers-reduced-motion: reduce` in browser devtools (Rendering panel) to verify the downgrades."

### 4.14 Successful create → auto-close + highlight pattern

PR #34's pattern, summarised:

1. Successful submit → modal closes.
2. List refresh — server re-fetched immediately.
3. The new row gets a 3-second highlight (ring + animate-pulse).
4. After 3 seconds the highlight clears automatically.
5. Operator does not need to dismiss anything.
6. Reduced-motion downgrade: ring is static (no pulse) for the 3-second window.
7. **Carve-out (round-2 #7):** if the success requires user action (copy a value, download a file, confirm one-time visibility — e.g. M4a-6b's secret store), the modal stays open at a confirmation step with the explicit action.

---

## 5. Tokens + rules

### 5.1 Existing tokens (no change)

Already in `src/app/globals.css`:

- **Surfaces:** `--bg`, `--bg-elevated`, `--bg-elevated-hot`
- **Borders:** `--border`, `--border-hot`
- **Text:** `--fg`, `--fg-dim`, `--fg-dimmer`
- **Mission Control status:** `--status-live`, `--status-busy`, `--status-degraded`, `--status-offline`, `--status-unknown` (grey — for Mission Control / Vitals / AgentPortal)
- **Per-agent accents:** `--accent-claude-code`, `--accent-hermes`, `--accent-openclaw`, `--accent-chatgpt`, `--accent-openrouter`, `--accent-default`
- **Glass panels:** `--panel`, `--panel-border`, `--panel-border-hot`
- **Misc:** `--radius`, `--shadow-glow`

**No deletions. No silent semantics change.** `--status-unknown` REMAINS the Mission Control grey. The token contradiction surfaced in v0 is fixed in §5.2.

### 5.2 Tokens to add (FU6 NEW)

Connector-test discriminant gets its own family. The `--status-test-*` prefix marks "connector-test outcome" semantically distinct from Mission Control's `--status-*` family:

```css
:root {
  /* connector-test status — NEW. Distinct from --status-* (Mission Control)
     so the two families can evolve independently. v0 of this spec leaked
     the contradiction; v1 separates them cleanly. */

  --status-valid:           var(--status-live);   /* alias of #10b981 */
  --status-invalid:         #f87171;              /* slightly softer than --status-offline */
  --status-unreachable:     var(--status-invalid); /* alias — may diverge */
  --status-misconfigured:   var(--status-invalid); /* alias — may diverge */
  --status-test-unknown:    #fbbf24;              /* YELLOW. NOT to be confused with the
                                                     existing --status-unknown which stays GREY
                                                     for Mission Control / Vitals / AgentPortal. */
  --status-not-tested:      var(--fg-dimmer);     /* alias of #71717a */

  /* trust badges — PROVENANCE, NOT test outcome. Conceptually separate
     from --status-* even if some hex values overlap today (§5.4). */

  --trust-first-party:      #4ade80;
  --trust-community:        #fbbf24;
  --trust-untrusted:        #f87171;
  --trust-unknown:          #71717a;
}
```

**Semantic separation summary:**

| Family | Domain | Where used | "Unknown" token |
|---|---|---|---|
| `--status-*` (existing) | Mission Control service health | Vitals, AgentPortal, feature dashboard cards | `--status-unknown` (grey #71717a) |
| `--status-{valid,invalid,unreachable,misconfigured,test-unknown,not-tested}` (NEW) | Connector test outcome | `ConnectorsPanel.StatusPill`, `ValidationDetail` | `--status-test-unknown` (yellow #fbbf24) |
| `--trust-*` (NEW) | Connector provenance | Connector row left column | `--trust-unknown` (grey #71717a) |

The two "unknown" states have different visual treatments **because they mean different things**: Mission Control's `unknown` means "no signal" (silent grey); a connector-test `unknown` means "we tried and the result was inconclusive — operator may want to look" (warning yellow). v0's collision is gone.

### 5.3 Inline-hex extraction rules (drift discipline)

| Situation | Action |
|---|---|
| Hex appears in 1 place | Leave it. Optionally document near the source. |
| Hex appears in 2 places | Leave it. Document the duplication in a comment if it's intentional. |
| Hex appears in **3+ places** | Extract to a CSS custom property; replace all sites in PR C. |
| New component being authored | Use named tokens from the start. |
| M4a-6a consumer demands a refactor | Refactor in M4a-6a's PR, citing the FU6 rule that enabled it. |
| Inline `bg-red-*` / `text-green-*` / similar Tailwind utilities used for status meaning | Replace with `bg-[var(--status-invalid)]` (or matching token). Carve-out: pure layout colors (`bg-black/20` overlays, etc.) stay. |

The 3-site threshold is a deliberate raise from v0's "2+ sites" — Rex's call (O4). Two sites is plausibly coincidence; three sites is drift.

### 5.4 Token sanity — semantic vs visual mapping

Two distinct concepts are kept separate even when their colors happen to overlap:

- **Trust** = provenance. Where did this connector come from?
- **Status** = test outcome. What does the connector look like right now?

Some hex values overlap (`first-party` green and `valid` green are both `#4ade80` / `--status-live` shades; `untrusted` red and `invalid` red are similar). This is acceptable but EXPLICITLY documented:

- `--trust-first-party` is its own token, not an alias of `--status-valid`.
- `--trust-untrusted` is its own token, not an alias of `--status-invalid`.

**Why duplicate when the colors look the same?** Because the meanings are different and the colors may diverge later. A future redesign might make trust badges use a softer palette than status pills (e.g. trust = pastels, status = high-contrast). When that happens, the trust tokens can move independently without breaking status semantics, and vice versa.

**Aliasing within the status family is acceptable** when the spec calls it out:

- `--status-valid: var(--status-live)` — connector-test `valid` and Mission Control `live` both mean "everything is fine; green dot." Visual identity is intentional. Documented here.
- `--status-unreachable: var(--status-invalid)` — both currently mean "test failed." May diverge later (e.g. unreachable could become amber to signal "try again" while invalid stays red for "fix the config"). v1 keeps them aliased; the spec calls out the alias so future divergence is easy.
- `--status-misconfigured: var(--status-invalid)` — same rationale.
- `--status-not-tested: var(--fg-dimmer)` — alias for dimmed-text grey. The pill renders as text-only with no dot for this state.

**Rule:** every alias must be motivated in `docs/UI-GUIDELINES.md`. A bare `--status-foo: var(--status-bar)` line without a comment explaining why is a smell.

### 5.5 Spacing / radius / card / button patterns

**Cards:**

- Radius: `var(--radius)` (`10px`).
- Padding: 16px standard; 24px for the Mission Control hero card.
- Hover lift: 1px via `translate-y` + border-opacity shift (`--border` → `--border-hot`).
- Outer shadow: only when status = live (via `--shadow-glow`).

**Section spacing:**

- 24px between section headers.
- 12px between rows in a list.

**Buttons:**

| Variant | Description |
|---|---|
| primary | Filled, accent color, white text |
| secondary | Border-only, `--border-hot` on hover |
| danger | Filled, `--status-invalid` |
| ghost | Text-only with hover bg |
| icon-only | `aria-label` mandatory; consistent 24px hit target |
| disabled | `--fg-dimmer` text, no hover effect, `aria-disabled` |
| loading | "—ing" verb, disabled, optional spinner |

**Button rules:**

- Do not invent new button styles. Pick from the canonical set; if it does not fit, add to the canonical set before using it.
- Icon-only buttons MUST have an `aria-label`.
- Loading button shows the "—ing" verb; it does NOT morph into a spinner replacement.

### 5.6 Locked must / must-not

From the issue body, restated for the rules companion:

- **Do not invent new button styles.**
- **Do not show duplicate statuses in the same row** (PR #34).
- **Trust badges and status badges are different concepts.** Different positions, different color families (§5.4).
- **Static labels like ENABLED do not appear unless actionable or meaningful** (PR #34 removed ENABLED).
- **Close exits modal; ← Back moves one step back; do not duplicate** (PR #33).
- **Successful create flows auto-close and highlight, UNLESS the carve-out applies** (PR #34 + round-2 #7).
- **Refresh preserves current settings section / page state** (PR #34's `?section=…`).
- **Focus stays predictable after Escape, Enter, Tab, modal close** (PR #34's `onModelBlur` defer).
- **Use the same color / status mapping everywhere.** Mission Control uses `--status-*`; connector tests use `--status-{valid,invalid,unreachable,misconfigured,test-unknown,not-tested}`; trust uses `--trust-*`. Do NOT mix families.
- **Reuse existing components before creating new styles.** Search `/dev/ui` first; ask before adding a new variant.

---

## 6. File-level changes

### NEW files

```
src/app/dev/ui/page.tsx               — the live /dev/ui page
src/app/dev/_lib/StateRow.tsx         — optional: small wrapper that
                                        renders a component once per
                                        state with a label
docs/UI-GUIDELINES.md                 — written rules companion
docs/M4AFU6-ACCEPTANCE.md             — operator acceptance checklist
                                        (per O6; see §12)
tests/dev-ui-route.test.ts            — smoke test for /dev/ui (200 + mounts)
```

### MODIFIED files (PR C scope; bounded)

```
src/app/globals.css
  Add NEW tokens from §5.2 (--status-valid, --status-invalid,
  --status-unreachable, --status-misconfigured, --status-test-unknown,
  --status-not-tested, --trust-*). Existing tokens untouched.

src/app/settings/_connectors/ConnectorsPanel.tsx
  Replace inline hex in StatusPill + TRUST_COLORS with the new tokens.
  NO behaviour change, NO API change, NO file move.

src/components/Pill.tsx  (only if it carries inline status hex in 3+ places)
  Inline hex → tokens. Same scope discipline.
```

PR C MUST NOT touch any other file unless inline color drift in 3+ sites or M4a-6a explicitly requires it (§5.3).

### MODIFIED files (PR D — closeout)

```
docs/ROADMAP.md                                      — M4a-FU6 marked complete
docs/specs/expandability-foundation/README.md        — status row added
docs/specs/expandability-foundation/m4a-fu6-task-spec.md
                                                     — header DRAFT → CODE COMPLETE
docs/specs/expandability-foundation/m4a-6-task-spec.md
                                                     — M4a-6a section references
                                                       docs/UI-GUIDELINES.md
docs/ARCHITECTURE.md                                  — short paragraph (per O7) noting
                                                       UI-GUIDELINES.md + /dev/ui as the
                                                       UI source of truth
```

### NO changes (explicit)

- No new runtime dependencies (no Storybook, no headless-ui, no Radix).
- No changes to `tailwind.config.*`.
- No new test files for visual rendering.
- No new ADR (O7 — paragraph in `ARCHITECTURE.md` instead).
- No `PULL_REQUEST_TEMPLATE.md` file (O10 — reviewer checklist lives in `UI-GUIDELINES.md`).

---

## 7. Tests

### What FU6 CAN test

| Test | Coverage |
|---|---|
| `tests/dev-ui-route.test.ts` (NEW) | `/dev/ui` route returns 200 and renders without throwing. Smoke test only — proves the page imports + mounts. No assertion on visual output. |

### What FU6 explicitly does NOT test

- **Visual regression** — no screenshot diffing. The repo does not currently carry a visual-regression toolchain.
- **Token correctness at runtime** — tokens are CSS custom properties; testing them would require a JSDOM that resolves `:root` declarations. Manual `/dev/ui` walkthrough is the verification.
- **Component-state coverage** — the state matrix is a doc / walkthrough artefact, not a test artefact. Reviewer walks `/dev/ui` against §4.
- **A11y conformance certification** — basic keyboard + ARIA conformance checked manually; deeper audit deferred.

### Test isolation

The new `/dev/ui` route smoke test inherits the FU5 PR A kernel test-isolation guard (`src/kernel/state/db.ts::assertNotRealDbInTests`). The route does not touch `state.db`, but the guard fires defensively if the import graph ever resolves a state-DB singleton against the default path.

---

## 8. Migration / compatibility

| Concern | Behaviour |
|---|---|
| Existing operator UI surfaces | UNCHANGED. ConnectorsPanel / Sidebar / Mission Control keep their props and behaviour. Token swap in PR C is purely under-the-hood. |
| Operators running an older build | Not applicable. FU6 ships no DB migration, no API change, no config-schema change. |
| Operators landing FU6 mid-session | CSS hot-reloads. No restart required. |
| M4a-6a / M4a-6b authors | Build against `docs/UI-GUIDELINES.md` and `/dev/ui`. Existing component APIs stable; new components extracted by M4a-6a's needs follow the FU6 token discipline. |
| `/dev/ui` in production builds | Visible (per O5 — not gated by `NODE_ENV`). Future hardening item: `DEV_UI_ENABLED` flag if it ever needs to disappear. |
| Operator who finds `/dev/ui` | Sees the design-system reference. Carries no operator data (per §3.4). The page is read-only, stateless, and uses fixture data only. |

---

## 9. UI non-leak rule (locked, verbatim from issue round-2 #5)

> **No raw provider data, env var values, baseUrl, Authorization headers, raw fetch errors, raw stack traces, or raw provider responses are rendered in UI. Use canned / neutral message maps.**

### 9.1 Codified in three places

1. **`docs/UI-GUIDELINES.md`** carries the rule verbatim as its own section (with a paragraph of context).
2. **`/dev/ui` examples** demonstrate the neutral-message pattern explicitly:
   - A `ValidationDetail` example renders `errorCode auth-missing` + the `discoveryMessageFor`-style hint. Never the raw fetch error string from the provider.
   - The preview-only API-key field (§4.10) shows a placeholder value (`••••••••`). Never an example real key shape.
   - The connector row examples never carry an env var NAME in the visible columns (`authRefKind: env` is the surface; the NAME itself is server-internal).
3. **Reviewer checklist** (§9.4) lives in `UI-GUIDELINES.md` and is what reviewers quote when catching drift.

### 9.2 `/dev/ui` data safety

Per §3.4, `/dev/ui` uses mock/demo data only. The page does NOT call any API route. All fixture strings (`"openai-live"`, `"hermes"`, `"https://example.test/v1"`) are illustrative-only.

### 9.3 Prior art references

- `src/app/settings/_connectors/api.ts::discoveryMessageFor` — closed-set neutral-message helper.
- M4a-5 PR #30 review fix `cf97971` — added the closed-set pattern.
- M4a-FU5 PR A's `testConnection.neutralMessage` — kernel-side re-derivation of `message` from `(status, errorCode)`. Never passes through a family-provided string.

### 9.4 Reviewer checklist (O10 — lives in `docs/UI-GUIDELINES.md`)

A short section in `UI-GUIDELINES.md` titled "Reviewer checklist for UI-touching PRs":

```
For any PR that touches UI surfaces, confirm:

- [ ] UI changes follow docs/UI-GUIDELINES.md (tokens, patterns,
      modal rules, focus behaviour).
- [ ] No raw provider data, env var NAME, baseUrl, secret value,
      Authorization header, raw fetch error, or raw stack trace
      is rendered in JSX or console output.
- [ ] All error messages route through a neutral-message map
      (discoveryMessageFor is the canonical example; new maps
      follow the same closed-set pattern).
- [ ] Reduced-motion downgrade is documented (or implemented)
      for any new pulse/glow/highlight state.
- [ ] If new inline status/trust hex is introduced, justify why
      (otherwise extract to a token per §5 of the FU6 task spec).
```

No new `PULL_REQUEST_TEMPLATE.md` file. The reviewer references this checklist when leaving review comments.

---

## 10. ADR work — `ARCHITECTURE.md` paragraph instead

Per O7: no new ADR. Instead, FU6 PR D adds a short paragraph to `docs/ARCHITECTURE.md` (likely in a new "UI consistency" subsection of §6 "UI shell" or as its own near-bottom subsection).

Draft text (final wording to land in PR D):

> **UI consistency.** Reusable visual patterns, status / trust / accent tokens, modal rules, and the non-leak posture for UI surfaces are codified in [`docs/UI-GUIDELINES.md`](UI-GUIDELINES.md). Live examples render at `/dev/ui` (an unadvertised internal route). New UI work — provider catalog (M4a-6a), UI-managed secrets (M4a-6b), connector row management (FU4 / #35), and any future statusful surface — references the guidelines as the source of truth. See M4a-FU6 task spec for the design rationale and PR breakdown.

The existing ADRs (ADR-0017 connector runtime + authRef; ADR-0018 preset catalog; ADR-0020 connector_health) cover all relevant architectural contracts; nothing in FU6 needs ADR status.

---

## 11. PR breakdown

Four PRs (O9), each with a tightly bounded scope.

### PR A — Additive skeleton

- `src/app/globals.css` — add NEW `--status-{valid,invalid,unreachable,misconfigured,test-unknown,not-tested}` + `--trust-*` tokens. **Existing tokens untouched. NO consumer migration in PR A.**
- `src/app/dev/ui/page.tsx` (NEW) — minimal skeleton. Header + one empty section per §4 category (anchors only; no live components yet).
- `src/app/dev/_lib/StateRow.tsx` (NEW; optional) — small wrapper.
- `docs/UI-GUIDELINES.md` (NEW) — sections per §3.3, including the reviewer checklist (§9.4). Component-index links point at the placeholder anchors that will fill in PR B.
- `tests/dev-ui-route.test.ts` (NEW) — smoke test (route returns 200).

**Hard constraints for PR A:**

- **Additive only.** No existing component refactor in PR A. No consumer of any token is touched.
- The only `globals.css` change is the NEW token block. Existing `--status-*` / `--accent-*` / `--panel-*` lines are untouched.
- The skeleton anchors render placeholders ("§4.7 Connector rows — examples in PR B"). PR A is a scaffold, not the visual inventory itself.

**Definition of done:**

- `/dev/ui` mounts; route smoke test passes.
- `docs/UI-GUIDELINES.md` exists with the section headers and the reviewer checklist.
- New tokens compile; existing tests stay green.

### PR B — Fill `/dev/ui` sections with live components

- Extend `src/app/dev/ui/page.tsx` — per-category sections (sidebar nav, Mission Control cards, agent cards, feature cards, self cards, Settings layout, connector rows, status pills, form fields, modals, loading states, reduced-motion downgrades, auto-close pattern).
- Extend `docs/UI-GUIDELINES.md` — cross-links updated to point at the now-live `/dev/ui` anchors per category.

**Hard constraints for PR B:**

- Imports components from production source paths (no hand-mirroring).
- Uses mock/demo fixture data only (§3.4).
- Does NOT refactor any existing component.

**Definition of done:**

- Every §4 category is renderable on `/dev/ui`.
- A reviewer walking `/dev/ui` against §4 can see every state matrix LIVE.
- Reduced-motion downgrade visible for pulse / highlight / skeleton states.

### PR C — Token swap (highest-risk PR; tightly bounded)

PR C is the highest-risk PR in the FU6 sequence because it touches existing components. It is restricted to color-token replacement only.

**Hard constraints for PR C:**

- **Color-token replacement only.** No logic changes.
- **No layout changes.**
- **No component-shape / API changes.**
- **No file moves.**
- **No "while we are here" refactors.**
- Only touch components that:
  - have inline hex/color drift in **3+ sites** (§5.3), OR
  - are explicitly required by M4a-6a.
- Anything else becomes a separate follow-up issue.

**Likely scope (subject to inventory during PR B):**

- `ConnectorsPanel.tsx` — `StatusPill` inline hex → `--status-{valid,invalid,…,test-unknown,not-tested}`; `TRUST_COLORS` inline hex → `--trust-*`.
- `Pill.tsx` — IF it carries status colors in 3+ sites.
- Nothing else, unless the 3+ rule triggers.

**Definition of done:**

- Typecheck + test suite still green.
- Manual visual diff of every touched component against the pre-PR-C version: identical (same hex resolves; the swap is mechanical).
- No behaviour change reported by acceptance walkthrough.

### PR D — Closeout

- `docs/ROADMAP.md` — M4a-FU6 line marked complete.
- `docs/specs/expandability-foundation/README.md` — status row added for `m4a-fu6-task-spec.md`.
- `docs/specs/expandability-foundation/m4a-fu6-task-spec.md` — status header DRAFT → CODE COMPLETE.
- `docs/specs/expandability-foundation/m4a-6-task-spec.md` — M4a-6a section adds a reference to `docs/UI-GUIDELINES.md` as the source of truth for new UI work.
- `docs/ARCHITECTURE.md` — short UI-consistency paragraph (§10).
- `docs/M4AFU6-ACCEPTANCE.md` (NEW) — operator acceptance checklist per §12.

**Definition of done:**

- All docs landed on main.
- Live `M4AFU6-ACCEPTANCE.md` walkthrough passed.

---

## 12. Operator acceptance (`docs/M4AFU6-ACCEPTANCE.md`)

FU6 is mostly visual; the acceptance checklist is a guided walkthrough rather than a curl-driven script. Per O6, this lives as its own file at `docs/M4AFU6-ACCEPTANCE.md`.

```
Step 1 — /dev/ui is reachable
  [ ] On a running dev server, http://127.0.0.1:3000/dev/ui
      returns 200 and the page renders.
  [ ] /dev/ui is NOT linked from the operator sidebar.
  [ ] Operator-facing URLs (/agents, /goals, /journal, /memory,
      /scheduler, /settings) still render unchanged.

Step 2 — Every component category is present
  [ ] §4.1 Sidebar nav examples render with state labels.
  [ ] §4.2 Mission Control cards — live / busy / degraded /
      offline / unknown (grey).
  [ ] §4.3 Agent cards — normal / hover / online / offline /
      degraded.
  [ ] §4.4 Feature dashboard cards.
  [ ] §4.5 Self cards (Goals / Journal / Memory).
  [ ] §4.6 Settings layout — left rail states + section panels.
  [ ] §4.7 Connector rows — every status state.
  [ ] §4.8 Status pills — BOTH families (Mission Control + connector-test).
  [ ] §4.9 Trust badges.
  [ ] §4.10 Form fields, INCLUDING the preview-only API key
      field with the "preview only — M4a-6b" caption.
  [ ] §4.11 Modals — Close vs ← Back examples, footer rules.
  [ ] §4.12 Loading / skeleton states.
  [ ] §4.13 Reduced-motion downgrade visible.
  [ ] §4.14 Auto-close + highlight pattern example.

Step 3 — docs/UI-GUIDELINES.md is the written companion
  [ ] File exists.
  [ ] Token catalog matches src/app/globals.css.
  [ ] Locked rules (§5.6 of the FU6 task spec) appear verbatim.
  [ ] UI non-leak rule (§9) appears verbatim.
  [ ] Reviewer checklist (§9.4) appears.
  [ ] Component-index links resolve to /dev/ui anchors.

Step 4 — Token semantic separation (O3)
  [ ] On /dev/ui, the Mission Control "unknown" example renders
      GREY (uses --status-unknown).
  [ ] The connector-test "unknown" example renders YELLOW
      (uses --status-test-unknown).
  [ ] In the actual Settings → Connectors flow, a connector
      whose test returns "unknown" still shows the yellow pill.
  [ ] In the actual Mission Control top cards, an "unknown"
      service still shows grey.

Step 5 — UI non-leak sweep
  [ ] Walk /dev/ui. No real connector data, no env var NAME,
      no baseUrl, no secret, no Authorization header, no raw
      fetch error string is rendered.
  [ ] Open browser devtools — no `console.error` containing
      stack traces from /dev/ui's renders.
  [ ] Inspect the preview-only API-key field — value renders
      as the placeholder; onChange does nothing.

Step 6 — Token swap unchanged behaviour (PR C verification)
  [ ] Settings → Connectors — existing rows still render the
      same status colors / trust labels / pill behaviour.
  [ ] Click Test on a connector. The right-side pill flips
      correctly through the loading → result states.
  [ ] Hard-refresh. FU5 hydration still works (M4A5 Step 8
      still passes).

Step 7 — Reduced-motion
  [ ] Enable `prefers-reduced-motion: reduce` (browser devtools
      → Rendering → Emulate CSS media feature).
  [ ] Visit Settings → Connectors. Add a new connector. The
      post-add row highlight downgrades to a static ring (no
      pulse) for the 3-second window.
  [ ] Visit /dev/ui — loading skeletons render as static
      dimming (no pulse).

Step 8 — M4a-6a spec reference
  [ ] docs/specs/expandability-foundation/m4a-6-task-spec.md
      references docs/UI-GUIDELINES.md as the source of truth
      for new UI work.

Step 9 — ARCHITECTURE.md paragraph (O7)
  [ ] docs/ARCHITECTURE.md carries a short paragraph stating
      that docs/UI-GUIDELINES.md + /dev/ui are the UI source
      of truth.

Step 10 — Sign-off
  [ ] All steps 1–9 pass.
  [ ] M4a-FU6 marked complete in ROADMAP.md and specs README.
  [ ] Issue #37 closed.
```

---

## 13. Risks and tradeoffs

| Risk | Mitigation |
|---|---|
| **Drift between `/dev/ui` and production.** | The page imports from production source paths (§3.2). A future contributor adding a new component must also add a `/dev/ui` example or the reviewer rejects the PR. |
| **`docs/UI-GUIDELINES.md` going stale.** | Component-index links in the doc point at `/dev/ui` anchors; broken anchors are visible. Reviewer-checklist (§9.4) prompts updates whenever a UI rule changes. |
| **Reviewer-with-link enforcement is weak.** | Acknowledged. Real enforcement evolves over time — an ESLint rule for inline status colors is a possible v1 hardening (O11). v0 ships the doc because the alternative (no rules) was the problem M4a-5 #33/#34 surfaced. |
| **Token swap (PR C) triggers visual regressions.** | PR C is isolated; aliases must be intentional; non-aliased extractions stay distinct (e.g. `--status-invalid` ≠ `--status-offline`). Manual visual diff before merge. The 3-site threshold (§5.3) raises the bar above v0's 2-site threshold. |
| **Reduced-motion downgrade incomplete.** | Per-category rules documented (§4.13); `/dev/ui` demonstrates the downgrade for pulse / highlight / skeleton; acceptance Step 7 walks through enabling `prefers-reduced-motion: reduce` and verifying. |
| **Preview-only API key field gets confused for a real surface.** | The caption is explicit: "preview only — full implementation belongs to M4a-6b." The field's onChange handler is a no-op. M4a-6b's PR is the only PR allowed to wire a real submit. |
| **Operator stumbles on `/dev/ui` and tries to operate from it.** | The page renders fixture data only (§3.4) — no live `/api/connectors`, no live `/api/runs`. Header reads "Design-system reference — NOT an operator surface." |
| **`/dev/ui` import graph blows out the bundle for the main app.** | Components imported by `/dev/ui` are already imported by the main routes; the page adds no new runtime dependencies. Next.js per-route code splitting keeps the `/dev/ui` chunk separate. Verify with `npm run build` post-PR-A that the main route bundles have not grown. |
| **PR C diff is unreadable.** | PR C scope is restricted to inline-hex → token replacements. The diff is mechanical and reviewable by visual diff alone. Any change beyond the swap is rejected and routed to a follow-up issue. |
| **M4a-6a starts before FU6 PR D's cross-reference lands.** | Hard limit (§1.2 + §11 PR D DoD): M4a-6a's spec / PR MUST reference `docs/UI-GUIDELINES.md`. The reference can land in M4a-6a's spec amendment if FU6 PR D has not shipped yet — but never after M4a-6a's code merges. |
| **`--status-test-unknown` is yet another token to maintain.** | Acknowledged. The alternative — silently recoloring Mission Control's `unknown` from grey to yellow — was worse: it would change the semantics of every Vitals / AgentPortal "unknown" surface. The token cost (one CSS line + a docs entry) is bounded; the semantic correctness is durable. |
| **The 3-site extraction threshold is too lax.** | Acknowledged. 2 sites is plausibly coincidence; 3 sites is drift. If post-FU6 acceptance shows drift creeping back, the threshold can drop to 2 in a future hardening pass. |
| **A future statusful surface invents its own pill family.** | Locked rule §5.6 + canonical pill catalog in `/dev/ui` + reviewer-with-link pattern. ESLint rule (O11) is a future hardening candidate. |
| **FU6 closes easy drift, leaves harder drift open.** | v1 explicitly scopes to tokens + components + rules + non-leak. Layout-level decisions (sidebar vs top nav, single-pane vs split-pane, etc.) remain in the operator-memory `agentic-os-ui-shell-decisions` note; FU6 does not try to codify those. |

---

**End of M4a-FU6 task spec (v1, design only).** Open questions O1–O12 are pinned (§0); CW/Jarvis amendments folded in (token contradiction fix, PR A/PR C scope tightening, token sanity, `/dev/ui` data safety, reduced-motion documentation, O10 lightweight enforcement); Markdown formatting cleaned up. No branch, no implementation, no `/dev/ui` page, no `globals.css` changes until Rex accepts v1. Promoted to `docs/specs/expandability-foundation/m4a-fu6-task-spec.md` per `docs/MAINTENANCE.md` only after explicit acceptance.
