# UI Guidelines

Written rules companion to the live `/dev/ui` design-system reference. Lives next to `ARCHITECTURE.md`, `ROADMAP.md`, and the `M4*-ACCEPTANCE.md` files because UI consistency is a cross-milestone concern, not a per-milestone one.

**This file is the source of truth for UI consistency rules.** The live React examples render at `/dev/ui` (an unadvertised internal route — type the URL; not in the operator sidebar). When the rules below say "see `/dev/ui#anchor`", the anchor exists on the page; if a link is broken, that's a real bug.

> **PR A status (current):** this is the first-draft skeleton companion to the `/dev/ui` skeleton route shell. Live component examples land in **PR B**; the tightly-bounded inline-hex → token swap lands in **PR C**. Until PR B / PR C ship, the `/dev/ui` anchors render placeholder sections and the rules below describe the intent rather than the current observable state. The intent and the rules are stable; the inventory under each anchor fills in next.

See the M4a-FU6 task spec ([`docs/specs/expandability-foundation/m4a-fu6-task-spec.md`](specs/expandability-foundation/m4a-fu6-task-spec.md)) for the design rationale and the per-PR breakdown.

## 1. Why this file exists

Recent UX issues fixed in PR #33 / #34 — the duplicate `valid` badge on connector rows, the meaningless `ENABLED` static label, three close-related buttons in the same modal, browser refresh dropping section state — were all rooted in the same cause: **no shared pattern source-of-truth**, so each component reached for its own conventions. Codifying the patterns here (before any UI-heavy milestone — M4a-6a in particular) keeps the next round from repeating the same drift.

Two artefacts ship together:

- **`/dev/ui`** — internal visual page rendering the actual reusable UI patterns with live React components.
- **This file** — written "must / must-not" rules + token catalog + reviewer checklist.

The two reference each other: the doc names the rule; the page shows the rule in action.

## 2. Token catalog

All tokens live in `src/app/globals.css :root`. Use tokens by name, not inline hex.

### 2.1 Existing surface / text / panel tokens (unchanged)

| Token | Purpose |
|---|---|
| `--bg`, `--bg-elevated`, `--bg-elevated-hot` | Page / card backgrounds |
| `--border`, `--border-hot` | Borders + hover-intensified borders |
| `--fg`, `--fg-dim`, `--fg-dimmer` | Primary / secondary / tertiary text |
| `--panel`, `--panel-border`, `--panel-border-hot` | Glass-panel surfaces (sidebar rail and similar) |
| `--radius` | Card / button radius (10px) |
| `--shadow-glow` | Soft outer glow for live cards |

### 2.2 Mission Control / Vitals status tokens (unchanged)

Service-health discriminant used by Mission Control top cards, `Vitals`, `AgentPortal`, and feature dashboard cards.

| Token | Color | Meaning |
|---|---|---|
| `--status-live` | green `#10b981` | Service is up |
| `--status-busy` | cyan `#06b6d4` | A run is in progress |
| `--status-degraded` | amber `#f59e0b` | Partial outage |
| `--status-offline` | rose `#f43f5e` | Down |
| `--status-unknown` | **grey** `#71717a` | **No data signal.** Stays grey. **Do NOT recolor this.** |

### 2.3 Per-agent accents (unchanged)

| Token | Agent |
|---|---|
| `--accent-claude-code` | Claude Code |
| `--accent-hermes` | Hermes |
| `--accent-openclaw` | OpenClaw |
| `--accent-chatgpt` | ChatGPT |
| `--accent-openrouter` | OpenRouter |
| `--accent-default` | Fallback (hash-mapped by agent name) |

### 2.4 Connector-test status discriminant (NEW in M4a-FU6 PR A)

`ConnectorValidation` (kernel type) discriminant surfaced by `ConnectorsPanel.StatusPill` + `ValidationDetail`. **Semantically distinct from `--status-*` (Mission Control)** — see §2.6 for why.

| Token | Color | Meaning |
|---|---|---|
| `--status-valid` | green (alias of `--status-live`) | Connector test passed |
| `--status-invalid` | red `#f87171` | Connector test failed |
| `--status-unreachable` | red (alias of `--status-invalid`) | Network/DNS failure; may diverge later |
| `--status-misconfigured` | red (alias of `--status-invalid`) | Pre-test config error; may diverge later |
| `--status-test-unknown` | **yellow** `#fbbf24` | **Test inconclusive.** NOT to be confused with `--status-unknown` (Mission Control grey). |
| `--status-not-tested` | dim grey (alias of `--fg-dimmer`) | Pre-test, fingerprint mismatch, or session-fresh row |

### 2.5 Trust badges (NEW in M4a-FU6 PR A)

Provenance, **NOT** validation status. Trust is "where did this connector come from?" — first-party preset, community / operator-loaded preset, or untrusted (see ADR-0018 preset trust clamp; downward-only).

| Token | Color | Meaning |
|---|---|---|
| `--trust-first-party` | green `#4ade80` | Ships with the binary |
| `--trust-community` | amber `#fbbf24` | Loaded from `~/.agentic-os/presets/` |
| `--trust-untrusted` | red `#f87171` | Operator-flagged untrusted |
| `--trust-unknown` | grey `#71717a` | Provenance can't be determined |

