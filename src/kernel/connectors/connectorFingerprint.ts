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
