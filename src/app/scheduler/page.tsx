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
  const feature = await requireFeatureReady("scheduler");

  return (
    <div className="mt-6 flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-medium tracking-tight">
          {feature.module.title}
        </h1>
        <p className="text-[13px] text-[var(--fg-dim)]">
          {feature.module.description}
        </p>
      </header>
      <SchedulerStatusPanel />
    </div>
  );
}
