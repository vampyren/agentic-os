// Feature foundation — barrel exports (Phase 1C — M1).
//
// Route gating is intentionally NOT re-exported here: it lives in the
// app layer (src/app/_lib/featureGates.ts) because it depends on
// next/navigation + the API CORS helper, and the kernel must not
// depend on the app layer.

export * from "./types";
export {
  registerFeature,
  getFeature,
  getExposures,
  listFeatures,
  resolveFeatureHealth,
  __resetRegistry,
} from "./registry";
export {
  resolveFeature,
  resolveAllFeatures,
  computeVisibility,
  computeLifecycleState,
} from "./resolver";
export type {
  ResolvedFeature,
  FeatureResolveDeps,
  CapabilityProbe,
} from "./resolver";
export { toUiSafeFeature } from "./projection";
export type { UiSafeFeature } from "./projection";
export { loadFeatureEnablement } from "./enablement";
export { ensureFeaturesRegistered } from "./registered";
