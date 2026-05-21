// Built-in mission: daily-summary (Phase 1C).
//
// Produces a lightweight daily summary draft. The mission does not write
// files itself; it returns a vault-note output for the central runner to
// persist through the constrained writer.

import { z } from "zod";
import type { MissionContext, MissionDefinition, MissionRunResult } from "../types";
import { toVaultRelativePath } from "@/lib/vaultPaths";
import { isoDate } from "./date";

const SUMMARIES_FOLDER = toVaultRelativePath("00_Inbox/agentic-os/summaries");

export const dailySummaryMission: MissionDefinition = {
  id: "daily-summary",
  title: "Daily Summary",
  description: "Creates a dated daily activity summary draft in the Agentic OS inbox.",
  defaultCron: "0 20 * * *",
  enabledByDefault: true,
  manualRunnable: true,
  concurrency: "skip",
  outputKind: "summary",
  defaultOutputFolder: SUMMARIES_FOLDER,
  optionsSchema: z.object({}).strict(),
  permissions: ["vault-write"],
  async run(ctx: MissionContext): Promise<MissionRunResult> {
    const date = isoDate(ctx.now);
    return {
      status: "success",
      message: "daily summary draft created",
      outputs: [
        {
          kind: "vault-note",
          outputFolder: SUMMARIES_FOLDER,
          filenameHint: `daily-summary-${date}`,
          frontmatter: {
            type: "summary",
            status: "inbox",
            source: "agentic-os",
            mission: ctx.missionId,
            runId: ctx.runId,
            date,
            trigger: ctx.trigger,
            timezone: ctx.timezone,
          },
          content:
            `# Daily Summary — ${date}\n\n` +
            `Generated: ${ctx.now.toISOString()}\n` +
            `Trigger: ${ctx.trigger}\n` +
            `Timezone: ${ctx.timezone}\n` +
            `Run: ${ctx.runId}\n\n` +
            `## Highlights\n\n` +
            `- No source-specific summarizer is connected yet; this draft marks the scheduled summary checkpoint and keeps the output in the Agentic OS inbox-first path.\n\n` +
            `## Follow-ups\n\n` +
            `- [ ] Review today's Agentic OS activity and promote any useful notes from inbox.\n` +
            `- [ ] Connect richer source readers when the memory/journal integration layer is ready.\n`,
          conflictPolicy: "suffix",
        },
      ],
    };
  },
};
