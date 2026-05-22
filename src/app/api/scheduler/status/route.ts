// Scheduler runtime status (Phase 1C — M1 gated).
//
//   GET /api/scheduler/status  →  neutral scheduler snapshot
//
// M1 gating: the cron-runtime status surface fails closed with the
// scheduler feature. When `features.scheduler.enabled` is false the
// gate returns 404 (mode "enabled"); when the feature is on, the
// snapshot is served exactly as in v0.3.0. `gateFeatureApi` also
// performs the origin check, so no separate originOk call is needed.

import { getGlobalMissionSchedulerSnapshot } from "@/features/scheduler/runtime";
import { gateFeatureApi } from "@/app/_lib/featureGates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const gate = await gateFeatureApi(req, "scheduler", "enabled");
  if (gate) return gate;
  return Response.json({
    ok: true,
    scheduler: getGlobalMissionSchedulerSnapshot(),
  });
}
