# ADR-0017 — Connector runtime + authRef

**Status:** Accepted
**Date:** 2026-05-23

## Context

Phase 1C left the capability router as a working stub: it dispatched into
neutral results (ADR-0012) but had no real connectors behind it — no Claude
Code, no Hermes, no LLM provider. Every capability call was answered by a
stand-in. M4a turns that stub into real connector dispatch.

A connector is the runtime adapter between the capability router and an
external system (a CLI agent, an HTTP LLM endpoint, …). M4a needs four things
together, or none of them work:

1. **A connector identity model** the router can resolve, that does not
   conflate "a type of connector" with "the operator's specific instance" with
   "the catalog entry the operator picked from."
2. **An authentication-reference contract** the router can rely on without
   ever seeing a raw secret.
3. **A `connector-test` Run lifecycle** that uses the M3 run ledger
   (ADR-0016) — connector tests are runs, like everything else.
4. **A `safeSpawn`-shaped subprocess discipline** for CLI families and a
   neutral HTTP discipline for LLM families.

Without locking these together, every connector family invents its own
secret pathway, its own subprocess wrapper, and its own meaning of "instance."
That was the v0.1 mistake (ADR-0006); M4a refuses to repeat it.

## Decision

### Three-level connector identity

Locked in `src/kernel/connectors/types.ts`:

- **`ConnectorFamilyDefinition`** — the *type* of connector. Knows its
  `settingsSchema`, advertised `capabilities`, and family-specific
  `invoke` / `testConnection`. Lives in code, not config (e.g.
  `cli-acp-agent`, `openai-compatible-llm`).
- **`ConnectorPreset`** — a declarative pre-fill of a family's settings,
  picked from a catalog at Add-Provider time. Lives in JSON (see
  ADR-0018). Trust-clamped on load (`first-party` / `community` /
  `untrusted` — never upgraded).
- **`ConnectorInstanceConfig`** — the operator's specific configured
  copy. Lives in `~/.agentic-os/config.yaml`. Carries its own `id`,
  `enabled`, `authRef`, `settings`, optional capability narrowing, and an
  optional `allowLocalNetwork` opt-in. The instance id is what the router
  resolves; **`connectorId`** in `RunRecord`, audit envelopes, capability
  router calls, and `ConnectorInvokeContext` is the **instance id**, never
  the family id and never the preset id.

The three never blur. A family is registered in code; presets are loaded
from disk; instances are written to config by the Add-Provider flow
(PR3b / PR3c). Effective capabilities for an instance = `family.capabilities`
∩ `preset.capabilities` (if narrowed) ∩ `instance.capabilities` (if narrowed) —
narrowing only.

### authRef — env-only, name-only

`AuthRef` is one of two forms — closed union:

```
"none"
"env:VAR_NAME"        // VAR_NAME matches /^[A-Za-z_][A-Za-z0-9_]*$/
```

Locked rules:

- **The config stores `authRef`, never a raw key.** The `secrets.yaml`
  path that pre-M4a code referenced for a few feature flags is **not** the
  connector secret pathway; M4a's `authRef` resolves directly from
  `process.env` and only `process.env`. Operators put `OPENAI_API_KEY` in
  their shell rc; the config carries `authRef: "env:OPENAI_API_KEY"`.
- **`resolveAuthRef(authRef)`** is the single entry point
  (`src/kernel/connectors/authRef.ts`). Returns
  `{ ok: true, secret } | { ok: false, errorCode: "auth-missing" | "auth-malformed" }`.
  Never throws. The resolved secret reaches a connector only as
  `ConnectorInvokeContext.secret`; the family code is responsible for
  putting it on the wire and the runtime is responsible for never letting
  it cross again.
- **Secret-looking keys are rejected in `settings` at any depth**
  (`src/kernel/connectors/secretKeys.ts`). The 14-name screen
  (`apiKey` / `api_key` / `token` / `password` / `bearer` / `secret` /
  `clientSecret` / `client_secret` / `accessToken` / `access_token` /
  `refreshToken` / `refresh_token` / `privateKey` / `private_key`) runs on
  the in-flight config write, on every loaded preset's `defaultSettings`,
  and on every POST body to `/api/connectors`. A settings tree carrying
  one of these keys is **never** persisted; the screen returns a neutral
  `secret-looking-key` error.
- **Audit, `/api/runs`, `/api/connectors`, and `~/.agentic-os/config.yaml`
  never contain a secret value, an env var NAME's resolved value, an
  Authorization header, or `ctx.secret`.** This is asserted in tests and
  re-checked at every M4a PR review.

### `connector-test` is a Run

`runConnectorTest` (`src/kernel/connectors/testConnection.ts`) creates a
**`connector-test` RunRecord** in the M3 ledger (ADR-0016), transitions it
through `queued → running → succeeded | failed | cancelled`, mirrors the
family's `ConnectorValidationResult` into the run's terminal record,
**deterministically awaits** the `connector.test` audit line before
resolving, and **never lets a raw provider error string cross** — the audit
carries the neutral `errorCode` only. Failed runs carry a mirrored
`errorCode`; success records the latency in `metrics`. The `connector-test`
shape is also the template M4a-5 reuses for `connector.models.discover`
(parked spec).

### Capability router does the real dispatch

`router.invoke(capabilityId, input, { connectorId? })`
(`src/kernel/capabilities/router.ts`) now:

1. Resolves `connectorId` (instance id) → `ConnectorInstanceConfig`.
2. Refuses neutrally when the instance is **disabled** (`connector-unknown`
   to the caller; the router does not distinguish disabled from missing).
3. Looks up the family from `instanceConfig.typeFamily`.
4. Verifies the capability sits in the instance's **effective**
   capability set (narrowing).
