import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createMissionScheduler } from "../src/features/scheduler/runtime";
import { __TEST__ as registryTest } from "../src/features/scheduler/missions/registry";
import { appConfigSchema } from "../src/kernel/schemas/appConfig";
import type { MissionDefinition, MissionRunResult } from "../src/features/scheduler/missions/types";
import type { RunnerResult } from "../src/features/scheduler/missions/runner";

type Scheduled = {
  expression: string;
  task: () => void | Promise<void>;
  options?: { timezone?: string; name?: string; noOverlap?: boolean };
  handle: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };
};

function mission(overrides: Partial<MissionDefinition> = {}): MissionDefinition {
  return {
    id: "m",
    title: "Test Mission",
    description: "test",
    defaultCron: "*/5 * * * *",
    enabledByDefault: true,
    manualRunnable: true,
    concurrency: "single",
    outputKind: "custom",
    optionsSchema: z.object({}).strict(),
    permissions: [],
    run: async (): Promise<MissionRunResult> => ({ status: "success" }),
    ...overrides,
  };
}

function registryWith(...defs: MissionDefinition[]) {
  const reg = registryTest.newRegistry();
  for (const d of defs) reg.register(d);
  return reg;
}

function fakeCron(validate = true) {
  const scheduled: Scheduled[] = [];
  return {
    scheduled,
    adapter: {
      validate: vi.fn(() => validate),
      schedule: vi.fn((expression: string, task: () => void | Promise<void>, options?: Scheduled["options"]) => {
        const handle = { start: vi.fn(), stop: vi.fn(), destroy: vi.fn() };
        scheduled.push({ expression, task, options, handle });
        return handle;
      }),
    },
  };
}

const successResult: RunnerResult = {
  status: "success",
  runId: "run-1",
  missionId: "m",
  message: "mission run completed",
  outputs: [],
};

