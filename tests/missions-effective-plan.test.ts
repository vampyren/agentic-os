import { describe, expect, it } from "vitest";
import { z } from "zod";
import { resolveEffectiveMissionPlans } from "../src/features/scheduler/missions/effectivePlan";
import type { MissionDefinition } from "../src/features/scheduler/missions/types";
import type { SchedulerFeatureConfig } from "../src/kernel/schemas/scheduler";
import { toVaultRelativePath } from "../src/lib/vaultPaths";

function fakeMission(overrides: Partial<MissionDefinition> = {}): MissionDefinition {
  return {
    id: "fake",
    title: "Fake",
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

function schedulerConfig(
  overrides: Partial<SchedulerFeatureConfig> = {},
): SchedulerFeatureConfig {
  return { enabled: false, timezone: "UTC", missions: {}, ...overrides };
}

describe("resolveEffectiveMissionPlans", () => {
  it("uses defaultCron when config gives no override", () => {
    const m = fakeMission({ id: "a", defaultCron: "0 20 * * *" });
    const { plans } = resolveEffectiveMissionPlans([m], schedulerConfig());
    expect(plans[0]?.cron).toBe("0 20 * * *");
  });

  it("config cron override wins over defaultCron", () => {
    const m = fakeMission({ id: "a", defaultCron: "0 20 * * *" });
    const { plans } = resolveEffectiveMissionPlans(
      [m],
      schedulerConfig({ missions: { a: { cron: "0 9 * * *" } } }),
    );
    expect(plans[0]?.cron).toBe("0 9 * * *");
  });

  it("config enabled:false disables an enabled-by-default mission", () => {
    const m = fakeMission({ id: "a", enabledByDefault: true });
    const { plans } = resolveEffectiveMissionPlans(
      [m],
      schedulerConfig({ missions: { a: { enabled: false } } }),
    );
    expect(plans[0]?.enabled).toBe(false);
  });

  it("uses enabledByDefault when config is silent", () => {
    const m = fakeMission({ id: "a", enabledByDefault: true });
    const { plans } = resolveEffectiveMissionPlans([m], schedulerConfig());
    expect(plans[0]?.enabled).toBe(true);
  });

  it("resolves the timezone from the scheduler config", () => {
    const m = fakeMission({ id: "a" });
    const { plans } = resolveEffectiveMissionPlans(
      [m],
      schedulerConfig({ timezone: "Europe/Stockholm" }),
    );
    expect(plans[0]?.timezone).toBe("Europe/Stockholm");
  });

  it("config outputFolder override wins over the mission default", () => {
    const m = fakeMission({
      id: "a",
      defaultOutputFolder: toVaultRelativePath("00_Inbox/agentic-os/missions"),
    });
    const { plans } = resolveEffectiveMissionPlans(
      [m],
      schedulerConfig({ missions: { a: { outputFolder: "00_Inbox/agentic-os/summaries" } } }),
    );
    expect(plans[0]?.outputFolder).toBe("00_Inbox/agentic-os/summaries");
  });

  it("flags an unknown mission id in config as a scheduler-level diagnostic", () => {
    const m = fakeMission({ id: "a" });
    const { diagnostics } = resolveEffectiveMissionPlans(
      [m],
      schedulerConfig({ missions: { "no-such-mission": { enabled: true } } }),
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("unknown-mission");
    expect(diagnostics[0]?.severity).toBe("error");
    expect(diagnostics[0]?.missionId).toBe("no-such-mission");
  });

  it("produces one clean plan per registered mission", () => {
    const a = fakeMission({ id: "a", defaultCron: "0 1 * * *" });
    const b = fakeMission({ id: "b" });
    const { plans, diagnostics } = resolveEffectiveMissionPlans(
      [a, b],
      schedulerConfig(),
    );
    expect(plans.map((p) => p.id)).toEqual(["a", "b"]);
    expect(diagnostics).toEqual([]);
    expect(plans[0]?.definition).toBe(a);
    expect(plans[0]?.diagnostics).toEqual([]);
  });
});
