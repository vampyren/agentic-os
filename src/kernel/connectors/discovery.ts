// runDiscoverModels — pre-save model discovery (M4a-5 PR AB, spec §5.4).
//
// The Add Provider flow calls this BEFORE the connector is saved. It accepts
// the same input shape as POST /api/connectors (minus `connectorId` — no
// instance is being created), merges family.defaultSettings + preset
// defaults + body settings, runs the same secret-key + preset-lookup + SSRF
// pipeline as the add route, builds a transient ConnectorInvokeContext, and
// dispatches to `family.listModels(ctx)`.
//
// Locked design points (spec v1.2):
//   * validation surface is NARROW — `family.modelDiscoverySettingsSchema`,
//     NOT `family.settingsSchema`. `model` is intentionally absent so an
//     operator who doesn't yet know the model can still call Load-models.
//   * a family without `listModels` returns `capability-not-supported`
//     (the existing ConnectorErrorCode — no new code).
//   * runDiscoverModels DOES NOT persist anything. No config write, no
//     Run record. Audit is awaited deterministically.
//   * NEVER returns or audits: the env var name, the resolved secret, the
//     Authorization header, the baseUrl, the model ids (only `modelCount`),
//     a raw fetch error / provider body / stderr.
//
// Server-only.

import { connectorRegistry as globalRegistry, type ConnectorRegistry } from "./registry";
import { resolveAuthRef } from "./authRef";
import { findSecretLookingKey } from "./secretKeys";
import { assertPublicBaseUrl } from "./ssrf";
import { auditConnectorModelsDiscover } from "../audit";
import { loadPresets, type ConnectorPreset } from "./presets";
import type {
  ConnectorErrorCode,
  ConnectorInvokeContext,
  ConnectorModelsResult,
} from "./types";

export interface DiscoverModelsInput {
  presetId: string;
  /** `none` | `env:VAR_NAME`. Validated by the caller (route) — kept as a
   *  pre-validated string here. */
  authRef?: string;
  settings?: Record<string, unknown>;
  allowLocalNetwork?: boolean;
}

export type DiscoverModelsOutcome =
  | { ok: true; models: ReadonlyArray<{ id: string }> }
  | { ok: false; errorCode: DiscoverErrorCode };

/**
 * The closed neutral errorCode union the route surfaces. A superset of the
 * route's own validation codes + the allowlisted ConnectorErrorCode values
 * a family may return through listModels. NO `discovery-not-supported`;
 * the existing `capability-not-supported` is reused.
 */
export type DiscoverErrorCode =
  | "preset-unknown"
  | "settings-invalid"
  | "secret-looking-key"
  | "malformed-authRef"
  | "blocked-network"
  | "capability-not-supported"
  | "auth-failed"
  | "auth-missing"
  | "rate-limited"
  | "network-unreachable"
  | "response-too-large"
  | "external-system-unavailable"
  | "internal-error";

const ALLOWLISTED_CONNECTOR_ERROR_CODES: ReadonlySet<ConnectorErrorCode> = new Set<
  ConnectorErrorCode
>([
  "auth-failed",
  "auth-missing",
  "rate-limited",
  "network-unreachable",
  "response-too-large",
  "external-system-unavailable",
  "capability-not-supported",
  "blocked-network",
]);

function projectConnectorErrorCode(
  code: ConnectorErrorCode | undefined,
): DiscoverErrorCode {
  if (code && ALLOWLISTED_CONNECTOR_ERROR_CODES.has(code)) {
    return code as DiscoverErrorCode;
  }
  return "external-system-unavailable";
}

export interface RunDiscoverModelsDeps {
  registry?: ConnectorRegistry;
  /** Test seam — production reads from disk via `loadPresets`. */
  presets?: ConnectorPreset[];
}

/**
 * Run pre-save model discovery. Always resolves (never throws). The audit
 * line is awaited deterministically before the result is returned, so a
 * test asserting "audit present at response time" cannot race.
 */
