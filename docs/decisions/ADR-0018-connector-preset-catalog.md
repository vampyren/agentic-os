# ADR-0018 — Connector preset catalog

**Status:** Accepted
**Date:** 2026-05-23

## Context

The connector runtime (ADR-0017) splits identity into three levels:
**family** (code), **preset** (declarative pre-fill), **instance** (the
operator's saved record). Adding a new connector instance from the
Settings UI must NOT require code. The operator picks a provider (OpenAI,
OpenRouter, Ollama, a custom OpenAI-compatible endpoint), supplies the
env var NAME holding the key, edits any defaults that matter for their
deployment, and saves.

That UX needs a **preset catalog**: a list of declarative starting points
keyed to families. M4a-3a (PR #20) ships the catalog mechanism + the
first-party JSON presets that cover OpenAI, OpenRouter, Ollama local, and
a custom OpenAI-compatible escape hatch. PR3b/3c surface the catalog
through `/api/connectors/presets` and the Add Provider UI.

A preset catalog is a load surface that takes JSON the operator did not
write — community presets dropped into `~/.agentic-os/presets/` are
plausible — so trust handling, secret-screening, and schema validation
have to be locked.

## Decision

### Source locations + trust levels

The catalog has two source dirs, walked at boot:

- **First-party** — `presets/` in the build (under the repo root). These
  ship with the binary. Default trust: `first-party`.
- **User / community** — `~/.agentic-os/presets/` (or
  `AGENTIC_OS_PRESETS_DIR` for tests). Walked after first-party. Default
  trust: whatever the JSON declares (`community` / `untrusted`).

A preset record is one JSON file matching `presetSchema`
(`src/kernel/connectors/presets.ts`):

```ts
{
  id, label, description?,
  typeFamily,            // "cli-acp-agent" | "openai-compatible-llm"
  defaultSettings,
  capabilities?,         // optional narrowing
  allowLocalNetwork?,    // preset-level SSRF opt-in
  authPrompt?,           // { apiKeyEnvVar?, baseUrl? } — UI hints
  trust                  // "first-party" | "community" | "untrusted"
}
```

The `id` is a kebab-case slug; duplicates lose to whichever directory
loaded first (first-party wins on collision).

### Trust clamp — downward only

User-loaded presets are clamped DOWNWARD only. A JSON in
`~/.agentic-os/presets/` cannot upgrade its own trust:

```
first-party  -> community    (with a neutral log line)
community    -> community    (unchanged)
untrusted    -> untrusted    (unchanged — never upgraded to community)
```

This rule is enforced as a closed `switch` in `presets.ts` (PR #20
review fix B4). An earlier draft silently upgraded `untrusted` to
`community`; that was caught in review and corrected to "downward only,
never up."

### Secret-key screening on load

A preset whose `defaultSettings` carries a secret-looking key at ANY depth
(per the 14-name screen — ADR-0017) is **skipped neutrally**: logged with
its file path and `id`, removed from the catalog, **never fatal** to the
rest of the load. A community preset attempting to ship an `apiKey:`
value does not corrupt the catalog or wedge the server.

### Validation discipline

Every preset is parsed through `presetSchema.safeParse(json)`:

- malformed JSON → skipped (one log line, neutral).
- schema violation → skipped (one log line, neutral, names the field).
- `typeFamily` not registered → skipped (the family was removed; the
  preset is dead).
- `allowLocalNetwork` is **only** an opt-in HINT for the Add Provider UI;
  the actual SSRF gate runs at `config-add` / `testConnection` / `invoke`
  time (ADR-0017 + spec §8). A preset declaring `allowLocalNetwork: true`
  does not bypass the SSRF guard for a public-internet baseUrl that
  resolves to a private address — the SSRF guard always wins.

`/api/connectors/presets` (M4a-3b) returns the loaded catalog as a
neutral list (id / label / description / typeFamily / authPrompt / trust)
— no `defaultSettings` contents are leaked; the Add Provider UI receives
defaults via the per-preset detail surface PR3c shapes.

### First-party catalog (PR #20)

M4a ships exactly four first-party presets:

```
presets/openai.json               OpenAI                openai-compatible-llm
presets/openrouter.json           OpenRouter            openai-compatible-llm
presets/ollama-local.json         Ollama (local)        openai-compatible-llm
                                                        allowLocalNetwork: true
presets/openai-compatible-custom.json  Custom endpoint  openai-compatible-llm
                                                        (escape hatch — operator
                                                        edits baseUrl freely)
```

`cli-acp-agent` does not need a preset — the operator's agent manifests
are the equivalent declarative layer for that family. A future
`cli-acp-agent` preset slot is reserved by `typeFamily` accepting it.

## Consequences

**Positive**

- Adding a new provider integration (a new OpenAI-compatible endpoint, a
  new local model server) is a JSON file drop, not a code change.
- The Settings → Add Provider flow surfaces an operator-friendly menu
  instead of a "fill these 8 fields from memory" form.
- Community / untrusted presets are first-class but cannot promote
  themselves into `first-party` (the only trust level that bypasses
  certain UI warnings).
- Secret-key screening on load is symmetric with the same screen at
  config-write time — a bad preset and a bad operator paste fail the
  same way, in the same module.

**Negative**

- The catalog is loaded at boot and not hot-reloaded. Adding or editing
  a preset file requires a server restart. Acceptable for M4a; an
  on-demand reload endpoint can land later if a use case appears.
- Four first-party presets is a small set. New families (OAuth, native
  vendor APIs) will mean new families AND new presets, both deferred.

**Neutral**

- The catalog is read-only from the API surface. There is no "edit this
  preset" UI; the operator edits files in `~/.agentic-os/presets/`
  directly if needed.
- The `authPrompt` shape is UI-only metadata. A connector family does
  not consult `authPrompt` at invoke time.

## Alternatives considered

- **Hardcode the preset list in TypeScript.** Rejected — the whole point
  is for the operator (or a community pack) to add presets without
  recompiling. Hardcoding would also drag the catalog into the build
  graph for what is fundamentally configuration.
- **Allow user-loaded presets to declare `trust: "first-party"`.**
  Rejected — that's a trust-elevation primitive on a directory the
  operator owns. Clamping downward only removes the elevation pathway.
- **Treat a preset as authoritative settings (no operator edit).**
  Rejected — a preset is a *pre-fill*, not a lock. The operator MUST be
  able to edit `baseUrl`, `model`, and similar fields before saving
  (PR #22 review fix — `baseUrl` is editable even for local/Ollama
  presets).
- **Validate presets lazily on first use.** Rejected — a malformed JSON
  in `~/.agentic-os/presets/` should be surfaced at boot, not on the
  hot path when the operator clicks "Add Provider."

## References

- ADR-0012 — Capability router neutral results.
- ADR-0017 — Connector runtime + authRef (companion).
- `m4-task-spec.md` v2.1 §13 (preset catalog), §5.10 (trust clamp),
  §7 (secret-key screen), §15 (Settings UI).
- `src/kernel/connectors/presets.ts`.
- `presets/{openai,openrouter,ollama-local,openai-compatible-custom}.json`.
- `src/app/api/connectors/presets/route.ts`.
- `src/app/settings/_connectors/AddProviderFlow.tsx`.
- PRs #20, #21, #22.
