// Feature lifecycle resolver (Phase 1C — M1).
//
// Turns a registered FeatureModule + the persisted enablement flag +
// (eventually) connector availability into a FeatureRuntimeStatus:
//
//   disabled    operator turned it off in config
//   unavailable enabled, but a required dependency is missing
//   degraded    enabled and usable, but an optional dep / health is off
//   ready       enabled and fully usable
//
// The resolver is pure of disk I/O when `deps` are injected — that is
// the unit-test path. Production callers pass nothing; the defaults
// load the real app config + (for M1) a capability-less router.

import type {
  FeatureModule,
  FeatureExposures,
  FeatureId,
  FeatureLifecyclePolicy,
  FeatureLifecycleState,
  FeatureReason,
  FeatureRuntimeStatus,
} from "./types";
import { getFeature, getExposures, listFeatures } from "./registry";
import { loadFeatureEnablement } from "./enablement";

export interface ResolvedFeature {
  module: FeatureModule;
  exposures: FeatureExposures;
  status: FeatureRuntimeStatus;
}

/** A capability provider check — the resolver only needs `has`. */
export interface CapabilityProbe {
  has(capabilityId: string): boolean;
}

export interface FeatureResolveDeps {
  /** feature-id → persisted enablement flag. Absent → use defaultEnabled. */
  enablement?: ReadonlyMap<FeatureId, boolean>;
  /** Connector capability availability. Absent → nothing is provided. */
  router?: CapabilityProbe;
}

/**
 * Visibility is a pure function of lifecycle state + policy. A disabled
 * feature is still visible (so the UI can offer to enable it) unless
 * the module opts out via `hiddenWhenDisabled`.
 */
export function computeVisibility(
  state: FeatureLifecycleState,
  lifecycle: FeatureLifecyclePolicy,
): "visible" | "hidden" {
  if (state === "disabled" && lifecycle.hiddenWhenDisabled === true) {
    return "hidden";
  }
  return "visible";
}

const NO_PROVIDER: CapabilityProbe = { has: () => false };

/**
 * Compute the lifecycle state + the reasons behind it for an
 * already-enabled feature. (Disablement is handled by the caller.)
 */
export async function computeLifecycleState(
  module: FeatureModule,
  router: CapabilityProbe,
): Promise<{ state: FeatureLifecycleState; reasons: FeatureReason[] }> {
  const reasons: FeatureReason[] = [];

  // (a) Required capabilities — any missing → unavailable.
  const missingRequired = (module.requiredCapabilities ?? []).filter(
    (cap) => !router.has(cap),
  );
  if (missingRequired.length > 0) {
    for (const cap of missingRequired) {
      reasons.push({
        code: "missing-required-capability",
        severity: "error",
        message: `required capability "${cap}" has no enabled provider`,
        capabilityId: cap,
      });
    }
    return { state: "unavailable", reasons };
  }

  // (b/c) Feature-supplied health probe.
  if (module.health) {
    const health = await module.health();
    if (health.status === "unavailable") {
      reasons.push({
        code: "health-down",
        severity: "error",
        message: health.message ?? "feature health probe reports unavailable",
      });
      return { state: "unavailable", reasons };
    }
    if (health.status === "degraded") {
      reasons.push({
        code: "health-degraded",
        severity: "warn",
        message: health.message ?? "feature health probe reports degraded",
      });
      return { state: "degraded", reasons };
    }
  }

  // (d) Optional capabilities — any missing → degraded (still usable).
  const missingOptional = (module.optionalCapabilities ?? []).filter(
    (cap) => !router.has(cap),
  );
  if (missingOptional.length > 0) {
    for (const cap of missingOptional) {
      reasons.push({
        code: "missing-optional-capability",
        severity: "warn",
        message: `optional capability "${cap}" has no enabled provider`,
        capabilityId: cap,
      });
    }
    return { state: "degraded", reasons };
  }

  // (e) Enabled, all deps satisfied.
  return { state: "ready", reasons };
}

async function resolveEnablement(
  deps: FeatureResolveDeps | undefined,
): Promise<ReadonlyMap<FeatureId, boolean>> {
  if (deps?.enablement) return deps.enablement;
  return loadFeatureEnablement();
}

function statusFor(
  module: FeatureModule,
  state: FeatureLifecycleState,
  reasons: FeatureReason[],
): FeatureRuntimeStatus {
  return {
    state,
    visibility: computeVisibility(state, module.lifecycle),
    reasons,
  };
}

/**
 * Resolve one feature by id. Returns `undefined` for an unregistered
 * id (so callers can 404). A registered feature always resolves to a
 * status.
 */
export async function resolveFeature(
  id: FeatureId,
  deps?: FeatureResolveDeps,
): Promise<ResolvedFeature | undefined> {
  const module = getFeature(id);
  const exposures = getExposures(id);
  if (!module || !exposures) return undefined;

  const enablement = await resolveEnablement(deps);
  const enabled = enablement.has(id)
    ? enablement.get(id) === true
    : module.lifecycle.defaultEnabled;

  if (!enabled) {
    return {
      module,
      exposures,
      status: statusFor(module, "disabled", [
        {
          code: "config-disabled",
          severity: "info",
          message: "feature is disabled in the operator config",
        },
      ]),
    };
  }

  const { state, reasons } = await computeLifecycleState(
    module,
    deps?.router ?? NO_PROVIDER,
  );
  return { module, exposures, status: statusFor(module, state, reasons) };
}

/** Resolve every registered feature. One entry per registered feature. */
export async function resolveAllFeatures(
  deps?: FeatureResolveDeps,
): Promise<readonly ResolvedFeature[]> {
  const enablement = await resolveEnablement(deps);
  const resolved: ResolvedFeature[] = [];
  for (const module of listFeatures()) {
    const r = await resolveFeature(module.id, { ...deps, enablement });
    if (r) resolved.push(r);
  }
  return resolved;
}
