// Effective mission plan resolver (Phase 1C — M3).
//
// "Mission planning" — the heart of M3. Merges each registered
// mission's definition defaults with the operator's config overrides
// to produce, per mission, what the scheduler WOULD do. No execution:
// the plan is a description, nothing runs.
//
// Diagnostics:
//   - A config `missions.<id>` key with no matching registered mission
//     → a scheduler-level `unknown-mission` error (drives "scheduler
//     degraded").
//   - Per-mission resolution anomalies attach to that plan's own
//     `diagnostics`.

import type {
  ConfigDiagnostic,
  EffectiveMissionPlan,
  MissionDefinition,
} from "./types";
import type { SchedulerFeatureConfig } from "@/kernel/schemas/scheduler";
import { toVaultRelativePath, type VaultRelativePath } from "@/lib/vaultPaths";

export interface EffectiveMissionPlanResult {
  plans: EffectiveMissionPlan[];
  /** Scheduler-level diagnostics not tied to a single known mission. */
  diagnostics: ConfigDiagnostic[];
}

/**
 * Resolve the effective plan for every registered mission against the
 * scheduler config. `missions` is passed as a list (not the registry)
 * so the resolver is trivially testable with in-test definitions.
 */
export function resolveEffectiveMissionPlans(
  missions: MissionDefinition[],
  schedulerConfig: SchedulerFeatureConfig,
): EffectiveMissionPlanResult {
  const diagnostics: ConfigDiagnostic[] = [];
  const knownIds = new Set(missions.map((m) => m.id));

  // Config entries referencing a mission that isn't registered.
  for (const configuredId of Object.keys(schedulerConfig.missions)) {
    if (!knownIds.has(configuredId)) {
      diagnostics.push({
        severity: "error",
        code: "unknown-mission",
        message: `scheduler config references mission "${configuredId}" which is not registered`,
        missionId: configuredId,
      });
    }
  }

  const plans: EffectiveMissionPlan[] = missions.map((def) => {
    const override = schedulerConfig.missions[def.id];
    const planDiagnostics: ConfigDiagnostic[] = [];

    const enabled = override?.enabled ?? def.enabledByDefault;
    const cron = override?.cron ?? def.defaultCron;

    // outputFolder: a config override (already allowlist-validated by
    // the config schema) wins; otherwise the mission's declared
    // default. The toVaultRelativePath call re-brands the override
    // string; the try/catch is a defense-in-depth net for the case the
    // resolver is ever handed config that bypassed schema validation.
    let outputFolder: VaultRelativePath | undefined;
    if (override?.outputFolder !== undefined) {
      try {
        outputFolder = toVaultRelativePath(override.outputFolder);
      } catch {
        planDiagnostics.push({
          severity: "error",
          code: "invalid-output-folder",
          message: `mission "${def.id}" has an output folder outside the allowed roots`,
          missionId: def.id,
        });
        outputFolder = def.defaultOutputFolder;
      }
    } else {
      outputFolder = def.defaultOutputFolder;
    }

    return {
      id: def.id,
      enabled,
      cron,
      timezone: schedulerConfig.timezone,
      outputFolder,
      definition: def,
      diagnostics: planDiagnostics,
    };
  });

  return { plans, diagnostics };
}
