import { describe, expect, it } from "vitest";
import { builtinMissions } from "../src/features/scheduler/missions/builtin";
import type { MissionContext } from "../src/features/scheduler/missions/types";
import type { AppConfig } from "../src/kernel/schemas/appConfig";
import type {
  CapabilityId,
  CapabilityInvokeResult,
} from "../src/kernel/capabilities/types";
import { isAllowedMissionOutputFolder } from "../src/lib/vaultPaths";

// Minimal MissionContext fake — the M3 stub missions ignore the
// context entirely, but run()'s signature requires one.
function fakeCtx(): MissionContext {
  return {
    missionId: "test",
    runId: "run-1",
    now: new Date("2026-01-01T00:00:00Z"),
    timezone: "UTC",
    trigger: "manual",
    options: {},
    config: {} as AppConfig,
    caps: {
      has: () => false,
      list: () => [],
      invoke: async <T = unknown>(
        capability: CapabilityId,
      ): Promise<CapabilityInvokeResult<T>> => ({ status: "skipped", capability }),
    },
    vault: { readNote: async () => null },
    bus: { emit: () => {} },
    log: { info: () => {}, warn: () => {}, error: () => {} },
    signal: new AbortController().signal,
  };
}

describe("built-in stub missions", () => {
  it("daily-summary run() returns success with an allowlisted vault-note output", async () => {
    const result = await builtinMissions["daily-summary"].run(fakeCtx());
    expect(result.status).toBe("success");
    if (result.status !== "success") throw new Error("unreachable");
    expect(result.outputs).toHaveLength(1);
    const out = result.outputs![0]!;
    expect(out.kind).toBe("vault-note");
    if (out.kind === "vault-note") {
      expect(isAllowedMissionOutputFolder(out.outputFolder)).toBe(true);
    }
  });

  it("weekly-review run() returns success with an allowlisted vault-note output", async () => {
    const result = await builtinMissions["weekly-review"].run(fakeCtx());
    expect(result.status).toBe("success");
    if (result.status !== "success") throw new Error("unreachable");
    const out = result.outputs![0]!;
    expect(out.kind).toBe("vault-note");
    if (out.kind === "vault-note") {
      expect(isAllowedMissionOutputFolder(out.outputFolder)).toBe(true);
    }
  });

  it("vitals-heartbeat run() returns success with an event output", async () => {
    const result = await builtinMissions["vitals-heartbeat"].run(fakeCtx());
    expect(result.status).toBe("success");
    if (result.status !== "success") throw new Error("unreachable");
    const out = result.outputs![0]!;
    expect(out.kind).toBe("event");
    if (out.kind === "event") {
      expect(out.eventKind).toBe("vitals.heartbeat");
    }
  });

  it("every built-in mission has a strict options schema and declared permissions", () => {
    for (const mission of Object.values(builtinMissions)) {
      expect(mission.optionsSchema.safeParse({}).success).toBe(true);
      // .strict() — an unknown key is rejected.
      expect(mission.optionsSchema.safeParse({ unexpected: 1 }).success).toBe(false);
      expect(mission.permissions.length).toBeGreaterThan(0);
    }
  });

  it("every built-in mission declares a sane definition", () => {
    for (const mission of Object.values(builtinMissions)) {
      expect(mission.id.length).toBeGreaterThan(0);
      expect(mission.title.length).toBeGreaterThan(0);
      expect(["single", "queue", "skip"]).toContain(mission.concurrency);
      expect(mission.manualRunnable).toBe(true);
    }
  });
});