### 2.6 Why two "unknown" tokens?

The two "unknown" states are **semantically different** and use **different colors on purpose**:

- **Mission Control `--status-unknown` (grey)** means "no signal" — silent. The card has no live data to render; do not draw operator attention. Used by Vitals, AgentPortal, feature dashboard cards.
- **Connector-test `--status-test-unknown` (yellow)** means "we tested and the result was inconclusive — operator may want to look." It IS a warning state.

Merging them under one token would either silently turn warnings into silence (bad) or recolor all Mission Control "no signal" cards to yellow (worse). The two tokens stay separate.

### 2.7 Token aliasing rule

Aliasing within a family is acceptable when documented. Every alias (`--status-foo: var(--status-bar)`) must have a comment explaining why. A bare alias is a smell — extract its own hex when the meanings diverge.

The aliases currently present:

- `--status-valid: var(--status-live)` — connector-test `valid` and Mission Control `live` both mean "everything is fine; green dot." Visual identity is intentional.
- `--status-unreachable: var(--status-invalid)` — both currently mean "test failed." May diverge later (unreachable could become amber to signal "try again" while invalid stays red for "fix the config").
- `--status-misconfigured: var(--status-invalid)` — same rationale as `--status-unreachable`.
- `--status-not-tested: var(--fg-dimmer)` — text-only dim state with no dot.

## 3. Locked rules — must / must-not

These rules were extracted from PR #33 / PR #34 regressions and the issue #37 body. Every UI-touching PR is reviewed against them.

