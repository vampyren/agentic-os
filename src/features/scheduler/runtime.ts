// Mission scheduler runtime (Phase 1C — scheduled firing).
//
// This is the automatic counterpart to the M4 manual mission runner. It
// resolves the same EffectiveMissionPlan objects, schedules only enabled
// plans when `features.scheduler.enabled` is true, and fires every tick
// through runMission({ trigger: "scheduled" }) so audit logging,
// permission gating, constrained vault writes, and neutral errors stay
// centralized in the runner.

import nodeCron, { type ScheduledTask, type TaskOptions } from "node-cron";
import { ensureBuiltinMissions } from "./missions/builtin";
import { missionRegistry, type MissionRegistry } from "./missions/registry";
import { resolveEffectiveMissionPlans } from "./missions/effectivePlan";
import type { ConfigDiagnostic } from "./missions/types";
import {
  runMission as defaultRunMission,
  type RunMissionInput,
  type RunnerResult,
} from "./missions/runner";
import { loadConfig } from "@/kernel/config";
import type { AppConfig } from "@/kernel/schemas/appConfig";
import { bus } from "@/kernel/bus";

export type SchedulerRuntimeStatus = "idle" | "disabled" | "running" | "stopped";

type ScheduledTaskHandle = Pick<ScheduledTask, "destroy" | "stop">;

export interface CronAdapter {
  validate(expression: string): boolean;
  schedule(
    expression: string,
    task: () => void | Promise<void>,
    options?: TaskOptions,
  ): ScheduledTaskHandle;
}

export interface ScheduledMissionRef {
  missionId: string;
  cron: string;
  timezone: string;
}

export interface SchedulerRuntimeSnapshot {
  status: SchedulerRuntimeStatus;
  scheduled: ScheduledMissionRef[];
  diagnostics: ConfigDiagnostic[];
}

export interface CreateMissionSchedulerOptions {
  config?: AppConfig;
  registry?: MissionRegistry;
  cron?: CronAdapter;
  runMission?: (input: RunMissionInput) => Promise<RunnerResult>;
}

export interface MissionSchedulerRuntime {
  start(): Promise<SchedulerRuntimeSnapshot>;
  stop(): void;
  getSnapshot(): SchedulerRuntimeSnapshot;
}

const nodeCronAdapter: CronAdapter = {
  validate: (expression) => nodeCron.validate(expression),
  schedule: (expression, task, options) => nodeCron.schedule(expression, task, options),
};

function cloneSnapshot(snapshot: SchedulerRuntimeSnapshot): SchedulerRuntimeSnapshot {
  return {
    status: snapshot.status,
    scheduled: snapshot.scheduled.map((s) => ({ ...s })),
    diagnostics: snapshot.diagnostics.map((d) => ({ ...d })),
  };
}

function diagnostic(
  code: string,
  message: string,
  missionId?: string,
): ConfigDiagnostic {
  return { severity: "warn", code, message, missionId };
}

function emitSchedulerEvent(kind: string, payload: Record<string, unknown>): void {
  try {
    bus.emit({ source: "scheduler", kind, payload });
  } catch {
    // The scheduler must never crash because a listener failed.
  }
}

