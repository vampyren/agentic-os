"use client";

// Scheduler settings panel (Phase 1C — M2).
//
// Rendered inside the Settings → Features frame because the scheduler
// exposes `settingsPanel` with componentKey "scheduler.settings-panel".
// Read-only — M2 builds no settings editing; the operator config
// remains the source of truth.

import { useSchedulerSnapshot } from "./useSchedulerSnapshot";

export default function SchedulerSettingsPanel() {
  const { snap, failed } = useSchedulerSnapshot();

  return (
    <div className="flex flex-col gap-1.5 text-[12px]">
      <p className="text-[var(--fg-dim)]">
        Cron-style mission triggers. Schedules live in the operator config
        under <code>features.scheduler</code> — read-only here.
      </p>
      {snap && (
        <p className="text-[var(--fg-dim)]">
          Runtime <span className="text-[var(--fg)]">{snap.status}</span> ·{" "}
          {snap.scheduled.length} scheduled
        </p>
      )}
      {failed && (
        <p className="text-[var(--fg-dimmer)]">Runtime status unavailable.</p>
      )}
    </div>
  );
}
