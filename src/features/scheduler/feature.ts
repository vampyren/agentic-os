// Scheduler as a FeatureModule (Phase 1C — M1).
//
// M1's proof-of-concept feature migration: the existing scheduler
// runtime, mission registry and API routes are UNCHANGED — this file
// only adds the feature-foundation manifest layer on top, so the
// scheduler resolves through the same lifecycle/projection/gate path
// every future feature will use.
//
// Enablement: `lifecycle.defaultEnabled` is `false` — deliberately
// matching the existing `schedulerFeatureSchema` default
// (`features.scheduler.enabled` defaults to false). v8's design noted
// "defaultEnabled true"; M1 overrides that to keep the v0.3.0 contract
// where the cron runtime is opt-in (a feature that fires missions on a
// timer should not auto-arm on a fresh install). The module manifest
// and the config schema agree on `false`.

import type { FeatureModule, FeatureId } from "@/kernel/features/types";
import {
  schedulerFeatureSchema,
  type SchedulerFeatureConfig,
} from "@/kernel/schemas/scheduler";

export const SCHEDULER_FEATURE_ID = "scheduler" as FeatureId;

export const schedulerFeature: FeatureModule<SchedulerFeatureConfig> = {
  id: SCHEDULER_FEATURE_ID,
  title: "Scheduler",
  description: "Time-based mission triggers (cron-style).",
  category: "automation",

  lifecycle: {
    defaultEnabled: false,
    canDisable: true,
    hiddenWhenDisabled: false,
    core: false,
  },

  config: {
    schema: schedulerFeatureSchema,
    // The schema's own resolved defaults — { enabled, timezone, missions }.
    defaults: schedulerFeatureSchema.parse(undefined),
  },

  // The scheduler needs no connector capabilities in the MVP — it
  // drives built-in missions directly, so it never goes "unavailable"
  // for a missing capability.
  requiredCapabilities: [],
  optionalCapabilities: [],

  sideEffects: ["timer", "file-write"],
  // No vault / artifacts manifest in M1 — mission output already
  // routes through the constrained vault writer in its own layer.
};
