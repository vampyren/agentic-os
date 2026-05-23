# M4a — live acceptance checklist

**Purpose:** Operator-side acceptance steps Rex runs against a real running
server before pronouncing **M4a verified**. Reformats `m4-task-spec.md` v2.1
§18 (and pulls in the doc-sync done-criteria from §20) into a sequenced
checklist with verification commands.

**Pre-requisites**

- M4a code merged to `main` (PRs #18 → #23 — all merged).
- `npm install && npm run typecheck && npm test && npm run build` pass on a
  clean checkout. (Then `git checkout -- next-env.d.ts` — the build rewrites
  it; ADR-0014 / known gotcha.)
- A scratch shell with `OPENAI_API_KEY` set to a real key the operator
  controls.
- Hermes binary on `$PATH` AND a Hermes agent manifest declaring `bin` —
  otherwise Step 6 will fail with `binary-not-found` (expected behaviour
  for a missing setup, but not what we are acceptance-testing).

**How to use this file**

Tick each step. A step is "passed" when ALL acceptance lines under it
hold. Open a small follow-up issue if any step fails — do not declare
M4a verified.

---

## Step 1 — `cli-acp-agent` via the shipped HTTP surfaces

**Important — no `/api/capabilities/invoke` exists in M4a.** The
capability router is internal: it is exercised by tests and by
`runConnectorTest` (`/api/connectors/[id]/test`). For agent runs the
existing `POST /api/agents/[name]/run` route still uses the legacy
agent `registry` (pre-M4a code), NOT the capability router — that
route is unchanged by M4a. A user-facing HTTP capability-invoke route
is **tracked as a follow-up** (see *Follow-ups* at the bottom of this
file), NOT part of M4a's acceptance.

What M4a's `cli-acp-agent` family is verified by:

```bash
# (a) testConnection for the Claude Code instance via the router:
curl -X POST http://127.0.0.1:3000/api/connectors/claude-code/test
# (b) testConnection for the Hermes instance via the router:
curl -X POST http://127.0.0.1:3000/api/connectors/hermes/test
```

```text
[ ] Each returns 200 with `ok: true` and a neutral validation envelope
    (no agent stderr, no binary path, no `~/.claude` / `~/.hermes`).
[ ] curl http://127.0.0.1:3000/api/runs returns the two NEW
    `connector-test` runs with status: "succeeded".
[ ] /api/runs/<id> on each shows a neutral inputSummary; no raw paths;
    no agent stderr.
[ ] Audit log line for each carries `connector.test` with neutral
    fields only.
[ ] router-level `agent.run` invocation is covered by the M4a-2 unit
    tests (`tests/cli-acp-connector.test.ts`) — recorded green in Step 9.
```

## Step 2 — Add Provider (Settings UI)

Settings → Connectors → Add Provider. Pick **OpenAI**. The auth dialog
asks for an **ENV VAR NAME** (not a key — label reads "env var name").
Supply `OPENAI_API_KEY`. Click Save.

```text
[ ] The form refuses to advance if a string that does not match the env
    var name shape `^[A-Za-z_][A-Za-z0-9_]*$` is typed into the env-var-
    name field — common real key shapes such as `sk-abc123...` contain
    `-` (a separator), so they are rejected by the **AUTHREF_REGEX**
    server-side (and by the client-side shape check). This is NOT the
    same as the B4 secret-key screen — B4 rejects secret-looking
    *setting key names* (`apiKey`, `token`, …); the env-var-name check
    rejects authRef values that are not a clean identifier. Both run.
[ ] If the operator does manage to type something that *does* match the
    env var name shape but is actually their API key, the server still
    saves it as `authRef: "env:<the-string>"` and treats it as the name
    of an env var to look up — `process.env[<the-string>]` returns
    undefined, testConnection fails neutrally with `auth-missing`, and
    nothing about the typed value is ever logged.
[ ] testConnection runs as part of Save — the result shows inline.
[ ] The connector is created with `enabled: true`.
[ ] cat ~/.agentic-os/config.yaml — the entry stores
    authRef: "env:OPENAI_API_KEY"; NO `sk-...` value appears anywhere.
[ ] The Add Provider modal closes; the connector row appears in the
    Connectors panel.
```

## Step 3 — `chat.generate` end-to-end

**`/api/capabilities/invoke` does not exist in M4a** (see Step 1). The
`openai-compatible-llm` family's `invoke()` is exercised by
`testConnection` (which calls the family's validator path against
`<baseUrl>/models`) and by the unit tests; a no-code live `chat.generate`
HTTP probe is tracked as a follow-up.

What M4a verifies live:

```bash
# testConnection against the saved OpenAI instance — this DOES hit the
# real OpenAI host, with `Authorization: Bearer <ctx.secret>`:
curl -X POST http://127.0.0.1:3000/api/connectors/<id-from-step-2>/test
```

```text
[ ] Response is 200 with `ok: true` — confirming the env var resolves,
    the Bearer auth lands, the SSRF guard accepts api.openai.com, and
    the family parses the response.
[ ] /api/runs shows a NEW `connector-test` run with status: "succeeded".
[ ] No code was written to add the provider — the Settings UI + the
    first-party preset were sufficient.
```

The router-internal `chat.generate` input shape (for when the future
`/api/capabilities/invoke` lands) is:

```json
{
  "capabilityId": "chat.generate",
  "connectorId": "<instance id>",
  "input": {
    "messages": [{ "role": "user", "content": "Say one word: pong." }]
  }
}
```

NOT `{ "prompt": "…" }` — the family rejects that with `invalid-input`.

## Step 4 — Disabled instance disappears from the surface

**Note — the Settings UI does NOT carry an enable/disable toggle today.**
The Connectors panel renders the `enabled` flag read-only (an "enabled" /
"disabled" badge next to a Test button); adding a toggle is a future UI
follow-up. So the only way to disable in M4a is to edit
`~/.agentic-os/config.yaml` and set the instance's `enabled: false`,
then restart (config is not hot-reloaded).

After disabling and restarting:

```bash
curl http://127.0.0.1:3000/api/connectors
curl -X POST http://127.0.0.1:3000/api/connectors/<id-from-step-2>/test
```

```text
[ ] The `/api/connectors` list response does NOT include the disabled
    instance (the route filters to enabled-only via
    `resolveConnectorInstances`).
[ ] `POST /api/connectors/<disabled-id>/test` returns a neutral failure —
    the disabled instance cannot be tested. (`/api/runs` records the
    failed connector-test attempt with a neutral errorCode.)
[ ] Internally the capability router collapses a known-but-disabled
    instance to `connector-unknown` per ADR-0012 (router.ts §dispatch),
    but that path is exercised by the unit tests, not by a shipped
    HTTP route in M4a.
```

Re-enable the connector in `config.yaml` and restart before continuing.

## Step 5 — SSRF guard rejects private endpoints

Try to add a custom OpenAI-compatible endpoint pointing at a private
address WITHOUT `allowLocalNetwork`. Try each in turn:

- `http://127.0.0.1:11434/v1`         (loopback)
- `http://169.254.169.254/latest/v1`  (AWS / cloud-instance metadata IP)
- `http://10.0.0.1/v1`                (RFC1918)
- `http://[::1]/v1`                   (IPv6 loopback)

```text
[ ] Add Provider Save returns 400 with errorClass "blocked-network" /
    errorCode "blocked-network" for EACH of the four addresses above.
[ ] No connector is created for any of them
    (re-list /api/connectors to confirm).
[ ] SSRF guard runs at config-add time AND testConnection time. At
    invoke time, redirect: "manual" prevents 3xx-based rebinding;
    DNS-TTL rebinding between testConnection and invoke is the named
    M4a-5 follow-up (NOT verified here).
[ ] Toggling `Allow local network` and re-saving the SAME baseUrl
    succeeds (assuming a local endpoint is actually reachable;
    otherwise it surfaces a neutral testConnection failure but the
    connector still saves).
```

## Step 6 — Hermes read-only Kanban

**As with Step 3, `kanban.*` capabilities are not HTTP-exposed in M4a**
(no `/api/capabilities/invoke`). The Hermes `kanban.board.list` /
`kanban.task.list` / `kanban.task.show` paths are verified by
`tests/hermes-kanban.test.ts` (9 tests covering projection, slug
guards, binary-not-found, missing-stderr-leak); they will become
HTTP-callable when the future capability-invoke route lands (see
follow-ups).

What M4a verifies live for the Hermes side:

- `POST /api/connectors/hermes/test` succeeds (Step 1 already covers this).
- The router-internal kanban paths are green in the test suite
  (Step 9).

Per-instance capability narrowing assertion (M4a is read-only by
design; M4a-FU2 / #25 adds explicit regression tests):

```text
[ ] tests/cli-acp-connector.test.ts asserts the family's advertised set
    is exactly {agent.run, kanban.board.list, kanban.task.list,
    kanban.task.show} — no kanban.task.create.
[ ] `kanban.task.create` has no advertising connector in M4a — calling
    it via the router must FAIL NEUTRALLY (no Hermes write path
    reached, no raw write attempt logged). The exact neutral errorCode
    is router-internal; the live assertion is "no advertising
    connector" via the registry probe — explicit regression test
    tracked in M4a-FU2 / #25.
[ ] A narrowed instance (e.g. a manifest declaring
    `capabilities: [agent.run]`) must NOT serve `kanban.board.list` —
    `runtime.ts` computes effective capabilities as the family ∩
    preset ∩ instance narrowing, and the router refuses any capability
    outside that set. Covered by router tests today and pinned as an
    explicit regression in M4a-FU2 / #25.
```

## Step 7 — Secret hygiene sweep

Inspect every M4a surface for the `OPENAI_API_KEY` *value* you supplied
in Step 2. (Substitute your real key's first 8 chars to grep.)

```bash
KEY_PREFIX="sk-abc123"   # whatever the first 8 chars of your real key are

grep -r "$KEY_PREFIX" ~/.agentic-os/audit/   # MUST be empty
grep -r "$KEY_PREFIX" ~/.agentic-os/config.yaml  # MUST be empty
curl http://127.0.0.1:3000/api/connectors | grep "$KEY_PREFIX"  # MUST be empty
curl http://127.0.0.1:3000/api/runs       | grep "$KEY_PREFIX"  # MUST be empty
```

```text
[ ] All four greps return ZERO matches.
[ ] cat ~/.agentic-os/config.yaml — the instance entry carries
    `authRef: "env:OPENAI_API_KEY"`. (The config DOES contain the env
    var NAME — that is intended; it is the lookup key, not the secret.)
[ ] /api/connectors response carries `authRefKind: "env"` ONLY (per
    the UI-safe projection in src/app/api/connectors/_shared.ts).
    It must NOT contain the env var name `OPENAI_API_KEY`.
    It must NOT contain the prefix `env:`.
    It must NOT contain the resolved secret value.
[ ] Audit lines carry `connector.test` (and any future capability.invoke)
    envelopes with neutral fields only — no Authorization, no baseUrl
    in plaintext, no raw provider response, no env var name's resolved
    value, no env var NAME either.
[ ] `Authorization` header NEVER appears in any audit / log / response.
```

## Step 8 — Build / test green

```bash
cd /path/to/agentic-os
git checkout -- next-env.d.ts || true   # in case build rewrote it
npm run typecheck
npm test
npm run build
git checkout -- next-env.d.ts          # build rewrites it; ADR-0014
```

```text
[ ] typecheck — clean.
[ ] tests — all green; no skipped tests beyond pre-existing xfail.
[ ] build — succeeds.
```

## Step 9 — Doc sync landed

```text
[ ] docs/decisions/ADR-0017-connector-runtime-and-authref.md — present.
[ ] docs/decisions/ADR-0018-connector-preset-catalog.md — present.
[ ] docs/ARCHITECTURE.md §8 (Connector runtime) — present.
[ ] docs/M4A-ACCEPTANCE.md — this file; merged.
```

## Step 10 — Sign-off

```text
[ ] All steps 1–9 pass.
[ ] Open follow-ups recorded:
      - issue #24 — M4a-FU1 (model discovery + picker; folded into the
        parked M4a-5 spec v1.2).
      - issue #25 — M4a-FU2 (Hermes Kanban test hardening).
    Both stay parked unless Rex authorises.
[ ] Rex marks M4a verified: "M4a verified, proceed to M4a-5 PR A" OR
    "M4a verified, defer M4a-5 and start M5".
```

---

**Follow-ups referenced above**

- **HTTP capability-invoke route.** `/api/capabilities/invoke` does NOT
  ship in M4a. Steps 1, 3, and 6 rely on `/api/connectors/[id]/test`
  and the test suite to verify router-driven behaviour. A user-facing
  capability-invoke HTTP route is a tracked follow-up (separate issue,
  not part of this PR).
- **Settings UI enable/disable toggle.** PR3c shipped a read-only
  enabled/disabled badge; toggling lives in a future UI follow-up.
- **DNS-TTL rebinding** between testConnection and invoke. The parked
  M4a-5 design covers request-time DNS re-resolution / IP-pinning.

**Out of scope for this checklist** (do NOT block acceptance on these):

- M4a-5 implementation. The parked design (`m4a-5-task-spec.md` v1.2)
  covers connector hardening (`effectiveSignal`, `readBoundedJson`,
  closed `RouterErrorCode` union, IPv4-compatible IPv6) + model
  discovery + searchable picker. Gated on Rex's explicit go-ahead per §0.
- M4a-FU2 (#25) test hardening — non-blocking regression tests for
  PR #23 (stdout cap, malformed projection, narrowed-instance refusal,
  write-capability refusal, audit privacy).
- M5 artifacts/approvals — a separate milestone.
- OAuth-mediated LLM family or native-vendor-API family — explicitly
  deferred in v8 §M4a.
