// Feature registry (Phase 1C — Milestone 2).
//
// In-memory registry of FeatureModules, registered explicitly in code.
// M2 registers no production features; the registry ships empty. A
// globalThis singleton survives hot-reload; tests build isolated
// instances via __TEST__.newRegistry().
//
// `resolveFeatureHealth` is a pure helper deriving a feature's health
// from its requiredCapabilities + the Capability Router: a feature
// whose required capabilities have no enabled provider is `degraded`.
// This is how "feature visible but not fully operational" falls out
// without each feature hand-checking connectors.

import type { FeatureModule, FeatureHealth } from "./types";
import type { CapabilityRouter } from "../capabilities/types";

class FeatureRegistry {
  private features = new Map<string, FeatureModule>();

  /** Register a feature module. Throws on a duplicate id. */
  register(mod: FeatureModule): void {
    if (this.features.has(mod.id)) {
      throw new Error(`feature already registered: ${mod.id}`);
    }
    this.features.set(mod.id, mod);
  }

  /** Look up a feature by id. Unknown id → undefined (not an error). */
  get(id: string): FeatureModule | undefined {
    return this.features.get(id);
  }

  /** All registered feature modules. */
  list(): FeatureModule[] {
    return [...this.features.values()];
  }
}

export type { FeatureRegistry };

const G = globalThis as unknown as {
  __agenticFeatureRegistry?: FeatureRegistry;
};
export const featureRegistry: FeatureRegistry =
  G.__agenticFeatureRegistry
  ?? (G.__agenticFeatureRegistry = new FeatureRegistry());

export const __TEST__ = {
  newRegistry: (): FeatureRegistry => new FeatureRegistry(),
};

/**
 * Derive a feature's health from its required capabilities. Pure — it
 * does not touch the registry. A feature whose `requiredCapabilities`
 * are not all satisfiable by the router is `degraded`, with the unmet
 * capabilities listed. A feature that declares none is `ok`.
 *
 * A feature MAY also supply its own `health()` for richer checks; that
 * is the feature's own concern. This helper is the capability-derived
 * baseline.
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
