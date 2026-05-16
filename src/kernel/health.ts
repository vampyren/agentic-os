// Health snapshot store. Commit 1 ships only the empty-snapshot reader so
// /api/vitals has a backing store. Commit 2 adds the probe loop that
// populates it on a per-manifest cadence.

export interface HealthSnapshotEntry {
  status: "live" | "degraded" | "offline" | "unknown";
  version?: string;
  message?: string;
  latencyMs?: number;
  checkedAt: number;
}

const G = globalThis as unknown as {
  __agenticHealth?: Map<string, HealthSnapshotEntry>;
};
const store: Map<string, HealthSnapshotEntry> =
  G.__agenticHealth ?? (G.__agenticHealth = new Map());

export function getHealthSnapshot(): Record<string, HealthSnapshotEntry> {
  const out: Record<string, HealthSnapshotEntry> = {};
  for (const [k, v] of store.entries()) out[k] = v;
  return out;
}

export function setHealthSnapshot(name: string, entry: HealthSnapshotEntry): void {
  store.set(name, entry);
}

export function getCachedHealth(name: string): HealthSnapshotEntry | undefined {
  return store.get(name);
}
