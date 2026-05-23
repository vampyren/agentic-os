# M4a Task Spec — Connector Runtime + Local Connectors + Preset Catalog (v2.1)

**Date:** 2026-05-22
**Version:** v2.1 — second review round folded in (B11–B13 + N1); v2 folded B1–B10 + 11 requirements; v1 was a design gate
**Milestone:** M4a — Connector runtime + local connectors + preset catalog
**Status:** **CODE COMPLETE (2026-05-23)** — all 6 sub-PRs merged:
- **PR #18 (M4a-1)** — connector runtime core
- **PR #19 (M4a-2)** — `cli-acp-agent` family
- **PR #20 (M4a-3a)** — preset catalog + `openai-compatible-llm` + SSRF
- **PR #21 (M4a-3b)** — `/api/connectors` routes + atomic config write
- **PR #22 (M4a-3c)** — Settings → Connectors UI + Add Provider flow
- **PR #23 (M4a-4)** — Hermes read-only `kanban.*` capabilities

Closeout PR **#26** is **MERGED** (squash `1333d6a`, docs-only — ADR-0017, ADR-0018, ARCHITECTURE §8, `docs/M4A-ACCEPTANCE.md`). §18 live acceptance PASSED 2026-05-23 against the operator's running server. M4a-FU1 (#24) folded into the M4a-5 spec; M4a-FU2 (#25) tracks PR #23 test-hardening gaps; M4a-FU3 (#27) tracks the user-facing HTTP capability-invoke route gap surfaced during acceptance. Documented spec deviations: `ConnectorFamilyDefinition` is non-generic (`settingsSchema: z.ZodTypeAny`) to permit a registry of mixed-family definitions; this was flagged and accepted in PR #18.
**Parent design:** `agentic-os-expandability-foundation-v8.md` (§M4a, §5.4, §5.5, §5.10)
**Predecessor milestone:** M3 — SQLite run ledger (PRs #14/#15/#16 + closeout #17 merged)
**Successor milestone:** **M4a-5 (optional, parked design — `m4a-5-task-spec.md` v1.2)** OR **M5 (artifacts + approvals)** — Rex decides ordering. v8's "M4b" name was retired in favour of M4a-5 (connector hardening + model discovery).
**Audience:** Claude Code (executing agent) and Rex (approving)
**Purpose:** Decompose M4a — the connector runtime that turns the M2 capability-router stub into real connector dispatch, plus the first connectors and the preset catalog — into concrete, reviewable, **security-locked** work, adapted to the live repo.

> **v1 → v2.** v1 had identity-model, security, run-ledger, and PR-scope gaps. v2
> locks: a three-level connector identity model (B2); env-var-name-only auth
> (B3); secret-key rejection in settings (B4); an SSRF / private-network policy
> (B5); a 6-way PR split (B6); a locked capability-invoke Run policy (B7);
> preset trust clamping (B8); locked `inputSummary` (B9); `errorCode` mirroring
> into failed Runs (B10); and 11 standing requirements (§ end of doc).
>
> **v2 → v2.1.** Closes the second review round: no-redirect-following for HTTP
> connectors so redirects cannot bypass the SSRF guard (B11); `allowLocalNetwork`
> lives only on the instance config + preset, never in family settings (B12);
> failed-Run `errorCode` mirrors the router's **sanitized** code, never a raw
> connector string (B13); stale exact router-test counts replaced with "all
> existing capability-router tests" (N1).

> **Scoping note.** M4a covers sub-PRs **M4a-1, M4a-2, M4a-3a/3b/3c, M4a-4**.
> The `oauth-mediated-llm` and `native-vendor-api` type families (v8's M4a-5)
> are **deferred to post-M4a** — a separate spec when needed.

This spec follows the M1/M2/M3 template. §3 is the corrective-guardrails section.

---

## 0. Preconditions — M4a is gated on M3 completion (B1)

**M4a must not begin implementation until ALL of the following hold:**

```text
[✓] PR #16 (M3 PR3 — /api/runs + scheduler wiring) merged to main.
[✓] M3 doc sync done — ADR-0014, ADR-0016, ARCHITECTURE §7 (PR #17 merged).
[ ] M3 §13 acceptance passes — the app-runtime steps (fresh DB + migration,
    mission -> run, /api/runs detail/cancel, restart recovery, forward guard),
    run by Rex on a live server.
[ ] M3 is marked "verified" by Rex.
```

The first two are done. M4a-1 does not start until the last two are also done.
This is a hard gate, not a courtesy.

---

## 1. Scope (locked from v8 §M4a)

Turn the capability router from "real dispatch logic, no providers" into a
working connector runtime, and ship the first real connectors:

```text
ConnectorRuntime — resolves a connector INSTANCE (operator config) against its
  FAMILY (code) and server-resolved auth into an invocable instance.
authRef resolver — env-based secret resolution, server-side only.
testConnection as a Run — a connector test is a connector-test RunRecord (M3).
capability router calls real connectors — builds the invoke context, dispatches,
  records a capability-invoke Run; neutral failures preserved.
preset catalog mechanism (§5.10) — provider presets as declarative JSON.
two connector type families (of v8's four):
  1. cli-acp-agent          (Claude Code, Hermes — local subprocess agents)
  2. openai-compatible-llm  (OpenAI + any OpenAI-compatible endpoint)
Hermes read-only Kanban capabilities (kanban.board.list / task.list / task.show).
Settings -> Connectors: the Add Provider flow.
```

Out of scope (deferred):

```text
oauth-mediated-llm + native-vendor-api type families   → post-M4a
Kanban WRITE capabilities (incl. kanban.task.create)    → later (read-only here)
the Hermes Kanban projection FEATURE / UI              → M4b
keychain / file authRef kinds                          → later (env-only — §6)
connector-private (non-well-known) capability IDs      → future (v8 §5.4)
permissions runtime enforcement                        → later milestone
artifacts / approvals                                  → M5
router-level wall-clock timeout enforcement            → post-M4a (§5, req 6)
request-time DNS re-resolution for SSRF                → post-M4a (§8)
```

---

## 2. Exit criteria (locked from v8 §M4a)

```text
Claude Code can be invoked through the capability router with agent.run.
Hermes can be invoked through the capability router with agent.run.
kanban.task.list / kanban.task.show work through the router via the Hermes
  connector instance (read-only).
A user can add OpenAI (or any openai-compatible provider) via Settings ->
  "Add Provider" without writing code: the preset picker shows the catalog, the
  auth dialog asks for the ENV VAR NAME (never the key), the connector becomes
  available on save.
A connector testConnection creates a Run (kind connector-test).
A disabled connector instance cannot invoke.
Raw secrets never leave the server runtime — not into a result, the audit log,
  the run ledger, an API response, the browser, or config.
Connector failures are neutral (errorCode + generic message; no secrets/paths).
A feature works with ANY connector instance implementing the required
  capability — no NEW feature code hardcodes a connector instance id (§3.12).
```

---

## 3. Repo-reality adaptations (READ FIRST)

v8 §5.4/§5.10 predate the live repo. The connector layer is **already
scaffolded** (M2 era) — M4a fills it in; it does not invent a parallel one.

1. **The capability router is real; connectors are the gap.**
   `src/kernel/capabilities/router.ts` — `createCapabilityRouter(registry,
   connectorsConfig)` filters enabled+capable connectors, dispatches, and
   collapses every failure to a neutral result (all existing tests in
   `tests/capability-router.test.ts`). M2 registers **no production
   connectors**, so `invoke` always returns `skipped`. M4a registers real ones
   and enriches dispatch — it must not regress the neutral-result contract.

2. **`CapabilityId` is the repo's set, not v8 §5.4's.** Live enum
   (`src/kernel/capabilities/types.ts`, `CapabilityIdSchema`):
   `chat.generate, agent.run, vision.analyze, knowledge.query,
   knowledge.source.add, media.image.generate, media.video.generate,
   code.execute, code.modify, web.fetch, sandbox.files, kanban.task.create,
   vault.note.write`. M4a uses **`chat.generate`** where v8 says `llm.chat`.
   M4a-4 **adds three** well-known ids — `kanban.board.list`,
   `kanban.task.list`, `kanban.task.show` — a deliberate core type change to
   `CapabilityIdSchema` (recorded in ADR-0017).

3. **`kanban.task.create` already exists but is NOT implemented in M4a (req 8).**
   `CapabilityIdSchema` already carries `kanban.task.create`. M4a is read-only:
   no connector implements `kanban.task.create`; Kanban **writes** are a later
   milestone. The id staying unimplemented is intentional, not an oversight.

4. **`ConnectorDefinition` is minimal and is reshaped into a FAMILY definition.**
   Live shape (`src/kernel/connectors/types.ts`): `{ id, title, kind,
   transport, capabilities, sideEffects, trust, health?, invoke?(capability,
   input) }`. M4a-1 reshapes it into `ConnectorFamilyDefinition` (§5) — adding
   `settingsSchema`, `defaultSettings`, `auth`, `testConnection`, and an
   `invoke` that receives a context. Safe — no production connector is
   registered, so only the type, the registry, the router, and the new
   connectors change.

5. **No instance model today — definitions in code, settings in config.**
   `connectorSettingsSchema` (`src/kernel/connectors/schema.ts`) is
   `{ enabled, authRef, trust, mcpServer }`, `.strict()`. M4a-1 reshapes a
   config entry into a `ConnectorInstanceConfig` (§5). The record **key** in
   `config.connectors` is the connector **instance id** — the `connectorId`
   used everywhere (B2).

6. **`authRef` is env-only.** `authRefSchema` accepts `"none" | "env:VAR_NAME"`.
   M4a stays **env-only**; file/keychain deferred (Open Question). The resolver
   reads `process.env[VAR]` server-side; the value never reaches any other sink.

7. **`safeSpawn` is the subprocess gateway.** `src/kernel/spawn.ts` —
   env-allowlisted, argv-validated, `NO_COLOR` forced. The `cli-acp-agent`
   family invokes **only** through `safeSpawn`.

8. **Claude Code already runs as a subprocess agent and that path COEXISTS
   (req 9).** Claude Code is registered in the Agent Registry today
   (subprocess / streamJson transports; `tests/subprocess-transport.test.ts`).
   M4a **adds** Claude Code as a connector *instance* for capability-based
   invocation — it does **not** migrate or remove the agent-registry path. The
   two coexist. Therefore the exit criterion "no feature hardcodes a connector
   id" (§2, §3.12) is scoped to **new, capability-consuming feature code**;
   pre-existing agent-registry consumers are out of M4a scope.

9. **`testConnection` becomes an M3 Run.** `getRunLedger()`
   (`src/kernel/state/runLedger.ts`) ships `RunKind` values `connector-test`
   and `capability-invoke`, and `CreateRunInput` carries `connectorId` /
   `capabilityId`. M4a-1 uses them — no ledger change needed.

10. **Audit stays JSONL, neutral.** `src/kernel/audit.ts` writes
    `~/.agentic-os/audit/YYYY-MM-DD.jsonl`. M4a adds `connector.test` and
    `capability.invoke` envelope kinds — neutral metadata only.

11. **Settings -> Connectors is a layout-ready stub.** `src/app/settings/page.tsx`
    has the `connectors` rail entry `active: false`. M4a-3c activates it.

12. **ADRs + per-step git approvals.** M4a doc sync writes **ADR-0017**
    (connector runtime + authRef) and **ADR-0018** (connector preset catalog) —
    the next free sequential numbers (§20, req 11). Per-step git approvals
    remain a hard rule; one sub-PR = one PR.

---

## 4. File structure

```text
M4a-1 — connector runtime core
  MODIFIED src/kernel/connectors/types.ts      ConnectorFamilyDefinition,
                                               ConnectorInstanceConfig,
                                               ConnectorInvokeContext,
                                               ConnectorAuth, ConnectorValidation,
                                               ConnectorTypeFamily
  NEW      src/kernel/connectors/authRef.ts    resolveAuthRef() — env-only
  NEW      src/kernel/connectors/secretKeys.ts screenSettingsKeys() (B4)
  NEW      src/kernel/connectors/runtime.ts    ConnectorRuntime — instance +
                                               family + resolved auth ->
                                               invocable instance; effective
                                               capability resolution
  NEW      src/kernel/connectors/testConnection.ts
                                               runConnectorTest()
  MODIFIED src/kernel/connectors/schema.ts     ConnectorInstanceConfig schema
                                               (typeFamily/presetId/settings/
                                               capabilities/trustOverride/
                                               allowLocalNetwork) + B4 screen
  MODIFIED src/kernel/connectors/registry.ts   keyed by family id
  MODIFIED src/kernel/capabilities/router.ts   instance resolution + dispatch +
                                               capability-invoke Run (B7)
  MODIFIED src/kernel/audit.ts                 auditConnectorTest(),
                                               auditCapabilityInvoke()
  NEW      tests/{auth-ref,secret-keys,connector-runtime,connector-test-run}.test.ts

M4a-2 — cli-acp-agent connectors (Claude Code + Hermes agent.run)
  NEW      src/connectors/cli-acp-agent/        family definition + Claude Code /
                                               Hermes instances (reuse the
                                               existing subprocess transport)
  NEW      tests/cli-acp-connector.test.ts

M4a-3a — preset catalog + openai-compatible-llm connector
  NEW      src/connectors/openai-compatible-llm/  HTTP chat.generate family
  NEW      src/kernel/connectors/presets.ts      preset loader + trust clamp (B8)
  NEW      src/kernel/connectors/ssrf.ts         private-network guard (B5)
  NEW      presets/*.json                        first-party presets (shipped)
  NEW      tests/{preset-catalog,ssrf-guard}.test.ts

M4a-3b — /api/connectors routes + config write path
  NEW      src/app/api/connectors/**             list / presets / add / test
  NEW      src/kernel/config/writeConfig.ts      atomic config write (req 3)
  NEW      tests/api-connectors.test.ts

M4a-3c — Settings -> Connectors UI + Add Provider flow
  MODIFIED src/app/settings/page.tsx             activate the Connectors rail
  NEW      src/app/settings/_connectors/*        Add Provider UI

M4a-4 — Hermes read-only Kanban capabilities
  MODIFIED src/kernel/capabilities/types.ts      + kanban.board.list/task.list/
                                                 task.show
  MODIFIED src/connectors/cli-acp-agent/         Hermes kanban.* (read-only)
  NEW      tests/hermes-kanban.test.ts
```

Exact paths under `src/connectors/` are Claude Code's call if a different
layout fits — confirm in M4a-2's PR. **Do not** restructure existing kernel
files beyond the changes listed.

---

## 5. Connector identity & runtime model (M4a-1) — locked (B2)

Three **distinct** identities — never blurred:

```text
ConnectorFamilyDefinition.id   implementation family. CODE.
                               e.g. "cli-acp-agent", "openai-compatible-llm".
                               Selects the implementation + the settingsSchema.
ConnectorInstanceConfig (key)  operator connector instance. CONFIG.
                               e.g. "claude-code", "hermes", "openai-main".
                               THIS is `connectorId` everywhere.
ConnectorPreset.id             catalog seed. JSON.
                               e.g. "openai", "openrouter", "ollama-local".
                               Seeds an instance's default settings.
```

**`connectorId`** — in `RunRecord`, `external_refs`, audit lines, the
`/api/connectors` + `/api/runs` payloads, and `ConnectorInvokeContext` —
**always means the instance id** (the `config.connectors` record key).
`typeFamily` selects implementation/schema; `presetId` seeds defaults. Three
fields, three meanings.

```ts
export type ConnectorTypeFamily = "cli-acp-agent" | "openai-compatible-llm";
//  oauth-mediated-llm | native-vendor-api — post-M4a.

/** Named type — exported, not inline (req 5). */
export interface ConnectorAuth {
  required: boolean;
  supportedRefs: Array<"env">;          // env-only in M4a
}

/** CODE — one per implementation family. */
export interface ConnectorFamilyDefinition<TSettings = unknown> {
  id: ConnectorTypeFamily;
  title: string;
  kind: ConnectorKind;                  // existing union
  transport: ConnectorTransport;        // existing union
  /** The MAXIMUM capability set any instance of this family may expose. */
  capabilities: CapabilityId[];
  sideEffects: ReadonlyArray<ConnectorSideEffect>;
  defaultTrust: ConnectorTrust;
  settingsSchema: z.ZodType<TSettings>;
  defaultSettings: TSettings;
  auth: ConnectorAuth;
  health?: (ctx: ConnectorInvokeContext<TSettings>) => Promise<ConnectorHealth>;
  testConnection?: (
    ctx: ConnectorInvokeContext<TSettings>,
    opts?: { signal?: AbortSignal; runId?: RunId },
  ) => Promise<ConnectorValidation>;
  invoke: (
    ctx: ConnectorInvokeContext<TSettings>,
    capability: CapabilityId,
    input: unknown,
  ) => Promise<ConnectorResult>;
}

/** CONFIG — config.connectors[<connectorId>]. The record key is connectorId. */
export interface ConnectorInstanceConfig {
  enabled: boolean;
  typeFamily: ConnectorTypeFamily;
  presetId?: string;
  authRef?: AuthRef;                    // "env:NAME" — never a raw key (B3)
  settings?: Record<string, unknown>;   // family-validated at runtime; B4-screened
  /** Narrows the family's capability set; absent => the family max set. */
  capabilities?: CapabilityId[];
  /** Operator override — DOWNWARD only (req 7 / B8). */
  trustOverride?: "community" | "untrusted";
  /** HTTP families only — opt-in past the SSRF guard (§8 / B5). */
  allowLocalNetwork?: boolean;
}

/** RUNTIME — what a connector's invoke()/testConnection() receives. */
export interface ConnectorInvokeContext<TSettings = unknown> {
  connectorId: string;                  // the INSTANCE id
  typeFamily: ConnectorTypeFamily;
  settings: TSettings;                  // parsed through the family schema
  /** Resolved secret, server-side only. Absent when auth.required is false. */
  secret?: string;
  signal?: AbortSignal;                 // connectors SHOULD respect it (req 6)
}

export interface ConnectorValidation {        // v8 §5.4
  status: "valid" | "invalid" | "unreachable" | "misconfigured" | "unknown";
  errorCode?:
    | "auth-failed" | "auth-missing" | "rate-limited" | "network-unreachable"
    | "config-invalid" | "capability-not-supported" | "capability-unavailable"
    | "external-system-unavailable" | "binary-not-found"
    | "blocked-network" | "unknown";
  message?: string;                     // neutral — no secrets, no raw paths
  testedAt: string;
  durationMs: number;
}
```

**Effective capability set (B2).** A family declares the **maximum** set. An
instance's effective set is:

```text
effective = family.capabilities
            ∩ (instanceConfig.capabilities ?? family.capabilities)
```

A preset may seed `instanceConfig.capabilities`. The router's `list()` /
`has()` / `invoke()` use the **instance-effective** set only. This is how the
Hermes instance exposes `kanban.*` while the Claude Code instance does not,
even though both are `typeFamily: "cli-acp-agent"`.

**ConnectorRuntime** (`src/kernel/connectors/runtime.ts`):

```text
buildInstance(instanceConfig, familyDefinition):
  -> { ok: true, ctx, effectiveCapabilities }
   | { ok: false, validation: ConnectorValidation }
  1. screen instanceConfig.settings keys (B4 / §7). A secret-looking key
     -> misconfigured / config-invalid.
  2. merge settings over (presetId ? preset.defaultSettings : {}) over
     family.defaultSettings; parse the result through family.settingsSchema.
     Failure -> misconfigured / config-invalid.
  3. for an HTTP family: compute effectiveAllowLocalNetwork =
     instanceConfig.allowLocalNetwork ?? preset.allowLocalNetwork ?? false,
     then run the SSRF guard on the resolved baseUrl with that flag (§8 / B12).
     Blocked -> misconfigured / blocked-network.
  4. if family.auth.required, resolve instanceConfig.authRef (§6).
     Missing/unset -> misconfigured / auth-missing.
  5. compute the effective capability set.
  6. return the ConnectorInvokeContext + effective capabilities.

resolveConnectorInstances(registry, connectorsConfig):
  for each ENABLED instance, look up its family by typeFamily and build it.
```

**Trust (req 7 / B8).** Effective trust = `family.defaultTrust`, optionally
moved **down** by `trustOverride`. An override never moves trust up. User-loaded
presets are clamped (§13 / B8).

**Two-phase settings validation.** The static `appConfig` schema validates the
instance-config **envelope** (`enabled`, `typeFamily`, `presetId?`, `authRef`,
`settings`, `capabilities?`, `trustOverride?`, `allowLocalNetwork?`) **and runs
the B4 secret-key screen**; the family `settingsSchema` strictly re-parses
`settings` in `buildInstance`. A misconfigured instance is never invoked.

---

## 6. authRef resolver (M4a-1) — `src/kernel/connectors/authRef.ts`

```ts
export type AuthResolution =
  | { ok: true; secret: string }
  | { ok: false; errorCode: "auth-missing" | "auth-malformed" };

export function resolveAuthRef(authRef: AuthRef | undefined): AuthResolution;
```

- `authRef` is `"none"` or `"env:VAR_NAME"` (the live `authRefSchema`).
- `"none"` / `undefined` → `auth-missing` when the family requires auth.
- `"env:VAR_NAME"` → `process.env["VAR_NAME"]`; empty/unset → `auth-missing`.
- The resolved secret is returned **only** into `ConnectorInvokeContext.secret`.
  It is never logged, never placed in a `ConnectorResult` / `ConnectorValidation`
  message, never written to the ledger, audit, an API response, or config.
- Server-only module; must not enter a client bundle.

---

## 7. Secret-key rejection in settings (M4a-1, B4) — `src/kernel/connectors/secretKeys.ts`

A connector instance's `settings` (and a preset's `defaultSettings`) carry
family config — `baseUrl`, `model`, etc. They must **never** carry a secret.
Before any family parsing, screen the keys:

```ts
export const SECRET_LOOKING_KEYS: readonly string[] = [
  "apiKey", "api_key", "token", "password", "bearer", "secret",
  "clientSecret", "client_secret", "accessToken", "access_token",
  "refreshToken", "refresh_token", "privateKey", "private_key",
];

/** Throws / returns a failure if any key (case-insensitive, at any depth)
 *  matches SECRET_LOOKING_KEYS. */
export function screenSettingsKeys(settings: unknown): ScreenResult;
```

Applied in **three** places:
- the static connector-config envelope (`schema.ts`) — a config with a
  secret-looking `settings` key fails config load;
- the preset loader (`presets.ts`) — a preset whose `defaultSettings` has a
  secret-looking key is **skipped neutrally** (logged, not fatal);
- `POST /api/connectors` — a request body whose `settings` has a secret-looking
  key is rejected with a neutral 400.

Secrets reach a connector **only** as a resolved `authRef` (§6) — never inline
in settings.

---

## 8. SSRF / private-network policy (M4a-3a, B5) — `src/kernel/connectors/ssrf.ts`

HTTP-family connectors (`openai-compatible-llm`) must not be pointed at
internal infrastructure. The `baseUrl` is guarded.

**Blocked by default** — hostnames and any resolved A/AAAA address in:

```text
127.0.0.0/8, localhost, ::1, 0.0.0.0,
10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16,
169.254.0.0/16 (link-local), fc00::/7 (ULA), fe80::/10 (link-local v6).
```

```ts
export async function assertPublicBaseUrl(
  baseUrl: string,
  opts: { allowLocalNetwork: boolean },
): Promise<void>;   // throws a neutral error with errorCode "blocked-network"
```

`allowLocalNetwork` is **not** a family settings field (B12). It lives only on
`ConnectorInstanceConfig` and `ConnectorPreset`; the runtime computes the
**effective** value — `instanceConfig.allowLocalNetwork ?? preset.allowLocalNetwork
?? false` — and the guard reads only that effective flag via `opts`.

Rules:
- Local/private targets are allowed **only** when the **effective**
  `allowLocalNetwork` is `true`.
- The `ollama-local` first-party preset declares `allowLocalNetwork: true`
  (a local Ollama is its whole point). A `custom` OpenAI-compatible endpoint
  defaults to **deny-local-network**.
- DNS is resolved at **config-add time and at testConnection time**; if any
  A/AAAA record lands in a blocked range, the connector is rejected
  (`misconfigured` / `blocked-network`).

**Redirects (B11).** An HTTP connector must **not** automatically follow a
redirect. M4a default: the fetch is issued with redirect handling **disabled**.
A 3xx response is treated as a neutral **failed** connector result
(`errorCode: "network-unreachable"`); the redirected `Location` URL is **never**
placed in a connector result, the run ledger, audit, or any log line. If
redirect following is ever added, every `Location` URL must pass the same
SSRF / private-network guard above **before** being followed.

- **Known limitation (post-M4a):** request-time DNS re-resolution is not
  enforced — a hostname that resolves public at config time and private later
  (DNS rebinding) is not caught in M4a. Documented; closed in a later milestone.

---

## 9. testConnection as a Run (M4a-1) — `src/kernel/connectors/testConnection.ts`

```ts
export async function runConnectorTest(
  connectorId: string,
  deps?: { ledger?: RunLedger; registry?: ConnectorRegistry; config?: AppConfig },
): Promise<ConnectorValidation>;
```

- Opens a `connector-test` RunRecord: `createRun({ kind: "connector-test",
  featureId: "connectors", trigger: "manual", connectorId, status: "running",
  onRestart: "mark-interrupted", inputSummary: "connector test · <connectorId>" })`
  — **`inputSummary` is locked to that exact form (B9)**: no settings, no
  baseUrl, no model, no presetId.
- Builds the instance (§5); a misconfigured instance short-circuits to a
  `misconfigured` validation and a `failed` run — no connector call.
- If the family has **no `testConnection` (req 2)**: validation `status:
  "unknown"`, `errorCode: "capability-unavailable"`; the run transitions to
  `failed` with that same `errorCode`.
- Otherwise calls `family.testConnection(ctx, { runId })`.
- Transitions the run: `valid` → `succeeded`; anything else → `failed` with
  `errorCode` taken from `ConnectorValidation.errorCode` **normalized against
  the closed `ConnectorValidation` errorCode union (B10/B13)** — any value not
  in that union becomes `"unknown"`, so a connector cannot smuggle a secret or
  a path into the run/audit through `errorCode`. A failed connector-test run
  never has a null `errorCode`.
- Writes an `auditConnectorTest` line (neutral — connectorId, runId, status,
  errorCode, durationMs).
- A ledger failure is swallowed + logged neutrally; the test still returns.
- `deps` is the test seam (mirrors `RunMissionOverrides`).

---

## 10. Capability router — real dispatch (M4a-1)

`createCapabilityRouter(registry, connectorsConfig)` resolves connector
**instances** (§5) and exposes only each instance's **effective** capabilities.

**`invoke` — locked Run policy (B7):**

```text
- router.invoke() that dispatches to a real connector instance OPENS a
  capability-invoke RunRecord (kind "capability-invoke", connectorId,
  capabilityId).
- router.list() / router.has() create NO Run.
- no enabled candidate for the capability -> neutral { status: "skipped" },
  NO Run.
- a misconfigured candidate whose instance id IS known -> opens a FAILED
  capability-invoke Run with errorCode "config-invalid", returns a neutral
  failed result.
- a misconfigured candidate whose instance id is NOT known (e.g. an unknown
  opts.connectorId override) -> neutral failed result, NO Run.
- a ledger failure is swallowed + logged neutrally; dispatch proceeds.
```

`inputSummary` for a capability-invoke Run is **locked (B9)**:
`"capability invoke · <capabilityId> via <connectorId>"` — no raw input, no
settings, no baseUrl, no model, no presetId.

On a failed dispatch the run's `errorCode` is the router's **sanitized**
errorCode — the neutralized code the router emits after collapsing the
connector failure (per ADR-0012), **never the raw connector-returned string**
(B10/B13). `ConnectorResult.errorCode` is typed `string`, so a connector could
return `"sk-SECRET…"` or a private path; the router **normalizes** it: a value
not in a known neutral allowlist becomes `"connector-returned-failure"` (a
returned failure) or `"connector-invoke-threw"` (a thrown one) or `"unknown"`.
Only allowlisted neutral codes (e.g. `auth-failed`, `rate-limited`) may pass
through unchanged. The `RunRecord.errorCode`, the `/api/runs` `errorCode`, and
the API result `errorCode` are all the **same** sanitized value. A failed
capability-invoke run never has a null `errorCode`.

The neutral-result contract is **unchanged** — a thrown or returned connector
failure is collapsed exactly as today; all existing capability-router tests
must still pass. A **disabled** instance is filtered out (exit criterion).

---

## 11. Audit + neutral logging discipline (M4a-1)

Two neutral envelope kinds, same discipline as `auditMissionRun`:

```text
connector.test     { connectorId, runId, status, errorCode?, durationMs }
capability.invoke  { capabilityId, connectorId, runId, status, errorCode?,
                     durationMs }
```

**Neutral logging discipline (req 1) — a spec requirement, not a note.**
Every `console.error` / `console.warn` / diagnostic in the connector runtime
uses **neutral ids and errorCodes only**. It is forbidden to log: a raw
connector error or stack, raw stderr, a raw HTTP response body, raw capability
input, the `authRef` value, or the resolved secret. This binds the runtime,
the connectors, and the routes.

---

## 12. cli-acp-agent type family (M4a-2)

One `ConnectorFamilyDefinition` (`id: "cli-acp-agent"`, `transport:
"subprocess"`), instantiated as a **Claude Code** instance and a **Hermes**
instance.

```text
- family capabilities (the MAX set): [agent.run, kanban.board.list,
  kanban.task.list, kanban.task.show]. (kanban.* land in M4a-4.)
- the Claude Code instance narrows capabilities to [agent.run];
  the Hermes instance keeps [agent.run] now, + kanban.* read-only in M4a-4.
- settingsSchema: { bin: string, timeoutMs, ... }. Hermes additionally per v8
  §5.5: hermesBin, board?, allowWrites=false, allowTerminalTaskCompletion=false.
- invoke(): runs through safeSpawn — REUSE the existing subprocess agent
  transport (tests/subprocess-transport.test.ts); no second subprocess path.
- testConnection(): binary-availability + minimal handshake -> ConnectorValidation
  (binary-not-found / external-system-unavailable / valid).
- auth.required: false (local binaries; no API key).
```

DoD: `agent.run` works through the router for both instances; `testConnection`
for each creates a `connector-test` Run; end-to-end test via a node-based
echo-script fake binary (req 10 — the `tests/subprocess-transport.test.ts`
pattern).

---

## 13. openai-compatible-llm family + preset catalog (M4a-3a)

**Family** — one `ConnectorFamilyDefinition` (`transport: "http"`,
`capabilities: [chat.generate]`, `auth.required: true`):

```text
settingsSchema: { baseUrl, model, maxTokens?, temperature? }
  — allowLocalNetwork is NOT a settings field (B12); it lives on the instance
    config / preset and the runtime feeds the SSRF guard the effective value.
invoke(ctx, "chat.generate", input): POST {baseUrl}/chat/completions with
  Authorization: Bearer <ctx.secret>, redirect handling DISABLED (B11).
  A 3xx response -> a neutral failed result; the Location is never surfaced.
  Neutralized failures. NEVER log the key, the Authorization header, or the
  raw response body.
testConnection(): a cheap models/ping call -> ConnectorValidation.
baseUrl is SSRF-guarded (§8) at build + test time.
```

**Preset catalog** (`src/kernel/connectors/presets.ts`, v8 §5.10):

```ts
export interface ConnectorPreset {
  id: string;                       // "openai", "openrouter", "ollama-local", ...
  label: string;
  description?: string;
  typeFamily: ConnectorTypeFamily;
  defaultSettings: Record<string, unknown>;   // B4-screened; family-validated
  capabilities?: CapabilityId[];               // seeds the instance narrow set
  allowLocalNetwork?: boolean;                 // preset-level SSRF policy (B12)
  authPrompt?: {
    apiKeyEnvVar?: { label: string; helpUrl?: string };  // env var NAME (B3)
    baseUrl?: { label: string; default?: string };
  };
  trust: "first-party" | "community" | "untrusted";
}
```

- First-party presets ship as JSON in the build's `presets/` dir; the loader
  **also** reads `~/.agentic-os/presets/` (community presets).
- **Trust clamp (B8):** a preset loaded from `~/.agentic-os/presets/` is
  **clamped to `community`** regardless of its declared `trust`. Only presets
  shipped in the build `presets/` dir may declare `first-party`. A user-loaded
  preset declaring `first-party` is loaded as `community` and the downgrade is
  logged neutrally.
- A preset whose `defaultSettings` has a secret-looking key is **skipped
  neutrally** (B4 / §7) — not fatal to catalog loading.
- M4a-3a ships at least: **OpenAI, OpenRouter, Ollama (local,
  `allowLocalNetwork: true`), custom OpenAI-compatible endpoint**.

DoD: the catalog loads + parses; trust clamp + secret-key skip verified.

---

## 14. /api/connectors routes + config write (M4a-3b)

Platform routes — CORS-gated, not feature-gated. Neutral errors.

```text
GET  /api/connectors            list configured connector instances + state
GET  /api/connectors/presets    the preset catalog
POST /api/connectors            add a connector instance from a preset +
                                operator-supplied env var name + settings
POST /api/connectors/:id/test   runs runConnectorTest (§9)
```

- `POST /api/connectors` body carries: `presetId`, the **env var name** holding
  the key (→ stored as `authRef: "env:NAME"`, B3), and family `settings`. The
  body's `settings` is **B4-screened** — a secret-looking key → neutral 400.
  The **raw key value is never accepted** in the body, never echoed in a
  response.
- **Atomic config write (req 3).** `POST /api/connectors` writes config via
  `src/kernel/config/writeConfig.ts`: validate → **back up the current config**
  → write a temp file → `fsync` → atomic `rename`. The response **never echoes
  raw config**.
- After the write, `testConnection` runs as a Run (§9); the result is returned.

---

## 15. Settings → Connectors UI (M4a-3c)

Activate the `connectors` rail entry; build the Add Provider flow: preset
picker → auth dialog → save → test result → enabled.

**Add Provider env-var UX (req 4).** The auth dialog asks for the **name of an
environment variable**, never the key. UI copy must explain:
- the env var must already exist **in the server process** environment;
- adding it may require **restarting Agentic OS**;
- if the var is absent, `testConnection` reports `auth-missing` and the UI
  shows that plainly.

M2's read-only Features section and the settled UI-shell rules
(`[[agentic-os-ui-shell-decisions]]`, `[[agentic-os-page-identity-convention]]`)
must not regress.

---

## 16. Hermes read-only Kanban capabilities (M4a-4)

```text
- Add kanban.board.list / kanban.task.list / kanban.task.show to
  CapabilityIdSchema (core type change — ADR-0017).
- The Hermes instance's effective capability set widens to include them; the
  Claude Code instance is unaffected (§5 effective-set rule).
- HermesConnector implements them read-only via safeSpawn, per v8 §5.5:
  read-only first; allowWrites stays false; kanban.task.create is NOT
  implemented (§3.3); no raw ~/.hermes paths in any result; errors neutralized.
- A Hermes task surfaced through a capability may be recorded on the calling
  run via the M3 external_refs table (system "hermes").
```

Exit: `kanban.task.list` / `kanban.task.show` work through the router via the
Hermes instance. WRITES and the Kanban feature/UI are later (M4b+).

---

## 17. Tests

Each suite uses tmp dirs + env overrides (`AGENTIC_OS_STATE_DB`,
`AGENTIC_OS_AUDIT_DIR`, `AGENTIC_OS_CONFIG`) and resets singletons in
`afterEach`. No real `~/.agentic-os`. No new test dependency. Subprocess tests
use a **node-based echo-script fake binary** — the
`tests/subprocess-transport.test.ts` pattern (req 10).

```text
auth-ref.test.ts         env resolution; missing/malformed; the secret never
                         appears in the AuthResolution failure path.
secret-keys.test.ts      screenSettingsKeys rejects each SECRET_LOOKING_KEY
                         (case-insensitive, nested); a clean settings object
                         passes.
connector-runtime.test.ts
                         buildInstance: settings merged + family-parsed; bad
                         settings -> misconfigured; auth required+missing ->
                         misconfigured; effective capability set = family ∩
                         instance; trustOverride moves trust down only; a
                         disabled instance is not resolved.
connector-test-run.test.ts
                         runConnectorTest opens a connector-test Run;
                         valid -> succeeded; invalid -> failed with errorCode
                         normalized against the ConnectorValidation union
                         (B10/B13) — an out-of-union value becomes "unknown";
                         no testConnection -> unknown / capability-unavailable
                         -> failed run;
                         inputSummary is exactly "connector test · <id>" (B9);
                         a seeded secret never appears in the audit line or the
                         returned validation; ledger failure swallowed.
capability-router.test.ts (extend)
                         a real instance dispatches with a built context;
                         capability-invoke Run policy (B7) — Run opened on real
                         dispatch, none on list()/has() or skipped, failed Run
                         for a known misconfigured instance, no Run for an
                         unknown id; inputSummary locked form (B9); failed-Run
                         errorCode is the router's SANITIZED code, never a raw
                         connector string (B10/B13); a connector returning
                         errorCode "sk-SECRET" / a private path -> not in the
                         Run / API / audit / logs; an unknown errorCode is
                         normalized; an allowlisted code (auth-failed) may be
                         preserved; all existing capability-router tests pass.
config-secret-keys.test.ts (B4)
                         a connector config with settings.apiKey is rejected;
                         with settings.token is rejected.
ssrf-guard.test.ts (B5/B11)
                         assertPublicBaseUrl blocks each private/local/
                         link-local range; allows a public host; allows a
                         private host only with effective allowLocalNetwork
                         true; a hostname resolving to a blocked address is
                         rejected. Redirects (B11): a public endpoint that
                         302s to http://127.0.0.1:1234 -> blocked, neutral
                         failed result; a 302 to http://169.254.169.254 ->
                         blocked, neutral failed result; the redirected
                         private URL never appears in the result / audit /
                         logs.
cli-acp-connector.test.ts
                         agent.run through the router for a fake echo-script
                         binary (Claude Code + Hermes); testConnection
                         binary-not-found path.
preset-catalog.test.ts   first-party presets load + parse; a community-dir
                         preset is read and CLAMPED to community (B8); a
                         user-loaded preset declaring first-party is loaded as
                         community; a preset with a secret-looking
                         defaultSettings key is skipped neutrally (B4).
api-connectors.test.ts   list / presets / add / test routes; CORS 403; neutral
                         errors; POST with raw key-like settings rejected (B4);
                         the raw key never appears in any response; config
                         write is atomic (backup + temp + rename).
hermes-kanban.test.ts    kanban.task.list / task.show through the router via
                         the Hermes instance (fake hermes bin); no raw
                         ~/.hermes path in the result.
```

All existing tests must still pass.

---

## 18. Acceptance script (Rex runs this before approving M4b)

```text
Step 1 — cli-acp agents. Trigger agent.run through the router for the Claude
  Code instance, then the Hermes instance — each returns a real result, and a
  connector-test / capability-invoke RunRecord appears in /api/runs.

Step 2 — Add Provider. Settings -> Connectors -> Add Provider. Pick "OpenAI".
  The auth dialog asks for an ENV VAR NAME (not a key). Supply it. Save.
  testConnection runs; the result shows; the connector is enabled.

Step 3 — chat.generate. Invoke chat.generate through the router; OpenAI
  answers. No code was written to add it.

Step 4 — Disabled instance. Disable a connector instance; confirm the router
  will not invoke it.

Step 5 — SSRF guard. Try to add a custom openai-compatible endpoint pointing at
  127.0.0.1 without allowLocalNetwork — it is rejected (blocked-network).

Step 6 — Hermes Kanban. kanban.task.list / kanban.task.show return data through
  the router via the Hermes instance. No ~/.hermes path is visible anywhere.

Step 7 — Secret hygiene. Inspect the audit log, /api/connectors, /api/runs, and
  the written config — the API key VALUE appears nowhere; only authRef
  "env:NAME" is stored.

Step 8 — npm run typecheck && npm test  -> all green.
Step 9 — npm run build  -> succeeds (then `git checkout -- next-env.d.ts`).
```

---

## 19. PR breakdown — one sub-PR = one PR (B6)

```text
PR 1 (M4a-1) — Connector runtime core
  types reshape, authRef.ts, secretKeys.ts, runtime.ts, testConnection.ts,
  schema.ts, registry.ts, router.ts dispatch + Run policy, audit kinds.
  tests/{auth-ref,secret-keys,connector-runtime,connector-test-run,
  config-secret-keys}.test.ts + router test extension.
  DoD: typecheck + tests green; router still neutral; no connectors yet.

PR 2 (M4a-2) — cli-acp-agent connectors
  the cli-acp-agent family + Claude Code + Hermes (agent.run), reusing the
  existing subprocess transport. tests/cli-acp-connector.test.ts.
  DoD: agent.run works through the router for both instances.

PR 3a (M4a-3a) — preset catalog + openai-compatible-llm connector
  openai-compatible-llm family, presets.ts (+ trust clamp), ssrf.ts,
  first-party preset JSON. tests/{preset-catalog,ssrf-guard}.test.ts.
  DoD: catalog loads; chat.generate works against a public endpoint in a test.

PR 3b (M4a-3b) — /api/connectors routes + config write path
  /api/connectors routes, writeConfig.ts (atomic). tests/api-connectors.test.ts.
  DoD: list/presets/add/test routes work; config write is atomic; B4 enforced.

PR 3c (M4a-3c) — Settings -> Connectors UI + Add Provider flow
  settings/page.tsx rail activation, the Add Provider UI.
  DoD: Rex can add OpenAI end-to-end via Settings.

PR 4 (M4a-4) — Hermes read-only Kanban capabilities
  + kanban.board.list/task.list/task.show; Hermes instance kanban.* read-only.
  tests/hermes-kanban.test.ts.
  DoD: full acceptance script passes.
```

`oauth-mediated-llm` + `native-vendor-api` are **not** in this milestone.

---

## 20. Done definition

M4a is **DONE** when:

```text
✓ Claude Code and Hermes instances are invocable through the router with
  agent.run.
✓ kanban.task.list / kanban.task.show work via the Hermes instance (read-only).
✓ A user adds an openai-compatible provider via Settings -> Add Provider with
  no code, supplying only an env var NAME; chat.generate then works.
✓ testConnection creates a connector-test Run; a disabled instance cannot
  invoke; connector failures are neutral; failed Runs carry a mirrored
  errorCode (B10).
✓ Raw secrets never leave the server runtime — verified in audit, /api/runs,
  /api/connectors, and the written config (§18 step 7).
✓ The SSRF guard blocks private/local endpoints by default (§8).
✓ No NEW capability-consuming feature hardcodes a connector instance id (§3.12).
✓ npm run typecheck, npm test, npm run build all pass; no regression.
✓ End-of-milestone doc sync: ADR-0017 (connector runtime + authRef) and
  ADR-0018 (connector preset catalog) — the next free sequential numbers
  (req 11) — written; ARCHITECTURE updated.
✓ Rex signs off via "M4a verified, proceed to M4b".
```

**ADR numbering (req 11).** The live ADR sequence is 0001–0012, 0014, 0016
(0013/0015 are abandoned gaps — the decisions README explicitly permits gaps).
M4a's ADRs take the **next free sequential numbers: ADR-0017 and ADR-0018** —
v8's aspirational "ADR-0018/ADR-0024" numbering is dropped. No new arbitrary
gaps are introduced.

---

## 21. Open questions for Rex (decide before M4a starts, or accept defaults)

1. **`file` / `keychain` authRef kinds.** Default: **defer** — M4a is env-only,
   matching the live `authRefSchema`. Default: env-only.

2. **`src/connectors/` location.** Default: a new top-level
   `src/connectors/<family>/` for connector implementations; `src/kernel/
   connectors/` keeps the runtime/registry/types. Default: split.

3. **Hermes adapter.** Default: the **CLI adapter** via `safeSpawn` (v8 §3.2
   Option A — read-only first, no raw `~/.hermes` paths). Default: CLI.

4. **`capabilities` narrowing source.** An instance's effective set can be
   narrowed by the preset (`preset.capabilities`) and/or the config entry
   (`instanceConfig.capabilities`). Default: both may narrow; the effective set
   is `family ∩ (config.capabilities ?? preset.capabilities ?? family)`.
   Default: config overrides preset, both narrow only.

5. **`connector-test` runs in `/api/runs`.** A `testConnection` per Add-Provider
   save creates a `connector-test` run; these will accumulate. Default: keep
   them (cheap, useful history); a retention/cleanup policy is a later
   milestone. Default: keep.

If Rex skips these, the defaults apply.

---

**End of M4a task spec (v2.1).** M4a shipped sub-PR by sub-PR (#18 → #23);
closeout doc-sync is open as PR #26 (ADR-0017, ADR-0018, ARCHITECTURE §8,
`docs/M4A-ACCEPTANCE.md`). The §18 acceptance script awaits Rex's live run
against the running server. The "M4b" naming from v8 was retired during M4a;
the optional follow-on is **M4a-5** (`m4a-5-task-spec.md` v1.2 — parked
design covering connector hardening `effectiveSignal`/`readBoundedJson`/
closed `RouterErrorCode`/IPv4-compatible IPv6, plus model discovery + a
searchable picker). M4a-5 is gated on PR #26 merging, the §18 acceptance
passing, and Rex's explicit go-ahead; otherwise the next milestone is M5
(artifacts + approvals).
