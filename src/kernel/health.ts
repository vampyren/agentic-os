// Health snapshot store + per-manifest probe loop.
//
// On registry init the probe loop schedules each agent's healthProbe at
// `intervalSec` (manifest-declared; default 300s = 5 min). Probes are cheap
// by contract (see docs/AGENT-MANIFEST.md — no chat prompts as probes).
//
// Bus events are emitted ONLY when an agent's status transitions (LIVE
// → DEGRADED → OFFLINE). Avoids spamming the UI when nothing changed.

import { bus } from "./bus";
import type { AgentManifest, HealthReport } from "./types";

export interface HealthSnapshotEntry {
  status: "live" | "degraded" | "offline" | "unknown";
  version?: string;
  message?: string;
  latencyMs?: number;
  checkedAt: number;
}

interface GlobalHealthState {
  store: Map<string, HealthSnapshotEntry>;
  timers: Map<string, NodeJS.Timeout>;
  loopStartedAt: number | null;
}

const G = globalThis as unknown as { __agenticHealth?: GlobalHealthState };
const state: GlobalHealthState =
  G.__agenticHealth ?? (G.__agenticHealth = {
    store: new Map(),
    timers: new Map(),
    loopStartedAt: null,
  });

export function getHealthSnapshot(): Record<string, HealthSnapshotEntry> {
  const out: Record<string, HealthSnapshotEntry> = {};
  for (const [k, v] of state.store.entries()) out[k] = v;
  return out;
}

export function getCachedHealth(name: string): HealthSnapshotEntry | undefined {
  return state.store.get(name);
}

interface ProbeTarget {
  manifest: AgentManifest;
  probe: () => Promise<HealthReport>;
}

export function startHealthLoop(targets: ProbeTarget[]): void {
  // Tear down any existing timers (HMR re-init, manifest reload, etc.)
  for (const t of state.timers.values()) clearInterval(t);
  state.timers.clear();

  state.loopStartedAt = Date.now();

  for (const target of targets) {
    const intervalSec = target.manifest.healthProbe?.intervalSec ?? 300;
    const intervalMs = Math.max(15, intervalSec) * 1000;  // floor at 15s

    // Run once at startup (don't wait the full interval) — but stagger
    // slightly so we don't slam all probes at boot.
    const delay = 200 + Math.floor(Math.random() * 800);
    setTimeout(() => runProbeOnce(target), delay);

    const timer = setInterval(() => { void runProbeOnce(target); }, intervalMs);
    // Don't keep the process alive on these — they're best-effort.
    timer.unref?.();
    state.timers.set(target.manifest.name, timer);
  }

  bus.emit({
    source: "system",
    kind: "system.health.started",
    payload: { count: targets.length, ts: Date.now() },
  });
}

async function runProbeOnce(target: ProbeTarget): Promise<void> {
  const name = target.manifest.name;
  const startedAt = Date.now();
  let report: HealthReport;
  try {
    report = await target.probe();
  } catch (e) {
    report = {
      status: "offline",
      message: String(e).slice(0, 200),
      checkedAt: Date.now(),
    };
  }
  const latencyMs = Date.now() - startedAt;

  const prev = state.store.get(name);
  const entry: HealthSnapshotEntry = {
    status: report.status,
    version: report.version,
    message: report.message,
    latencyMs,
    checkedAt: report.checkedAt ?? Date.now(),
  };
  state.store.set(name, entry);

  // Only emit on status change.
  if (!prev || prev.status !== entry.status) {
    bus.emit({
      source: name,
      kind: "agent.health.changed",
      payload: {
        from: prev?.status ?? "unknown",
        to: entry.status,
        version: entry.version,
        latencyMs: entry.latencyMs,
      },
    });
  }
}

export function stopHealthLoop(): void {
  for (const t of state.timers.values()) clearInterval(t);
  state.timers.clear();
  state.loopStartedAt = null;
}
