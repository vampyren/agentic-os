// Mission type system (Phase 1C — M3).
//
// A mission is a unit of scheduled or manually-triggered work. Missions
// RETURN output objects (a discriminated MissionOutput union); they
// never touch the filesystem themselves — a central runner (M4) writes
// vault notes through the constrained writer and emits events. M3
// defines the types + registers stub missions; nothing runs them yet.
//
// MissionDefinition / MissionContext are intentionally NON-generic for
// M3: `optionsSchema` is a `z.ZodTypeAny` and `options` is `unknown`.
// The stubs declare `z.object({}).strict()` and ignore options. Typed
// per-mission options can arrive when the M4 manual-run API needs them.

import type { z } from "zod";
import type { CapabilityRouter } from "@/kernel/capabilities/types";
import type { AppConfig } from "@/kernel/schemas/appConfig";
import type { VaultRelativePath } from "@/lib/vaultPaths";

/** Side effects a mission declares up front (declarative; runner checks). */
export type MissionPermission =
  | "vault-write"
  | "event-emit"
  | "vault-read"
  | "external-api";

export type MissionConcurrency = "single" | "queue" | "skip";
export type MissionTrigger = "scheduled" | "manual" | "replay";
export type MissionOutputKind = "summary" | "review" | "heartbeat" | "custom";

/** Minimal logger handed to a mission. Real impl wired by M4's runner. */
export interface MissionLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/** Read-only vault access (design §7: a mission's vault access is READ ONLY). */
export interface MissionVaultReader {
  readNote(relPath: string): Promise<string | null>;
}

/** Minimal event-bus surface exposed to a mission. */
export interface MissionEventBus {
  emit(input: { source: string; kind: string; payload?: unknown }): void;
}

/** Everything a mission's run() receives. M3 stubs use only a subset. */
export interface MissionContext {
  readonly missionId: string;
  readonly runId: string;
  readonly now: Date;
  readonly timezone: string;
  readonly trigger: MissionTrigger;
  readonly options: unknown;
  readonly config: Readonly<AppConfig>;
  readonly caps: CapabilityRouter;
  readonly vault: MissionVaultReader;
  readonly bus: MissionEventBus;
  readonly log: MissionLogger;
  readonly signal: AbortSignal;
}

/**
 * What a mission produces. The runner persists these — a `vault-note`
 * is written through the constrained writer; an `event` is emitted on
 * the bus. Missions never write files directly.
 */
export type MissionOutput =
  | {
      kind: "vault-note";
      outputFolder: VaultRelativePath;
      filenameHint: string;
      frontmatter?: Record<string, unknown>;
      content: string;
      /** Default "suffix" (timestamp/-N) — see design §3.5. */
      conflictPolicy?: "fail" | "overwrite" | "suffix";
    }
  | {
      kind: "event";
      eventKind: string;
      payload: Record<string, unknown>;
    };

/** Discriminated result of a mission run. */
export type MissionRunResult =
  | {
      status: "success";
      message?: string;
      outputs?: MissionOutput[];
      metadata?: Record<string, unknown>;
    }
  | { status: "skipped"; reason: string; metadata?: Record<string, unknown> }
  | {
      status: "failed";
      errorCode: string;
      message: string;
      metadata?: Record<string, unknown>;
    };

/** A registered mission. Registered explicitly in code, not discovered. */
export interface MissionDefinition {
  id: string;
  title: string;
  description: string;

  // Scheduling
  defaultCron?: string;
  enabledByDefault: boolean;
  manualRunnable: boolean;
  concurrency: MissionConcurrency;

  // Output contract
  outputKind: MissionOutputKind;
  defaultOutputFolder?: VaultRelativePath;

  // Validation — REQUIRED; stubs use z.object({}).strict().
  optionsSchema: z.ZodTypeAny;

  // Declared side effects (declarative; the runner checks them later).
  permissions: MissionPermission[];

  run(ctx: MissionContext): Promise<MissionRunResult>;
}

/** A config / resolution anomaly, explaining why a plan is off. */
export interface ConfigDiagnostic {
  severity: "warn" | "error";
  code: string;
  message: string;
  missionId?: string;
}

/** What the scheduler would actually do for one mission. */
export interface EffectiveMissionPlan {
  id: string;
  enabled: boolean;
  cron?: string;
  timezone: string;
  outputFolder?: VaultRelativePath;
  definition: MissionDefinition;
  /** Per-mission resolution anomalies (empty when the plan is clean). */
  diagnostics: ConfigDiagnostic[];
}
