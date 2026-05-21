// Built-in mission: vitals-heartbeat (Phase 1C).
//
// Emits a periodic scheduler heartbeat event. No vault write is
// produced; the central runner emits the returned event after enforcing
// the mission's declared event permission.

import { z } from "zod";
import type { MissionContext, MissionDefinition, MissionRunResult } from "../types";

export const vitalsHeartbeatMission: MissionDefinition = {
  id: "vitals-heartbeat",
  title: "Vitals Heartbeat",
  description: "Emits a periodic vitals heartbeat event on the bus.",
  defaultCron: "*/15 * * * *",
  enabledByDefault: true,
  manualRunnable: true,
  concurrency: "queue",
  outputKind: "heartbeat",
  optionsSchema: z.object({}).strict(),
  permissions: ["event-emit"],
  async run(ctx: MissionContext): Promise<MissionRunResult> {
    return {
      status: "success",
      message: "vitals heartbeat emitted",
      outputs: [
        {
          kind: "event",
          eventKind: "vitals.heartbeat",
          payload: {
            missionId: ctx.missionId,
            runId: ctx.runId,
            trigger: ctx.trigger,
            timezone: ctx.timezone,
            generatedAt: ctx.now.toISOString(),
          },
        },
      ],
    };
  },
};
