"use client";

// Live scheduler status — read-only (Phase 1C — M2).
//
// Fetches the neutral snapshot from /api/scheduler/status (itself gated
// behind the scheduler feature) and renders the runtime state, the
// scheduled missions, and any config diagnostics. No controls — M2
// keeps the page read-only.

import { useEffect, useState } from "react";

type SchedulerRuntimeStatus = "idle" | "disabled" | "running" | "stopped";

interface ScheduledMission {
  missionId: string;
  cron: string;
  timezone: string;
}

interface SchedulerDiagnostic {
  severity: string;
  code: string;
  message: string;
  missionId?: string;
}

interface SchedulerSnapshot {
  status: SchedulerRuntimeStatus;
  scheduled: ScheduledMission[];
  diagnostics: SchedulerDiagnostic[];
}

const STATUS_TONE: Record<SchedulerRuntimeStatus, string> = {
  running: "#4ade80",
  idle: "#8a8f98",
  stopped: "#8a8f98",
  disabled: "#fbbf24",
};

export default function SchedulerStatusPanel() {
  const [snap, setSnap] = useState<SchedulerSnapshot | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/scheduler/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("status"))))
      .then((j: { scheduler: SchedulerSnapshot }) => {
        if (!cancelled) setSnap(j.scheduler);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
