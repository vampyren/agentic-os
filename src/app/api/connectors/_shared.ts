// Shared helpers for the /api/connectors platform routes (M4a — PR3b).
//
// CORS gate (mirrors /api/runs/_shared.ts), neutral errors, and the UI-safe
// connector projection used by GET /api/connectors.
//
// The projection deliberately omits raw `settings`, raw `authRef`, secrets,
// and provider data — only the UI-safe summary crosses the API boundary
// (spec §14, req 8). FU5 PR B adds optional `lastValidation` so a browser
// refresh / server restart can hydrate the previous test outcome instead
// of falling back to "not tested" (issue #36). The fingerprint that gates
// hydration (§9 contract) is SERVER-INTERNAL and is NOT a field on the
// projection — only the hydrated `lastValidation` value crosses.

import { forbidden, originOk } from "@/app/api/_lib/cors";
import { connectorRegistry } from "@/kernel/connectors/registry";
import type { ConnectorInstanceConfig } from "@/kernel/connectors/schema";
import type { CapabilityId } from "@/kernel/capabilities/types";
import type { ConnectorValidation } from "@/kernel/connectors/types";

/** A neutral JSON error — no raw paths, stacks, settings, or echoed body. */
export function neutral(
  errorClass: string,
  message: string,
  status: number,
): Response {
  return Response.json({ ok: false, error: message, errorClass }, { status });
}

export function corsGate(req: Request): Response | null {
  return originOk(req) ? null : forbidden();
}

/**
 * Display shape for a configured connector instance. NO raw settings, NO
 * raw authRef value, NO secret — only the operator-visible summary.
 *
 * `lastValidation` (FU5 PR B) is OPTIONAL and is populated only when the
 * caller has a `connector_health` row whose `config_hash` matches the
 * fingerprint of the CURRENT effective (or raw, on build failure)
 * instance config. The route computes that match; this type just
 * carries the resolved value. The fingerprint itself is server-internal
 * and is intentionally NOT a field here.
 */
export interface ConnectorListItem {
  connectorId: string;
  typeFamily: string;
  presetId?: string;
  enabled: boolean;
  trust: "first-party" | "community" | "untrusted" | "unknown";
  capabilities: CapabilityId[];
  /**
   * Authorisation shape only:
   *   `env`   — instance carries `env:VAR_NAME` (the VAR_NAME is NOT exposed);
   *   `none`  — instance explicitly opted out of auth;
   *   `unset` — no authRef on the instance.
   */
  authRefKind: "env" | "none" | "unset";
  allowLocalNetwork?: boolean;
  /**
   * Last-known connector test outcome, hydrated from
   * `connector_health` when the stored config_hash matches the
   * recomputed current fingerprint. Absent when never tested OR when
   * the operator has edited the instance config since the last test
   * (fingerprint mismatch → "stale, show as not tested").
   */
  lastValidation?: ConnectorValidation;
}

export function projectConnector(
  connectorId: string,
  entry: ConnectorInstanceConfig,
  /**
   * Optional last-known validation, gated by fingerprint match on the
   * caller's side (FU5 PR B). When omitted, the projection's
   * `lastValidation` is absent — same as the never-tested state.
   */
  lastValidation?: ConnectorValidation,
): ConnectorListItem {
  const family = connectorRegistry.get(entry.typeFamily);
  const familyCaps = family?.capabilities ?? [];
  const effectiveCaps = entry.capabilities
    ? entry.capabilities.filter((c) => familyCaps.includes(c))
    : familyCaps;
  const trust = family
    ? (entry.trustOverride ?? family.defaultTrust)
    : "unknown";
  const authRefKind: ConnectorListItem["authRefKind"] = !entry.authRef
    ? "unset"
    : entry.authRef === "none"
      ? "none"
      : "env";
  return {
    connectorId,
    typeFamily: entry.typeFamily,
    ...(entry.presetId ? { presetId: entry.presetId } : {}),
    enabled: entry.enabled,
    trust,
    capabilities: effectiveCaps,
    authRefKind,
    ...(entry.allowLocalNetwork ? { allowLocalNetwork: true } : {}),
    ...(lastValidation ? { lastValidation } : {}),
  };
}
