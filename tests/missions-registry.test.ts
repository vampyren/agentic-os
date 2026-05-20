import { describe, expect, it } from "vitest";
import { z } from "zod";
import { __TEST__ } from "../src/features/scheduler/missions/registry";
import {
  builtinMissions,
  registerBuiltinMissions,
} from "../src/features/scheduler/missions/builtin";
import type { MissionDefinition } from "../src/features/scheduler/missions/types";

function fakeMission(overrides: Partial<MissionDefinition> = {}): MissionDefinition {
  return {
    id: "fake-mission",
    title: "Fake Mission",
    description: "a mission used in tests",
    enabledByDefault: false,
    manualRunnable: true,
    concurrency: "single",
    outputKind: "custom",
    optionsSchema: z.object({}).strict(),
    permissions: [],
    run: async () => ({ status: "success" }),
    ...overrides,
  };
}

describe("missionRegistry", () => {
  it("registers, gets, and lists a mission", () => {
    const reg = __TEST__.newRegistry();
    const m = fakeMission({ id: "alpha" });
    reg.register(m);
    expect(reg.get("alpha")).toBe(m);
    expect(reg.list()).toEqual([m]);
  });

  it("returns undefined for an unknown mission id", () => {
    expect(__TEST__.newRegistry().get("ghost")).toBeUndefined();
  });

  it("throws on a duplicate mission id", () => {
    const reg = __TEST__.newRegistry();
    reg.register(fakeMission({ id: "dup" }));
    expect(() => reg.register(fakeMission({ id: "dup" }))).toThrow(
      /already registered/i,
    );
  });

  it("__TEST__.newRegistry() yields isolated instances", () => {
    const a = __TEST__.newRegistry();
    const b = __TEST__.newRegistry();
    a.register(fakeMission({ id: "only-a" }));
    expect(a.list()).toHaveLength(1);
    expect(b.list()).toHaveLength(0);
  });
});

describe("registerBuiltinMissions", () => {
  it("registers all three built-in missions", () => {
    const reg = __TEST__.newRegistry();
    registerBuiltinMissions(reg);
    expect(reg.list().map((m) => m.id).sort()).toEqual([
      "daily-summary",
      "vitals-heartbeat",
      "weekly-review",
    ]);
  });

  it("builtinMissions record keys match the mission ids", () => {
    for (const [key, mission] of Object.entries(builtinMissions)) {
      expect(mission.id).toBe(key);
    }
  });
});
