// Feature registry (Phase 1C — M1).
//
// In-process registry of feature modules + their UI exposures,
// registered explicitly in code at app boot (see registered.ts) — no
// filesystem auto-discovery. A globalThis singleton survives Next's
// dev hot-reload; `__resetRegistry()` clears it for tests.
//
// `resolveFeatureHealth` is a pure capability-derived health helper
// (kept from M2's foundation): a feature whose `requiredCapabilities`
// have no enabled provider is `degraded`. The M1 lifecycle resolver
// (resolver.ts) is the richer, config-aware path.

import type {
  FeatureModule,
  FeatureExposures,
  FeatureHealth,
  FeatureId,
} from "./types";
import type { CapabilityRouter } from "../capabilities/types";

class FeatureRegistry {
  private modules = new Map<string, FeatureModule>();
  private exposures = new Map<string, FeatureExposures>();

  /**
   * Register a feature module + its UI exposures. Throws on a
   * duplicate id, and throws when `exposures.featureId` does not match
   * `module.id` — catching a manifest/exposure mismatch at boot rather
   * than at first query.
   */
  register(module: FeatureModule, exposures: FeatureExposures): void {
    if (this.modules.has(module.id)) {
      throw new Error(`feature already registered: ${module.id}`);
    }
    if (exposures.featureId !== module.id) {
      throw new Error(
        `feature exposures mismatch: module "${module.id}" got exposures ` +
          `for "${exposures.featureId}"`,
      );
    }
    this.modules.set(module.id, module);
    this.exposures.set(module.id, exposures);
  }

  /** Look up a module by id. Unknown id → undefined (not an error). */
  get(id: string): FeatureModule | undefined {
    return this.modules.get(id);
  }

  /** Look up a feature's exposures. Unknown id → undefined. */
  getExposures(id: string): FeatureExposures | undefined {
    return this.exposures.get(id);
  }

  /** All registered feature modules. */
  list(): FeatureModule[] {
    return [...this.modules.values()];
  }

  /** Test-only: drop all registrations so each test starts clean. */
  reset(): void {
    this.modules.clear();
    this.exposures.clear();
  }
}

export type { FeatureRegistry };

const G = globalThis as unknown as {
  __agenticFeatureRegistry?: FeatureRegistry;
};
const featureRegistry: FeatureRegistry =
  G.__agenticFeatureRegistry
  ?? (G.__agenticFeatureRegistry = new FeatureRegistry());

// ── Public API (module-level — operate on the singleton) ────────────

export function registerFeature<TConfig>(
  module: FeatureModule<TConfig>,
  exposures: FeatureExposures,
): void {
  featureRegistry.register(module as FeatureModule, exposures);
}

export function getFeature(id: FeatureId): FeatureModule | undefined {
  return featureRegistry.get(id);
}

export function getExposures(id: FeatureId): FeatureExposures | undefined {
  return featureRegistry.getExposures(id);
}

export function listFeatures(): readonly FeatureModule[] {
  return featureRegistry.list();
}

/** Test-only. Clears all registered features so each test starts clean. */
export function __resetRegistry(): void {
  featureRegistry.reset();
}

/**
 * Derive a feature's health from its required capabilities. Pure — it
 * does not touch the registry. A feature whose `requiredCapabilities`
 * are not all satisfiable by the router is `degraded`, with the unmet
 * capabilities listed. A feature that declares none is `ok`.
 */
export function resolveFeatureHealth(
  feature: FeatureModule,
  router: CapabilityRouter,
): FeatureHealth {
  const required = feature.requiredCapabilities ?? [];
  const missing = required.filter((cap) => !router.has(cap));
  if (missing.length === 0) {
    return { status: "ok" };
  }
  return {
    status: "degraded",
    message: `feature requires ${missing.length} capability/capabilities with no enabled provider`,
    missingCapabilities: missing,
  };
}
