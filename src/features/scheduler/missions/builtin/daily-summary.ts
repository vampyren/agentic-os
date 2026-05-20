// Built-in mission: daily-summary (Phase 1C — M3 STUB).
//
// Will summarise the day's activity into a vault note. M3 ships only
// the definition with a stub `run()` that returns a well-formed
// MissionOutput — no real summarisation logic. The runner that would
// invoke run() arrives in M4.

import { z } from "zod";
import type { MissionDefinition, MissionRunResult } from "../types";
import { toVaultRelativePath } from "@/lib/vaultPaths";

const SUMMARIES_FOLDER = toVaultRelativePath("00_Inbox/agentic-os/summaries");

export const dailySummaryMission: MissionDefinition = {
  id: "daily-summary",
  title: "Daily Summary",
  description:
    "Summarises the day's activity into a vault note. Stub — real summarisation lands in a later milestone.",
  defaultCron: "0 20 * * *",
  enabledByDefault: true,
  manualRunnable: true,
  concurrency: "skip",
  outputKind: "summary",
  defaultOutputFolder: SUMMARIES_FOLDER,
  optionsSchema: z.object({}).strict(),
  permissions: ["vault-write"],
  async run(): Promise<MissionRunResult> {
    return {
      status: "success",
      message: "daily-summary stub — no real summarisation yet",
      outputs: [
        {
          kind: "vault-note",
          outputFolder: SUMMARIES_FOLDER,
          filenameHint: "daily-summary",
          content:
            "# Daily Summary\n\n(stub output — real summarisation lands in a later milestone)\n",
          conflictPolicy: "suffix",
        },
      ],
    };
  },
};
