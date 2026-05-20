// Built-in mission: vitals-heartbeat (Phase 1C — M3 STUB).
//
// Will emit a periodic vitals heartbeat event. Unlike the summary
// missions it produces an `event` output (no vault note, just a bus
// emission). M3 ships only the definition with a stub `run()`.
//
// No defaultCron: a heartbeat is interval-driven; how it ticks is the
// M5 scheduler runtime's concern. concurrency "queue" so a slow tick
// never silently drops the next (design §3.2).

import { z } from "zod";
import type { MissionDefinition, MissionRunResult } from "../types";

export const vitalsHeartbeatMission: MissionDefinition = {
  id: "vitals-heartbeat",
  title: "Vitals Heartbeat",
  description:
    "Emits a periodic vitals heartbeat event on the bus. Stub — real vitals payload lands in a later milestone.",
  enabledByDefault: true,
  manualRunnable: true,
  concurrency: "queue",
  outputKind: "heartbeat",
  optionsSchema: z.object({}).strict(),
  permissions: ["event-emit"],
  async run(): Promise<MissionRunResult> {
    return {
      status: "success",
      message: "vitals-heartbeat stub — no real vitals payload yet",
      outputs: [
        {
          kind: "event",
          eventKind: "vitals.heartbeat",
          payload: { stub: true },
        },
      ],
    };
  },
};
