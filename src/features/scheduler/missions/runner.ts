// Mission runner (Phase 1C — M4).
//
// The central runner ADR-0011 describes: a mission RETURNS
// MissionOutput objects; this runner is the only thing that persists
// them. It resolves the effective plan for a mission, strict-parses
// the caller's options through the mission's OWN optionsSchema, builds
// a MissionContext, invokes mission.run(), enforces the mission's
// declared permissions BEFORE any side effect, then writes vault-note
// outputs through the constrained writer and emits event outputs
// through a permission-gated bus adapter.
//
// Every failure path returns a NEUTRAL RunnerResult: an errorClass and
// a generic message only — never a raw path, a secret, a stack, the
// caller's raw options, or echoed input.
//
// M4 has NO cron / scheduler runtime: runMission is invoked manually
// (the /api/missions/[id]/run route). Scheduled firing is a later
// milestone.

import { randomUUID } from "node:crypto";
import type {
  MissionContext,
  MissionEventBus,
  MissionLogger,
  MissionPermission,
  MissionRunResult,
  MissionTrigger,
  MissionVaultReader,
} from "./types";
import { missionRegistry, type MissionRegistry } from "./registry";
import { resolveEffectiveMissionPlans } from "./effectivePlan";
import { ensureBuiltinMissions } from "./builtin";
import { loadConfig } from "@/kernel/config";
import type { AppConfig } from "@/kernel/schemas/appConfig";
import { createCapabilityRouter } from "@/kernel/capabilities/router";
import type {
  CapabilityId,
  CapabilityInvokeResult,
  CapabilityRouter,
} from "@/kernel/capabilities/types";
import { connectorRegistry } from "@/kernel/connectors/registry";
import { bus } from "@/kernel/bus";
import { auditMissionRun } from "@/kernel/audit";
import { getRunLedger, type RunLedger } from "@/kernel/state/runLedger";
import {
  writeMissionNote,
  ConstrainedWriteError,
} from "@/vault/constrainedWriter";

export type RunnerErrorClass =
  | "mission-unknown"
  | "mission-not-manual"
  | "mission-options-invalid"
  | "mission-threw"
  | "mission-reported-failure"
  | "mission-permission-denied"
  | "mission-output-write-failed"
  | "config-error"
  | "internal-error";

export interface RunnerOutputRef {
  kind: "vault-note" | "event";
  /** vault-note: path relative to the vault root. */
  path?: string;
  /** event: the emitted event kind. */
  eventKind?: string;
}

export type RunnerResult =
  | {
      status: "success" | "skipped";
      runId: string;
      missionId: string;
      message?: string;
      outputs: RunnerOutputRef[];
    }
  | {
      status: "failed";
      runId: string;
      missionId: string;
      errorClass: RunnerErrorClass;
      message: string;
    };

export interface RunMissionInput {
  missionId: string;
  trigger: MissionTrigger;
  rawOptions: unknown;
}

/** Test seam — production callers pass nothing and get the globals. */
export interface RunMissionOverrides {
  registry?: MissionRegistry;
  config?: AppConfig;
  /**
   * Run-ledger override (test seam). Production passes no overrides at all
   * and gets the real ledger. A test that passes an overrides object opts
   * INTO ledger mirroring only by setting this explicitly — otherwise the
   * runner skips the ledger, so tests never touch the real
   * ~/.agentic-os/state.db.
   */
  ledger?: RunLedger | null;
}

/** Read-only vault access. M4 missions never read the vault — a real
 *  reader is a later milestone (reviewer decision Q2). */
const stubVaultReader: MissionVaultReader = {
  async readNote(): Promise<string | null> {
    return null;
  },
};

/** A no-op logger. M4 plumbs the context; real logging is later. */
const noopLogger: MissionLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Permission-gated bus adapter (reviewer decision Q4). A mission may
 * emit DURING run() only if it declared "event-emit"; otherwise emit
 * throws — the runner's try/catch turns that into a neutral failure.
 * The mission-supplied `source` is ignored; events are attributed to
 * the scheduler.
 */
function buildBusAdapter(permissions: MissionPermission[]): MissionEventBus {
  const canEmit = permissions.includes("event-emit");
  return {
    emit(input) {
      if (!canEmit) {
        throw new Error("event emitted without the event-emit permission");
      }
      bus.emit({ source: "scheduler", kind: input.kind, payload: input.payload });
    },
  };
}

