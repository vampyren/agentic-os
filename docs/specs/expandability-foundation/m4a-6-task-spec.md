# M4a-6 Task Spec — Provider Catalog Expansion (6a) + UI-Managed Connector Secrets (6b) (v2 draft)

**Date:** 2026-05-24
**Version:** v2 — split into two sequential sub-milestones (M4a-6a provider catalog expansion; M4a-6b UI-managed connector secrets). v1 was the unified spec; v0.1 was the broader-catalog pass; v0 was the first design pass. **Committed to the repo as a design-accepted draft** per `docs/MAINTENANCE.md`. No implementation begins until M4a-5 closeout merges, the M4a-5 operator-acceptance tick lands per §0, AND Rex green-lights M4a-6a PR.

> **v1 → v2 (sub-milestone split):**
> Spec restructured to make explicit that M4a-6 bundles two distinct
> concerns. Section 0.5 (NEW) names the two sub-milestones. Part A
> (M4a-6a — provider catalog expansion) is UI + presets only, with
> **NO new authRef kind** and **NO secret persistence** — existing
> env:VAR_NAME flow remains the credential path. Part B (M4a-6b —
> UI-managed connector secrets) contains the secret store + new
> authRef kind. M4a-6a ships first as one PR; M4a-6b ships after
> 6a is merged and operator-accepted. The split keeps blast radius
> small per the workflow's "one logical change per PR" rule —
> operators get the polished picker immediately, and the deeper
> kernel/security change of 6b ships on top of a verified baseline.
> All v1 locked decisions (O8 / O9 / O10 / O11) preserved unchanged.
> §10 strengthened with explicit guardrails Rex added for the
> v1 → v2 split: .gitignore-coverage regression test; SECURITY.md
> must plainly state that local secret-store files are plaintext
> on disk and that file permissions + backup hygiene are the
> security boundary.
>
> **v0.1 → v1 (locked decisions, preserved):**
> §1.1 active table (OpenAI, OpenRouter, Ollama, LM Studio,
> Custom OpenAI-compatible, **DeepSeek**) and planned table
> (Anthropic-direct, Gemini, xAI/Grok, AWS Bedrock, Nous, Alibaba
> Cloud Coding Plan, Custom direct API, Qwen) locked. Alibaba
> Cloud Coding Plan is **NOT** the same integration as "Alibaba
> DashScope / Qwen OpenAI-compatible endpoint"; treat as distinct.
> §1.2 LOCKED — collapsed "More providers coming later"
> disclosure with static, non-clickable rows + "needs <family>"
> caption per planned card. §14 O8 / O9 / O10 / O11 LOCKED with
> Rex's pinned decisions.
>
> Open questions still in play: O1 (encryption), O2 (multi-key per
> provider), O3 (secret id naming), O4 (PATCH semantics), O5
> (authRefKind union), O6 (backup docs), O7 (acceptance file).
> Rex accepting v2 = greenlight to start M4a-6a PR — but only
> after M4a-5 closeout + operator acceptance per §0.

