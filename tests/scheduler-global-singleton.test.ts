import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalConfigPath = process.env.AGENTIC_OS_CONFIG;

async function makeSchedulerConfig(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentic-os-scheduler-global-"));
  const vault = path.join(root, "vault");
  await mkdir(vault, { recursive: true });
  const configPath = path.join(root, "config.yaml");
  await writeFile(
    configPath,
    [
      "configVersion: 1",
      "vault:",
      `  root: ${vault}`,
      "agents:",
      "  default: claude-code",
      "features:",
      "  scheduler:",
      "    enabled: true",
      "    timezone: Europe/Stockholm",
      "    missions:",
      "      daily-summary:",
      "        enabled: false",
      "      weekly-review:",
      "        enabled: false",
      "      vitals-heartbeat:",
      "        enabled: true",
      "        cron: \"*/15 * * * *\"",
      "",
    ].join("\n"),
    "utf8",
  );
  return configPath;
}

afterEach(async () => {
  if (originalConfigPath === undefined) {
    delete process.env.AGENTIC_OS_CONFIG;
  } else {
    process.env.AGENTIC_OS_CONFIG = originalConfigPath;
  }

  const runtime = await import("../src/features/scheduler/runtime");
  runtime.stopGlobalMissionScheduler();
});

describe("global mission scheduler singleton", () => {
  it("shares the started scheduler snapshot across reloaded module instances", async () => {
    const configPath = await makeSchedulerConfig();
    const root = path.dirname(configPath);
    process.env.AGENTIC_OS_CONFIG = configPath;

    try {
      vi.resetModules();
      const firstRuntime = await import("../src/features/scheduler/runtime");
      const started = await firstRuntime.startGlobalMissionScheduler();

      expect(started.status).toBe("running");
      expect(started.scheduled).toContainEqual({
        missionId: "vitals-heartbeat",
        cron: "*/15 * * * *",
        timezone: "Europe/Stockholm",
      });

      vi.resetModules();
      const secondRuntime = await import("../src/features/scheduler/runtime");
      expect(secondRuntime.getGlobalMissionSchedulerSnapshot().status).toBe("running");
      expect(secondRuntime.getGlobalMissionSchedulerSnapshot().scheduled).toContainEqual({
        missionId: "vitals-heartbeat",
        cron: "*/15 * * * *",
        timezone: "Europe/Stockholm",
      });
    } finally {
      const runtime = await import("../src/features/scheduler/runtime");
      runtime.stopGlobalMissionScheduler();
      await rm(root, { recursive: true, force: true });
    }
  });
});
