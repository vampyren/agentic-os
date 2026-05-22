// Shell feature resolution (Phase 1C — M2).
//
// Resolving the feature registry reads the operator config. The shell
// renders on EVERY page, so a missing or unreadable config must not
// 500 the whole app — it must degrade to "no feature surfaces". The
// real config error still surfaces where it matters: feature-specific
// API routes and gated pages load the config directly and fail loudly.

import { ensureFeaturesRegistered } from "@/kernel/features/registered";
import { resolveAllFeatures } from "@/kernel/features/resolver";
import { toUiSafeFeature, type UiSafeFeature } from "@/kernel/features/projection";

/**
 * Resolve the registry for the shell as a UI-safe list. Returns an
 * empty list (never throws) if the config cannot be loaded, so the
 * shell chrome always renders.
 */
export async function resolveShellFeatures(): Promise<UiSafeFeature[]> {
  ensureFeaturesRegistered();
  try {
    return (await resolveAllFeatures()).map(toUiSafeFeature);
  } catch {
    return [];
  }
}
