// Connector config fingerprint (M4a-FU5, spec §4.4).
//
// `fingerprintConnectorConfig` is the single helper both the testConnection
// write path AND the GET /api/connectors hydration path call (the latter in
// PR B) on the SAME effective config shape. A divergence is a test failure
// (covered by `tests/connector-fingerprint-symmetry.test.ts` once the route
// side ships).
//
// Properties (locked, §4.4):
//
//   - Deterministic — equivalent configs always produce the same hex.
//   - Irreversible — SHA-256. Hashing is NOT a substitute for protecting
//     local state.db (§9 honest-scope wording); it just means the hash
//     itself doesn't carry the plaintext.
//   - Narrow — only validation-relevant fields. `trustOverride` and
//     `enabled` are intentionally excluded; they don't change what a
//     connector test would do.
//   - authRef identity is HASHED (`env:<sha16>` / `secret:<sha16>` / the
//     literal `"none"`). The raw env var name and the raw secret id NEVER
//     appear in the canonicalised input.
//
// Input shape (pinned v1.1): callers pass the EFFECTIVE instance config
// (post-defaults-merge, post-validation) — the same shape
// `buildConnectorContext` produces and the family ran against. Hashing the
// raw config.yaml entry would produce different hashes for two
// semantically-equal configs (one with explicit overrides, one relying on
// preset defaults), causing spurious "not tested" fallbacks.

import { createHash } from "node:crypto";
import type { CapabilityId } from "../capabilities/types";
import type { ConnectorInstanceConfig } from "./schema";
import type { ConnectorRegistry } from "./registry";
import { buildConnectorContext } from "./runtime";
import { SECRET_LOOKING_KEYS } from "./secretKeys";
import type { ConnectorTypeFamily } from "./types";

/**
 * The validation-relevant slice of a connector instance config. Built by
 * the caller from `buildConnectorContext`'s output (settings = the parsed
 * effective settings; capabilities = the resolved effective set) plus the
 * instance-level fields that change what the test would do.
 *
 * Excludes `trustOverride` and `enabled` (locked, §4.4).
 */
export interface ConnectorFingerprintInput {
  typeFamily: ConnectorTypeFamily;
  /** Optional preset seed id; null when absent. */
  presetId: string | null;
  /** Effective, family-shape settings (post-merge, post-parse). */
  settings: unknown;
  /** Effective (narrowed) capability set; preserves the family-default
   *  shape when the instance didn't narrow. */
  capabilities: ReadonlyArray<CapabilityId>;
  /** Operator opt-in past the SSRF guard for HTTP families; defaults false. */
  allowLocalNetwork: boolean;
  /** Raw authRef string from config — `none`, `env:NAME`, or future
   *  `secret:<id>` (M4a-6b). Hashed before it enters the canonical input. */
  authRef: string | undefined;
}

/**
 * Deterministic, irreversible fingerprint of the validation-relevant config
 * for one connector. SHA-256 hex of a canonical JSON serialisation
 * (recursive key sort + sorted capability list + hashed authRef identity).
 *
 * The `connectorId` is included in the input so two connector instances
 * with otherwise-identical effective config still get distinct hashes —
 * different connector ids are different things, and the operator may run
 * tests on them independently.
 */
export function fingerprintConnectorConfig(
  connectorId: string,
  input: ConnectorFingerprintInput,
): string {
  const canonical = {
    connectorId,
    typeFamily: input.typeFamily,
    presetId: input.presetId,
    settings: canonicaliseValue(input.settings ?? {}),
    // Sort the capability list so insertion order in the instance config
    // doesn't change the hash — narrowing intent is set-shaped, not ordered.
    capabilities: [...input.capabilities].sort(),
    allowLocalNetwork: input.allowLocalNetwork,
    authRef: hashAuthRefIdentity(input.authRef),
  };
  return createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
}

