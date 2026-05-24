# M4a-5 — live acceptance checklist

**Purpose:** Operator-side acceptance steps Rex runs against a live
running server before pronouncing **M4a-5 verified**. M4a-5 ships two
slices: backend hardening + backend model discovery (PR #29) and the
Add Provider UI picker (PR #30). Both are on `main`. This checklist
exercises the user-facing surface and the security non-leak invariants.

**Pre-requisites**

- `main` at or after merge `1a246c3` (PR #30).
- `npm install && npm run typecheck && npm test && npm run build` pass on
  a clean checkout. Then `git checkout -- next-env.d.ts` (the build
  rewrites it; ADR-0014 / known gotcha).
- A real `OPENAI_API_KEY` set in the server process's environment.
- An existing OpenAI-compatible connector already saved through the
  `M4A-ACCEPTANCE.md` flow (e.g. `openai-live` from the M4a operator
  pass). If absent, run M4A-ACCEPTANCE Steps 1–2 first to create one.

**How to use this file**

Tick each step. A step is "passed" when ALL acceptance lines under it
hold. Open a follow-up issue if any step fails — do not declare M4a-5
verified.

---

## Step 1 — Backend discovery route reachable + secret-safe

Pre-save model discovery against the saved OpenAI connector's preset.
Hits `/api/connectors/models/preview` directly.

```bash
curl -X POST http://127.0.0.1:3000/api/connectors/models/preview \
  -H 'content-type: application/json' \
  -H 'origin: http://127.0.0.1:3000' \
  -d '{
    "presetId": "openai",
    "authRef": "env:OPENAI_API_KEY",
    "settings": { "baseUrl": "https://api.openai.com/v1" }
  }'
```

```text
[ ] Response is 200 with `ok: true` and a `models: [{ id }, ...]` array
    that includes at least one real OpenAI model (e.g. `gpt-4o-mini`).
[ ] Response body contains NO env-var NAME (`OPENAI_API_KEY`), NO
    `sk-...` key VALUE, NO Authorization header echo.
[ ] Audit log `connector.models.discover` line is on disk by the time
    the response returns (deterministic awaited audit):
       tail -n5 ~/.agentic-os/audit/$(date -u +%Y-%m-%d).jsonl
       | grep connector.models.discover
[ ] The audit envelope carries `presetId`, `status`, optional
    `modelCount`. It does NOT carry `connectorId` (pre-save discovery
    never instantiates a connector). No model ids, no env var NAME,
    no baseUrl, no Authorization, no key value.
```

## Step 2 — SSRF blocks private addresses (incl. IPv4-compatible IPv6)

Three private-baseUrl probes against discovery without
`allowLocalNetwork`:

```bash
for url in 'http://127.0.0.1:11434/v1' 'http://169.254.169.254/latest/v1' 'http://[::127.0.0.1]/v1'; do
  echo "== $url =="
  curl -s -X POST http://127.0.0.1:3000/api/connectors/models/preview \
    -H 'content-type: application/json' \
    -H 'origin: http://127.0.0.1:3000' \
    -d "{\"presetId\":\"openai-compatible-custom\",\"settings\":{\"baseUrl\":\"$url\"}}"
done
```

```text
[ ] Each call returns 400 with errorClass "blocked-network".
[ ] `http://[::127.0.0.1]/v1` is also rejected — the IPv4-compatible
    IPv6 hardening from PR #29 catches it (Node's URL parser
    normalises `::127.0.0.1` to the hex form `::7f00:1`; the
    SSRF guard handles both).
```

## Step 3 — Add Provider picker — happy path

Settings → Connectors → **Add Provider** → pick **OpenAI** → in the
preset form:

```text
[ ] The Model field is now visible for the OpenAI preset (PR C
    intentionally renders it for all openai-compatible-llm presets,
    even when the preset declares a default — see PR #30 body note).
[ ] A "Load models" button sits next to the Model field. Click it.
[ ] Status flips to "Loading…" briefly, then the picker opens below
    the Model field.
[ ] The picker lists real OpenAI models in PROVIDER ORDER (no
    alphabetical re-sort).
[ ] If the catalog exceeds 200 entries, the banner reads
    "Showing first 200 of N matches — refine search."
```

## Step 4 — Searchable picker — keyboard map

In the Add Provider form, with the Model picker open:

```text
[ ] Typing "4o" into the Model field narrows the picker (case-
    insensitive substring on the model id).
[ ] ArrowDown / ArrowUp move the highlight, clamped to the visible
    list.
[ ] Pressing Enter fills the Model field with the highlighted id and
    closes the picker.
[ ] Pressing Escape closes the picker, keeps focus on the Model
    field, and does NOT clear the typed value.
[ ] Pressing Escape does NOT close the outer Add Provider modal
    (propagation stop is working).
[ ] Tab moves focus to the next form field and closes the picker
    (blur-close).
[ ] Re-focusing the Model input re-opens the picker (when models
    are loaded).
```

## Step 5 — Picker edge cases (zero matches; provider returned 0)

In the Add Provider form, with the Model picker open and a model list
loaded:

```text
[ ] Type something that matches nothing (e.g. "zzz-nonexistent").
    The picker shows the empty-state line:
       "No matches for "zzz-nonexistent" — keep typing or enter a
        model id manually."
[ ] Pressing Escape with an empty list STILL closes the picker
    (regression guard from PR #30 review fix `cf97971`).
[ ] Pressing Enter with an empty list does NOT submit the Add
    Provider form (regression guard, same commit).
[ ] If a provider returned an empty model list, the empty-state
    instead reads:
       "Provider returned no models — enter a model id manually."
```

## Step 6 — Discovery failure does NOT disable manual entry

In the Add Provider form, force a discovery failure (e.g. type an
obviously-broken env var NAME under the Advanced env-var path, or
point Base URL at `https://127.0.0.1/v1` without enabling
`allowLocalNetwork`):

```text
[ ] Click Load models. A neutral message appears in amber:
       "<friendly message> — enter a model id manually."
[ ] The Model input is NOT disabled. NOT cleared. NOT hidden.
[ ] You can still type a Model id manually and click Save.
[ ] Save proceeds; the connector is created if everything else is
    valid (config-add SSRF / settings / authRef checks still apply
    independently — discovery failure does not bypass save
    validation, and save success does not require a green discovery).
```

## Step 7 — Stale-result clearing on input change

In the Add Provider form, after Load models has run:

```text
[ ] Edit the Base URL (or env var name, or allowLocalNetwork toggle,
    or back-and-pick a different preset). The previous model list
    should disappear; the picker should not reopen with stale data.
[ ] The Model field itself stays untouched — manual entry intact.
[ ] Click Load models again. A fresh request fires; new results
    populate the picker.
```

## Step 8 — Successful Add returns to the Connectors list with a highlighted row

This step verifies the post-acceptance UX change: the Add Provider
modal no longer ends on a separate "Added <id>" result screen with
Close + Done buttons. After a successful add it auto-closes; the
new connector's testConnection result surfaces on the row itself.

```text
[ ] In the Add Provider form, click **Add** on a valid configuration.
[ ] The modal closes automatically — there is NO result screen with
    Close + Done in the middle. Three close-related buttons (Close
    + ← Back + Done) no longer exist; only the modal-header Close
    and (during the form step) the ← Back affordance.
[ ] You land back on the Connectors list. The new connector row is
    present (refresh ran automatically; no manual reload needed).
[ ] The new row has a brief visual highlight (ring + pulse) for
    ~3 seconds so it's easy to find. The highlight clears on its
    own; no manual dismiss.
[ ] The new row's RIGHT-SIDE STATUS PILL shows the test outcome
    at a glance — green dot + "valid" / red dot +
    "invalid"/"unreachable"/"misconfigured" / yellow dot +
    "unknown". The pill replaces the old "ENABLED" label, which
    is gone (it had no functional meaning without an
    enable/disable toggle and duplicated the per-row trust
    label on the left). Rows that have never been tested in
    this session show a dimmed "not tested" instead — never
    "ENABLED".
[ ] When the test result is **non-valid**, a BELOW-row detail
    line renders the actionable info — `errorCode <code>` and, for
    `auth-missing`, the "set the named env var; restart Agentic
    OS" hint. When the test result is **valid**, the row shows
    NO below-row detail line (the green pill on the right is the
    only status surface — no duplicate "valid" badge). This is
    the live-review fix: previously valid rows had BOTH a green
    pill on the right AND a green "valid" badge below; the
    duplicate is gone.
[ ] If the Add itself FAILS (e.g. duplicate id, blocked-network,
    settings-invalid), the modal stays open at the form step with a
    neutral submitError shown inline. The modal only auto-closes on
    Add success.
[ ] **Refresh the browser while viewing Connectors.** You stay on
    Connectors — the URL contains `?section=connectors` and the
    page hydrates with that section selected. Refresh from the
    Features tab keeps you on Features (the URL is empty or
    `?section=features`). Switching tabs updates the URL via
    `router.replace`; the back button is NOT polluted with one
    history entry per tab switch.
[ ] **Validation status survives a browser refresh** (FU5 —
    issue #36, shipped in PR B). After clicking Test on a row
    and getting a result (valid / invalid / unreachable /
    misconfigured / unknown), hard-refresh the browser. The row's
    right-side StatusPill should render the SAME status it had
    pre-refresh — NOT "not tested". The below-row detail line
    (errorCode + auth-missing hint when applicable) also
    reappears for non-valid outcomes.
[ ] **Server restart preserves validation status** (FU5 durability
    check). Kill the dev server, restart it, refresh the browser.
    The row's StatusPill still reads the previously-tested status.
    Validation state is persisted in `~/.agentic-os/state.db` via
    the `connector_health` table (M4a-FU5 PR A migration v2).
[ ] **Edited config falls back to "not tested"** (FU5 fingerprint
    invariant). Edit the connector's config (e.g. change the
    `model` field in `~/.agentic-os/config.yaml`, or use a future
    edit modal). Refresh. The row's StatusPill should read
    "not tested" — the fingerprint mismatch elides
    `lastValidation` from the API response so the operator is
    prompted to re-test after a config change rather than seeing
    a stale status.
[ ] **Broken-config status also survives refresh** (FU5 build-
    failure fingerprint path). With a connector that fails
    `buildConnectorContext` (e.g. an unset required env var → 
    `auth-missing`, or invalid settings → `config-invalid`),
    click Test once. Refresh. The row's StatusPill still reads
    the broken-config status — NOT "not tested". This proves the
    fingerprint fallback path (`fingerprintFromInstanceConfig`)
    matches between the test write site and the hydration read
    site.
[ ] **API does NOT expose `config_hash`** (FU5 §9 non-leak):
       curl http://127.0.0.1:3000/api/connectors | grep -i 'config[_-]\?hash\|fingerprint'
    MUST be empty. The fingerprint is server-internal; only the
    hydrated `lastValidation` object crosses the API boundary.
```

The trade-off: previously the operator saw "Added <id> · connection
test: <status>" in a dedicated modal step before Done; now they see
the same status on the new row's right-side status pill (and, for
non-valid outcomes, on a below-row detail line with the actionable
errorCode / hint). One source of truth (the row); one fewer click;
no contradiction between modal status and row status; no duplicate
"valid" labels.

## Step 9 — Save + secret hygiene sweep

After a successful Save through the picker:

```bash
KEY_PREFIX="sk-abc123"   # whatever the first 8 chars of your real key are
grep -r "$KEY_PREFIX" ~/.agentic-os/audit/   # MUST be empty
grep -r "$KEY_PREFIX" ~/.agentic-os/config.yaml  # MUST be empty
curl http://127.0.0.1:3000/api/connectors | grep "$KEY_PREFIX"  # MUST be empty
curl http://127.0.0.1:3000/api/runs       | grep "$KEY_PREFIX"  # MUST be empty
```

```text
[ ] All four greps return ZERO matches.
[ ] /api/connectors response carries `authRefKind: "env"` (or "none"
    / "unset" as applicable). MUST NOT contain the env var NAME or
    the `env:` prefix.
[ ] Audit lines carry only neutral envelopes — no Authorization
    header, no baseUrl in plaintext, no raw provider response, no
    env var NAME's resolved value.
```

## Step 10 — RouterErrorCode disjoint from ConnectorErrorCode

The router-side errorCode union is closed and disjoint per PR #29.
Verify via the existing test suite (no live probe needed; this is a
type invariant):

```bash
npm test -- router-error-codes 2>&1 | tail -5
```

```text
[ ] Tests pass. The closed 5-member RouterErrorCode set is enforced:
    config-invalid, connector-unknown, connector-invoke-threw,
    connector-returned-failure, permission-denied. ConnectorErrorCode
    values (auth-failed / blocked-network / response-too-large /
    rate-limited) are explicitly asserted as NOT members.
```

## Step 11 — Build / test green

```bash
cd /path/to/agentic-os
git checkout -- next-env.d.ts || true
npm run typecheck
npm test
npm run build
git checkout -- next-env.d.ts          # build rewrites it; ADR-0014
```

```text
[ ] typecheck — clean.
[ ] tests — all green; 66 files / 630 tests at minimum.
[ ] build — succeeds.
```

## Step 12 — Sign-off

```text
[ ] All steps 1–11 pass.
[ ] Recorded in the AutoMem current-state memory file: "M4a-5
    verified".
[ ] Open follow-ups remain parked: #25 (M4a-FU2 Hermes Kanban test
    hardening), #27 (M4a-FU3 user-facing /api/capabilities/invoke).
[ ] Rex marks M4a-5 verified: "M4a-5 verified — start M4a-6a PR"
    (the provider catalog sub-milestone) OR "M4a-5 verified — defer
    M4a-6 and start M5".
```

---

**Out of scope for this checklist** (do NOT block acceptance on these):

- **M4a-6** — Provider catalog + UI-managed connector secrets. Spec
  is tracked in a follow-up spec PR (split into sub-milestones
  **M4a-6a** provider catalog expansion + **M4a-6b** UI-managed
  connector secrets); not yet on `main` when this closeout PR was
  prepared, so this checklist does not link directly to the spec
  file. No M4a-6 code shipped.
- **M4a-FU2 / #25** — Hermes Kanban test hardening.
- **M4a-FU3 / #27** — user-facing HTTP `/api/capabilities/invoke` route.
- **M5** — artifacts + approvals (separate milestone).
