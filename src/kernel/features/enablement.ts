// Feature enablement source (Phase 1C — M1).
//
// The lifecycle resolver needs to know which features the operator has
// turned on. That switch lives in the persisted app config. M1 keeps
// the EXISTING config shape — `features.scheduler.enabled` — rather
// than introducing a generic `features.<id>.config.enabled` path; the
// scheduler block's `enabled` field IS the lifecycle switch.
//
// This module is the single place that maps the typed AppConfig onto a
// feature-id → enabled map, so the resolver stays free of config
// schema knowledge and easy to unit-test (callers inject a map).

import { loadConfig } from "../config";
import type { FeatureId } from "./types";

/**
 * Read the persisted enablement flag for every known feature from the
 * app config. A feature absent from the returned map has no persisted
 * flag — the resolver falls back to the module's `defaultEnabled`.
 */
export async function loadFeatureEnablement(): Promise<Map<FeatureId, boolean>> {
  const cfg = await loadConfig();
  return new Map<FeatureId, boolean>([
    // `features.scheduler.enabled` — schema default is `false`, so the
    // scheduler is opt-in unless the operator sets it true.
    ["scheduler", cfg.features.scheduler.enabled],
  ]);
}