**Milestone:** M4a-6 — provider catalog + UI-managed connector secrets (OPTIONAL post-M4a-5; split into 6a + 6b per §0.5).
**Status:** **DRAFT v2 — DESIGN ONLY**. Sub-milestone split locked per Rex (2026-05-24). No branch, no implementation until M4a-5 closeout + operator acceptance ticks AND Rex green-lights M4a-6a PR.
**Parent design:** `m4-task-spec.md` v2.1 (M4a connector runtime); `m4a-5-task-spec.md` v1.2 (model discovery).
**Predecessor milestone:** M4a-5 — code complete on `main` (PR #29 + PR #30).
**Successor milestone:** M5 — Artifacts + approvals.
**Goal:** Two sequential sub-milestones. **M4a-6a:** polished provider catalog picker — Rex picks a card, configures via existing env-var auth, tests, saves. No terminal-style list, no fake-active providers. **M4a-6b:** UI-managed local secrets — Rex pastes an API key into the UI, server stores it server-side outside repo/git, the repo config holds only an authRef. Existing env:VAR_NAME flow stays as the Advanced/server mode throughout.

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
should land **before** any M4a-6 PR implementation starts so the work
builds on a verified-and-documented base.

---

## 0.5 Sub-milestone split (v2)

M4a-6 ships as **two sequential sub-milestones**. The split exists
because the v1 spec bundled two distinct concerns (provider catalog
UX + local secret store); each is independently reviewable and the
operator gets value from 6a immediately without committing to 6b yet.

### M4a-6a — Provider catalog expansion

Scope:

- Card-based **provider picker** that replaces the existing
  terminal-style preset list.
- Collapsed "More providers coming later" disclosure for planned
  providers per the LOCKED rules in §1.2 (O8).
- New first-party presets: **LM Studio local**, **DeepSeek** (DeepSeek
  subject to demote-on-acceptance-failure per O9).
- Picker polish: clearer cards, provider-friendly copy, preserved
  provider order from `/api/connectors/presets`.
- **Existing `env:VAR_NAME` auth path remains the only credential
  mechanism in 6a.** No new authRef kind, no secret persistence, no
  new auth APIs. An operator who hadn't set an env var before still
  hasn't had to set one — the picker just shows them the
  Advanced/env-var form when they pick a card that needs a key, same
  as today.
- One PR (UI + presets only). Lands first.

Out of scope for 6a:

- Secret store — **lives entirely in M4a-6b**.
- New `secret:<id>` authRef kind — **6b only**.
- New routes for secret CRUD or pre-save test-draft — **6b only**.
- New ADR — **6b ships ADR-0019**.

### M4a-6b — UI-managed connector secrets

Scope:

- New `secret:<id>` authRef kind + local file-backed secret store
  outside repo/git.
- API + UI to paste an API key once, store it server-side, test the
  connector, rotate or clear it later.
- `authRefKind` projection union widens to include `"secret"` (O5).
- Existing `env:VAR_NAME` flow stays as the **Advanced/server mode**
  — the operator picks between "Save key locally" and "Use server
  env var" inside the now-card-based picker shipped in 6a.
- 4 PRs (PR A kernel store + authRef extension; PR B routes; PR C
  UI revisions to add the secret-store path; PR D closeout).
- Begins only after **M4a-6a merges + M4a-6a acceptance passes +
  Rex explicitly green-lights 6b PR A**.

Out of scope for 6b:

- Encryption at rest (file permissions only — see §10 for the
  locked guardrails).
- OAuth flows.
- Native vendor families.
- M5.

### Why this order

6a is contained: UI redesign + two preset files. Reviewable in one
PR, deployable without operator behaviour change (env-var operators
keep working unchanged). 6b stacks on 6a's verified base and adds
the deeper kernel + security surface. If 6b ever has to be reverted,
6a stays valuable on its own — operators retain the polished picker
and the two new presets.

---

# Part A — M4a-6a: Provider catalog expansion

The sections below (§1 catalog rules, §2 user stories US-5/US-6/US-7,
the picker UX in §1.2) and the new presets (LM Studio + DeepSeek)
constitute M4a-6a's full scope. **No authRef changes. No secret
persistence. No new routes.** Existing `env:VAR_NAME` flow remains
the credential path; the picker rendered by 6a uses the
`PresetForm` already shipped in M4a-5 PR C (with its env-var input)
when the operator picks a card that needs a key.

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

| Card | Preset source | 6a credential path | 6b credential path |
|---|---|---|---|
| **OpenAI** | existing `openai` | `env:VAR_NAME` only (e.g. `env:OPENAI_API_KEY`) | adds `secret:<id>` UI-managed key |
| **OpenRouter** | existing `openrouter` | `env:VAR_NAME` only (e.g. `env:OPENROUTER_API_KEY`) | adds `secret:<id>` UI-managed key |
| **Ollama local** | existing `ollama-local` | No key; `allowLocalNetwork: true`; default `baseUrl: http://localhost:11434/v1` | unchanged (no key needed) |
| **LM Studio local** | **NEW** `presets/lm-studio-local.json` | No key; `allowLocalNetwork: true`; default `baseUrl: http://localhost:1234/v1`. Mirrors `ollama-local.json` shape | unchanged (no key needed) |
| **Custom OpenAI-compatible** | existing `openai-compatible-custom` | Operator edits everything; auth via `env:VAR_NAME` | adds `secret:<id>` UI-managed key |
| **DeepSeek** | **NEW** `presets/deepseek.json` | `env:DEEPSEEK_API_KEY` — acceptance verifies real-key end-to-end on the `openai-compatible-llm` family at `https://api.deepseek.com/v1`. If acceptance fails, DeepSeek demotes to PLANNED before 6a closeout (O9 demote rule). | adds `secret:<id>` UI-managed key once 6b ships |

**Reading the table:** the **6a credential path** column is what
operators get when M4a-6a merges — every active card configurable
via the existing `env:VAR_NAME` flow, no new authRef kind. The
**6b credential path** column names what M4a-6b adds on top of 6a:
the same card stays configurable via env-var, AND gains the
"Save key locally" option backed by the secret store. DeepSeek
publishes an OpenAI-compatible chat-completions surface with
standard `Authorization: Bearer …` auth; it sits on the
`openai-compatible-llm` family with no family changes.

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

Split by sub-milestone per §0.5. The 6a list is what ships in
M4a-6a's single PR; the 6b list is what M4a-6b's four PRs add on
top. Anything not on either list is out of scope (see §1.4).

#### 1.3.A In scope for M4a-6a (provider catalog expansion)

- **Card-based provider picker UI** replacing the terminal-style
  preset list shipped in M4a-5 PR C.
- **Card presentation that distinguishes active from planned
  providers** per §1.1 / §1.2 — collapsed "More providers coming
  later" disclosure with static, non-clickable rows + "needs
  <family>" captions.
- **New first-party presets:** `presets/lm-studio-local.json` and
  `presets/deepseek.json` (DeepSeek subject to the demote-on-
  acceptance-failure rule per O9).
- **Hardcoded `PLANNED_PROVIDERS` constant** in the picker module
  listing the planned cards from §1.1 with their "needs <family>"
  captions per §1.5.
- **Existing `env:VAR_NAME` flow remains the only credential
  mechanism in 6a.** No new authRef kind, no secret persistence,
  no new auth APIs. The picker hosts the existing `PresetForm`
  (shipped in M4a-5 PR C) when a card needs a key — operator
  types an env var name; same behaviour as today.

NOT in 6a: secret store, `secret:<id>` authRef, new routes for
secret CRUD or pre-save test-draft, paste/rotate/clear key UI,
SecretField component, ADR-0019. All of those are 6b.

#### 1.3.B In scope for M4a-6b (UI-managed connector secrets)

- A new **`secret:<id>` `authRef` variant** + a **local file-backed
  secret store** the kernel reads from (path, perms, atomic writes
  documented in §3 + §10.1).
- **API-key paste field** in the Add Provider form, **never
  re-displayed after save**.
- **Pre-save "Test connection"** against a transient context (no
  persistence) — new `POST /api/connectors/test-draft`.
- **Edit / rotate / delete connector** with explicit secret-cleanup
  confirmation — new `PATCH /api/connectors/[id]` and `DELETE
  /api/connectors/[id]` with the `?deleteSecret=true|false` query
  flag.
- **Standalone secret CRUD** — `GET/POST /api/secrets`,
  `DELETE /api/secrets/[id]`.
- **`authRefKind` projection widens** to include `"secret"` (O5).
- **Existing `env:VAR_NAME` flow** stays as the
  **Advanced: use server env var** mode — the operator picks
  between "Save key locally" and "Use server env var" inside the
  6a-shipped card picker.
- **ADR-0019** documenting the secret store + downward-only
  cleanup rule + the deliberate no-encryption-yet posture.
- **SECURITY.md** updated with the verbatim plaintext-on-disk
  paragraph per §10.3.

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

US-1 through US-4 (paste-key, rotate, delete-with-secret-cleanup,
delete-keeping-secret) belong to **M4a-6b** and are framed at the top
of Part B below.

---

# Part B — M4a-6b: UI-managed connector secrets

Everything below (§3 secret store, §4 authRef extension, §5 API
changes, §7 audit kinds, §10 security non-leak invariants, §11 ADR
work, the secret-related portions of §6 file-level changes, and the
M4a-6b acceptance steps in §13) constitutes M4a-6b's scope. **M4a-6b
begins only after M4a-6a is merged and operator-accepted.**

### Part B preconditions

```text
[ ] M4a-6a (provider catalog expansion) merged to main.
[ ] M4a-6a operator acceptance per docs/M4A6A-ACCEPTANCE.md passed.
[ ] Rex explicitly green-lights M4a-6b PR A.
```

### Part B user stories (carried verbatim from v1)

```text
US-1  As Rex I click the OpenAI card, paste my key, click Test, click
      Save. The key is gone from the UI after Save. The connector works.

US-2  As Rex I edit a saved OpenAI connector and click "Rotate key". I
      paste a new key. The old one is replaced; I never see the old one.

US-3  As Rex I delete a connector. The UI asks whether to also delete
      the saved key. I tick yes. Both are gone.

US-4  As Rex I delete a connector and leave the saved key. Later I
      add a new connector with the same id; the key is re-attached.
```

US-5 and US-6 sit under Part A above (Ollama with no key; Advanced
env-var path).

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

## 10. Security non-leak invariants (locked — M4a-6b guardrails)

**Scope:** these invariants apply to M4a-6b once the secret store
exists. M4a-6a carries no secret material — it ships only UI
restructure + presets, so the operator's env-var posture is
unchanged.

### 10.1 Store location and permissions

- Secret file lives **outside the repo**, at `~/.agentic-os/secrets/store.json`
  (env override: `AGENTIC_OS_SECRETS`). Never under the repo tree;
  never under the vault; never under `state.db`.
- Parent dir `~/.agentic-os/secrets/` created at mode **0700**
  on first write if missing.
- Store file written at mode **0600** (owner read/write only) on
  every write, including the temp-file phase of the atomic-rename
  pattern.
- `.gitignore` regression test: a unit test asserts that the
  default secret-store path AND any value of `AGENTIC_OS_SECRETS`
  pointing inside the repo tree would be excluded by the repo's
  `.gitignore`. The test fails CI if a future `.gitignore` change
  accidentally lets a secrets file land under git.

### 10.2 Non-leak surface list

Across every shipped surface, NONE of these may contain the raw
secret value (asserted by `tests/secret-non-leak.test.ts` with a
marker-string sweep):

- API response bodies (`/api/connectors`, `/api/secrets`, `/api/runs`,
  `/api/connectors/[id]/test`, `/api/connectors/models/preview`,
  `/api/connectors/test-draft`, `/api/connectors/[id]` PATCH, …).
- testConnection result envelopes (validation status, errorCode,
  duration — never the secret).
- Audit JSONL (any `kind`).
- Run records (any field).
- `console.log` / `console.error` / `console.warn` lines.
- `~/.agentic-os/config.yaml` (config persists only the authRef,
  never the value).
- `~/.agentic-os/state.db` (state DB persists nothing secret-bearing
  per ADR-0014).
- Any error message returned from the kernel.

The new `secret.create` / `secret.update` / `secret.delete` audit
kinds carry the operator-facing **id** (not sensitive) plus an
optional **label**, the status, and an optional `errorCode`. They
do NOT carry the value, the env var name, the Authorization header,
the `baseUrl`, or `ctx.secret`.

### 10.3 `SECURITY.md` plaintext-on-disk statement (REQUIRED in PR D)

`docs/SECURITY.md` MUST state plainly, as part of M4a-6b PR D
closeout:

> The local secret store (`~/.agentic-os/secrets/store.json`)
> contains API keys in **plaintext on disk**. File permissions
> (0600 file / 0700 directory) and backup hygiene are the
> security boundary for the UI-managed secret flow. The file is
> protected at the same level as `~/.ssh/id_rsa` or
> `~/.aws/credentials`; treat it the same way (back it up
> out-of-band, do not commit it, do not include it in the vault).
>
> If stronger guarantees are required (encryption at rest,
> hardware-backed key storage), use the `env:VAR_NAME` authRef
> mode and supply the credential via your OS keyring / secret
> manager / shell environment. The Advanced/env-var flow in the
> Add Provider UI takes you down that path.

This paragraph is mandatory; the PR D doc-sync is blocked until it
lands.

### 10.4 What's NOT promised

For honesty:

- The store is NOT encrypted. A process running as the same user
  can read it. So can a backup tool, a misconfigured share, or a
  `tar` of the home directory.
- This is the same posture as the existing env-var flow (env-var
  contents are visible to any same-user process via `/proc/<pid>/environ`
  or shell history). M4a-6b does not weaken what M4a already
  shipped — it gives the operator a UI-friendly alternative at the
  same security level.
- Operators who need a stronger boundary should use `env:VAR_NAME`
  + OS keyring tooling (per §10.3).

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

Restructured for the v2 sub-milestone split. M4a-6 ships in two
sequential phases: 6a (one PR, UI + presets only) lands first; 6b
(four PRs, secret-store layer) stacks on top of 6a only after 6a
is merged and operator-accepted.

### 12.A M4a-6a — one PR

```text
M4a-6a PR — Provider catalog expansion (UI + new presets only).
  + src/app/settings/_connectors/ProviderPicker.tsx (NEW card grid;
      replaces the current PresetPicker terminal-style list — that
      component shipped in M4a-5 PR C and is the immediate
      predecessor surface).
  + a hardcoded PLANNED_PROVIDERS constant in the picker module
    listing the planned cards from §1.1 (Anthropic, Gemini, Grok,
    Bedrock, Nous, Alibaba Cloud Coding Plan, custom-direct,
    Qwen-OAuth) each with a "needs <family>" caption per §1.5,
    rendered inside the collapsed "More providers coming later"
    disclosure per §1.2 (LOCKED — O8). The list is in code (not
    config) because no preset exists for planned cards until their
    family ships.
  + presets/lm-studio-local.json (NEW).
  + presets/deepseek.json (NEW; subject to demote-on-acceptance-
    failure rule per O9).
  + extend AddProviderFlow.tsx to host the new ProviderPicker;
    the existing PresetForm + ModelPicker shipped in M4a-5 PR C
    are reused unchanged. Advanced/env-var input continues to be
    the credential field.
  + tests/provider-picker.test.ts — picker render smoke, planned-
    disclosure visibility, "needs <family>" caption presence per
    planned card. Manual verification per docs/M4A6A-ACCEPTANCE.md
    is the primary UX-correctness gate (no @testing-library/react
    in the repo).

  NO changes in this PR to:
    - src/kernel/connectors/* (no authRef regex change)
    - src/kernel/secrets/* (does not exist yet — 6b ships it)
    - any /api/connectors* route handler
    - audit kinds
    - docs/SECURITY.md / ADRs / ARCHITECTURE.md beyond a small
      ROADMAP/m4a-6-task-spec.md status-table touch in a tiny
      6a closeout commit (or folded into the same PR if scope
      stays small).

  DoD: typecheck + tests green; the existing env:VAR_NAME flow is
  observably unchanged (operators with M4a-5-saved connectors
  see the same Add Provider experience minus the terminal-style
  list); the planned-provider disclosure renders honestly per §1.2.
```

After M4a-6a merge: Rex runs docs/M4A6A-ACCEPTANCE.md against a
live server. Only after that passes does M4a-6b PR A start.

### 12.B M4a-6b — four PRs

```text
M4a-6b PR A — Secret store + authRef extension (kernel only).
  + src/kernel/secrets/{store,paths,schema}.ts
  + extend src/kernel/connectors/{authRef,schema}.ts
  + extend src/kernel/audit.ts (auditSecret{Create,Update,Delete})
  + tests/secrets-store.test.ts
  + tests/secrets-store-malformed.test.ts
  + tests/auth-ref-secret.test.ts
  + tests/connector-runtime-secret.test.ts
  + tests/secrets-gitignore-coverage.test.ts (NEW — §10.1 guardrail)
  DoD: typecheck + tests green; existing env:/none flow unchanged
  (all current router/test/connector tests still pass); the
  .gitignore regression test passes against the default store
  path AND against any AGENTIC_OS_SECRETS path that points into
  the repo tree.

M4a-6b PR B — Routes + transient test + standalone secrets (no UI).
  + src/app/api/connectors/test-draft/route.ts
  + src/app/api/connectors/[id]/route.ts (PATCH + DELETE)
  + src/app/api/secrets/route.ts (GET + POST)
  + src/app/api/secrets/[id]/route.ts (DELETE)
  + extend src/app/api/connectors/route.ts (POST accepts secretValue
    + atomic secret-then-config write with rollback)
  + extend src/app/api/connectors/_shared.ts (authRefKind: "secret")
  + tests/api-secrets.test.ts
  + tests/api-connectors-test-draft.test.ts
  + tests/api-connectors-patch.test.ts
  + tests/api-connectors-delete.test.ts
  + tests/api-connectors-secret-value.test.ts
  + tests/secret-non-leak.test.ts (marker-string sweep per §10.2)
  DoD: full marker-string sweep is clean; old env:/none flow
  untouched; PATCH/DELETE round-trip on a real preset works in-test.

M4a-6b PR C — UI revisions: secret-store path inside the picker.
  + src/app/settings/_connectors/ProviderForm.tsx (NEW or rewrite
      of PresetForm — adds the "Save key locally" path alongside
      the existing "Advanced: use server env var" path; the
      ProviderPicker from 6a stays the entry point)
  + src/app/settings/_connectors/SecretField.tsx (password input;
    never re-displays saved keys; status badge saved/missing/invalid)
  + src/app/settings/_connectors/ConnectorRowActions.tsx (Edit /
    Rotate-key / Delete with explicit "Also delete saved key"
    checkbox)
  + extend AddProviderFlow.tsx to host the secret-store path
    inside the existing card-picker host shipped in 6a. Advanced
    env-var path remains. DoD: manual verification per
    docs/M4A6B-ACCEPTANCE.md passes locally.
  + extend ConnectorsPanel.tsx (row actions wired)
  + extend api.ts (testDraft / updateConnector / deleteConnector /
    listSecrets / deleteSecret client helpers)

M4a-6b PR D — Closeout.
  + docs/decisions/ADR-0019-ui-managed-secret-store.md
  + docs/ARCHITECTURE.md (§8 — new secret-store paragraph + routes update)
  + docs/SECURITY.md — the §10.3 plaintext-on-disk paragraph
    (REQUIRED; this PR is blocked until the paragraph lands)
  + docs/ROADMAP.md (M4a-6 status — both 6a and 6b complete)
  + docs/specs/expandability-foundation/README.md (status row update)
  + docs/specs/expandability-foundation/m4a-6-task-spec.md (this
    spec, status header bumped to "CODE COMPLETE")
  + docs/M4A6B-ACCEPTANCE.md (operator checklist; see §13)
  DoD: per the docs/MAINTENANCE.md milestone-done rule — all eight
  items ticked (code, tests, ADR, ARCHITECTURE, ROADMAP, spec status,
  acceptance checklist, live acceptance pass).
```

---

## 13. Operator acceptance

Two separate checklists, one per sub-milestone. Each lands as a
flat doc under `docs/` parallel to `docs/M4A-ACCEPTANCE.md` /
`docs/M4A5-ACCEPTANCE.md`. Order: 6a passes first; 6b starts only
after 6a is operator-accepted and Rex green-lights 6b PR A.

### 13.A `docs/M4A6A-ACCEPTANCE.md` — M4a-6a (catalog) checklist (sketch)

```text
Step 1 — Settings → Connectors → Add Provider. The new card-based
         picker renders (no terminal-style list).
Step 2 — Active cards visible: OpenAI · OpenRouter · Ollama local ·
         LM Studio local · Custom OpenAI-compatible · DeepSeek
         (six total). Provider order preserved from the catalog.
Step 3 — Click OpenAI. The PresetForm from M4a-5 PR C opens with the
         Advanced/env-var field shown by default (6a doesn't ship the
         secret-store path; that's 6b). The Model field + Load-models
         button shipped in M4a-5 PR C still works.
Step 4 — Click Ollama. Base URL editable; no API key field; the
         allowLocalNetwork toggle is present.
Step 5 — Click LM Studio. Base URL editable (default
         http://localhost:1234/v1); no API key field; allowLocalNetwork
         toggle present.
Step 6 — Click DeepSeek. Paste a real DEEPSEEK_API_KEY env var name
         in the Advanced/env-var field. Test connection → valid;
         chat.generate against `deepseek-chat` returns a real
         response. **DEMOTE RULE (O9):** if this step fails, DeepSeek
         moves to the planned list before 6a closeout and
         presets/deepseek.json is deleted from the diff.
Step 7 — Picker shows the "More providers coming later" disclosure
         at the bottom. Default closed.
Step 8 — Expand the disclosure. Eight planned rows render with
         "needs <family>" captions per §1.2. Rows are NOT clickable;
         no form opens.
Step 9 — Existing env:VAR_NAME connectors saved before 6a still load
         and still work — no migration, no behaviour change.
Step 10 — npm run typecheck && npm test && npm run build → all green.
Step 11 — 6a closeout doc-sync merged (ROADMAP entry + spec status
          + this checklist's link in the expandability README).
```

### 13.B `docs/M4A6B-ACCEPTANCE.md` — M4a-6b (secrets) checklist (sketch)

Runs only after 13.A passes.

```text
Step 1 — Settings → Connectors → Add Provider → OpenAI card. The
         picker from 6a is unchanged; the form now offers two paths:
         "Save key locally" (new, default) and "Advanced: use server
         env var" (preserved).
Step 2 — Paste a real OpenAI key into the "Save key locally" field.
Step 3 — Click Test connection → status: valid.
Step 4 — Click Save → connector appears in the panel; key field is no
         longer visible.
Step 5 — cat ~/.agentic-os/config.yaml → entry stores
         `authRef: "secret:openai-1"`. NO sk-... value anywhere.
Step 6 — ls -l ~/.agentic-os/secrets/store.json → file mode 0600.
         ls -ld ~/.agentic-os/secrets/ → mode 0700. cat the file →
         contains the secret keyed by id. (One-time inspection;
         the operator should not need to look in here during normal
         use.)
Step 7 — curl http://127.0.0.1:3000/api/connectors | grep sk-       (empty)
Step 8 — curl http://127.0.0.1:3000/api/runs       | grep sk-       (empty)
Step 9 — grep -r sk- ~/.agentic-os/audit/                           (empty)
Step 10 — Settings → Edit OpenAI → Rotate key. Paste a different key.
          Old key gone from store.json; new key in place.
Step 11 — Settings → Delete OpenAI with "Also delete saved key" checked.
          Both connector and secret are gone.
Step 12 — Settings → Delete a different connector WITHOUT the
          "Also delete saved key" checkbox. Connector gone; secret
          remains. (The orphaned secret can be removed via
          /api/secrets/[id] DELETE; verify via curl that
          /api/secrets returns the id with referencedBy: [].)
Step 13 — Settings → Add Provider → "Advanced: use server env var"
          path on a fresh card. Existing env-var flow still works
          unchanged (regression guard — env-var operators are not
          forced onto the secret store).
Step 14 — `.gitignore` regression test: in CI, the secrets-gitignore-
          coverage test passes — the default store path and any
          AGENTIC_OS_SECRETS-pointing path inside the repo tree are
          excluded by .gitignore.
Step 15 — docs/SECURITY.md contains the §10.3 plaintext-on-disk
          paragraph verbatim (REQUIRED in PR D).
Step 16 — npm run typecheck && npm test && npm run build → all green.
Step 17 — 6b closeout doc-sync merged (ADR-0019, ARCHITECTURE,
          SECURITY, ROADMAP, m4a-6 spec status → CODE COMPLETE,
          M4A6B-ACCEPTANCE.md).
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

**End of M4a-6 task spec (v2 draft, design only).** Sub-milestone split
locked per Rex (2026-05-24): M4a-6a (provider catalog expansion — one
PR, UI + presets only; existing env-var auth path retained) ships
first; M4a-6b (UI-managed connector secrets — four PRs, kernel store +
authRef extension + new routes + UI revisions + closeout) ships after
6a is merged and operator-accepted. v1's locked decisions
(O8 / O9 / O10 / O11) preserved; §10 strengthened with the
`.gitignore` regression-test guardrail and the mandatory SECURITY.md
plaintext-on-disk paragraph (§10.3). No implementation begins until
M4a-5 closeout merges, the M4a-5 operator-acceptance tick lands per
§0, AND Rex explicitly green-lights M4a-6a PR.