export async function runDiscoverModels(
  input: DiscoverModelsInput,
  deps?: RunDiscoverModelsDeps,
): Promise<DiscoverModelsOutcome> {
  const registry = deps?.registry ?? globalRegistry;
  const audit = (
    status: "success" | "failed",
    errorCode: DiscoverErrorCode | undefined,
    modelCount?: number,
  ): Promise<void> =>
    auditConnectorModelsDiscover({
      presetId: input.presetId,
      status,
      ...(errorCode ? { errorCode } : {}),
      ...(modelCount !== undefined ? { modelCount } : {}),
    });

  // 1. Secret-key screen on body.settings (B4). The same screen the
  //    Add-Provider route runs before persisting.
  if (input.settings && findSecretLookingKey(input.settings)) {
    await audit("failed", "secret-looking-key");
    return { ok: false, errorCode: "secret-looking-key" };
  }

  // 2. Preset lookup.
  let presets: ConnectorPreset[];
  try {
    presets = deps?.presets ?? (await loadPresets());
  } catch {
    await audit("failed", "internal-error");
    return { ok: false, errorCode: "internal-error" };
  }
  const preset = presets.find((p) => p.id === input.presetId);
  if (!preset) {
    await audit("failed", "preset-unknown");
    return { ok: false, errorCode: "preset-unknown" };
  }

  // 3. Family lookup. If the family has no `listModels`, surface the
  //    existing `capability-not-supported` (NO new errorCode — spec v1.2).
  const family = registry.get(preset.typeFamily);
  if (!family) {
    await audit("failed", "internal-error");
    return { ok: false, errorCode: "internal-error" };
  }
  if (typeof family.listModels !== "function") {
    await audit("failed", "capability-not-supported");
    return { ok: false, errorCode: "capability-not-supported" };
  }

  // 4. Merge settings (family.defaults <- preset.defaults <- body.settings)
  //    and re-screen the merged tree (B4 — at any depth, mirrors POST
  //    /api/connectors order discipline).
  const mergedSettings = {
    ...(family.defaultSettings as Record<string, unknown>),
    ...preset.defaultSettings,
    ...(input.settings ?? {}),
  };
  if (findSecretLookingKey(mergedSettings)) {
    await audit("failed", "secret-looking-key");
    return { ok: false, errorCode: "secret-looking-key" };
  }

  // 5. Validate the merged settings via the NARROW
  //    `modelDiscoverySettingsSchema` — NOT the full settingsSchema. The
  //    registry's register() invariant guarantees this schema is present
  //    when `listModels` is.
  if (!family.modelDiscoverySettingsSchema) {
    // Defensive — register() should have refused this family, but if a
    // future code path skips the invariant we still fail neutrally.
    await audit("failed", "internal-error");
    return { ok: false, errorCode: "internal-error" };
  }
  const parsed = family.modelDiscoverySettingsSchema.safeParse(mergedSettings);
  if (!parsed.success) {
    await audit("failed", "settings-invalid");
    return { ok: false, errorCode: "settings-invalid" };
  }

  // 6. Effective allowLocalNetwork (body wins, then preset, then false).
  const effectiveAllowLocalNetwork =
    input.allowLocalNetwork ?? preset.allowLocalNetwork ?? false;

  // 7. SSRF guard for HTTP families.
  if (family.transport === "http") {
    const baseUrl = (parsed.data as { baseUrl?: unknown }).baseUrl;
    if (typeof baseUrl === "string") {
      try {
        await assertPublicBaseUrl(baseUrl, {
          allowLocalNetwork: effectiveAllowLocalNetwork,
        });
      } catch {
        await audit("failed", "blocked-network");
        return { ok: false, errorCode: "blocked-network" };
      }
    }
  }

  // 8. Resolve authRef ONLY if the operator supplied one. Pre-save
  //    discovery against a no-auth Ollama-compatible endpoint works
  //    without a secret. A malformed authRef would have been rejected at
  //    the route boundary; here we treat anything non-`none` as the
  //    "operator supplied an authRef" branch.
  let secret: string | undefined;
  if (input.authRef && input.authRef !== "none") {
    const r = resolveAuthRef(input.authRef);
    if (!r.ok) {
      const errorCode: DiscoverErrorCode =
        r.errorCode === "auth-malformed" ? "malformed-authRef" : "auth-missing";
      await audit("failed", errorCode);
      return { ok: false, errorCode };
    }
    secret = r.secret;
  }

  // 9. Build a TRANSIENT ConnectorInvokeContext (NOT persisted; no
  //    connector instance exists yet). The connectorId field is a
  //    placeholder — discovery never emits a connector.test or
  //    capability.invoke audit using it; the only audit line is
  //    connector.models.discover, which carries presetId only.
  const ctx: ConnectorInvokeContext = {
    connectorId: `preview:${input.presetId}`,
    typeFamily: family.id,
    settings: parsed.data,
    ...(secret !== undefined ? { secret } : {}),
  };

  // 10. Call family.listModels. Failures are projected through the
  //     allowlist and audited; secrets, baseUrl, env var name, and raw
  //     provider data NEVER cross.
  let result: ConnectorModelsResult;
  try {
    result = await family.listModels(ctx);
  } catch {
    await audit("failed", "external-system-unavailable");
    return { ok: false, errorCode: "external-system-unavailable" };
  }
  if (!result.ok) {
    const errorCode = projectConnectorErrorCode(result.errorCode);
    await audit("failed", errorCode);
    return { ok: false, errorCode };
  }
  await audit("success", undefined, result.models.length);
  return {
    ok: true,
    models: result.models.map((m) => ({ id: m.id })),
  };
}