/**
 * Permission-gated capability router. A mission may invoke a
 * capability during run() only if it declared "external-api". A
 * mission without that permission gets a router whose invoke()
 * returns a neutral failed result and never reaches a connector.
 */
function buildCapsAdapter(
  permissions: MissionPermission[],
  real: CapabilityRouter,
): CapabilityRouter {
  if (permissions.includes("external-api")) return real;
  return {
    invoke: async <T = unknown>(
      capability: CapabilityId,
    ): Promise<CapabilityInvokeResult<T>> => ({
      status: "failed",
      capability,
      errorCode: "permission-denied",
      message: "mission lacks the external-api permission",
    }),
    list: real.list,
    has: real.has,
  };
}

/**
 * Resolve the run ledger without ever breaking a mission run. The audit JSONL
 * line is the source-of-truth record; the ledger is a queryable mirror, so a
 * failure to open it is logged and swallowed.
 */
async function resolveLedger(): Promise<RunLedger | null> {
  try {
    return await getRunLedger();
  } catch (err) {
    console.error("[run-ledger] unavailable; mission run not mirrored:", err);
    return null;
  }
}

/** Run a ledger write, swallowing+logging failure so it cannot break the run. */
function ledgerWrite(action: () => void): void {
  try {
    action();
  } catch (err) {
    console.error("[run-ledger] mission ledger write failed:", err);
  }
}

