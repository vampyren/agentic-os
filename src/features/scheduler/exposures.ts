// Scheduler UI exposures (Phase 1C — M1).
//
// Split from feature.ts so the stable feature core and the evolving UI
// surface version independently. M1 declares NO nav / commands /
// cards: the registry-driven shell that consumes exposures lands in
// M2, and the consuming side tolerates their absence. This file exists
// now so M2 only has to populate it — not wire it up.

import type { FeatureExposures, FeatureId } from "@/kernel/features/types";
import { SCHEDULER_FEATURE_ID } from "./feature";

export const schedulerExposures: FeatureExposures = {
  featureId: SCHEDULER_FEATURE_ID as FeatureId,
};
