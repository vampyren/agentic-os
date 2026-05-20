// Built-in mission: weekly-review (Phase 1C — M3 STUB).
//
// Will produce a weekly review note. M3 ships only the definition with
// a stub `run()` returning a well-formed MissionOutput — no real
// review logic.

import { z } from "zod";
import type { MissionDefinition, MissionRunResult } from "../types";
import { toVaultRelativePath } from "@/lib/vaultPaths";

const REVIEWS_FOLDER = toVaultRelativePath("00_Inbox/agentic-os/reviews");

export const weeklyReviewMission: MissionDefinition = {
  id: "weekly-review",
  title: "Weekly Review",
  description:
    "Produces a weekly review note. Stub — real review logic lands in a later milestone.",
  defaultCron: "0 18 * * 0",
  enabledByDefault: true,
  manualRunnable: true,
  concurrency: "skip",
  outputKind: "review",
  defaultOutputFolder: REVIEWS_FOLDER,
  optionsSchema: z.object({}).strict(),
  permissions: ["vault-write"],
  async run(): Promise<MissionRunResult> {
    return {
      status: "success",
      message: "weekly-review stub — no real review logic yet",
      outputs: [
        {
          kind: "vault-note",
          outputFolder: REVIEWS_FOLDER,
          filenameHint: "weekly-review",
          content:
            "# Weekly Review\n\n(stub output — real review logic lands in a later milestone)\n",
          conflictPolicy: "suffix",
        },
      ],
    };
  },
};
