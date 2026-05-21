import { describe, expect, it } from "vitest";
import { builtinMissions } from "../src/features/scheduler/missions/builtin";
import type { MissionContext } from "../src/features/scheduler/missions/types";
import type { AppConfig } from "../src/kernel/schemas/appConfig";
import type {
  CapabilityId,
  CapabilityInvokeResult,
} from "../src/kernel/capabilities/types";
import { isAllowedMissionOutputFolder } from "../src/lib/vaultPaths";

function fakeCtx(overrides: Partial<MissionContext> = {}): MissionContext {
  return {
    missionId: "test",
    runId: "run-1",
    now: new Date("2026-01-01T20:15:00Z"),
    timezone: "Europe/Stockholm",
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
    ...overrides,
  };
}

describe("built-in missions", () => {
  it("daily-summary produces a useful dated draft without stub wording", async () => {
    const result = await builtinMissions["daily-summary"].run(fakeCtx({ missionId: "daily-summary" }));
    expect(result.status).toBe("success");
    if (result.status !== "success") throw new Error("unreachable");
    expect(result.outputs).toHaveLength(1);
    const out = result.outputs![0]!;
    expect(out.kind).toBe("vault-note");
    if (out.kind === "vault-note") {
      expect(isAllowedMissionOutputFolder(out.outputFolder)).toBe(true);
      expect(out.filenameHint).toContain("daily-summary-2026-01-01");
      expect(out.content).toContain("# Daily Summary — 2026-01-01");
      expect(out.content).toContain("Trigger: manual");
      expect(out.content).not.toMatch(/stub/i);
    }
  });

  it("weekly-review produces a useful weekly draft without stub wording", async () => {
    const result = await builtinMissions["weekly-review"].run(fakeCtx({ missionId: "weekly-review" }));
    expect(result.status).toBe("success");
    if (result.status !== "success") throw new Error("unreachable");
    const out = result.outputs![0]!;
    expect(out.kind).toBe("vault-note");
    if (out.kind === "vault-note") {
      expect(isAllowedMissionOutputFolder(out.outputFolder)).toBe(true);
      expect(out.filenameHint).toContain("weekly-review-2026-W01");
      expect(out.content).toContain("# Weekly Review — 2026-W01");
      expect(out.content).toContain("Review checklist");
      expect(out.content).not.toMatch(/stub/i);
    }
  });

  it("vitals-heartbeat emits a real heartbeat payload", async () => {
    const result = await builtinMissions["vitals-heartbeat"].run(fakeCtx({ missionId: "vitals-heartbeat" }));
    expect(result.status).toBe("success");
    if (result.status !== "success") throw new Error("unreachable");
    const out = result.outputs![0]!;
    expect(out.kind).toBe("event");
    if (out.kind === "event") {
      expect(out.eventKind).toBe("vitals.heartbeat");
      expect(out.payload).toMatchObject({
        missionId: "vitals-heartbeat",
        runId: "run-1",
        trigger: "manual",
        timezone: "Europe/Stockholm",
      });
      expect(out.payload).not.toHaveProperty("stub");
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
