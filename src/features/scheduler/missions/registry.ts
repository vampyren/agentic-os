// Mission registry (Phase 1C — M3).
//
// In-memory registry of MissionDefinitions, registered explicitly in
// code (mirrors the M2 connector / feature registries). Ships empty;
// builtin/index.ts provides registerBuiltinMissions() but does NOT
// auto-register at import — no boot wiring in M3. A globalThis
// singleton survives Next.js hot-reload; tests use __TEST__.newRegistry().

import type { MissionDefinition } from "./types";

class MissionRegistry {
  private missions = new Map<string, MissionDefinition>();

  /** Register a mission definition. Throws on a duplicate id. */
  register(def: MissionDefinition): void {
    if (this.missions.has(def.id)) {
      throw new Error(`mission already registered: ${def.id}`);
    }
    this.missions.set(def.id, def);
  }

  /** Look up a mission by id. Unknown id → undefined (not an error). */
  get(id: string): MissionDefinition | undefined {
    return this.missions.get(id);
  }

  /** All registered mission definitions. */
  list(): MissionDefinition[] {
    return [...this.missions.values()];
  }
}

export type { MissionRegistry };

const G = globalThis as unknown as {
  __agenticMissionRegistry?: MissionRegistry;
};
export const missionRegistry: MissionRegistry =
  G.__agenticMissionRegistry
  ?? (G.__agenticMissionRegistry = new MissionRegistry());

export const __TEST__ = {
  newRegistry: (): MissionRegistry => new MissionRegistry(),
};
