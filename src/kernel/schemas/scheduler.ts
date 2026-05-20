// Scheduler feature config schema (Phase 1C — M3).
//
// Tightens M1's loose `features.scheduler.missions` record into a real
// per-mission config schema. Lives in the kernel (not under
// src/features/) so src/kernel/schemas/appConfig.ts can import it
// without the kernel depending on a feature.
//
// M3 cron validation is STRUCTURAL only: 5 fields, cron-field charset,
// 6-field (sub-minute) expressions rejected as a DoS guard. Deep range
// validation (minute 0-59 etc.) defers to M5 / node-cron.

import { z } from "zod";
import { isAllowedMissionOutputFolder } from "../../lib/vaultPaths";

// Kebab-case slug — same convention as agent / connector ids.
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

// A single cron field: digits, names, and the operators * , - /.
const CRON_FIELD = /^[a-zA-Z0-9*,/-]+$/;

/**
 * Structural cron validation. A valid expression has exactly 5
 * whitespace-separated fields (minute hour day-of-month month
 * day-of-week), each using only cron-field characters. A 6-field
 * expression (seconds prefix → sub-minute scheduling) is rejected.
 */
export const cronExpressionSchema = z.string().refine(
  (s) => {
    const fields = s.trim().split(/\s+/);
    if (fields.length !== 5) return false;
    return fields.every((f) => CRON_FIELD.test(f));
  },
  {
    message:
      "cron must be a 5-field expression (minute hour day-of-month " +
      "month day-of-week); 6-field / sub-minute expressions are rejected",
  },
);

const missionOutputFolderSchema = z.string().refine(isAllowedMissionOutputFolder, {
  message:
    "outputFolder must be a vault-relative path under an allowed mission " +
    "output root (00_Inbox/agentic-os/{summaries,reviews,missions,studio,kanban})",
});

/** Per-mission operator config (config.features.scheduler.missions.<id>). */
export const missionConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    cron: cronExpressionSchema.optional(),
    outputFolder: missionOutputFolderSchema.optional(),
  })
  .strict();

/** The whole scheduler feature config block. */
export const schedulerFeatureSchema = z
  .object({
    enabled: z.boolean().default(false),
    timezone: z.string().min(1).default("UTC"),
    missions: z
      .record(
        z.string().regex(SLUG, "mission id must be a kebab-case slug"),
        missionConfigSchema,
      )
      .default({}),
  })
  .strict()
  .default({});

export type MissionConfig = z.infer<typeof missionConfigSchema>;
export type SchedulerFeatureConfig = z.infer<typeof schedulerFeatureSchema>;