export function createMissionScheduler(
  options: CreateMissionSchedulerOptions = {},
): MissionSchedulerRuntime {
  const cron = options.cron ?? nodeCronAdapter;
  const runMission = options.runMission ?? defaultRunMission;
  const tasks: ScheduledTaskHandle[] = [];
  let snapshot: SchedulerRuntimeSnapshot = {
    status: "idle",
    scheduled: [],
    diagnostics: [],
  };

  async function start(): Promise<SchedulerRuntimeSnapshot> {
    if (snapshot.status === "running") return cloneSnapshot(snapshot);

    if (!options.registry) ensureBuiltinMissions();
    const registry = options.registry ?? missionRegistry;

    snapshot = { status: "idle", scheduled: [], diagnostics: [] };

    let config: AppConfig;
    try {
      config = options.config ?? (await loadConfig());
    } catch {
      snapshot.status = "disabled";
      snapshot.diagnostics.push(
        diagnostic("config-load-failed", "scheduler disabled because config could not be loaded"),
      );
      emitSchedulerEvent("scheduler.disabled", { reason: "config-load-failed" });
      return cloneSnapshot(snapshot);
    }

    const schedulerConfig = config.features.scheduler;

    if (!schedulerConfig.enabled) {
      snapshot.status = "disabled";
      emitSchedulerEvent("scheduler.disabled", { reason: "feature-disabled" });
      return cloneSnapshot(snapshot);
    }

    const { plans, diagnostics } = resolveEffectiveMissionPlans(
      registry.list(),
      schedulerConfig,
    );
    snapshot.diagnostics.push(...diagnostics);

    for (const plan of plans) {
      snapshot.diagnostics.push(...plan.diagnostics);
      if (!plan.enabled) continue;

      if (plan.diagnostics.some((d) => d.severity === "error")) {
        snapshot.diagnostics.push(
          diagnostic("plan-invalid", "enabled mission plan has errors", plan.id),
        );
        continue;
      }

      if (!plan.cron) {
        snapshot.diagnostics.push(
          diagnostic("missing-cron", "enabled mission has no cron expression", plan.id),
        );
        continue;
      }

      if (!cron.validate(plan.cron)) {
        snapshot.diagnostics.push(
          diagnostic("invalid-cron", "cron expression rejected by scheduler", plan.id),
        );
        continue;
      }

      const handle = cron.schedule(
        plan.cron,
        async () => {
          emitSchedulerEvent("scheduler.mission.started", { missionId: plan.id });
          try {
            const result = await runMission({
              missionId: plan.id,
              trigger: "scheduled",
              rawOptions: {},
            });
            emitSchedulerEvent("scheduler.mission.completed", {
              missionId: plan.id,
              status: result.status,
            });
          } catch {
            emitSchedulerEvent("scheduler.mission.completed", {
              missionId: plan.id,
              status: "failed",
              errorClass: "internal-error",
            });
          }
        },
        {
          timezone: plan.timezone,
          name: `agentic-os:${plan.id}`,
          noOverlap: true,
        },
      );

      tasks.push(handle);
      snapshot.scheduled.push({
        missionId: plan.id,
        cron: plan.cron,
        timezone: plan.timezone,
      });
    }

    snapshot.status = "running";
    emitSchedulerEvent("scheduler.started", {
      scheduledCount: snapshot.scheduled.length,
      diagnosticCount: snapshot.diagnostics.length,
    });
    return cloneSnapshot(snapshot);
  }

  function stop(): void {
    for (const task of tasks.splice(0)) {
      try {
        task.destroy();
      } catch {
        try {
          task.stop();
        } catch {
          // Keep shutdown best-effort and neutral.
        }
      }
    }
    snapshot = { ...snapshot, status: "stopped", scheduled: [] };
    emitSchedulerEvent("scheduler.stopped", {});
  }

  return {
    start,
    stop,
    getSnapshot: () => cloneSnapshot(snapshot),
  };
}

const GLOBAL_SCHEDULER_KEY = Symbol.for("agentic-os.mission-scheduler");

type GlobalSchedulerState = {
  scheduler: MissionSchedulerRuntime | null;
};

function globalSchedulerState(): GlobalSchedulerState {
  const globalObject = globalThis as typeof globalThis & {
    [GLOBAL_SCHEDULER_KEY]?: GlobalSchedulerState;
  };

  globalObject[GLOBAL_SCHEDULER_KEY] ??= { scheduler: null };
  return globalObject[GLOBAL_SCHEDULER_KEY];
}

export async function startGlobalMissionScheduler(): Promise<SchedulerRuntimeSnapshot> {
  const state = globalSchedulerState();
  state.scheduler ??= createMissionScheduler();
  return state.scheduler.start();
}

export function stopGlobalMissionScheduler(): void {
  const state = globalSchedulerState();
  state.scheduler?.stop();
  state.scheduler = null;
}

export function getGlobalMissionSchedulerSnapshot(): SchedulerRuntimeSnapshot {
  const scheduler = globalSchedulerState().scheduler;
  return scheduler?.getSnapshot() ?? {
    status: "idle",
    scheduled: [],
    diagnostics: [],
  };
}