5. Resolves `authRef` if the family requires auth OR the operator
   supplied an optional authRef (B1 PR #20 fix — optional authRefs are not
   silently dropped).
6. Builds a transient `ConnectorInvokeContext` and calls
   `family.invoke(capabilityId, input, ctx)`.
7. **Sanitises** the family's thrown or returned failure into the closed
   neutral `RouterErrorCode` envelope (per ADR-0012 / B13 — `config-invalid`,
   `connector-unknown`, `connector-invoke-threw`, `connector-returned-failure`).

`ConnectorInvokeContext` carries `connectorId`, the resolved settings, the
optional `secret`, an `AbortSignal`, and a request id — nothing more. A
family must NOT reach for `process.env` itself; the kernel resolves the
auth pathway exactly once.

### Subprocess discipline (CLI families)

CLI connector families (`cli-acp-agent` and any future descendant) MUST
spawn through the existing `safeSpawn` helper — argv arrays only (never
`shell: true`), per-arg length cap, null-byte rejection, env allowlist,
`NO_COLOR` forced, and a per-call timeout. Stdout is bounded; stderr is
read and **never surfaced** in the connector result, the run record, the
audit line, or any log. Slug guards on user-supplied identifiers (e.g.
`taskId`, `boardId`) are an additional defence-in-depth layer.

### HTTP discipline (LLM families)

HTTP connector families (`openai-compatible-llm` and any future
descendant) MUST:

- pass through the SSRF guard (`assertPublicBaseUrl`, ADR-companion to
  ADR-0012 / spec §8) at `config-add` time, at `testConnection` time, and
  at `invoke` time;
- set `redirect: "manual"` so a 3xx response is treated as
  `network-unreachable`, NEVER auto-followed (B11);
- send `Authorization: Bearer <ctx.secret>` **only when a secret is
  present** (Ollama-compatible endpoints work secret-less);
- never echo the Authorization header, baseUrl, env var name, or
  provider error body into the connector result, run record, audit, or log.

The shared `effectiveSignal` / `readBoundedJson` helpers — which always
bound a fetch by a default timeout AND a streamed body cap — are designed
in the parked M4a-5 v1.2 spec and will land in M4a-5 PR A. M4a itself
treats the SSRF guard, manual-redirect, and Bearer-when-secret rules as
non-negotiable.

## Consequences

**Positive**

- The connector runtime has one identity model, one secret pathway, and
  one run lifecycle. Adding a new connector family is a code change in
  one place; adding a new instance is a config change with no code.
- Secrets cross the layer boundary exactly once (`authRef → ctx.secret`)
  and are never logged or persisted. The 14-key screen catches the most
  common operator mistake (pasting a key into `settings`) before the
  config write commits.
- `connector-test` runs are queryable from `/api/runs` like any other run,
  so the operator gets a real "did my new provider work?" surface.
- The router stays neutral (ADR-0012). A failing connector cannot leak its
  raw error or stack — the router collapses both thrown and returned
  failures into the closed `RouterErrorCode` union.

**Negative**

- Three identity levels (family / preset / instance) is more vocabulary
  than the v0.1 single-level model. Mitigated by spec language, type
  shapes, and tests that fail if the levels are blurred.
- The `authRef` resolver runs server-side per invoke; a misconfigured
  env-var name surfaces as `auth-missing` to the caller, not the operator
  desktop. The Settings → Connectors UI (PR3c) shows the testConnection
  result on save so the operator catches it early.

**Neutral**

- M4a ships only `cli-acp-agent` and `openai-compatible-llm`. The
  `oauth-mediated-llm` and `native-vendor-api` families are deferred and
  named in v8 §M4a; they will reuse this runtime contract.
- The closed `RouterErrorCode` union is currently a typed string set
  (`ROUTER_ERROR_CODES` constant) but `CapabilityInvokeResult.errorCode`
  is still `string | undefined` at the type boundary. The closed-union
  type tightening is part of the parked M4a-5 PR A.

## Alternatives considered

- **Read `secrets.yaml` for connector keys.** Rejected — pre-M4a
  `secrets.yaml` was a one-off for a handful of platform flags; mixing
  arbitrary operator API keys into it would push the kernel into reading
  user-managed secret material from disk. `process.env` keeps the secret
  off the disk Agentic OS owns and reuses the operator's existing
  shell/keychain rituals.
- **Embed the secret in `settings` directly.** Rejected — guarantees the
  key ends up in `config.yaml`, in audit lines, and probably in any
  `/api/connectors` response. The secret-key screen is the active
  rejection of this alternative.
- **Flat identity (one connector record per provider).** Rejected — the
  same operator can have two OpenAI instances (e.g. personal + work) or
  two Hermes manifests. Preset + instance separation is what makes that
  cheap.
- **Let the family resolve its own secret from `process.env`.** Rejected —
  splits the rule across N families instead of one kernel module; one
  mistake in one family becomes a secret leak.

## References

- ADR-0009 — JSONL audit log.
- ADR-0012 — Capability router neutral results.
- ADR-0014 — Persistence four-store split.
- ADR-0016 — Run ledger foundation.
- ADR-0018 — Connector preset catalog (companion).
- `m4-task-spec.md` v2.1 §5 (connector identity), §6 (authRef),
  §7 (secret-key rejection), §9 (`testConnection` as a Run),
  §10 (capability router dispatch), §11 (audit + neutral logging).
- `src/kernel/connectors/{authRef,secretKeys,runtime,testConnection,
  types,registry,registered,schema}.ts`.
- `src/kernel/capabilities/router.ts`.
- PRs #18, #19, #20, #21, #22, #23.
