# M4a-5 Task Spec — Connector Hardening + Model Discovery (v1.2)

**Date:** 2026-05-23
**Version:** v1.2 — second-pass review folded in (6 corrections); v1.1 absorbed the first 12 revisions; v1 was a first draft
**Milestone:** M4a-5 — Connector hardening + model discovery (OPTIONAL post-M4a sub-milestone)
**Status:** **PARKED — DESIGN ONLY** (as of 2026-05-23). The §0 gate is **mostly satisfied**: PR #23 merged (`17cd769`); closeout PR #26 merged (`1333d6a`); §18 live acceptance passed against the operator's running server. The remaining gate is Rex's explicit go-ahead to either start M4a-5 PR AB (hardening + backend discovery) or defer M4a-5 entirely and start M5 first.
**Parent design:** `m4-task-spec.md` v2.1 — this spec resolves several of v2.1's *Carried follow-ups* + the new issue #24 (M4a-FU1).
**Predecessor milestone:** M4a-4 — Hermes read-only Kanban (PR #23, merged `17cd769`).
**Successor milestone:** M5 — Artifacts + approvals (does not begin until either this milestone ships or Rex explicitly defers it).
**Audience:** Claude Code (executing agent, when authorised) and Rex (approving / sequencing).
**Purpose:** Decompose M4a-5 — the optional connector hardening + searchable model picker — into concrete, reviewable work. Ship hardening WITH discovery because the discovery path inherits all of the same network risks.

> **This is a spec-only document.** It is not a green light to implement.
> M4a is complete and verified — PR #23 (`17cd769`) and the closeout PR #26
> (`1333d6a`) are both merged, and the §18 live acceptance passed on
> 2026-05-23. M4a-5 remains **parked design only**; the sole remaining gate
> is Rex explicitly choosing to start M4a-5 PR AB OR deferring M4a-5 and
> starting M5 first.
>
> **v1 → v1.1 (12 review edits):** (1) discovery validates only what discovery
> needs — `model` is NOT required; (2) tightened "discovery failure ≠ save
> failure" — config-add still enforces validation; (3) locked the timeout
> design — `effectiveSignal` always bounds, combines `ctx.signal` with the
> default via `AbortSignal.any` (Node ≥20); (4) added `response-too-large`
> ConnectorErrorCode; (5) explicit body-cap-vs-context-window note;
> (6) dropped `discovery-not-supported` — re-uses `capability-not-supported`;
> (7) explicit RouterErrorCode vs ConnectorErrorCode boundary paragraph;
> (8) explicit IPv4-compat IPv6 policy note; (9) picker order/cap-banner/
> Escape behaviour locked; (10) audit is awaited (deterministic); (11) UI
> test harness opened as a deliberate yes/no question; (12) gate restated.
>
> **v1.1 → v1.2 (6 review edits):** (A) `modelDiscoverySettingsSchema` is
> **required when `listModels` is declared** — no silent fallback to
> `settingsSchema`, no skip; missing it is a registration-time error;
> (B) replaced the last `withTimeout` references with `effectiveSignal` so
> only one timeout concept exists; (C) audit envelope for
> `connector.models.discover` is `{ presetId, status, errorCode?, modelCount? }`
> — no `connectorId` (pre-save discovery never creates an instance);
> (D) §5.3 spells out the explicit ordering for `openai-compatible-llm.listModels`
> (status-code checks before body read, `response-too-large` ONLY after a 2xx
> over-cap body); (E) added explicit env-var-name and resolved-secret
> non-leak assertions for the discovery test surface; (F) tightened the Done
> wording — "discovery failure does not block manual model entry or
> attempting save; config-add still enforces normal validation."

This spec follows the m4-task-spec v2.1 template. §3 is the corrective-guardrails
section.

---

## 0. Preconditions

M4a-5 implementation **must not begin** until ALL of the following hold:

```text
[x] M4a PR4 (#23 — Hermes read-only kanban.*) is merged to main.
    (merged 2026-05-23 as `17cd769`).
[x] M4a §18 acceptance script passes on a live server (Rex-driven).
    (Passed 2026-05-23; `openai-live` test returned valid,
    169.254.169.254 returned blocked-network, secret-grep clean.)
[x] M4a doc sync is merged — ADR-0017 (connector runtime + authRef),
    ADR-0018 (connector preset catalog), ARCHITECTURE updated.
    (PR #26 merged 2026-05-23 as `1333d6a`; all four docs landed.)
[x] M4a is marked "verified" by Rex.
[ ] Rex explicitly authorises M4a-5 start (optional milestone; may be
    deferred until after M5).
```

This gate exists because M4a-5 touches the same router / family / SSRF
surfaces and would conflict with any open M4a work.

---

## 1. Scope (locked)

Two themes shipping together:

```text
A. Model discovery + searchable model picker  (issue #24 / M4a-FU1)
   - Server-side discovery against the family's /models endpoint.
   - Add Provider UI gains a "Load models" button + searchable picker.
   - Manual model entry remains the always-available fallback.

B. Connector hardening (v2.1's carried items)
   - Bounded fetch timeout when ctx.signal is absent.
   - Response-body size cap before res.json() / readBoundedJson helper.
   - Deprecated IPv4-compatible IPv6 forms (`::a.b.c.d`) added to SSRF.
   - Closed RouterErrorCode union — replace `errorCode: string` on the
     router-emitted result with a closed neutral union.
```

Discovery and hardening go together because the discovery path is just one
more HTTP call by the openai-compatible-llm family — it inherits every
network risk, so the hardening is on the critical path.

Out of scope:

```text
oauth-mediated-llm family                              → post-M4a-5 / later
native-vendor-api family                               → post-M4a-5 / later
M5 artifacts + approvals                               → M5
Settings UI redesign beyond the Load-models button     → later UX work
POST /api/connectors/[id]/models for SAVED connectors  → Open Question 1
                                                         (default: defer to
                                                         post-M4a-5)
getRunLedger singleton init-promise race               → later (separate
                                                         carried item; not
                                                         a discovery risk)
Hermes kanban WRITES (kanban.task.create)              → later milestone
```

---

## 2. Exit criteria

```text
Add Provider UI shows a Load models button next to the Model field for
  every openai-compatible-llm preset.
Clicking Load models calls a server-side discovery endpoint, populates a
  searchable picker, and lets the operator select a model that fills the
  Model field.
Manual model entry stays available REGARDLESS of discovery success/failure
  — i.e. the Model text input is never disabled, cleared, or hidden by a
  discovery error. (See §5.2 / §11 / §14 for the exact contract: a
  network/auth/SSRF failure on discovery does NOT block the operator from
  TYPING a model id; saving the connector still goes through the regular
  /api/connectors POST validation, which will fail with the underlying
  errorCode — blocked-network / malformed-authRef / etc. — if the
  underlying issue isn't fixed. Discovery and save are orthogonal.)
OpenRouter-scale catalogues (hundreds of models) are searchable; the
  picker has a deterministic order (provider order by default) and shows
  "Showing first 200 of N matches — refine search" when results exceed
  the render cap.
Ollama / local discovery respects effective allowLocalNetwork.
Every HTTP family fetch — chat.generate, testConnection, listModels —
  uses a bounded effective signal that ALWAYS combines `ctx.signal` (if
  present) with a default timeout, via `AbortSignal.any` — never just one
  or the other.
Every HTTP family response is read through readBoundedJson — over-cap
  bodies fail neutrally with errorCode `response-too-large`, before JSON
  parse.
assertPublicBaseUrl blocks deprecated IPv4-compatible IPv6 forms
  (`::a.b.c.d`) WHEN the embedded IPv4 is private — `::127.0.0.1`,
  `::169.254.169.254`, etc.; public embedded IPv4 (e.g. `::1.1.1.1`)
  is NOT blocked unless we explicitly choose the stricter policy (§10).
CapabilityInvokeResult.errorCode is a closed RouterErrorCode union, not
  `string`. The router cannot emit an unsanitized errorCode. Connector-
  facing APIs (`/api/connectors/[id]/test`, `/api/connectors/models/
  preview`) are NOT capability invocations and may surface allowlisted
  ConnectorErrorCode values (§9).
No secret / raw provider response / authRef value / Authorization header
  / private path appears in any UI / audit / log line.
```

---

## 3. Repo-reality adaptations (READ FIRST)

This spec is post-M4a-4. The live shape:

1. **`openai-compatible-llm` family** (`src/connectors/openai-compatible-llm/
   family.ts`, PR #20) — already does `redirect: "manual"` (B11), adds
   `Authorization: Bearer <ctx.secret>` only when present (Ollama-compatible),
   and routes through `assertPublicBaseUrl` at config-add + testConnection
   time (PR3a/3b). M4a-5 wires `effectiveSignal` + `readBoundedJson` into the
   existing invoke/testConnection paths AND adds `listModels`.

2. **`assertPublicBaseUrl`** (`src/kernel/connectors/ssrf.ts`, PR #20 +
   review fix #21) — handles 127/8, 10/8, 172.16/12, 192.168/16, 169.254/16,
   0.0.0.0, localhost, ::1, ::, fc00::/7, fe80::/10, IPv4-mapped IPv6
   (`::ffff:…` dotted + hex). M4a-5 extends `isPrivateIPv6` to recognise
   deprecated IPv4-compatible IPv6 (`::a.b.c.d` without the `ffff` prefix).

3. **Router error codes are currently strings.**
   `CapabilityInvokeResult.errorCode?: string` (`src/kernel/capabilities/types.ts`).
   The router today emits `"connector-returned-failure"` /
   `"connector-invoke-threw"` / `"config-invalid"` / `"connector-unknown"`.
   M4a-5 introduces a closed `RouterErrorCode` union and tightens the
   type — a future caller cannot emit an arbitrary string.

4. **Audit kinds today are `connector.test` and `capability.invoke`.**
   M4a-5 adds `connector.models.discover` — neutral envelope
   `{ presetId, status, errorCode?, modelCount? }`. Pre-save discovery
   never creates or uses a connector instance, so the envelope carries
   **no `connectorId`**; a future saved-connector discovery route (Open
   Question 1) would extend the envelope at that point, but M4a-5 ships
   the pre-save surface only. Raw provider response never crosses;
   model id list never crosses to the audit.

5. **`authRef` resolution** is the existing env-only path
   (`src/kernel/connectors/authRef.ts`). Discovery reuses it — no new
   secret pathway.

6. **`assertPublicBaseUrl` accepts an injectable resolver** for tests. The
   discovery path uses the same default DNS resolver in production;
   request-time DNS re-resolution stays the documented post-M4a-5 limitation
   (v2.1 spec §8).

7. **Add Provider UI lives in
   `src/app/settings/_connectors/AddProviderFlow.tsx`** (PR #22). The Model
   field is currently plain text. M4a-5 adds a Load models button and a
   searchable picker — the field STAYS a real text input (manual fallback
   guaranteed).

8. **Client API helpers in `src/app/settings/_connectors/api.ts`** (PR #22)
   currently swallow errors silently (return empty arrays on failure — a
   tracked follow-up). M4a-5 does NOT redesign the whole error surface
   (still a tracked follow-up); discovery just adds its own helper that
   returns a typed result so the picker can render success/failure cleanly.

9. **Per-step git approvals remain a hard rule.** One sub-PR = one PR.

10. **Reuse the shared helpers.** Any new utility (timeout, body cap, error
    codes) is added once in the kernel and imported by the family — no
    family-local re-implementations.

---

## 4. File structure

```text
NEW — kernel helpers (foundational, server-only):
  src/kernel/connectors/timeout.ts        effectiveSignal(ctxSignal?, ms) —
                                          ALWAYS bounded; combines ctx.signal
                                          (if any) with AbortSignal.timeout(ms)
                                          via AbortSignal.any (Node >=20).
  src/kernel/connectors/bodyCap.ts        readBoundedJson(res, maxBytes) —
                                          streamed read with a byte budget,
                                          neutral failure on over-cap.
  src/kernel/capabilities/errorCodes.ts   RouterErrorCode closed union +
                                          helpers; isRouterErrorCode(x).
  src/kernel/connectors/discovery.ts      runDiscoverModels(input, deps?) —
                                          parses preview body, builds the
                                          context (without writing the config),
                                          runs SSRF guard, calls
                                          family.listModels(ctx).

NEW — API:
  src/app/api/connectors/models/preview/route.ts
                                          POST — Add-Provider-time
                                          (pre-save) discovery against an
                                          in-flight preset+settings+authRef.

NEW — UI:
  src/app/settings/_connectors/ModelPicker.tsx
                                          Searchable picker (typeahead);
                                          opens below the Model field on
                                          successful discovery.

MODIFIED — kernel:
  src/kernel/connectors/ssrf.ts           extend isPrivateIPv6 to recognise
                                          IPv4-compatible IPv6 (`::a.b.c.d`).
  src/kernel/connectors/types.ts          ConnectorFamilyDefinition gains
                                          optional `listModels(ctx) ->
                                          Promise<ConnectorModelsResult>`.
                                          Add ConnectorModelsResult type.
  src/kernel/capabilities/types.ts        errorCode: RouterErrorCode | undefined
                                          (replace `string`).
  src/kernel/capabilities/router.ts       emit only RouterErrorCode values
                                          (use errorCodes.ts).
  src/kernel/audit.ts                     auditConnectorModelsDiscover().

MODIFIED — connector family:
  src/connectors/openai-compatible-llm/family.ts
                                          invoke + testConnection use
                                          effectiveSignal + readBoundedJson.
                                          New listModels() against /models
                                          with the same redirect-manual /
                                          Bearer-when-secret-present rules.

MODIFIED — UI:
  src/app/settings/_connectors/AddProviderFlow.tsx
                                          PresetForm gets a Load models
                                          button + the ModelPicker
                                          dropdown. Manual entry stays.
  src/app/settings/_connectors/api.ts     discoverModels(input) client
                                          helper; typed Result return so
                                          the picker can render success
                                          / failure / "not supported".

TESTS:
  tests/ssrf-ipv4-compatible.test.ts (or extend ssrf-guard.test.ts)
  tests/body-cap.test.ts
  tests/timeout-helper.test.ts
  tests/router-error-codes.test.ts (or extend capability-router.test.ts)
  tests/connector-registry.test.ts (registration-time invariant — a family
                                    declaring listModels MUST also declare
                                    modelDiscoverySettingsSchema)
  tests/connector-discovery.test.ts (the runDiscoverModels path + the
                                     openai-compatible-llm listModels impl)
  tests/api-connectors-models-preview.test.ts (the route, mirroring the
                                               api-connectors.test.ts setup)
```

Component-render tests for the UI are still out of scope — repo doesn't
carry `@testing-library/react`.

---

## 5. Model discovery — design

### 5.1 Two surfaces, ship one

```text
Option A — POST /api/connectors/<id>/models       (SAVED connector)
Option B — POST /api/connectors/models/preview    (PRE-SAVE)
```

M4a-5 ships **Option B** (pre-save). It's the only one the Add Provider
flow needs. Option A is **deferred** (Open Question 1) — it can land in a
follow-up once a real consumer appears (e.g. "Refresh model list" on an
existing connector row).

### 5.2 Family contract

`ConnectorFamilyDefinition` gains an OPTIONAL method:

```ts
export interface ConnectorModelEntry {
  id: string;
  /** Operator-friendly display name; absent → render `id`. */
  label?: string;
  /** Reserved — provider-supplied flags ("chat-capable", "vision", …).
   *  M4a-5 surfaces them only if the provider already includes them; the
   *  family never invents. */
  flags?: ReadonlyArray<string>;
}

export type ConnectorModelsResult =
  | { ok: true; models: ConnectorModelEntry[] }
  | { ok: false; errorCode: ConnectorErrorCode };

export interface ConnectorFamilyDefinition {
  // …existing fields…
  /** Schema for the SUBSET of settings discovery needs — NOT the same as
   *  `settingsSchema`. For openai-compatible-llm this is { baseUrl } only
   *  (no `model`, because Load-models exists precisely so the operator
   *  doesn't know the model yet).
   *
   *  REQUIRED whenever `listModels` is declared; optional only when the
   *  family does NOT declare `listModels` (e.g. cli-acp-agent). See the
   *  registration-time assertion below — discovery NEVER falls back to
   *  `settingsSchema`. */
  modelDiscoverySettingsSchema?: z.ZodTypeAny;
  listModels?(ctx: ConnectorInvokeContext): Promise<ConnectorModelsResult>;
}
```

**Registration-time invariant.** A family that declares `listModels`
MUST also declare `modelDiscoverySettingsSchema`. The registry asserts
this at startup; a unit test (`tests/connector-registry.test.ts` or
equivalent) fails if the invariant is broken. There is **no fallback** —
discovery does not silently re-use `family.settingsSchema` (which can
require `model` and defeat the purpose of Load-models), and discovery
does not silently skip validation. Either both fields are present or
neither is — `cli-acp-agent` legitimately has neither.

```ts
// Assertion (sketch — in src/kernel/connectors/registry.ts):
for (const family of registeredFamilies) {
  if (family.listModels && !family.modelDiscoverySettingsSchema) {
    throw new Error(
      `Connector family "${family.id}" declares listModels but is missing ` +
      `modelDiscoverySettingsSchema. Discovery MUST validate only the ` +
      `discovery-relevant subset; falling back to settingsSchema would ` +
      `force model entry and defeat Load-models.`,
    );
  }
}
```

A family WITHOUT `listModels` is fine — the preview route returns
**`capability-not-supported`** (the existing ConnectorErrorCode — no new
code) and the UI renders "Model discovery is not supported for this
connector family; enter a model id manually." The `cli-acp-agent` family
does NOT implement `listModels` (and therefore correctly has no
`modelDiscoverySettingsSchema` either).

**Discovery must NOT require `model`.** `family.settingsSchema` for
`openai-compatible-llm` requires `model` (it's needed for chat.generate
and testConnection), but Load-models exists precisely because the
operator may not know the model yet. The discovery path therefore
validates against `modelDiscoverySettingsSchema` — for
`openai-compatible-llm`, that's `{ baseUrl: z.string().url() }` plus the
common auth / SSRF context. `model` is intentionally absent.

### 5.3 `openai-compatible-llm.listModels`

`GET <baseUrl>/models` with `redirect: "manual"`, `Authorization: Bearer
<ctx.secret>` (only when secret present), bounded effective signal,
bounded body. Response shape (OpenAI-compatible):

```text
{ "data": [{ "id": "gpt-4o-mini", "object": "model", ... }, ...] }
```

For its own minimal validation, the family checks
`{ baseUrl: z.string().url() }` on `ctx.settings` (NOT the full
`settingsSchema`, which requires `model`). `model` is intentionally
absent from the discovery validation surface.

Project to `ConnectorModelEntry[]` with `id` only (label/flags reserved —
providers vary; opt in later).

**Status-code checks happen BEFORE body read.** `response-too-large`
applies ONLY to a 2xx response whose body exceeded the cap (it is not a
fall-through code for non-2xx). Explicit order:

```text
1.  3xx (any)                       -> "network-unreachable"
                                       (B11 — Location is never read or
                                       surfaced; the response is dropped
                                       before any body read)
2.  401 / 403                       -> "auth-failed"
3.  429                             -> "rate-limited"
4.  any other non-2xx               -> "external-system-unavailable"
5.  2xx -> readBoundedJson(res, LIST_MODELS_MAX_BYTES)
     a.  ok    -> project { data: [...] } to ConnectorModelEntry[]
     b.  too-large   -> "response-too-large"          (§8 / §9)
     c.  invalid-json -> "external-system-unavailable"
6.  any thrown fetch (DNS / network / abort)
                                    -> "external-system-unavailable"
                                       (the raw error NEVER crosses)
```

NEVER read response stderr / body into a result.

### 5.4 Pre-save discovery flow (`runDiscoverModels`)

Same input shape as `POST /api/connectors`, except `connectorId` is
absent (no instance is being created):

```ts
interface DiscoverModelsInput {
  presetId: string;
  authRef?: string;         // env:VAR_NAME | none
  settings?: Record<string, unknown>;
  allowLocalNetwork?: boolean;
}
```

Steps — same order discipline as `POST /api/connectors` (spec v2.1 §14)
but **the validation surface is narrower**: discovery does not need
`model`, only what `family.modelDiscoverySettingsSchema` declares.

```text
1.  parse + envelope check
2.  secret-key screen on body.settings (B4)
3.  preset lookup -> 400 preset-unknown if missing
4.  family lookup
    -> if family has NO `listModels`: 400 capability-not-supported
       (the existing ConnectorErrorCode — no `discovery-not-supported`).
5.  merge settings (family.defaultSettings <- preset.defaultSettings <-
    body.settings)
6.  re-screen merged settings (B4)
7.  validate merged settings via `family.modelDiscoverySettingsSchema`
    (NOT `family.settingsSchema`); `model` is NOT required.
8.  effective allowLocalNetwork = body ?? preset ?? false
9.  SSRF guard (HTTP families only) — fails 400 blocked-network if
    private/unreachable.
10. resolveAuthRef when authRef supplied (B1)
11. build a transient ConnectorInvokeContext (NOT persisted — no
    connector instance is being created)
12. family.listModels(ctx) under the bounded effective signal (§7)
13. AWAIT auditConnectorModelsDiscover(success | failed) — deterministic
    before the response returns (§12)
14. return ConnectorModelsResult
```

`runDiscoverModels` has the same deps shape as `runConnectorTest` — a
test seam (registry / config-or-presets injection) so the unit test can
swap the family for one that returns predictable models without DNS.

**Critically: discovery and save are orthogonal** (see §1, §11, §14). A
discovery failure (any reason) does NOT block the operator from typing
a model id manually and submitting `POST /api/connectors`. That save
will still go through the full PR3b validation pipeline — including the
SAME SSRF guard, secret-key screen, and full `family.settingsSchema`
(which DOES require `model`). If the underlying issue that broke
discovery is real (e.g. `blocked-network`, `malformed-authRef`), save
will surface the same neutral errorCode. Discovery shows the operator
"we couldn't load models"; save enforces correctness.

---

## 6. Backend route — `POST /api/connectors/models/preview`

CORS-gated, NOT feature-gated (platform infra). Content-Length cap 64 KB.

Body (closed):

```ts
{ presetId, authRef?, settings?, allowLocalNetwork? }
```

Response (success):

```json
{ "ok": true, "presetId": "openai", "models": [{ "id": "gpt-4o-mini" }, ...] }
```

Response (failure):

```json
{ "ok": false, "errorClass": "...", "error": "neutral message" }
```

Closed neutral error codes (route-level + allowlisted ConnectorErrorCode
from §9):

```text
invalid-body / invalid-json / malformed-authRef / secret-looking-key /
preset-unknown / settings-invalid / blocked-network /
capability-not-supported / auth-failed / rate-limited /
network-unreachable / response-too-large / external-system-unavailable /
internal-error
```

(No new `discovery-not-supported` — review edit 6. A family without
`listModels` surfaces `capability-not-supported`.)

Audit (neutral):

```ts
auditConnectorModelsDiscover({
  presetId, status: "success" | "failed", errorCode?,
  modelCount?,   // number only, not the ids
});
```

Status code map: 200 ok; 400 for body/preset/family/settings; 422 for
blocked-network (semantically not-allowed) or use 400 (consistency with
/api/connectors); 502 for upstream / external-system-unavailable / 3xx;
504 for timeout (or fold into external-system-unavailable). Default: keep
all neutral failures at 400 to match /api/connectors; this avoids leaking
upstream behaviour through HTTP status (open question — see §17 Q3).

---

## 7. Hardening — `effectiveSignal` (`src/kernel/connectors/timeout.ts`)

LOCKED — one design. The HTTP family's fetch currently uses `ctx.signal`
IF present and **no fallback otherwise** (a hung server can hang invoke
forever). M4a-5 always derives a bounded effective signal.

```ts
const DEFAULT_INVOKE_MS    = 30_000;  // chat.generate
const DEFAULT_TESTCONN_MS  = 10_000;  // testConnection /models ping
const DEFAULT_DISCOVERY_MS = 15_000;  // listModels

/**
 * Always returns a BOUNDED signal. A `ctx.signal` operator cancellation
 * is honoured AND combined with the family's default timeout, so a
 * long-running operator signal cannot mask a hung fetch.
 *
 * Requires Node ≥20 (`AbortSignal.any`, `AbortSignal.timeout`). The
 * `package.json` `engines` field MUST pin Node ≥20 before this lands;
 * if the repo is ever forced onto Node <20, swap in a tiny polyfill
 * (an EventTarget that fires when either source aborts).
 */
export function effectiveSignal(
  ctxSignal: AbortSignal | undefined,
  defaultMs: number,
): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(defaultMs);
  if (!ctxSignal) return timeoutSignal;
  return AbortSignal.any([ctxSignal, timeoutSignal]);
}
```

Used wherever the openai-compatible-llm family calls `fetch` (and any
later HTTP family). **No boolean toggle, no `combine` option** — the
combined signal is always the rule.

Test assertions (locked):

```text
- no ctx.signal: effectiveSignal fires within DEFAULT_*_MS (aborted=true)
- an ALREADY-aborted ctx.signal aborts the effective signal immediately
- a long-running ctx.signal does not mask the default timeout — the
  effective signal aborts at DEFAULT_*_MS even if ctx.signal hasn't
  fired
- the effective signal carries `.reason` from whichever source aborted
  first (informational; not user-facing)
```

**Node version note.** Before PR A lands, confirm the repo's
`package.json` declares `"engines": { "node": ">=20" }`. If it doesn't
yet, that bump is part of PR A (Node 20 has been LTS-stable since
Apr 2023; current build/test infra already runs on it). If for any
reason Node <20 must be supported, replace `AbortSignal.any` with a
small `EventTarget`-based polyfill in `timeout.ts` (the rest of the
API stays the same).

---

## 8. Body cap — `readBoundedJson`

```ts
export async function readBoundedJson<T = unknown>(
  res: Response,
  maxBytes: number,
): Promise<{ ok: true; value: T } | { ok: false; reason: "too-large" | "invalid-json" }>;
```

Streams `res.body` chunk-by-chunk, tallies bytes, aborts the reader and
returns `too-large` past the cap; otherwise concats and JSON-parses;
malformed JSON → `invalid-json`.

**This cap is NOT a context-window limit.** It limits **HTTP response
bytes read into Node memory** — nothing about model context capacity,
prompt budgets, or 200k / 1M-token windows. Those are model-side
concerns and unaffected. A 2 MB cap on the JSON BODY is roughly
hundreds of thousands of tokens worth of structured text; if a real
provider response ever exceeds it we raise the constant, not the model
context.

Caller translation:

```text
readBoundedJson reason     -> family-emitted ConnectorErrorCode
  "too-large"              -> "response-too-large"      (NEW — §9 allowlist)
  "invalid-json"           -> "external-system-unavailable"
```

Defaults — named constants in `bodyCap.ts`, easy to bump:

```text
CHAT_GENERATE_MAX_BYTES   = 2 MB    (raise if real workflows demand it)
TEST_CONNECTION_MAX_BYTES = 256 KB  (/models ping)
LIST_MODELS_MAX_BYTES     = 2 MB    (large catalogues like OpenRouter)
```

Open Question 4 — exact cap sizes. Defaults above. They are byte budgets
for ONE HTTP response body, not anything model-context-related.

---

## 9. Closed RouterErrorCode union — `src/kernel/capabilities/errorCodes.ts`

```ts
export type RouterErrorCode =
  | "connector-returned-failure"
  | "connector-invoke-threw"
  | "config-invalid"
  | "connector-unknown"
  | "permission-denied";

export const ROUTER_ERROR_CODES: ReadonlySet<RouterErrorCode> = new Set([
  "connector-returned-failure",
  "connector-invoke-threw",
  "config-invalid",
  "connector-unknown",
  "permission-denied",
]);

export function isRouterErrorCode(x: unknown): x is RouterErrorCode {
  return typeof x === "string" && ROUTER_ERROR_CODES.has(x as RouterErrorCode);
}
```

`CapabilityInvokeResult.errorCode` is typed `RouterErrorCode | undefined`
— a `CapabilityRouter` implementation cannot emit an arbitrary string at
compile time. A test asserts `isRouterErrorCode(result.errorCode)` for
every failure path.

The fifth member — `permission-denied` — is emitted by the scheduler's
mission-runner adapter (`src/features/scheduler/missions/runner.ts`)
BEFORE the real router is reached. The adapter implements
`CapabilityRouter`, so its errorCode sits on the router-contract
surface; it is NOT a `ConnectorErrorCode`. The remaining four codes
remain the router's own sanitisation outputs per ADR-0012 / B13.

**RouterErrorCode vs ConnectorErrorCode — explicit boundary.**

`CapabilityInvokeResult.errorCode` (`router.invoke()`) carries
**router-contract `RouterErrorCode` values ONLY**. The router collapses
a connector's own errorCode (whatever string the connector returned or
threw) to one of the four sanitisation members; the mission-runner
adapter additionally emits `permission-denied`. Both layers share the
same closed union, per ADR-0012 / B13. There is no widening to
`ConnectorErrorCode` values.

Connector-facing APIs are **not** capability invocations. They MAY
surface allowlisted `ConnectorErrorCode` values directly:

```text
/api/connectors/[id]/test               (M4a-1 / runConnectorTest)
/api/connectors/models/preview          (M4a-5)
/api/connectors                          (M4a-3b add-provider)
```

Allowlisted `ConnectorErrorCode` values that may pass through these
non-invoke surfaces:

```text
auth-failed         auth-missing         rate-limited
network-unreachable response-too-large   blocked-network
capability-not-supported                  capability-unavailable
external-system-unavailable               binary-not-found
config-invalid                            unknown
```

Add `ConnectorErrorCode` to the closed neutral surface — but `auth-failed`,
`rate-limited`, `blocked-network`, `response-too-large`, and
`capability-not-supported` MUST stay in this allowlist; they are the
codes the UI relies on to render targeted messages.

Do NOT widen `RouterErrorCode` to reuse these connector codes. The two
unions stay disjoint. The router emits ONLY router codes; the connector
APIs emit ONLY connector codes (validated through this allowlist).

The `ConnectorErrorCode` union itself is amended by §8 to add
`response-too-large` — kept in the connector-side family, not the
router-side family.

---

## 10. IPv4-compatible IPv6 hardening

Extend `isPrivateIPv6` in `src/kernel/connectors/ssrf.ts`:

```text
::a.b.c.d  (IPv4-compatible, RFC 4291 §2.5.5.1 — DEPRECATED but
            still parseable by some stacks). Extract the dotted IPv4
            and feed through isPrivateIPv4.
```

Same pattern PR #21 added for `::ffff:a.b.c.d`.

**Policy — locked default (Open Question 5):**

> Block `::a.b.c.d` ONLY when the embedded IPv4 is private (per
> `isPrivateIPv4`). Public embedded IPv4 (e.g. `::1.1.1.1`) is NOT
> blocked under this default — the deprecated form pointing at a public
> address is unusual but not inherently dangerous.

**Implementer must NOT silently widen this to "block all
`::a.b.c.d`".** That stricter alternative is on the table (belt-and-
braces, blocks legitimate-if-rare public mapped addresses) but only on
an explicit Rex decision; the default ships as written. Test list
asserts both halves: blocks `::127.0.0.1` / `::169.254.169.254` /
`::10.0.0.5`; allows `::1.1.1.1`.

---

## 11. UI changes — Add Provider "Load models"

In `PresetForm` (`AddProviderFlow.tsx`):

```text
- Model field STAYS a text input. Manual entry is always available — the
  input is NEVER disabled, cleared, or hidden by a discovery failure.
- Show a "Load models" button next to the Model field WHEN:
    family is openai-compatible-llm (preset.typeFamily check)
    OR family has listModels declared (future-proof).
- onClick:
    setLoadingModels(true)
    discoverModels({ presetId, authRef: envVar ? `env:${envVar}` : undefined,
                      settings: { baseUrl /* NO model */ },
                      allowLocalNetwork })
    on success -> render the ModelPicker below the field
    on failure -> render a small neutral message:
                  "Could not load models — <neutral errorCode>. Enter a
                  model id manually."
                  (errorClass surfaced verbatim per §9 allowlist:
                  auth-failed / blocked-network / response-too-large /
                  capability-not-supported / etc.)
    in all cases:
      form stays submittable
      Model field stays editable
      operator can type a model and POST /api/connectors — save still
      enforces normal validation (incl. SSRF, secret-key screen, full
      family.settingsSchema with `model` required); if the underlying
      issue is real, SAVE still fails with the same neutral errorCode.
- ModelPicker:
    a typeahead — controlled query input
    filters the model list client-side (substring match)
    Order:
      deterministic; PRESERVE provider order (no implicit sort)
      operator search filters the rendered list
    Render cap:
      cap visible rows at top-200 filtered results
      when filtered N > 200, show a small banner at the bottom of the
      list: "Showing first 200 of N matches — refine search"
    Keyboard:
      ↑/↓ move highlight, Enter select, Esc close
      Esc behaviour:
        closes the picker
        KEEPS focus on the Model field
        does NOT clear any value the operator typed in the Model field
    Selecting a model:
      fills the Model text field
      closes the picker
    role="listbox" + aria-activedescendant (minimum a11y; full focus-trap
    work stays the tracked follow-up from PR #22).
```

Component a11y at the modal level (role="dialog", aria-modal, focus
trap, Escape-closes-modal) is the tracked follow-up from PR #22 —
**M4a-5 PR C does NOT redesign Modal accessibility wholesale**, but the
new picker itself satisfies `role="listbox"` + `aria-activedescendant`
and the keyboard map above. Full modal a11y stays the tracked
follow-up.

---

## 12. Audit + neutral logging

```text
connector.models.discover  { presetId, status, errorCode?, modelCount? }
```

**Audit calls are AWAITED — deterministic before the response returns.**
PR3b set the precedent (`POST /api/connectors` awaits
`auditConnectorAdd`); `runDiscoverModels` does the same for
`auditConnectorModelsDiscover`:

```ts
const audit = (status: "success" | "failed", errorCode?: ConnectorErrorCode) =>
  auditConnectorModelsDiscover({ presetId, status, errorCode, modelCount });

await audit("success", undefined);    // success path
await audit("failed", "auth-failed"); // each failed path
return result;
```

This is non-optional: tests assert the audit line is present before the
response resolves, so a fire-and-forget audit would race.

NEVER in audit (or in console logs, or in any response body):

- the resolved authRef value
- the env var name
- the provider's response body
- any model ids
- the baseUrl, the model, or any settings values
- the Authorization header
- ctx.secret
- a raw stack / fetch error / provider error body

`modelCount` is a non-sensitive number useful for ops ("how often does
OpenRouter return 350 models"); it is the ONLY non-id field allowed.

Console logging stays neutral (req 1 / spec v2.1 §11) — never the raw
fetch error / stderr / provider response body.

---

## 13. Tests

`tests/timeout-helper.test.ts`:

```text
- effectiveSignal(undefined, ms) aborts within ms (no ctx.signal -> timed)
- effectiveSignal(alreadyAbortedSignal, ms) returns a signal that is
  ALREADY aborted (operator pre-cancellation honoured)
- effectiveSignal(longRunningSignal, ms) STILL aborts at ms — a
  long-running ctx.signal cannot mask the default timeout
- Node >= 20 (AbortSignal.any / AbortSignal.timeout) is asserted in
  package.json engines
```

`tests/body-cap.test.ts`:

```text
- readBoundedJson under-cap returns { ok: true, value }
- exactly-at-cap is ok
- over-cap aborts and returns { ok: false, reason: "too-large" }
- malformed JSON returns { ok: false, reason: "invalid-json" }
- a too-large response leaves no partial value in the result
- caller-side (openai-compatible-llm tests): over-cap maps to
  ConnectorErrorCode "response-too-large", NOT
  "external-system-unavailable"
```

`tests/router-error-codes.test.ts`:

```text
- every existing capability-router.test.ts failure path emits a
  RouterErrorCode (isRouterErrorCode === true)
- CapabilityInvokeResult is now typed RouterErrorCode | undefined
  (compile-time guard)
```

`tests/ssrf-guard.test.ts` (extend):

```text
- isPrivateIPv6("::127.0.0.1")           === true
- isPrivateIPv6("::169.254.169.254")     === true
- isPrivateIPv6("::10.0.0.5")            === true
- isPrivateIPv6("::1.1.1.1")             === false  (public; default policy)
- assertPublicBaseUrl("https://[::127.0.0.1]/v1") rejects
```

`tests/connector-registry.test.ts` (or extend the existing registry test):

```text
- registration-time invariant: a family declaring `listModels` MUST also
  declare `modelDiscoverySettingsSchema`. A test fixture that declares
  one without the other throws at registration time. The real registered
  families satisfy the invariant: `openai-compatible-llm` has both;
  `cli-acp-agent` has neither.
```

`tests/connector-discovery.test.ts`:

```text
- openai-compatible-llm.listModels validates ONLY baseUrl (not `model`):
    settings { baseUrl: "https://x/v1" } -> proceeds to fetch
    settings { /* no model */ }          -> proceeds to fetch (NOT
                                            settings-invalid)
- 200 with { data: [{ id }, ...] } -> ok: true, models: [{ id }, ...]
- 401  -> ok: false, errorCode: "auth-failed"
- 429  -> ok: false, errorCode: "rate-limited"
- 302  -> ok: false, errorCode: "network-unreachable" (B11 — Location
        never read or surfaced)
- body > cap -> ok: false, errorCode: "response-too-large"   (§8 / §9)
- malformed JSON -> external-system-unavailable
- a thrown fetch -> external-system-unavailable (no raw error in result)
- the resolved secret never appears in the returned result
```

`tests/api-connectors-models-preview.test.ts`:

```text
- discovery DOES NOT require `model`: a body without `settings.model`
  succeeds at the discovery-validation gate and proceeds to the family
  call (the result depends on the family / fake fetch).
- preset-unknown, secret-looking-key, malformed-authRef, blocked-network
  match the /api/connectors POST handler's behaviour and audit failed
  attempts neutrally (req 4 from PR #21 review; deterministic — the
  audit is awaited per §12).
- a family without listModels -> **capability-not-supported (400)** —
  the existing ConnectorErrorCode; NOT a new code.
- a 200 over-cap provider body -> response-too-large.
- happy path against a family-with-fake-fetch returns a model list.
- the audit line carries connector.models.discover with no raw values
  (no model ids, no baseUrl, no env var name, no Authorization).
- CORS gate rejects cross-site origin.
- content-length cap (64 KB) returns 413 invalid-body.
- runDiscoverModels failure does NOT block a subsequent
  POST /api/connectors save with the same payload + a manually-typed
  `model` — i.e. discovery and save are orthogonal (issue #24 / spec §1
  exit criteria). Save still enforces full validation; if the SAME
  underlying issue is real (e.g. blocked-network), save fails with the
  same neutral errorCode.

- ENV VAR NAME NON-LEAK (explicit):
    Setup:
      process.env.OPENAI_API_KEY = "sk-test-redacted-marker-XYZ"
      body.authRef = "env:OPENAI_API_KEY"
    Assertions (must ALL hold across success AND every neutral failure
    path — auth-failed, blocked-network, rate-limited, etc.):
      - HTTP response body                  contains neither "OPENAI_API_KEY"
                                            nor "sk-test-redacted-marker-XYZ"
      - audit line (captured via test seam) contains neither
      - the captured outbound fetch URL     contains neither
      - the captured outbound Authorization header is "Bearer sk-test-..."
        but is NEVER echoed back into the result, the audit, or any log line
      - console.error / console.warn (spied) contains neither, on every path
    The same assertions apply when authRef is "none" or absent (no
    Authorization header should appear in either fetch or any surface).
```

UI (manual verification — same checklist as PR #22):

```text
- Add Provider opens, picks OpenAI, Load models -> picker shows
- Type to filter, ↑/↓ navigate, Enter select
- Failure case: discovery 401 -> neutral message, manual entry still works
- Failure case: SSRF block (custom endpoint pointing at 127.0.0.1) ->
  neutral, manual entry still works
- Ollama preset with allowLocalNetwork -> Load models works against the
  local endpoint
```

All existing tests must still pass.

---

## 14. Acceptance script (Rex runs this before approving M5)

```text
Step 1 — Hardening verified by automated tests (above).
Step 2 — Load models against OpenAI preset works in the UI; picker is
         searchable; selecting fills the field.
Step 3 — Load models against OpenRouter returns a large list; search /
         typeahead is responsive (filtered list bounded).
Step 4 — Load models against Ollama (local) works ONLY when the preset
         declares `allowLocalNetwork: true` AND the local endpoint
         responds. Without it -> blocked-network neutral message.
Step 5 — Custom endpoint pointing at 127.0.0.1 with no allowLocalNetwork:
         Load models fails neutrally with errorClass "blocked-network".
         Manual model entry STAYS available in the UI (the Model text
         input is not disabled, cleared, or hidden).
         BUT — pressing Save with that same private baseUrl + a manually
         typed model ALSO fails with "blocked-network" (POST /api/connectors
         enforces the SAME SSRF guard at config-add time). Saving only
         succeeds after the operator enables allowLocalNetwork (or
         changes the baseUrl). Discovery and save are orthogonal:
         discovery failure does not BLOCK manual entry, but it does not
         BYPASS save validation either.
Step 6 — A 401 from the provider -> neutral message; the form stays open;
         the connector is NOT created on a failed Load models.
Step 7 — Inspect audit + responses: no API key, no Authorization header,
         no raw provider body, no env var NAME leak.
Step 8 — npm run typecheck && npm test  -> all green.
Step 9 — npm run build  -> succeeds (next-env.d.ts drift restored).
```

---

## 15. PR breakdown — one sub-PR = one PR

```text
PR A — Connector hardening (foundation; no UI)
  timeout.ts, bodyCap.ts, errorCodes.ts
  router.ts (use RouterErrorCode)
  ssrf.ts (IPv4-compatible IPv6)
  family.ts of openai-compatible-llm (use effectiveSignal + readBoundedJson)
  tests/{timeout-helper, body-cap, router-error-codes, ssrf-guard ext}.test.ts
  capability-router test extension
  DoD: typecheck + tests green; existing router contract preserved.

PR B — Discovery backend (no UI)
  types.ts (ConnectorFamilyDefinition.listModels?, ConnectorModelsResult)
  openai-compatible-llm listModels()
  discovery.ts (runDiscoverModels)
  /api/connectors/models/preview/route.ts
  audit.ts (auditConnectorModelsDiscover)
  tests/{connector-discovery, api-connectors-models-preview}.test.ts
  DoD: backend discovery works via fake fetch; route covered; audit
       neutral; manual fallback unaffected.

PR C — UI: Load models + searchable picker
  ModelPicker.tsx
  AddProviderFlow.tsx (Load models button + picker placement)
  api.ts (discoverModels helper)
  DoD: §13 manual verification checklist passes against the M4a-running
       app.
```

Stacked PRs are fine; per-step git approval applies regardless. Any sub-PR
can be deferred (e.g. PR C only) if scope contracts.

---

## 16. Done definition

M4a-5 is **DONE** when:

```text
✓ Every HTTP family fetch goes through effectiveSignal + readBoundedJson.
✓ assertPublicBaseUrl blocks IPv4-compatible IPv6 forms whose embedded
  IPv4 is private.
✓ CapabilityInvokeResult.errorCode is a closed RouterErrorCode union;
  the router cannot emit a raw string.
✓ POST /api/connectors/models/preview returns a neutral, projected
  ConnectorModelsResult for openai-compatible-llm presets; other
  families return `capability-not-supported` (existing
  ConnectorErrorCode — no new code).
✓ Discovery validates only what discovery needs (`baseUrl` etc.);
  `model` is NOT required for /models calls.
✓ ConnectorErrorCode union includes `response-too-large`, mapped from
  readBoundedJson "too-large".
✓ Add Provider UI exposes Load models + a searchable picker; manual
  model entry stays available; discovery failure does not block manual
  model entry or attempting save; config-add still enforces normal
  validation (a real blocked-network / settings-invalid / preset-unknown
  /malformed-authRef cause that surfaces at discovery ALSO blocks save
  until the underlying issue is fixed).
✓ No secret / raw provider response / authRef value / private path
  appears in any UI / audit / log line.
✓ npm run typecheck, npm test, npm run build all pass; no regression.
✓ Doc sync: ARCHITECTURE updated with the discovery surface; ADR-0017
  amended (or a small follow-on ADR) if the RouterErrorCode union change
  is structural.
✓ Rex signs off via "M4a-5 verified, proceed to M5" (or defers to M5
  and revisits later).
```

---

## 17. Open questions for Rex (decide before M4a-5 starts, or accept defaults)

1. **POST `/api/connectors/[id]/models` (saved-connector discovery)?**
   Default: **defer**. The pre-save flow covers the primary UX. Adds a
   "Refresh model list" button later if needed.
2. **HTTP status codes for discovery failures.** Default: **400** for every
   neutral failure (mirrors `/api/connectors`). Alternative: use 502/504
   for upstream / timeout — leaks the failure shape. Default keeps it
   uniform.
3. **Body-cap sizes.** Default: chat.generate 2 MB; testConnection 256 KB;
   listModels 2 MB. Named constants in `bodyCap.ts`. NB: these are
   HTTP-body byte budgets, not model-context-window sizes (§8).
4. **IPv4-compatible IPv6 policy.** Default: block ONLY when the embedded
   IPv4 is private (same rule as IPv4-mapped). Alternative: block ALL
   `::a.b.c.d` (deprecated form); stricter. Default: same rule. (§10
   warns the implementer not to silently widen.)
5. **Picker behaviour for very large catalogues (OpenRouter).** Default:
   client-side search + cap render to top-200 filtered results, with the
   banner "Showing first 200 of N matches — refine search". Provider
   order preserved (no implicit sort). Alternative: virtualised list.
   Default: cap + search + banner.
6. **`label` / `flags` per model.** Default: surface only `id` from
   `/models`. Some providers include `owned_by` / `created`; we don't
   surface those in M4a-5. A future enhancement.
7. **UI test harness for PR C (component tests for ModelPicker /
   AddProviderFlow).** This is M4a-5's first real UI behaviour
   (async server call, searchable picker, keyboard nav, manual-fallback
   guarantee) — PR #22 deliberately skipped a test harness because the
   UI was a thin renderer; PR C is not. Default: **defer** the test
   harness — rely on the manual verification checklist (§13 / §14)
   unless PR C grows beyond the locked picker behaviour, in which case
   bring in `@testing-library/react` + `jsdom` (or `happy-dom`) as a
   small new dev dep and add at least one smoke test for the picker.
   Alternative (Option A): install the test harness up front as part of
   PR C. Default: defer; revisit if PR C scope grows.

If Rex skips these, the defaults apply.

---

**End of M4a-5 task spec (v1.2, design only).** v1.2 folds the
second-pass review (6 corrections) into v1.1 (which itself folded the
12-edit consolidated review). Nothing here authorises implementation.
M4a is complete and verified — PR #23 merged, closeout PR #26 merged,
and the §18 live acceptance passed (2026-05-23). The sole remaining
gate per §0 is **Rex's explicit go-ahead** to either start M4a-5 PR AB
(connector hardening + backend model discovery) or defer M4a-5 and
start M5 first.