/** Recursive key sort so equivalent objects always serialise the same
 *  way. Arrays preserve order (operator intent). Primitives pass through. */
function canonicaliseValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicaliseValue);
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = canonicaliseValue((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

/** Hashed authRef identity. Never the raw env var name (§9 non-leak):
 *
 *    none / undefined        -> "none"
 *    "env:VAR_NAME"          -> "env:<sha256(VAR_NAME).slice(0,16)>"
 *    "secret:<id>" (M4a-6b)  -> "secret:<sha256(<id>).slice(0,16)>"
 *    anything else           -> "unknown:<sha256(authRef).slice(0,16)>"
 *
 *  The hash is of the IDENTITY part (after the `env:` / `secret:` prefix),
 *  not the prefix itself — so an env var "FOO" and a secret named "FOO"
 *  still hash to different `env:<x>` / `secret:<y>` strings via the prefix.
 *
 *  NOTE (FU5 PR A — doc/code alignment TODO for the closeout PR):
 *  the spec §4.4 example wording showed `sha256(authRef)` (the WHOLE
 *  string including the `env:` prefix). The implementation hashes only
 *  the identity part and re-applies the prefix as plaintext. The two
 *  approaches are equivalent for non-leak posture (the env var NAME
 *  never crosses) but produce different hex strings. The implementation
 *  choice was confirmed cleaner in the PR review; the spec example
 *  needs updating to match in the PR D closeout. PR B MUST use this
 *  helper directly, never reimplement.
 */
function hashAuthRefIdentity(authRef: string | undefined): string {
  if (!authRef || authRef === "none") return "none";
  const colon = authRef.indexOf(":");
  const prefix = colon > 0 ? authRef.slice(0, colon) : "unknown";
  const identity = colon > 0 ? authRef.slice(colon + 1) : authRef;
  const allowedPrefix =
    prefix === "env" || prefix === "secret" ? prefix : "unknown";
  const hash = createHash("sha256").update(identity).digest("hex").slice(0, 16);
  return `${allowedPrefix}:${hash}`;
}

// ── Build-failure fallback (FU5 PR A — fix #1) ────────────────────────────
//
// When `buildConnectorContext` fails (auth-missing, settings invalid,
// secret-looking key, etc.) there is no EFFECTIVE config to hash. But we
// still want connector_health to record the `misconfigured` outcome so the
// operator sees it survive a refresh — otherwise common broken-config
// states fall back to "not tested" instead of staying "misconfigured /
// auth-missing".
//
// The fallback hashes the RAW operator-supplied instance config (no
// preset / family-default merge — those merges happen INSIDE
// buildConnectorContext and aren't available when it fails). PR B's
// hydration path uses the SAME helper for the same broken config, so
// stored vs current fingerprints match.
//
// Non-leak: any secret-looking key in `settings` (per
// `findSecretLookingKey` / `SECRET_LOOKING_KEYS`) has its VALUE replaced
// with `[redacted:<sha16>]` before the canonical input is hashed. The
// hash of the redacted value is still value-sensitive (changing the
// secret value changes the fingerprint), but the raw value itself never
// enters the JSON-string fed to SHA-256.

const SECRET_KEY_SET = new Set(SECRET_LOOKING_KEYS);

/** Replace any secret-looking key's value with a deterministic
 *  irreversible sentinel. Walks objects + arrays at any depth. The
 *  redaction is value-sensitive: changing the secret value changes the
 *  sentinel (so the fingerprint changes), but the raw value is never
 *  serialised. */
function redactSecretValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecretValues);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_SET.has(key.toLowerCase())) {
        // Don't recurse — replace the whole subtree.
        const hash = createHash("sha256")
          .update(JSON.stringify(child ?? null))
          .digest("hex")
          .slice(0, 16);
        out[key] = `[redacted:${hash}]`;
      } else {
        out[key] = redactSecretValues(child);
      }
    }
    return out;
  }
  return value;
}

