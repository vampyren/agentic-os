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

## Step 1 — `agent.run` via the router (cli-acp-agent)

Trigger `agent.run` through the capability router for the Claude Code
instance, then the Hermes instance. Each returns a real result, and a
`connector-test` / `capability.invoke` RunRecord appears in `/api/runs`.

```text
[ ] curl http://127.0.0.1:3000/api/runs returns the two runs (or a list
    containing them) with status: "succeeded".
[ ] /api/runs/<id> on each shows neutral inputSummary, no raw paths,
    no agent stderr.
[ ] Audit log line for each carries connector.test or capability.invoke
    with no `~/.hermes` / `~/.claude` path leak.
```

## Step 2 — Add Provider (Settings UI)

Settings → Connectors → Add Provider. Pick **OpenAI**. The auth dialog
asks for an **ENV VAR NAME** (not a key — label reads "env var name").
Supply `OPENAI_API_KEY`. Click Save.

```text
[ ] The form refuses to advance if a key shape (sk-... or similar) is
    typed into the env-var-name field (B4 / secret-key screen).
[ ] testConnection runs as part of Save — the result shows inline.
[ ] The connector is created with `enabled: true`.
[ ] cat ~/.agentic-os/config.yaml — the entry stores
    authRef: "env:OPENAI_API_KEY"; NO `sk-...` value appears anywhere.
[ ] The Add Provider modal closes; the connector row appears in the
    Connectors panel.
```

## Step 3 — `chat.generate` via the router (openai-compatible-llm)

Invoke `chat.generate` through the router against the new OpenAI
instance:

```bash
curl -X POST http://127.0.0.1:3000/api/capabilities/invoke \
  -H 'content-type: application/json' \
  -d '{
    "capabilityId": "chat.generate",
    "connectorId": "<the-instance-id-from-step-2>",
    "input": { "prompt": "Say one word: pong." }
  }'
```

```text
[ ] Response is `ok: true` with a real model answer.
[ ] /api/runs shows a capability-invoke run with status: "succeeded".
[ ] No code was written to add the provider.
```

## Step 4 — Disabled instance refuses neutrally

Disable the new OpenAI connector (Settings → toggle the row, or edit
`config.yaml` `enabled: false`) and re-invoke `chat.generate` against
the same `connectorId`.

```text
[ ] Response is `ok: false`, `errorCode: "connector-unknown"` (the
    router does not distinguish "disabled" from "missing" — ADR-0012).
[ ] No leaked instance state in the error envelope.
```

Re-enable the connector before continuing.

## Step 5 — SSRF guard rejects private endpoints

Try to add a custom OpenAI-compatible endpoint pointing at
`http://127.0.0.1:11434/v1` (or any private address) WITHOUT
`allowLocalNetwork`.

```text
[ ] Add Provider Save returns 400 with errorCode "blocked-network".
[ ] The connector is NOT created (re-list /api/connectors to confirm).
[ ] Toggling `Allow local network` and re-saving the SAME baseUrl
    succeeds (assuming a local endpoint is actually reachable;
    otherwise it surfaces a neutral testConnection failure but the
    connector still saves).
```

## Step 6 — Hermes read-only Kanban

`kanban.board.list` / `kanban.task.list` / `kanban.task.show` via the
router against the Hermes instance:

```bash
curl -X POST http://127.0.0.1:3000/api/capabilities/invoke \
  -H 'content-type: application/json' \
  -d '{ "capabilityId": "kanban.board.list", "connectorId": "hermes",
        "input": {} }'

curl -X POST http://127.0.0.1:3000/api/capabilities/invoke \
  -H 'content-type: application/json' \
  -d '{ "capabilityId": "kanban.task.list", "connectorId": "hermes",
        "input": { "boardId": "<a-real-board-id>" } }'

curl -X POST http://127.0.0.1:3000/api/capabilities/invoke \
  -H 'content-type: application/json' \
  -d '{ "capabilityId": "kanban.task.show", "connectorId": "hermes",
        "input": { "taskId": "<a-real-task-id>" } }'
```

```text
[ ] Each returns a neutral DTO (boards / tasks / task) — no `~/.hermes`
    path, no stderr text, no Hermes binary path in the result.
[ ] /api/runs entries are present and neutral.
[ ] `kanban.task.create` returns `connector-unknown` (no advertising
    connector — M4a is read-only by design).
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
[ ] /api/connectors response carries authRef: "env:OPENAI_API_KEY" only.
[ ] Audit lines carry connector.test / capability.invoke envelopes with
    neutral fields only — no Authorization, no baseUrl in plaintext, no
    raw provider response, no env var name's resolved value.
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

**Out of scope for this checklist** (do NOT block acceptance on these):

- M4a-5 implementation. The parked design (`m4a-5-task-spec.md` v1.2)
  covers connector hardening (`effectiveSignal`, `readBoundedJson`,
  closed `RouterErrorCode` union, IPv4-compatible IPv6) + model
  discovery + searchable picker. Gated on Rex's explicit go-ahead per §0.
- M4a-FU2 (#25) test hardening — non-blocking regression tests for
  PR #23.
- M5 artifacts/approvals — a separate milestone.
- OAuth-mediated LLM family or native-vendor-API family — explicitly
  deferred in v8 §M4a.
