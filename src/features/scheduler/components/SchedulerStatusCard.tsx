"use client";

// Scheduler dashboard card (Phase 1C — M2).
//
// A registry-driven Mission Control card: the shell renders it because
// the scheduler feature exposes `dashboardCards` with
// componentKey "scheduler.status-card". Compact runtime state +
// scheduled-mission count; the whole card links to /scheduler.

import Link from "next/link";
import { Clock } from "lucide-react";
import {
  useSchedulerSnapshot,
  type SchedulerRuntimeStatus,
} from "./useSchedulerSnapshot";

const STATUS_TONE: Record<SchedulerRuntimeStatus, string> = {
  running: "#4ade80",
  idle: "#8a8f98",
  stopped: "#8a8f98",
  disabled: "#fbbf24",
};

export default function SchedulerStatusCard() {
  const { snap, failed } = useSchedulerSnapshot();

  return (
    <Link
      href="/scheduler"
      className="panel p-5 flex flex-col gap-3 transition hover:border-[var(--panel-border-hot)]"
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-[13px] font-medium">
          <Clock size={15} />
          Scheduler
        </span>
        {snap && (
          <span
            className="w-2 h-2 rounded-full"
            style={{ background: STATUS_TONE[snap.status] }}
            aria-hidden
          />
        )}
      </div>
      <div className="text-[12px] text-[var(--fg-dim)]">
        {failed
          ? "Status unavailable."
          : !snap
            ? "Loading…"
            : snap.status === "running"
              ? `${snap.scheduled.length} mission${
                  snap.scheduled.length === 1 ? "" : "s"
                } scheduled`
              : `Runtime ${snap.status}`}
      </div>
    </Link>
  );
}
