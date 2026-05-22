// Scheduler page (Phase 1C — M2).
//
// Minimal read-only view of the cron runtime, and the destination for
// the scheduler nav exposure. Gated by `requireFeatureReady` — when the
// scheduler feature is disabled or not ready, the M1 page gate calls
// notFound() (404). This is the first page wired to the M1 page gate,
// which M1 delivered + unit-tested but left unattached.

import { requireFeatureReady } from "@/app/_lib/featureGates";
import SchedulerStatusPanel from "./SchedulerStatusPanel";

export const dynamic = "force-dynamic";

export default async function SchedulerPage() {
  // Gate only — the page identity ("Scheduler" + description) is rendered
  // once by the TopBar via `resolveTitle("/scheduler")`. Repeating it in a
  // page-level header here would duplicate the heading (see src/lib/titles.ts).
  await requireFeatureReady("scheduler");

  return (
    <div className="mt-6 flex flex-col gap-5">
      <SchedulerStatusPanel />
    </div>
  );
}
