# M4a-6 Task Spec — Provider Picker + UI-Managed Connector Secrets (v1 draft)

**Date:** 2026-05-24
**Version:** v1 — provider-catalog split locked; O8 / O9 / O10 / O11 pinned per Rex (2026-05-24). v0.1 was the broader-catalog pass; v0 was the first design pass. **Committed to the repo as a design-accepted draft** per `docs/MAINTENANCE.md`. No implementation begins until M4a-5 closeout merges, the M4a-5 operator-acceptance tick lands per §0, AND Rex green-lights PR A.

> **v0.1 → v1 (locked decisions):**
> §1.1 active table unchanged (OpenAI, OpenRouter, Ollama, LM Studio,
> Custom OpenAI-compatible, **DeepSeek**). §1.1 planned-table Alibaba
> row clarified — "Alibaba Cloud Coding Plan" is **NOT** the same
> integration as "Alibaba DashScope / Qwen OpenAI-compatible
> endpoint"; treat as distinct until product/auth contract is
> confirmed. §1.2 LOCKED — collapsed "More providers coming later"
> disclosure with static, non-clickable rows + "needs <family>"
> caption per planned card. §14 O8 / O9 / O10 marked LOCKED with
> Rex's pinned decisions (DeepSeek stays active with mandatory
> demote-on-acceptance-failure rule; xAI / Grok stays planned;
> Alibaba Cloud Coding Plan stays planned and is not silently
> treated as generic Qwen).
>
> Open questions still in play: O1 (encryption), O2 (multi-key per
> provider), O3 (secret id naming), O4 (PATCH semantics), O5
> (authRefKind union), O6 (backup docs), O7 (acceptance file).
> Rex accepting v1 = greenlight to promote to `docs/specs/` AND
> start PR A — but PR A waits until M4a-5 closeout + operator
> acceptance per §0.
**Milestone:** M4a-6 — Provider picker + UI-managed connector secrets (OPTIONAL post-M4a-5 sub-milestone).
**Status:** **DRAFT v1 — DESIGN ONLY**. Active/planned split locked per Rex (2026-05-24). No branch, no implementation until M4a-5 closeout + operator acceptance ticks AND Rex green-lights PR A.
**Parent design:** `m4-task-spec.md` v2.1 (M4a connector runtime); `m4a-5-task-spec.md` v1.2 (model discovery).
**Predecessor milestone:** M4a-5 — code complete on `main` (PR #29 + PR #30).
**Successor milestone:** M5 — Artifacts + approvals.
**Goal:** Rex picks a provider card, pastes an API key, tests, saves. No terminal. No env-var editing. The repo config still stores **only** an authRef, never the raw key.

---

## 0. Preconditions

```text
[x] M4a-5 PR AB merged (`6f23684`).
[x] M4a-5 PR C merged (`1a246c3`).
[ ] M4a-5 closeout PR merged (status header / ROADMAP / ARCH §8 sync).
[ ] M4a-5 operator acceptance of the picker UX recorded.
[ ] Rex explicitly authorises M4a-6 start.
```

The closeout + acceptance ticks are not strict blockers for design, but they
should land **before** PR A implementation starts so M4a-6 builds on a
verified-and-documented base.

---

## 1. Scope

### 1.1 Provider cards — active vs planned split

**Honesty rule:** a card is **active** ONLY when (a) a connector family
that can actually serve it is already registered, and (b) the operator
can paste credentials and save end-to-end. Everything else is
**planned** and surfaced as "Coming later — needs <family>".
No card ever looks active when it can't serve a request — that
includes greyed-out fakes, dead-end forms, and "Save anyway" buttons
that drop a connector that won't work.

**Active in M4a-6** (configurable end-to-end via the existing
`openai-compatible-llm` family):

| Card | Preset source | Notes |
|---|---|---|
| **OpenAI** | existing `openai` | API key via secret store. |
| **OpenRouter** | existing `openrouter` | API key via secret store. |
| **Ollama local** | existing `ollama-local` | No key; `allowLocalNetwork: true`; default `baseUrl: http://localhost:11434/v1`. |
| **LM Studio local** | **NEW** `presets/lm-studio-local.json` | No key; `allowLocalNetwork: true`; default `baseUrl: http://localhost:1234/v1`. Mirrors `ollama-local.json` shape. |
| **Custom OpenAI-compatible** | existing `openai-compatible-custom` | Operator edits everything. |
| **DeepSeek** | **NEW** `presets/deepseek.json` | DeepSeek publishes an OpenAI-compatible chat-completions surface at `https://api.deepseek.com/v1`; standard `Authorization: Bearer …` auth. Sits cleanly on `openai-compatible-llm` with no family changes — only a new first-party preset. **Active in M4a-6.** Operator verification step added to acceptance §13. |

**Planned** (no active card; surfaced as "Coming later — needs <family>"
or omitted entirely — see §1.2):

| Card | Why it can't be active in M4a-6 | What it needs |
|---|---|---|
| **Anthropic** (direct API) | Native Anthropic API (`/v1/messages`) differs from OpenAI's chat-completions shape — different request body, different streaming protocol, different tool-calling envelope. Cannot be cleanly served by `openai-compatible-llm`. | A new `native-anthropic` connector family (deferred from M4a v8). **Claude Code stays a SEPARATE path** — it's already shipped through `cli-acp-agent`, not as a provider card. |
| **Google AI Studio / Gemini** | Native Gemini API has a different endpoint (`/v1beta/models/<model>:generateContent`), different auth (URL query param OR HTTP header, depending on flavour), different message shape. | A new `native-gemini` connector family. OAuth or API-key auth depending on Google product. |
| **xAI / Grok** | xAI's docs claim OpenAI-SDK-compatibility at `https://api.x.ai/v1/chat/completions` with Bearer auth, BUT we have not verified that the existing family yields green end-to-end (notably: their newer Responses-API surface for Grok 4 reasoning models is NOT a drop-in). Conservative posture: planned until an operator runs the M4a-6 acceptance against a real Grok key. | Possibly nothing (if `/chat/completions` works) — in which case M4a-6 PR D can promote xAI to active by adding `presets/xai-grok.json`. Otherwise: a future `native-xai-responses` family. |
| **AWS Bedrock** | Cloud-provider auth model (IAM SigV4 OR Bedrock API key); regional endpoints; per-model invoke runtime; AWS SDK dependency. Cannot be served by `openai-compatible-llm`. | A new `aws-bedrock-runtime` connector family with SigV4 signing. |
| **Nous Portal** | Public API/auth contract not confirmed — Nous Research's hosted offering has varied across versions; we can't ship a preset against an undocumented surface. | Verify the exact endpoint + auth shape first. If OpenAI-compatible, becomes a preset-only change later. |
| **Alibaba Cloud Coding Plan** | **NOT THE SAME** as the public Alibaba DashScope / Qwen OpenAI-compatible endpoint. Alibaba Cloud Coding Plan is a separate product offering whose exact API, auth model, billing surface, and endpoint contract are not yet confirmed. Do NOT silently treat it as DashScope / Qwen-OpenAI-compatible — they may have different auth (RAM access keys vs simple Bearer), different endpoints (Alibaba Cloud regional vs DashScope global), and different SDK contracts. Conservative posture: ship neither active until the Coding-Plan product contract is publicly documented AND verified against this family. | Step 1 — confirm Coding-Plan endpoint + auth + billing surface. Step 2 — if it's a clean Bearer-on-OpenAI-compatible-`/chat/completions` surface, becomes a preset-only promotion. Step 3 — if DashScope-style generic Qwen access lands first under a different card name, that is a **separate** preset/promotion, NOT this row. |
| **Custom direct API** | Broader than OpenAI-compatible — would let an operator point at a non-OpenAI-shaped endpoint. M4a-6 cannot serve this without a generic native-direct family. | A future generic native-direct connector family with a richer settings shape than the current `openai-compatible-custom` preset. |
| **Qwen** (OAuth or CLI login) | OAuth flow / Qwen CLI-login integration not implemented; the existing OAuth-mediated-llm family from v8 §M4a is deferred. | The deferred `oauth-mediated-llm` family OR a Qwen-CLI agent path via `cli-acp-agent`. |

### 1.2 Planned-card UX presentation (LOCKED — O8)

A **collapsed "More providers coming later" disclosure** sits at the
bottom of the picker. Implementation rules:

- Disclosure defaults to **closed**. Expanding it lists the planned
  cards from §1.1.
- Each row is **static**: provider label + a one-line
  "needs <family>" caption stating exactly why it's planned. Examples:
  - *Anthropic direct API — needs a native Anthropic connector family.*
  - *Google AI Studio / Gemini — needs a native Gemini family.*
  - *xAI / Grok — preset-only promotion pending operator validation
    of the OpenAI-compatible path.*
  - *AWS Bedrock — needs a Bedrock auth/runtime family (IAM SigV4 or
    Bedrock API key).*
  - *Nous Portal — needs API/auth contract confirmation.*
  - *Alibaba Cloud Coding Plan — needs product/auth/endpoint contract
    confirmation. NOT the same as DashScope/Qwen-OpenAI-compatible.*
  - *Custom direct API — needs a generic native-direct family.*
  - *Qwen (OAuth or CLI-login) — needs the deferred
    `oauth-mediated-llm` family OR a Qwen-CLI path via `cli-acp-agent`.*
- Rows are **not clickable**. No `<button>`, no `<a>`, no
  `cursor: pointer`. Pure read-only text. No form ever opens for
  them.
- Rows MUST NOT visually mimic active cards — no card border, no
  "Connect" affordance, no status pill that says anything other
  than a neutral "Planned" or no pill at all.

The two alternatives considered during v0.1 review — **(A)** omit
planned cards entirely from the first UI, and **(B)** disabled-card
grid alongside active — were rejected: (A) leaves operators
without an in-product roadmap and generates "where's Anthropic?"
support questions; (B) creates visual noise and risks looking like
UI bugs. The collapsed disclosure is honest about the roadmap with
low visual cost and zero risk of looking broken.

### 1.3 In scope (capabilities)

- A new `secret:<id>` `authRef` variant + a local secret store the kernel reads from.
- Card-based provider picker UI (replaces the terminal-style list).
- API-key paste field, **never re-displayed after save**.
- Pre-save "Test connection" against a transient context (no persistence).
- Edit / rotate / delete connector with explicit secret-cleanup confirmation.
- Existing `env:VAR_NAME` flow stays as **Advanced: use server env var** mode.
- Card presentation that distinguishes active from planned providers per §1.1 / §1.2.

### 1.4 Out of scope (explicitly)

- OAuth flows (Anthropic console OAuth, Google OAuth, Qwen OAuth, etc.).
- Native vendor SDK families: Anthropic (`/v1/messages`), Google Gemini
  (`generateContent`), AWS Bedrock (SigV4), xAI Responses-API. These
  require new connector families and stay deferred. Their cards appear
  as **planned** per §1.1 / §1.2 — never as active or partial.
- `/api/capabilities/invoke` (issue #27).
- Hermes Kanban write capabilities (#25).
- Encryption at rest (file permissions only — see §3).
- Multi-user / device-bound key escrow.
- M5.

### 1.5 Promotion path (planned → active)

A planned card is promoted to active by **either** of two paths,
neither of which is required for M4a-6 to ship:

- **Preset-only promotion** (cheap): the provider turns out to be
  OpenAI-compatible end-to-end. The promotion is a JSON file drop
  in `presets/` plus a card-list update + an acceptance step. No
  kernel changes. xAI / Grok / Nous / Alibaba sit here pending
  verification.
- **New-family promotion** (expensive): a new connector family is
  required (Anthropic, Gemini, Bedrock, generic-native-direct,
  Qwen-OAuth). Each is its own milestone after M4a-6.

The UI's "Coming later" caption per planned card names which path
applies so reviewers don't have to re-derive it.

---

## 2. User stories

```text
US-1  As Rex I click the OpenAI card, paste my key, click Test, click Save.
      The key is gone from the UI after Save. The connector works.

US-2  As Rex I edit a saved OpenAI connector and click "Rotate key". I paste
      a new key. The old one is replaced; I never see the old one.

US-3  As Rex I delete a connector. The UI asks whether to also delete the
      saved key. I tick yes. Both are gone.

US-4  As Rex I delete a connector and leave the saved key. Later I add a
      new connector with the same id; the key is re-attached.

US-5  As Rex I add Ollama. The form asks for Base URL (default
      http://localhost:11434/v1) and shows the local-network allow flag.
      No API key field appears.

US-6  As an advanced operator I click "Advanced: use server env var". I
      type OPENAI_API_KEY. Existing M4a flow continues to work unchanged.
```

---

## 3. Secret store — design decision (open question O1)

**Recommendation: plain JSON file at file mode 0600, NO encryption.**

Path:    `~/.agentic-os/secrets/store.json` (env override: `AGENTIC_OS_SECRETS`).
Dir:     `~/.agentic-os/secrets/` at mode 0700.

```json
{
  "version": 1,
  "secrets": {
    "<id>": {
      "value": "<raw secret>",
      "createdAt": "2026-05-24T10:00:00Z",
      "updatedAt": "2026-05-24T10:00:00Z",
      "label": "OpenAI personal key"
    }
  }
}
```

**Rationale:**

- The threat model Agentic OS targets is **local-first, single-operator desktop**. A file at mode 0600 matches the protection level of `~/.ssh/id_rsa`, `~/.aws/credentials`, `~/.gcloud/credentials.db`, and the existing env-var flow (which lives plaintext in `~/.bashrc`). We are **not weakening** anything — we are moving the file from a shell rc that Rex has to edit manually into a structured store the UI manages.
- Encryption would only be meaningful behind a passphrase prompt; that adds significant UX friction for marginal threat-model gain on a single-user desktop. Out of scope for M4a-6.
- Atomic writes via the existing `withFileLock` + temp-file-rename pattern (`src/lib/fileLock.ts`).
- Parent dir is created at mode 0700 on first write if missing; temp file written at mode 0600 before the rename.

**Alternatives explicitly considered:**

- **OS keychain** (`keytar`) — adds a native dependency, cross-platform fragility, no headless story. Pin for later if a remote/multi-user phase needs it.
- **Encrypted file with master passphrase** — adds a passphrase prompt at every server start. Real UX cost; defer until a passphrase mode is justified by the threat model.
- **Machine-bound encryption** (derive key from machine-id) — encryption theatre; the kernel can read the same machine-id any attacker on the box can.

**Operator-facing documentation:** SECURITY.md gets a paragraph naming the store path, mode, and back-up posture ("treat it like ~/.ssh — back it up out-of-band; do NOT commit it; do NOT include it in the vault").

---

## 4. `authRef` extension

Today: `"none" | "env:VAR_NAME"`.
After M4a-6: `"none" | "env:VAR_NAME" | "secret:<id>"`.

Regex (in `src/kernel/connectors/schema.ts`):
```text
^(none|env:[A-Za-z_][A-Za-z0-9_]*|secret:[a-z0-9][a-z0-9-]{0,63})$
```

`resolveAuthRef` in `src/kernel/connectors/authRef.ts` learns a third branch:

```ts
type AuthResolution =
  | { ok: true; secret: string }
  | { ok: false; errorCode: "auth-missing" | "auth-malformed" };

// secret:<id> -> look up in the secret store; auth-missing if absent.
// env:NAME    -> existing behaviour.
// none        -> existing behaviour.
```

Function signature gains an optional `secretStore?: SecretStore` dep (defaults to the singleton) so tests can inject an isolated store. No change to existing `env:` behaviour.

**`secret:<id>` naming (open question O3):** id is **the same as the connectorId** when the secret is created in lockstep during Add Provider. Predictable, debuggable, easy cleanup. The operator never types the id directly — the UI generates it.

---

## 5. API changes

### NEW routes

```text
POST   /api/connectors/test-draft            transient test (no persistence)
PATCH  /api/connectors/[id]                  update settings or rotate secret
DELETE /api/connectors/[id]                  remove connector (+ optional secret)
GET    /api/secrets                          list secret ids (NO values)
POST   /api/secrets                          create a standalone secret (advanced)
DELETE /api/secrets/[id]                     remove a secret
```

### EXTENDED routes

**`POST /api/connectors`** — body gains an optional `secretValue: string` field:

```ts
{
  connectorId, presetId,
  authRef?: string,             // existing (env:NAME / none)
  secretValue?: string,         // NEW — raw key, written to the store
  settings?, allowLocalNetwork?
}
```

Mutual exclusion: `authRef` and `secretValue` cannot both be set. If
`secretValue` is present, the server:
1. Validates the connector body (existing pipeline).
2. Validates settings + SSRF + family parse (existing pipeline).
3. **First** writes the secret to the store under id = `connectorId`.
4. **Then** writes the connector entry with `authRef: "secret:<connectorId>"`.
5. On any step-4 failure (atomic config write fails), **roll back** the secret-store write — the kernel doesn't leave orphan secrets behind on a half-create.
6. Audits `connector.add` + `secret.create` (id only — NEVER the value).

The `secretValue` field is **never** returned in the response, **never** logged, **never** audited, and **never** echoed back into the connector projection.

**`GET /api/connectors`** — `authRefKind` projection widened from
`"env" | "none" | "unset"` to add `"secret"`:

```ts
authRefKind: "env" | "secret" | "none" | "unset"
```

The new `"secret"` summary tells the UI to render a "🔒 key saved" badge
without exposing the id or the value.

### Test draft route

`POST /api/connectors/test-draft` body:

```ts
{
  presetId: string,
  authRef?: string,             // env:NAME / none
  secretValue?: string,         // raw key, transient — never persisted
  settings?: Record<string, unknown>,
  allowLocalNetwork?: boolean,
}
```

Mirrors `POST /api/connectors/models/preview` shape (existing transient
context pattern). Returns a `ConnectorValidation`. The route NEVER writes
the secret store and NEVER writes a config entry; the transient context
is built in memory only.

### PATCH semantics (open question O4)

`PATCH /api/connectors/[id]` accepts a subset of the POST body (no
`connectorId`, no `presetId`). `secretValue` field semantics:

- **Absent**         → keep existing secret unchanged.
- **Non-empty string** → write new secret; replaces the old.
- **Empty string ""**  → explicit removal — deletes the store entry,
  switches `authRef` to `"none"`. The UI surfaces an explicit
  "Remove saved key" action; never via accidental empty field.

### Delete semantics

`DELETE /api/connectors/[id]?deleteSecret=true|false` —
`deleteSecret` query parameter defaults to `false`. The UI surfaces an
explicit "Also delete the saved API key" checkbox in the delete
dialog (unchecked by default). If `deleteSecret=true` AND the
connector's authRef is `secret:<id>`, the secret entry is removed from
the store. Otherwise the secret remains (orphaned but harmless; the
operator can clean up via `/api/secrets/[id]`).

### Standalone secrets

`GET /api/secrets`: returns `[{ id, createdAt, updatedAt, label?,
referencedBy: [connectorId, ...] }]`. **No values.** The
`referencedBy` field is computed by walking `config.connectors[*].authRef`
for `secret:<id>` matches.

`POST /api/secrets` body: `{ id, value, label? }`. Mostly internal —
the Add Provider flow uses the combined `POST /api/connectors` with
`secretValue` instead. Exposed for advanced operators who want to
manage secrets outside a connector flow.

`DELETE /api/secrets/[id]`: removes the entry. If `referencedBy` is
non-empty, refuses with `409 in-use` (operator must clear the
references first).

---

## 6. File-level changes

### NEW kernel files

```text
src/kernel/secrets/store.ts          SecretStore class — load/save/get/put/delete; atomic.
src/kernel/secrets/paths.ts          secretsStorePath() with AGENTIC_OS_SECRETS env override.
src/kernel/secrets/schema.ts         SecretsFile / SecretRecord Zod types + load guard.
```

### MODIFIED kernel files

```text
src/kernel/connectors/authRef.ts     +secret: branch in resolveAuthRef.
src/kernel/connectors/schema.ts      authRefSchema regex widened.
src/kernel/audit.ts                  +auditSecretCreate/Update/Delete (id-only envelopes).
```

### NEW API route files

```text
src/app/api/connectors/test-draft/route.ts
src/app/api/connectors/[id]/route.ts                    PATCH + DELETE handlers (the
                                                        existing /test sub-route stays).
src/app/api/secrets/route.ts                            GET + POST.
src/app/api/secrets/[id]/route.ts                       DELETE.
```

### MODIFIED API route files

```text
src/app/api/connectors/route.ts                         POST accepts secretValue;
                                                        atomic order described in §5.
src/app/api/connectors/_shared.ts                       authRefKind widened to "secret".
```

### NEW UI files

```text
src/app/settings/_connectors/ProviderPicker.tsx         card-grid replacement for the
                                                        existing PresetPicker list.
src/app/settings/_connectors/ProviderForm.tsx           unified form: API-key path,
                                                        Ollama/LM-Studio path, advanced
                                                        env-var toggle.
src/app/settings/_connectors/SecretField.tsx            password input; "Save key locally"
                                                        helper text; status badge
                                                        (saved/missing/invalid); never
                                                        re-shows saved values.
src/app/settings/_connectors/ConnectorRowActions.tsx    Edit / Delete row buttons;
                                                        delete dialog with the explicit
                                                        "Also delete saved key" checkbox.
```

### MODIFIED UI files

```text
src/app/settings/_connectors/AddProviderFlow.tsx        hosts ProviderPicker + ProviderForm;
                                                        existing PresetForm survives as
                                                        the "Advanced: env var" path.
src/app/settings/_connectors/ConnectorsPanel.tsx        row actions wired; status pill
                                                        shows authRef kind.
src/app/settings/_connectors/api.ts                     +testDraft, updateConnector,
                                                        deleteConnector, listSecrets,
                                                        deleteSecret client helpers.
src/app/settings/_connectors/ModelPicker.tsx            unchanged (still consumes
                                                        /api/connectors/models/preview).
```

### NEW presets

```text
presets/lm-studio-local.json       openai-compatible-llm; allowLocalNetwork: true;
                                   default baseUrl http://localhost:1234/v1; trust
                                   first-party.

presets/deepseek.json              openai-compatible-llm; default baseUrl
                                   https://api.deepseek.com/v1; default model
                                   "deepseek-chat"; trust first-party.
                                   authPrompt.apiKeyEnvVar suggested label
                                   "DEEPSEEK_API_KEY" + helpUrl
                                   https://platform.deepseek.com/api_keys
                                   (advanced env-var path); for the secret-
                                   store path, just the API-key paste field.
```

---

## 7. Audit kinds (new)

```text
secret.create { secretId, label?, status }
secret.update { secretId, status }
secret.delete { secretId, status }
```

**Never** in any of these: the secret VALUE, the env var resolved value, the Authorization header. Only the operator-facing id and an optional label. Status is the closed neutral set `"success" | "failed"` with an optional `errorCode`.

---

## 8. Tests

### Kernel tests

```text
tests/secrets-store.test.ts                 CRUD; atomic write; mode 0600 enforced;
                                            withFileLock concurrency; missing file
                                            yields empty store; AGENTIC_OS_SECRETS
                                            env override.
tests/secrets-store-malformed.test.ts       malformed JSON / unreadable / wrong shape
                                            -> SecretStoreError; route surfaces neutral
                                            internal-error (NO raw content echoed).
tests/auth-ref-secret.test.ts               resolveAuthRef("secret:foo") happy + missing
                                            + malformed id. Existing env:/none cases
                                            still pass.
tests/connector-runtime-secret.test.ts      buildConnectorContext: secret:<id> resolves
                                            to ctx.secret; missing secret -> auth-missing
                                            misconfigured.
```

### Route tests

```text
tests/api-secrets.test.ts                   GET (no values); POST create; DELETE;
                                            DELETE refuses if referencedBy non-empty.
tests/api-connectors-test-draft.test.ts     POST /test-draft with secretValue; no
                                            persistence side-effect (secret store NOT
                                            mutated; config NOT mutated).
tests/api-connectors-patch.test.ts          rotate secret (new value replaces old);
                                            empty string clears; absent keeps;
                                            mutual exclusion authRef vs secretValue.
tests/api-connectors-delete.test.ts         delete without deleteSecret keeps secret;
                                            delete with deleteSecret=true removes;
                                            delete with deleteSecret on env-authRef
                                            is a no-op.
tests/api-connectors-secret-value.test.ts   POST /api/connectors with secretValue
                                            writes to store, sets authRef:
                                            secret:<connectorId>; failure in config
                                            write rolls back the secret-store write.
```

### Security tests

```text
tests/secret-non-leak.test.ts               Marker-string sweep: a known secret
                                            value is set up; assertion across
                                            /api/connectors, /api/secrets, /api/runs,
                                            audit JSONL, run records, and every
                                            neutral-error response that the marker
                                            NEVER appears.
```

### UI tests

Deferred per the spec convention (no `@testing-library/react` in the repo); manual verification via `docs/M4A6-ACCEPTANCE.md`.

---

## 9. Migration / compatibility

| Concern | Behaviour |
|---|---|
| Existing `env:NAME` connectors | Continue working with **zero changes**. The regex widens, never narrows. |
| Existing `none` connectors | Continue working unchanged. |
| Existing config on disk | Parses unchanged; no migration step needed. |
| Fresh install | `~/.agentic-os/secrets/store.json` and its parent dir are created on first secret write — never on cold start. |
| Persistence model (ADR-0014 four-store split) | Secrets file lives **alongside** `config.yaml`, NOT in `state.db`. ADR-0014's four-store rule is about the SQLite-vs-filesystem-artifact-vs-audit-vs-vault split; a small secret file alongside config is consistent with the existing kernel-managed config carveout. **No state DB migration needed.** ADR-0019 will document this. |
| Backup posture | SECURITY.md gets a paragraph naming the store + mode + "treat like ~/.ssh". |
| Audit retro-compat | New `secret.*` audit kinds are additive; existing analysis tools that filter by `kind` are unaffected. |

---

## 10. Security non-leak invariants (locked)

Across every shipped surface, NONE of these may contain the raw secret value:

- API response bodies (`/api/connectors`, `/api/secrets`, `/api/runs`,
  `/api/connectors/[id]/test`, `/api/connectors/models/preview`,
  `/api/connectors/test-draft`, `/api/connectors/[id]` PATCH, …).
- Audit JSONL (any `kind`).
- Run records (any field).
- `console.log/error/warn` lines.
- `~/.agentic-os/config.yaml`.
- `~/.agentic-os/state.db`.
- Any error message returned from the kernel.

Asserted by `tests/secret-non-leak.test.ts` with a marker-string sweep.

The new `secret.create` / `secret.update` / `secret.delete` audit kinds carry the operator-facing **id** (not sensitive) plus an optional **label** plus the status + optional errorCode.

---

## 11. ADR work

**ADR-0019: UI-managed local secret store.** New decision doc:

- Decision: secrets live in `~/.agentic-os/secrets/store.json` at mode 0600 (dir 0700). No encryption.
- Decision: `authRef` union extended with `secret:<id>`; regex documented.
- Decision: cleanup rule (explicit UI confirmation on connector delete).
- Decision: rotation via PATCH /api/connectors/[id].
- Decision: persistence-model fit — secrets are **kernel-managed config-adjacent state**, not a fifth store under ADR-0014.
- Alternatives considered: keychain (deferred), encrypted file (deferred), env-var-only (rejected — forces terminal editing; the whole point of M4a-6).
- References: ADR-0017 (connector runtime + authRef), ADR-0018 (preset catalog), `m4a-6-task-spec.md`.

ADR-0017 / ADR-0018 do not need amendments — M4a-6 extends them, doesn't change their decisions.

---

## 12. PR breakdown

Per the workflow's "one logical change per PR" rule, M4a-6 splits cleanly into 4 PRs:

```text
PR A — Secret store + authRef extension (kernel only).
  + src/kernel/secrets/{store,paths,schema}.ts
  + extend src/kernel/connectors/{authRef,schema}.ts
  + extend src/kernel/audit.ts (auditSecret{Create,Update,Delete})
  + tests/secrets-store.test.ts
  + tests/secrets-store-malformed.test.ts
  + tests/auth-ref-secret.test.ts
  + tests/connector-runtime-secret.test.ts
  DoD: typecheck + tests green; existing env:/none flow unchanged
  (all current router/test/connector tests still pass).

PR B — Routes + transient test + standalone secrets (no UI).
  + src/app/api/connectors/test-draft/route.ts
  + src/app/api/connectors/[id]/route.ts (PATCH + DELETE)
  + src/app/api/secrets/route.ts (GET + POST)
  + src/app/api/secrets/[id]/route.ts (DELETE)
  + extend src/app/api/connectors/route.ts (POST accepts secretValue + atomic
    secret-then-config write with rollback)
  + extend src/app/api/connectors/_shared.ts (authRefKind: "secret")
  + tests/api-secrets.test.ts
  + tests/api-connectors-test-draft.test.ts
  + tests/api-connectors-patch.test.ts
  + tests/api-connectors-delete.test.ts
  + tests/api-connectors-secret-value.test.ts
  + tests/secret-non-leak.test.ts
  DoD: full marker-string sweep is clean; old env:/none flow untouched;
  PATCH/DELETE round-trip on a real preset works in-test.

PR C — UI: provider picker, key field, row actions.
  + src/app/settings/_connectors/ProviderPicker.tsx
  + src/app/settings/_connectors/ProviderForm.tsx
  + src/app/settings/_connectors/SecretField.tsx
  + src/app/settings/_connectors/ConnectorRowActions.tsx
  + presets/lm-studio-local.json
  + presets/deepseek.json
  + a hardcoded PLANNED_PROVIDERS constant in the picker module listing
    the planned cards from §1.1 (Anthropic, Gemini, Grok, Bedrock, Nous,
    Alibaba, custom-direct, Qwen-OAuth) each with a "needs <family>"
    caption per §1.5. Rendered inside a collapsed disclosure per §1.2.
    The list is in code (not config) because none of these cards have a
    preset until their family ships — see §1.5 promotion path.
  + extend AddProviderFlow.tsx (host the new picker + form; Advanced env-var
    path preserved)
  + extend ConnectorsPanel.tsx (row actions wired)
  + extend api.ts (testDraft / updateConnector / deleteConnector / listSecrets
    / deleteSecret client helpers)
  DoD: manual verification per docs/M4A6-ACCEPTANCE.md passes locally.

PR D — Closeout.
  + docs/decisions/ADR-0019-ui-managed-secret-store.md
  + docs/ARCHITECTURE.md (§8 — new secret-store paragraph + routes update)
  + docs/SECURITY.md (secret-store path / mode / backup posture paragraph)
  + docs/ROADMAP.md (M4a-6 status)
  + docs/specs/expandability-foundation/README.md (status table row)
  + docs/specs/expandability-foundation/m4a-6-task-spec.md (this spec, finalised)
  + docs/M4A6-ACCEPTANCE.md (operator checklist; see §13)
  DoD: per the docs/MAINTENANCE.md milestone-done rule — all eight items
  ticked (code, tests, ADR, ARCHITECTURE, ROADMAP, spec status, acceptance
  checklist, live acceptance pass).
```

---

## 13. Operator acceptance — `docs/M4A6-ACCEPTANCE.md` (sketch)

```text
Step 1 — Settings → Connectors → Add Provider → OpenAI card.
Step 2 — Paste a real OpenAI key into the API key field.
Step 3 — Click Test connection → status: valid.
Step 4 — Click Save → connector appears in the panel; key field is no
         longer visible.
Step 5 — cat ~/.agentic-os/config.yaml → entry stores
         `authRef: "secret:openai-1"`. NO sk-... value anywhere.
Step 6 — ls -l ~/.agentic-os/secrets/store.json → file mode 0600.
         cat the file → contains the secret keyed by id. (One-time
         inspection; the operator should not need to look in here
         during normal use.)
Step 7 — curl http://127.0.0.1:3000/api/connectors | grep sk-       (empty)
Step 8 — curl http://127.0.0.1:3000/api/runs       | grep sk-       (empty)
Step 9 — grep -r sk- ~/.agentic-os/audit/                           (empty)
Step 10 — Settings → Edit OpenAI → Rotate key. Paste a different key.
          Old key gone from store.json; new key in place.
Step 11 — Settings → Delete OpenAI with "Also delete saved key" checked.
          Both connector and secret are gone.
Step 12 — Settings → Add Provider → "Advanced: use server env var" path.
          Existing env-var flow still works unchanged.
Step 13 — Settings → Ollama card. Base URL editable; no API key field.
          allowLocalNetwork toggle present.
Step 14 — Settings → LM Studio card. Same shape as Ollama.
Step 15 — Settings → DeepSeek card. Paste a real DeepSeek API key.
          Test connection → valid; chat.generate against
          `deepseek-chat` returns a real response. authRef stored as
          `secret:deepseek-1`; NO key value anywhere on disk / API /
          audit. If this step fails, DeepSeek MOVES BACK to the
          planned list and PR D's docs reflect that — we ship M4a-6
          with the active set we can actually verify.
Step 16 — Picker shows the "More providers coming later" disclosure.
          Expanding it shows the planned cards from §1.1 each with its
          "needs <family>" caption. None of them are clickable; none
          opens a form.
Step 17 — npm run typecheck && npm test && npm run build → all green.
Step 18 — Doc sync (ADR-0019, ARCHITECTURE, ROADMAP, m4a-6 spec status,
          M4A6-ACCEPTANCE) merged.
```

---

## 14. Open questions for Rex

```text
O1  Secret-store encryption?
    Default: NO — file perms (0600) only, matching ~/.ssh / ~/.aws.
    Pin if you want a passphrase-protected mode.

O2  Multi-key per provider (e.g. OpenAI personal + OpenAI work)?
    Default: solved by adding two CONNECTOR INSTANCES, each with its own
    secret. No "shared secret library" concept in M4a-6. Pin if you want
    one secret reusable across instances.

O3  secret:<id> naming.
    Default: id == connectorId when created in lockstep. Predictable,
    debuggable, easy cleanup. Pin if you want random opaque ids.

O4  PATCH secretValue semantics.
    Default: absent = keep, non-empty = rotate, empty string = clear
    (with an explicit UI confirmation step). Pin if you want a separate
    "clearSecret" boolean.

O5  /api/connectors authRefKind union.
    Default: extend with "secret". The UI gains a 🔒 badge for that
    kind. Pin if you want a more granular surface.

O6  Backup / export docs.
    Default: a short paragraph in SECURITY.md naming the store path,
    mode, and "treat like ~/.ssh" backup posture. Pin if you want a
    standalone docs/BACKUP.md.

O7  M4A6-ACCEPTANCE.md vs inline manual verification.
    Default: ship a real M4A6-ACCEPTANCE.md (parallel to
    M4A-ACCEPTANCE.md), so the milestone-done rule's "acceptance
    checklist" tick has a real file. Pin if you'd rather just verify
    inline at PR-D review time.

O8  [LOCKED — Rex 2026-05-24] Planned-card UX presentation.
    DECISION: collapsed "More providers coming later" disclosure at
    the bottom of the picker. Static rows ONLY, not clickable. Each
    row carries a "needs <family>" caption stating why it is planned
    (examples in §1.2). Alternatives (A omit / B disabled-grid) were
    considered and rejected; see §1.2 for the rationale.

O9  [LOCKED — Rex 2026-05-24] DeepSeek as active.
    DECISION: ship as active in M4a-6 — DeepSeek publishes an
    OpenAI-compatible chat-completions surface and sits on the
    existing `openai-compatible-llm` family with a first-party
    preset only (no kernel changes). Acceptance §13 Step 15
    verifies end-to-end against a real key. **Demote rule (hard):**
    if Step 15 fails on acceptance day, DeepSeek demotes to
    PLANNED before PR D closeout, the spec records the failure
    reason, and PR D's `presets/deepseek.json` is deleted from the
    diff — we never ship a card we can't verify works.

O10 [LOCKED — Rex 2026-05-24] xAI / Grok promotion path.
    DECISION: stays PLANNED in M4a-6. Promotion is **preset-only**
    (no kernel changes expected) and happens via a follow-up PR
    after an operator runs the M4a-6 acceptance shape against a
    real Grok key and confirms basic chat.generate is green. If
    that fails, xAI stays planned until either xAI changes or a
    native `native-xai-responses` family lands.

O11 [LOCKED — Rex 2026-05-24] Alibaba naming discipline.
    DECISION: "Alibaba Cloud Coding Plan" and "Alibaba DashScope /
    Qwen OpenAI-compatible endpoint" are TREATED AS DISTINCT
    INTEGRATIONS until proven otherwise. The Alibaba Cloud Coding
    Plan row in §1.1 stays planned with its own "needs product/
    auth/endpoint contract confirmation" caption. If DashScope-
    style generic Qwen access lands first (preset-only on
    `openai-compatible-llm`), that ships under a DIFFERENT card
    name (e.g. "Alibaba DashScope" or "Qwen via DashScope"),
    NOT silently under the Coding-Plan row. The spec MUST NOT
    fold the two together until publicly-documented product
    contracts are confirmed.
```

---

**End of M4a-6 task spec (v1 draft, design only).** Active/planned
split locked per Rex (2026-05-24); O8 / O9 / O10 / O11 pinned (see
§14). No implementation begins until M4a-5 closeout merges, the
M4a-5 operator-acceptance tick lands per §0, AND Rex green-lights
PR A.
