// Built-in mission catalogue (Phase 1C — M3).
//
// Explicit record of the built-in missions (design §3.11 — explicit
// registry over filesystem discovery). `registerBuiltinMissions` is
// provided for a caller to populate a registry, but is NOT invoked at
// import time — M3 does no boot wiring, consistent with M2.

import type { MissionDefinition } from "../types";
import type { MissionRegistry } from "../registry";
import { dailySummaryMission } from "./daily-summary";
import { weeklyReviewMission } from "./weekly-review";
import { vitalsHeartbeatMission } from "./vitals-heartbeat";

export const builtinMissions = {
  "daily-summary": dailySummaryMission,
  "weekly-review": weeklyReviewMission,
  "vitals-heartbeat": vitalsHeartbeatMission,
} satisfies Record<string, MissionDefinition>;

/** Register every built-in mission into the given registry. */
export function registerBuiltinMissions(registry: MissionRegistry): void {
  for (const mission of Object.values(builtinMissions)) {
    registry.register(mission);
  }
}
