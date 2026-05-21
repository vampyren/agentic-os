// Built-in mission: weekly-review (Phase 1C).
//
// Produces a lightweight weekly review draft. The mission returns a
// vault-note output only; the central runner owns persistence.

import { z } from "zod";
import type { MissionContext, MissionDefinition, MissionRunResult } from "../types";
import { toVaultRelativePath } from "@/lib/vaultPaths";
import { isoWeekId } from "./date";

const REVIEWS_FOLDER = toVaultRelativePath("00_Inbox/agentic-os/reviews");

export const weeklyReviewMission: MissionDefinition = {
  id: "weekly-review",
  title: "Weekly Review",
  description: "Creates a weekly review draft in the Agentic OS inbox.",
  defaultCron: "0 18 * * 0",
  enabledByDefault: true,
  manualRunnable: true,
  concurrency: "skip",
  outputKind: "review",
  defaultOutputFolder: REVIEWS_FOLDER,
  optionsSchema: z.object({}).strict(),
  permissions: ["vault-write"],
  async run(ctx: MissionContext): Promise<MissionRunResult> {
    const week = isoWeekId(ctx.now);
    return {
      status: "success",
      message: "weekly review draft created",
      outputs: [
        {
          kind: "vault-note",
          outputFolder: REVIEWS_FOLDER,
          filenameHint: `weekly-review-${week}`,
          frontmatter: {
            type: "review",
            status: "inbox",
            source: "agentic-os",
            mission: ctx.missionId,
            runId: ctx.runId,
            week,
            trigger: ctx.trigger,
            timezone: ctx.timezone,
          },
          content:
            `# Weekly Review — ${week}\n\n` +
            `Generated: ${ctx.now.toISOString()}\n` +
            `Trigger: ${ctx.trigger}\n` +
            `Timezone: ${ctx.timezone}\n` +
            `Run: ${ctx.runId}\n\n` +
            `## Review checklist\n\n` +
            `- [ ] Summarize what shipped this week.\n` +
            `- [ ] Capture blockers, risks, and stale docs.\n` +
            `- [ ] Update the Agentic OS handoff if project state changed.\n` +
            `- [ ] Promote useful inbox outputs after review.\n\n` +
            `## Notes\n\n` +
            `- This is a scheduler-generated review shell. Rich source aggregation belongs to the next integration layer.\n`,
          conflictPolicy: "suffix",
        },
      ],
    };
  },
};
