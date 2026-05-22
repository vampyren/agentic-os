// Boot-time feature registration (Phase 1C — M1).
//
// Features are registered explicitly, in code — no filesystem
// auto-discovery (per v8 §13: "third-party plugin loader too early" is
// an anti-pattern). Every server-side entry point that resolves
// features calls `ensureFeaturesRegistered()` first.
//
// Idempotency is keyed off the registry itself rather than a private
// boolean, so a test calling `__resetRegistry()` gets a clean
// re-registration on the next `ensureFeaturesRegistered()`.

import { getFeature, registerFeature } from "./registry";
import { schedulerFeature } from "@/features/scheduler/feature";
import { schedulerExposures } from "@/features/scheduler/exposures";

export function ensureFeaturesRegistered(): void {
  if (!getFeature(schedulerFeature.id)) {
    registerFeature(schedulerFeature, schedulerExposures);
  }
  // Future features register here.
}
