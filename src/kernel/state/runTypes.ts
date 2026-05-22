// Run-ledger types (v8 §5.6). The persisted shape of a "run" — any unit of
// tracked work: a scheduled mission, a manual mission, and (later milestones)
// capability invocations, connector tests, orchestration phases.
//
// These mirror the migration-v1 columns in migrations.ts. The row<->record
// mapper that bridges snake_case columns and camelCase fields lives in
// runLedger.ts (M3 PR2). M3 persists this subset of v8's RunRecord; claim /
// heartbeat / round / joinPolicy columns arrive with their own milestones.

export type RunId = string;

/**
 * Full v8 status enum. M3 *produces* only queued / running / succeeded /
 * failed / cancelled / interrupted-by-restart; waiting-* and blocked are
 * carried so later milestones need no type change (their producers — the
 * approval queue, the M4a claim sweep — enable them).
 */
export type RunStatus =
  | "queued"
  | "running"
  | "waiting-approval"
  | "waiting-clarification"
  | "blocked"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted-by-restart";

/**
 * Locked to the v8 union — `kind` is a long-lived query / filter / index
 * field, so it is not discretionary. M3's scheduler producer uses
 * "scheduled-mission" for cron fires and "manual-mission" for manual triggers.
 */
export type RunKind =
  | "scheduled-mission"
  | "manual-mission"
  | "capability-invoke"
  | "connector-test"
  | "external-work-bridge"
  | "orchestration-phase"
  | "artifact-generate"
  | "approval-action"
  | "user-action";

export type RunTrigger =
  | "manual"
  | "scheduled"
  | "replay"
  | "orchestrator"
  | "connector"
  | "approval";

export type RunCancelledBy =
  | "user"
  | "parent-run"
  | "timeout"
  | "stale-claim"
  | "system";

export type RunOnRestart = "resume" | "mark-interrupted" | "cancel";

export const TERMINAL_RUN_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>([
  "succeeded",
  "failed",
  "cancelled",
  "interrupted-by-restart",
]);

export function isTerminalStatus(status: RunStatus): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}

export interface RunRecord {
  id: RunId;
  kind: RunKind;
  featureId: string;
  parentRunId: string | null;
  correlationId: string | null;
  trigger: RunTrigger;
  status: RunStatus;
  currentStep: string | null;
  totalSteps: number | null;
  completedSteps: number | null;
  capabilityId: string | null;
  connectorId: string | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  updatedAt: string;
  durationMs: number | null;
  inputHash: string | null;
  /**
   * Audit-grade, operator-visible text. NEVER raw prompts, raw options,
   * filesystem paths, secrets, provider stderr, raw config, or private note
   * content — mission ids, triggers, counts, hashes, and short neutral labels
   * only. Binds every producer that writes the field.
   */
  inputSummary: string | null;
  errorCode: string | null;
  cancelledBy: RunCancelledBy | null;
  onRestart: RunOnRestart;
  // Per-run budget slots (v8). Persisted in M3; runtime enforcement is later.
  maxIterations: number | null;
  maxDurationMs: number | null;
  maxToolCalls: number | null;
  maxCostUsd: number | null;
}

export type RunStepKind =
  | "capability.invoke"
  | "mission.run"
  | "artifact.write"
  | "approval.wait"
  | "agent.proposal"
  | "agent.critique"
  | "decision.resolve"
  | "external.task.create"
  | "external.task.observe";

export interface RunStepRecord {
  id: string;
  runId: RunId;
  /** Step order within the run (the `idx` column). */
  index: number;
  kind: RunStepKind;
  status: RunStatus;
  startedAt: string | null;
  endedAt: string | null;
  capabilityId: string | null;
  connectorId: string | null;
  agentId: string | null;
  errorCode: string | null;
}

/**
 * A reference from a run to a record in an external system reached through a
 * connector (e.g. a Hermes task or run id). v8-shaped — the DB columns stay
 * snake_case (external_refs.ref_kind / .ref_id); the runLedger mapper bridges
 * `kind`<->ref_kind and `id`<->ref_id.
 */
export interface ExternalRef {
  /** Connector / system id, e.g. "hermes". */
  system: string;
  /** task | thread | run | ... */
  kind: string;
  /** Opaque external id. */
  id: string;
  scope?: string;
}