- **Do not invent new button styles.** Pick from the canonical set (§5 of the FU6 task spec); if the canonical set doesn't fit, add to it BEFORE using it.
- **Do not show duplicate statuses in the same row.** The right-side `StatusPill` is the at-a-glance source of truth; below-row detail (`ValidationDetail`) only renders for non-valid outcomes. PR #34 removed a duplicate `valid` badge for this reason.
- **Trust badges and status badges are different concepts.** Different positions (trust on the left near the connector id; status on the right near the Test button), different color families (`--trust-*` vs `--status-*`). Do not mix.
- **Static labels like `ENABLED` do not appear unless actionable or meaningful.** PR #34 removed a static `ENABLED` label because it duplicated metadata without enabling any interaction. The rule generalises: every label in a row must either be interactive (a button), informative-and-changing (a status pill), or genuinely-meaningful metadata not shown elsewhere.
- **Close exits modal; ← Back moves one step back; do not duplicate.** PR #33 dropped a redundant Cancel button after the same conflation. Footer never duplicates a header close.
- **Successful create flows auto-close and highlight the new row in the list, UNLESS the carve-out applies.** Carve-out (FU6 round-2 #7): copy / download / one-time-confirmation cases stay open at a confirmation step. Example: M4a-6b's "your API key is now stored; you will not see it again."
- **Refresh preserves current settings section / page state.** PR #34 introduced the `?section=…` URL search-param pattern; the same approach (URL state, `router.replace`, `scroll: false`) applies wherever the user picks a section/tab.
- **Focus stays predictable after Escape, Enter, Tab, and modal close.** PR #34's `onModelBlur` defer pattern is the prior art.
- **Use the same color / status mapping everywhere.** Mission Control: `--status-*`. Connector tests: `--status-{valid,invalid,unreachable,misconfigured,test-unknown,not-tested}`. Trust: `--trust-*`. Do not mix families. Do not introduce a parallel "feature-status" or "agent-status" token family.
- **Reuse existing components before creating new styles.** Search `/dev/ui` first; ask before adding a new variant.

## 4. UI non-leak rule (locked)

> **No raw provider data, env var values, baseUrl, Authorization headers, raw fetch errors, raw stack traces, or raw provider responses are rendered in UI. Use canned / neutral message maps.**

Codified across three surfaces:

1. **This file** carries the rule verbatim above (the heading you just read).
2. **`/dev/ui` examples** (filled in PR B) demonstrate the neutral-message pattern explicitly:
   - A `ValidationDetail` example renders `errorCode auth-missing` + the `discoveryMessageFor`-style hint. Never the raw fetch error string.
   - The preview-only API-key field shows a placeholder value (`••••••••`). Never an example real key shape.
   - The connector row examples never carry an env var NAME in the visible columns.
3. **The reviewer checklist below (§5)** prompts each UI-touching PR to self-attest.

Prior art:

- `src/app/settings/_connectors/api.ts::discoveryMessageFor` — closed-set neutral-message helper.
- M4a-5 PR #30 review fix `cf97971` — added the closed-set pattern.
- M4a-FU5 PR A's `testConnection.neutralMessage` — kernel-side re-derivation of `message` from `(status, errorCode)`. Never passes through a family-provided string.

## 5. Reviewer checklist for UI-touching PRs

No `PULL_REQUEST_TEMPLATE.md` file exists in this repo (FU6 task spec O10 — keeping it lightweight). Reviewers of UI-touching PRs reference the checklist below directly when leaving review comments.

For any PR that touches UI surfaces, confirm:

- [ ] UI changes follow `docs/UI-GUIDELINES.md` (tokens, patterns, modal rules, focus behaviour).
- [ ] No raw provider data, env var NAME, baseUrl, secret value, Authorization header, raw fetch error, or raw stack trace is rendered in JSX or console output.
- [ ] All error messages route through a neutral-message map (`discoveryMessageFor` is the canonical example; new maps follow the same closed-set pattern).
- [ ] Reduced-motion downgrade is documented (or implemented) for any new pulse / glow / highlight state.
- [ ] If new inline status / trust hex is introduced, justify why (otherwise extract to a token per §5 of the FU6 task spec).

The reviewer is expected to link this section in a PR comment when the rule is broken.

## 6. Component index — links into `/dev/ui`

| § | Category | `/dev/ui` anchor |
|---|---|---|
| 4.1 | Sidebar navigation | `/dev/ui#sidebar-nav` |
| 4.2 | Mission Control top status cards | `/dev/ui#mission-control-cards` |
| 4.3 | Agent cards | `/dev/ui#agent-cards` |
| 4.4 | Feature dashboard cards | `/dev/ui#feature-cards` |
| 4.5 | Self cards | `/dev/ui#self-cards` |
| 4.6 | Settings layout | `/dev/ui#settings-layout` |
| 4.7 | Connector rows | `/dev/ui#connector-rows` |
| 4.8 | Status pills | `/dev/ui#status-pills` |
| 4.9 | Trust badges | `/dev/ui#trust-badges` |
| 4.10 | Form fields (incl. preview-only API key) | `/dev/ui#form-fields` |
| 4.11 | Modals | `/dev/ui#modals` |
| 4.12 | Loading / skeleton states | `/dev/ui#loading-states` |
| 4.13 | Interaction states (cross-cutting) | `/dev/ui#interaction-states` |
| 4.14 | Auto-close + highlight pattern | `/dev/ui#auto-close-highlight` |

Until PR B ships, each anchor renders a placeholder section. PR B fills each with live React component examples.

## 7. Successful-create-flow rule (softened)

> **Successful create flows should return to the list and highlight the created row, not leave redundant success modals — UNLESS the success state requires user action such as copy, download, or confirming a one-time value.**

The original (PR #34) rule was "no success modal ever." FU6 round-2 #7 softened it: the carve-out for copy / download / one-time-confirmation cases exists because M4a-6b's "Save key locally" path may need a one-time "the API key is now stored; you will not see it again" moment. The carve-out names what's allowed (copy / download / one-time confirmation) so the rule stays sharp without blocking that case.

Default behaviour:

1. Successful submit → modal closes.
2. List refresh — server re-fetched immediately.
3. The new row gets a 3-second highlight (ring + animate-pulse).
4. After 3 seconds the highlight clears automatically.
5. Operator does not need to dismiss anything.
6. Reduced-motion downgrade: ring is static (no pulse) for the 3-second window.
7. Carve-out: if the success requires user action, the modal stays open at a confirmation step with the explicit action.

## 8. Reduced-motion

Every pulse / glow / highlight state MUST respect `prefers-reduced-motion: reduce`. Per-category downgrades:

- **Connector row highlight (PR #34's emerald ring + pulse):** downgrade to a static border-color highlight for the same 3-second window. The operator still locates the row visually; no animated pulse.
- **Loading skeletons:** downgrade pulse → static dimming.
- **Modal entry/exit:** downgrade transitions to instant show/hide.
- **Card hover lift:** keep (the lift is a discrete 1px transform on hover, not a continuous animation; harmless under reduced motion).
- **Status dot glow:** keep static; the glow is not animated.

`/dev/ui` MUST demonstrate the reduced-motion downgrade for the pulse / highlight states (lands in PR B). To verify on the running app: browser devtools → Rendering panel → Emulate CSS media feature → `prefers-reduced-motion: reduce`.

## 9. Out of scope

What FU6 does NOT promise:

- A full visual redesign of any existing surface.
- Tailwind plugin authoring or theme system overhaul.
- Production-grade accessibility audit (basic keyboard + ARIA conformance only; deeper a11y work is a separate milestone).
- Translation / i18n.
- Storybook or external pattern-library tooling — the internal `/dev/ui` page is sufficient.
- The real `SecretField` (M4a-6b scope). FU6's API-key example fields are preview-only fake placeholders.
- ESLint rule for inline status colors. Future hardening candidate; out of FU6 v1.
- Operator-facing nav changes. `/dev/ui` is unadvertised; do not link it from the sidebar.

## Cross-references

- [`docs/specs/expandability-foundation/m4a-fu6-task-spec.md`](specs/expandability-foundation/m4a-fu6-task-spec.md) — full task spec.
- `src/app/globals.css` — token definitions.
- `src/app/dev/ui/page.tsx` — the live reference page (skeleton in PR A; filled in PR B).
- ADR-0017 (connector runtime + authRef — informs the preview-only API-key field).
- ADR-0018 (preset catalog + trust clamp — informs the trust badge family).
- ADR-0020 (connector_health projection — informs the connector-test status discriminant).
