"use client";

// Shared scheduler snapshot hook (Phase 1C — M2).
//
// Fetches the neutral snapshot once on mount from the gated
// /api/scheduler/status endpoint. Every scheduler UI surface — the
// /scheduler page panel, the dashboard card, the settings panel —
// reads through this hook so the fetch shape lives in exactly one
// place.

import { useEffect, useState } from "react";

export type SchedulerRuntimeStatus =
  | "idle"
  | "disabled"
  | "running"
  | "stopped";

export interface ScheduledMission {
  missionId: string;
  cron: string;
  timezone: string;
}

export interface SchedulerDiagnostic {
  severity: string;
  code: string;
  message: string;
  missionId?: string;
}

export interface SchedulerSnapshot {
  status: SchedulerRuntimeStatus;
  scheduled: ScheduledMission[];
  diagnostics: SchedulerDiagnostic[];
}

export interface SchedulerSnapshotState {
  snap: SchedulerSnapshot | null;
  failed: boolean;
}

export function useSchedulerSnapshot(): SchedulerSnapshotState {
  const [state, setState] = useState<SchedulerSnapshotState>({
    snap: null,
    failed: false,
  });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/scheduler/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("status"))))
      .then((j: { scheduler: SchedulerSnapshot }) => {
        if (!cancelled) setState({ snap: j.scheduler, failed: false });
      })
      .catch(() => {
        if (!cancelled) setState({ snap: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