describe("mission scheduler runtime", () => {
  it("does not schedule anything when the scheduler feature is disabled", async () => {
    const cron = fakeCron();
    const runMission = vi.fn(async () => successResult);
    const config = appConfigSchema.parse({
      vault: { root: "/tmp/agentic-os-test-vault" },
      features: {
        scheduler: {
          enabled: false,
          missions: { m: { enabled: true, cron: "* * * * *" } },
        },
      },
    });

    const scheduler = createMissionScheduler({
      config,
      registry: registryWith(mission()),
      cron: cron.adapter,
      runMission,
    });

    const snapshot = await scheduler.start();

    expect(snapshot.status).toBe("disabled");
    expect(cron.adapter.schedule).not.toHaveBeenCalled();
    expect(runMission).not.toHaveBeenCalled();
  });

  it("reports a disabled scheduler instead of crashing when config cannot be loaded", async () => {
    const cron = fakeCron();
    const runMission = vi.fn(async () => successResult);
    const previousConfigPath = process.env.AGENTIC_OS_CONFIG;
    process.env.AGENTIC_OS_CONFIG = "/tmp/agentic-os-missing-config-for-scheduler-test.yaml";

    try {
      const scheduler = createMissionScheduler({
        registry: registryWith(mission()),
        cron: cron.adapter,
        runMission,
      });

      const snapshot = await scheduler.start();

      expect(snapshot.status).toBe("disabled");
      expect(cron.adapter.schedule).not.toHaveBeenCalled();
      expect(runMission).not.toHaveBeenCalled();
      expect(snapshot.diagnostics).toContainEqual(
        expect.objectContaining({ code: "config-load-failed" }),
      );
    } finally {
      if (previousConfigPath === undefined) {
        delete process.env.AGENTIC_OS_CONFIG;
      } else {
        process.env.AGENTIC_OS_CONFIG = previousConfigPath;
      }
    }
  });

  it("schedules enabled mission plans and fires them through runMission as scheduled runs", async () => {
    const cron = fakeCron();
    const runMission = vi.fn(async () => successResult);
    const config = appConfigSchema.parse({
      vault: { root: "/tmp/agentic-os-test-vault" },
      features: {
        scheduler: {
          enabled: true,
          timezone: "Europe/Stockholm",
          missions: { m: { enabled: true, cron: "*/10 * * * *" } },
        },
      },
    });

    const scheduler = createMissionScheduler({
      config,
      registry: registryWith(mission()),
      cron: cron.adapter,
      runMission,
    });

    const snapshot = await scheduler.start();
    await cron.scheduled[0]!.task();

    expect(snapshot.status).toBe("running");
    expect(cron.scheduled).toHaveLength(1);
    expect(cron.scheduled[0]!.expression).toBe("*/10 * * * *");
    expect(cron.scheduled[0]!.options).toMatchObject({
      timezone: "Europe/Stockholm",
      name: "agentic-os:m",
      noOverlap: true,
    });
    expect(runMission).toHaveBeenCalledWith({
      missionId: "m",
      trigger: "scheduled",
      rawOptions: {},
    });
  });

  it("skips cron expressions rejected by the cron adapter without crashing", async () => {
    const cron = fakeCron(false);
    const runMission = vi.fn(async () => successResult);
    const config = appConfigSchema.parse({
      vault: { root: "/tmp/agentic-os-test-vault" },
      features: {
        scheduler: {
          enabled: true,
          missions: { m: { enabled: true, cron: "99 * * * *" } },
        },
      },
    });

    const scheduler = createMissionScheduler({
      config,
      registry: registryWith(mission()),
      cron: cron.adapter,
      runMission,
    });

    const snapshot = await scheduler.start();

    expect(snapshot.status).toBe("running");
    expect(cron.adapter.schedule).not.toHaveBeenCalled();
    expect(snapshot.diagnostics).toContainEqual(
      expect.objectContaining({ code: "invalid-cron", missionId: "m" }),
    );
  });

  it("continues scheduling other missions when one registration throws", async () => {
    const scheduled: Scheduled[] = [];
    const cron = {
      validate: vi.fn(() => true),
      schedule: vi.fn((expression: string, task: () => void | Promise<void>, options?: Scheduled["options"]) => {
        if (options?.name === "agentic-os:m") throw new Error("schedule failed");
        const handle = { start: vi.fn(), stop: vi.fn(), destroy: vi.fn() };
        scheduled.push({ expression, task, options, handle });
        return handle;
      }),
    };
    const runMission = vi.fn(async () => successResult);
    const config = appConfigSchema.parse({
      vault: { root: "/tmp/agentic-os-test-vault" },
      features: { scheduler: { enabled: true } },
    });

    const scheduler = createMissionScheduler({
      config,
      registry: registryWith(
        mission({ id: "m", defaultCron: "*/5 * * * *" }),
        mission({ id: "n", defaultCron: "*/10 * * * *" }),
      ),
      cron,
      runMission,
    });

    const snapshot = await scheduler.start();

    expect(snapshot.status).toBe("running");
    expect(snapshot.diagnostics).toContainEqual(
      expect.objectContaining({ code: "schedule-failed", missionId: "m" }),
    );
    expect(snapshot.scheduled).toEqual([
      { missionId: "n", cron: "*/10 * * * *", timezone: "UTC" },
    ]);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]!.options).toMatchObject({ name: "agentic-os:n" });
  });

  it("destroys scheduled tasks when stopped", async () => {
    const cron = fakeCron();
    const runMission = vi.fn(async () => successResult);
    const config = appConfigSchema.parse({
      vault: { root: "/tmp/agentic-os-test-vault" },
      features: { scheduler: { enabled: true } },
    });

    const scheduler = createMissionScheduler({
      config,
      registry: registryWith(mission()),
      cron: cron.adapter,
      runMission,
    });

    await scheduler.start();
    scheduler.stop();

    expect(cron.scheduled).toHaveLength(1);
    expect(cron.scheduled[0]!.handle.destroy).toHaveBeenCalledTimes(1);
    expect(scheduler.getSnapshot().status).toBe("stopped");
  });
});
