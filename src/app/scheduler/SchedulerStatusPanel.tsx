"use client";

// Live scheduler status — read-only (Phase 1C — M2).
//
// The full status view on the /scheduler page: runtime state, the
// scheduled missions, and any config diagnostics. Reads through the
// shared useSchedulerSnapshot hook. No controls — M2 is read-only.

import {
  useSchedulerSnapshot,
  type SchedulerRuntimeStatus,
} from "@/features/scheduler/components/useSchedulerSnapshot";

const STATUS_TONE: Record<SchedulerRuntimeStatus, string> = {
  running: "#4ade80",
  idle: "#8a8f98",
  stopped: "#8a8f98",
  disabled: "#fbbf24",
};

export default function SchedulerStatusPanel() {
  const { snap, failed } = useSchedulerSnapshot();

  return (
    <section className="rounded-xl border border-[var(--panel-border)] bg-[var(--panel)] p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.25em] text-[var(--fg-dimmer)]">
          Cron runtime
        </span>
        {snap && (
          <span className="flex items-center gap-2 text-[12px] text-[var(--fg-dim)]">
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: STATUS_TONE[snap.status] }}
            />
            <span className="uppercase tracking-wider">{snap.status}</span>
          </span>
        )}
      </div>

      {failed && (
        <p className="text-[13px] text-[var(--fg-dim)]">
          Scheduler status is unavailable.
        </p>
      )}

      {!failed && !snap && (
        <p className="text-[13px] text-[var(--fg-dimmer)]">Loading…</p>
      )}

      {snap && (
        <>
          <div className="flex flex-col gap-2">
            <span className="text-[11px] uppercase tracking-widest text-[var(--fg-dimmer)]">
              Scheduled missions
            </span>
            {snap.scheduled.length === 0 ? (
              <p className="text-[13px] text-[var(--fg-dimmer)]">
                No missions scheduled.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {snap.scheduled.map((m) => (
                  <li
                    key={m.missionId}
                    className="flex items-center justify-between gap-3 text-[13px]"
                  >
                    <span className="text-[var(--fg)]">{m.missionId}</span>
                    <span className="font-mono text-[12px] text-[var(--fg-dim)]">
                      {m.cron} · {m.timezone}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {snap.diagnostics.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-[11px] uppercase tracking-widest text-[var(--fg-dimmer)]">
                Diagnostics
              </span>
              <ul className="flex flex-col gap-1.5">
                {snap.diagnostics.map((d, i) => (
                  <li
                    key={`${d.code}-${i}`}
                    className="text-[12px] text-[var(--fg-dim)]"
                  >
                    <span className="uppercase tracking-wider text-[var(--fg-dimmer)]">
                      {d.severity}
                    </span>{" "}
                    {d.message}
                    {d.missionId ? ` (${d.missionId})` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