/**
 * Fingerprint a connector from its RAW operator-supplied instance config
 * (the shape stored in `config.yaml`). Used by the testConnection write
 * path when `buildConnectorContext` fails (build-failure fallback) AND
 * by PR B's hydration path when its own build attempt for the same
 * connector also fails. Same algorithm both sides → deterministic match
 * on a still-broken config.
 *
 * Capabilities: uses `instanceConfig.capabilities ?? []` because the
 * family's max set isn't reliably available on the build-failure path
 * (the family may not even be registered). PR B does the same.
 *
 * Non-leak: secret-looking values are SHA-256-sentinel-redacted before
 * the canonical input is hashed — see `redactSecretValues` above.
 */
export function fingerprintFromInstanceConfig(
  connectorId: string,
  instanceConfig: ConnectorInstanceConfig,
): string {
  return fingerprintConnectorConfig(connectorId, {
    typeFamily: instanceConfig.typeFamily,
    presetId: instanceConfig.presetId ?? null,
    settings: redactSecretValues(instanceConfig.settings ?? {}),
    capabilities: instanceConfig.capabilities ?? [],
    allowLocalNetwork: instanceConfig.allowLocalNetwork ?? false,
    authRef: instanceConfig.authRef,
  });
}

// ── Symmetric write+read fingerprint (FU5 PR B) ──────────────────────────
//
// `computeCurrentFingerprint` is the SINGLE helper both ends call:
//
//   - testConnection (PR A) — writes the fingerprint computed for the
//     instance config it actually tested against.
//   - GET /api/connectors (PR B) — recomputes the fingerprint for the
//     same connector's CURRENT instance config; matches against the
//     stored row's configHash; hydrates `lastValidation` on match,
//     omits it on mismatch.
//
// Two paths, mirroring PR A's `finish()` wiring:
//
//   1. `buildConnectorContext` succeeds → fingerprint over the
//      EFFECTIVE post-merge/post-validation config
//      (`fingerprintConnectorConfig`).
//   2. `buildConnectorContext` fails (family missing, settings invalid,
//      auth-missing, defensive B4) → fingerprint over the RAW instance
//      config with secret-value redaction (`fingerprintFromInstanceConfig`).
//
// PR B's hydration MUST use this helper, NEVER reimplement the dispatch.
// The fingerprint-symmetry test (`tests/connector-fingerprint-symmetry.test.ts`)
// asserts the testConnection write path and this helper produce the
// SAME hash for the same instance config — both branches.

/**
 * Resolve the connector's family and recompute the canonical
 * fingerprint for its CURRENT instance config. Pure: takes its
 * registry by parameter (production passes the global registry;
 * tests pass an isolated one). No I/O.
 *
 * Returns the SHA-256 hex string. Never throws — a family-missing
 * scenario routes to the build-failure fallback.
 */
export function computeCurrentFingerprint(
  connectorId: string,
  instanceConfig: ConnectorInstanceConfig,
  registry: ConnectorRegistry,
): string {
  const family = registry.get(instanceConfig.typeFamily);
  if (!family) {
    // Family was de-registered between testConnection and now (or never
    // registered). buildConnectorContext would fail with config-invalid;
    // mirror that path with the fallback fingerprint.
    return fingerprintFromInstanceConfig(connectorId, instanceConfig);
  }
  const build = buildConnectorContext(connectorId, instanceConfig, family);
  if (!build.ok) {
    return fingerprintFromInstanceConfig(connectorId, instanceConfig);
  }
  return fingerprintConnectorConfig(connectorId, {
    typeFamily: instanceConfig.typeFamily,
    presetId: instanceConfig.presetId ?? null,
    settings: build.instance.ctx.settings,
    capabilities: build.instance.effectiveCapabilities,
    allowLocalNetwork: instanceConfig.allowLocalNetwork ?? false,
    authRef: instanceConfig.authRef,
  });
}