export async function runMission(
  input: RunMissionInput,
  overrides?: RunMissionOverrides,
): Promise<RunnerResult> {
  const runId = randomUUID();
  const startedAt = Date.now();
  const { missionId, trigger } = input;

  // M3: mirror the run into the SQLite run ledger. Production passes no
  // overrides and gets the real ledger; a test opts in via overrides.ledger,
  // otherwise the runner skips the ledger and never touches the real state DB.
  // A ledger failure never breaks the run — the audit JSONL line stays the
  // source-of-truth record (every ledger write goes through ledgerWrite()).
  const ledger: RunLedger | null = overrides
    ? overrides.ledger ?? null
    : await resolveLedger();
  ledgerWrite(() =>
    ledger?.createRun({
      id: runId,
      kind: trigger === "scheduled" ? "scheduled-mission" : "manual-mission",
      featureId: "scheduler",
      trigger,
      status: "running",
      onRestart: "mark-interrupted",
      inputSummary: `mission ${missionId} · ${trigger}`,
    }),
  );

  // Production path uses the global registry — make sure the built-in
  // missions are registered into it before the lookup.
  if (!overrides?.registry) {
    ensureBuiltinMissions();
  }
  const registry = overrides?.registry ?? missionRegistry;

  const fail = async (
    errorClass: RunnerErrorClass,
    message: string,
  ): Promise<RunnerResult> => {
    await auditMissionRun({
      missionId,
      runId,
      trigger,
      status: "failed",
      durationMs: Date.now() - startedAt,
      outputsPersisted: 0,
      outputsEmitted: 0,
      errorClass,
    });
    ledgerWrite(() =>
      ledger?.transitionRun(runId, "failed", { errorCode: errorClass }),
    );
    return { status: "failed", runId, missionId, errorClass, message };
  };

  // Mission must be registered.
  const definition = registry.get(missionId);
  if (!definition) {
    return fail("mission-unknown", "no such mission");
  }

  // Load config + resolve the effective plan.
  let config: AppConfig;
  try {
    config = overrides?.config ?? (await loadConfig());
  } catch {
    return fail("config-error", "could not load configuration");
  }

  const { plans } = resolveEffectiveMissionPlans(
    registry.list(),
    config.features.scheduler,
  );
  const plan = plans.find((p) => p.id === missionId);
  if (!plan) {
    return fail("internal-error", "mission plan could not be resolved");
  }

  // A manual trigger requires manualRunnable. `enabled` governs
  // scheduled firing only, NOT manual runs (reviewer decision Q3).
  if (trigger === "manual" && !definition.manualRunnable) {
    return fail("mission-not-manual", "mission is not manually runnable");
  }

  // Strict option parsing through the mission's OWN schema.
  const parsed = definition.optionsSchema.safeParse(input.rawOptions ?? {});
  if (!parsed.success) {
    return fail("mission-options-invalid", "invalid mission options");
  }

  // Build the MissionContext.
  const ctx: MissionContext = {
    missionId,
    runId,
    now: new Date(),
    timezone: plan.timezone,
    trigger,
    options: parsed.data,
    config,
    caps: buildCapsAdapter(
      definition.permissions,
      createCapabilityRouter(connectorRegistry, config.connectors),
    ),
    vault: stubVaultReader,
    bus: buildBusAdapter(definition.permissions),
    log: noopLogger,
    signal: new AbortController().signal,
  };

  // Invoke the mission.
  let result: MissionRunResult;
  try {
    result = await definition.run(ctx);
  } catch {
    return fail("mission-threw", "mission run failed");
  }

  if (result.status === "skipped") {
    await auditMissionRun({
      missionId,
      runId,
      trigger,
      status: "skipped",
      durationMs: Date.now() - startedAt,
      outputsPersisted: 0,
      outputsEmitted: 0,
    });
    // A skip is not a failure: the run succeeds, with currentStep "skipped"
    // marking it — never an errorCode (reserved for real failures).
    ledgerWrite(() =>
      ledger?.transitionRun(runId, "succeeded", { currentStep: "skipped" }),
    );
    // result.reason is mission-controlled text — it could carry a
    // private path or secret-like value, so it is NOT echoed. A
    // generic neutral message is returned instead.
    return {
      status: "skipped",
      runId,
      missionId,
      message: "mission run skipped",
      outputs: [],
    };
  }
  if (result.status === "failed") {
    return fail("mission-reported-failure", "mission reported a failure");
  }

  const outputs = result.outputs ?? [];

  // Permission enforcement — fail-closed, BEFORE any side effect. A
  // single output the mission lacks permission for fails the whole
  // run; nothing is persisted or emitted.
  for (const out of outputs) {
    const needed: MissionPermission =
      out.kind === "vault-note" ? "vault-write" : "event-emit";
    if (!definition.permissions.includes(needed)) {
      return fail(
        "mission-permission-denied",
        "mission produced an output it lacks permission for",
      );
    }
  }

  // Persist vault-note outputs (constrained writer only) and emit
  // event outputs (bus only).
  const refs: RunnerOutputRef[] = [];
  let persisted = 0;
  let emitted = 0;
  try {
    for (const out of outputs) {
      if (out.kind === "vault-note") {
        const written = await writeMissionNote({
          vaultRoot: config.vault.root,
          missionId,
          outputFolder: out.outputFolder,
          filenameHint: out.filenameHint,
          frontmatter: out.frontmatter,
          content: out.content,
          conflictPolicy: out.conflictPolicy,
        });
        refs.push({ kind: "vault-note", path: written.relativePath });
        persisted++;
      } else {
        bus.emit({
          source: "scheduler",
          kind: out.eventKind,
          payload: out.payload,
        });
        refs.push({ kind: "event", eventKind: out.eventKind });
        emitted++;
      }
    }
  } catch (e) {
    const errorClass: RunnerErrorClass =
      e instanceof ConstrainedWriteError
        ? "mission-output-write-failed"
        : "internal-error";
    // A later output failed after earlier ones already took effect —
    // audit the ACTUAL persisted/emitted counts, not zero, so the
    // audit log is not misleading. The response stays neutral.
    await auditMissionRun({
      missionId,
      runId,
      trigger,
      status: "failed",
      durationMs: Date.now() - startedAt,
      outputsPersisted: persisted,
      outputsEmitted: emitted,
      errorClass,
    });
    ledgerWrite(() =>
      ledger?.transitionRun(runId, "failed", { errorCode: errorClass }),
    );
    return {
      status: "failed",
      runId,
      missionId,
      errorClass,
      message: "mission output could not be persisted",
    };
  }

  await auditMissionRun({
    missionId,
    runId,
    trigger,
    status: "success",
    durationMs: Date.now() - startedAt,
    outputsPersisted: persisted,
    outputsEmitted: emitted,
  });

  ledgerWrite(() => ledger?.transitionRun(runId, "succeeded"));

  // result.message is mission-controlled text — keep success responses
  // neutral for the same reason skipped reasons are neutralized.
  return {
    status: "success",
    runId,
    missionId,
    message: "mission run completed",
    outputs: refs,
  };
}
