// RunLedger — the service over the run-ledger tables (runs / run_steps /
// external_refs) in the SQLite state DB. The single API surface for run
// lifecycle: create, progress, transition, cancel (with cascade), steps, and
// external references. Pure data logic — no HTTP, no React.
//
// Audit stays JSONL (src/kernel/audit.ts); the ledger is the queryable mirror,
// joined to the audit log only by runId.

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type DatabaseType from "better-sqlite3";
import { getStateDb } from "./db";
import {
  isTerminalStatus,
  type ExternalRef,
  type RunCancelledBy,
  type RunId,
  type RunKind,
  type RunOnRestart,
  type RunRecord,
  type RunStatus,
  type RunStepKind,
  type RunStepRecord,
  type RunTrigger,
} from "./runTypes";

type Db = DatabaseType.Database;

// ── Errors ────────────────────────────────────────────────────────────────

export type RunLedgerErrorCode =
  | "not-found"
  | "terminal"
  | "invalid-transition";

/** A typed ledger violation. PR3's API maps `code` to an HTTP status. */
export class RunLedgerError extends Error {
  readonly code: RunLedgerErrorCode;
  constructor(code: RunLedgerErrorCode, message: string) {
    super(message);
    this.name = "RunLedgerError";
    this.code = code;
  }
}

// ── Inputs ────────────────────────────────────────────────────────────────

export interface CreateRunInput {
  id?: RunId;
  kind: RunKind;
  featureId: string;
  trigger: RunTrigger;
  onRestart: RunOnRestart;
  /** A new run starts queued or running — never terminal/waiting. */
  status?: Extract<RunStatus, "queued" | "running">;
  parentRunId?: string | null;
  correlationId?: string | null;
  currentStep?: string | null;
  totalSteps?: number | null;
  completedSteps?: number | null;
  capabilityId?: string | null;
  connectorId?: string | null;
  inputHash?: string | null;
  inputSummary?: string | null;
  maxIterations?: number | null;
  maxDurationMs?: number | null;
  maxToolCalls?: number | null;
  maxCostUsd?: number | null;
}

export interface TransitionPatch {
  errorCode?: string | null;
  cancelledBy?: RunCancelledBy | null;
  currentStep?: string | null;
  completedSteps?: number | null;
  totalSteps?: number | null;
}

export interface ProgressPatch {
  currentStep?: string | null;
  completedSteps?: number | null;
  totalSteps?: number | null;
}

export interface ListRunsFilter {
  status?: RunStatus;
  kind?: RunKind;
  featureId?: string;
  /** Default 50, hard cap 200. */
  limit?: number;
}

export interface AppendStepInput {
  kind: RunStepKind;
  status?: Extract<RunStatus, "queued" | "running">;
  capabilityId?: string | null;
  connectorId?: string | null;
  agentId?: string | null;
}

export interface RunChangedEvent {
  runId: RunId;
  status: RunStatus;
}

// ── Transition rules (M3 — spec §9) ───────────────────────────────────────
// M3 produces only queued / running / succeeded / failed / cancelled /
// interrupted-by-restart. waiting-* and blocked are not reached; their only
// allowed exit is interrupted-by-restart so the boot sweep can still clean a
// run a later milestone might leave behind.

const ALLOWED_TRANSITIONS: Record<RunStatus, ReadonlySet<RunStatus>> = {
  queued: new Set<RunStatus>(["running", "cancelled", "interrupted-by-restart"]),
  running: new Set<RunStatus>([
    "succeeded",
    "failed",
    "cancelled",
    "interrupted-by-restart",
  ]),
  "waiting-approval": new Set<RunStatus>(["interrupted-by-restart"]),
  "waiting-clarification": new Set<RunStatus>(["interrupted-by-restart"]),
  blocked: new Set<RunStatus>(["interrupted-by-restart"]),
  succeeded: new Set<RunStatus>(),
  failed: new Set<RunStatus>(),
  cancelled: new Set<RunStatus>(),
  "interrupted-by-restart": new Set<RunStatus>(),
};

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

// ── Row shapes & mappers ──────────────────────────────────────────────────

interface RunRow {
  id: string;
  kind: string;
  feature_id: string;
  parent_run_id: string | null;
  correlation_id: string | null;
  trigger: string;
  status: string;
  current_step: string | null;
  total_steps: number | null;
  completed_steps: number | null;
  capability_id: string | null;
  connector_id: string | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  updated_at: string;
  duration_ms: number | null;
  input_hash: string | null;
  input_summary: string | null;
  error_code: string | null;
  cancelled_by: string | null;
  on_restart: string;
  max_iterations: number | null;
  max_duration_ms: number | null;
  max_tool_calls: number | null;
  max_cost_usd: number | null;
}

interface RunStepRow {
  id: string;
  run_id: string;
  idx: number;
  kind: string;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  capability_id: string | null;
  connector_id: string | null;
  agent_id: string | null;
  error_code: string | null;
}

interface ExternalRefRow {
  system: string;
  ref_kind: string;
  ref_id: string;
  scope: string | null;
}

function rowToRun(r: RunRow): RunRecord {
  return {
    id: r.id,
    kind: r.kind as RunKind,
    featureId: r.feature_id,
    parentRunId: r.parent_run_id,
    correlationId: r.correlation_id,
    trigger: r.trigger as RunTrigger,
    status: r.status as RunStatus,
    currentStep: r.current_step,
    totalSteps: r.total_steps,
    completedSteps: r.completed_steps,
    capabilityId: r.capability_id,
    connectorId: r.connector_id,
    createdAt: r.created_at,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    updatedAt: r.updated_at,
    durationMs: r.duration_ms,
    inputHash: r.input_hash,
    inputSummary: r.input_summary,
    errorCode: r.error_code,
    cancelledBy: r.cancelled_by as RunCancelledBy | null,
    onRestart: r.on_restart as RunOnRestart,
    maxIterations: r.max_iterations,
    maxDurationMs: r.max_duration_ms,
    maxToolCalls: r.max_tool_calls,
    maxCostUsd: r.max_cost_usd,
  };
}

function rowToStep(r: RunStepRow): RunStepRecord {
  return {
    id: r.id,
    runId: r.run_id,
    index: r.idx,
    kind: r.kind as RunStepKind,
    status: r.status as RunStatus,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    capabilityId: r.capability_id,
    connectorId: r.connector_id,
    agentId: r.agent_id,
    errorCode: r.error_code,
  };
}

function durationMs(startIso: string, endIso: string): number {
  return Math.max(0, Date.parse(endIso) - Date.parse(startIso));
}

// ── RunLedger ─────────────────────────────────────────────────────────────

export class RunLedger {
  private readonly db: Db;
  private readonly events = new EventEmitter();

  /** Pass an injected Database in tests; production uses `getRunLedger()`. */
  constructor(db: Db) {
    this.db = db;
    this.events.setMaxListeners(50);
  }

  /**
   * Subscribe to in-process run-change events — emitted after every
   * successful create / transition / cancel. Returns an unsubscribe fn.
   */
  onRunChanged(listener: (e: RunChangedEvent) => void): () => void {
    this.events.on("run.changed", listener);
    return () => this.events.off("run.changed", listener);
  }

  private emitChanged(runId: RunId, status: RunStatus): void {
    this.events.emit("run.changed", { runId, status } satisfies RunChangedEvent);
  }

  // ── Runs ────────────────────────────────────────────────────────────────

  createRun(input: CreateRunInput): RunRecord {
    const id = input.id ?? randomUUID();
    const now = new Date().toISOString();
    const status: RunStatus = input.status ?? "running";
    // §9 / review edit 5: a run created already running starts its clock now;
    // a queued run has no startedAt until the queued -> running transition.
    const startedAt = status === "running" ? now : null;

    this.db
      .prepare(
        `INSERT INTO runs (
          id, kind, feature_id, parent_run_id, correlation_id, trigger,
          status, current_step, total_steps, completed_steps, capability_id,
          connector_id, created_at, started_at, ended_at, updated_at,
          duration_ms, input_hash, input_summary, error_code, cancelled_by,
          on_restart, max_iterations, max_duration_ms, max_tool_calls,
          max_cost_usd
        ) VALUES (
          @id, @kind, @featureId, @parentRunId, @correlationId, @trigger,
          @status, @currentStep, @totalSteps, @completedSteps, @capabilityId,
          @connectorId, @createdAt, @startedAt, NULL, @updatedAt,
          NULL, @inputHash, @inputSummary, NULL, NULL,
          @onRestart, @maxIterations, @maxDurationMs, @maxToolCalls,
          @maxCostUsd
        )`,
      )
      .run({
        id,
        kind: input.kind,
        featureId: input.featureId,
        parentRunId: input.parentRunId ?? null,
        correlationId: input.correlationId ?? null,
        trigger: input.trigger,
        status,
        currentStep: input.currentStep ?? null,
        totalSteps: input.totalSteps ?? null,
        completedSteps: input.completedSteps ?? null,
        capabilityId: input.capabilityId ?? null,
        connectorId: input.connectorId ?? null,
        createdAt: now,
        startedAt,
        updatedAt: now,
        inputHash: input.inputHash ?? null,
        inputSummary: input.inputSummary ?? null,
        onRestart: input.onRestart,
        maxIterations: input.maxIterations ?? null,
        maxDurationMs: input.maxDurationMs ?? null,
        maxToolCalls: input.maxToolCalls ?? null,
        maxCostUsd: input.maxCostUsd ?? null,
      });

    this.emitChanged(id, status);
    return this.requireRun(id);
  }

  getRun(id: RunId): RunRecord | null {
    const row = this.db
      .prepare<[string], RunRow>("SELECT * FROM runs WHERE id = ?")
      .get(id);
    return row ? rowToRun(row) : null;
  }

  listRuns(filter: ListRunsFilter = {}): RunRecord[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.status) { where.push("status = ?"); params.push(filter.status); }
    if (filter.kind) { where.push("kind = ?"); params.push(filter.kind); }
    if (filter.featureId) {
      where.push("feature_id = ?");
      params.push(filter.featureId);
    }
    const limit = Math.min(
      Math.max(1, filter.limit ?? DEFAULT_LIST_LIMIT),
      MAX_LIST_LIMIT,
    );
    const sql =
      "SELECT * FROM runs"
      + (where.length ? ` WHERE ${where.join(" AND ")}` : "")
      + " ORDER BY created_at DESC, rowid DESC LIMIT ?";
    return (this.db.prepare(sql).all(...params, limit) as RunRow[]).map(rowToRun);
  }

  /** Every non-terminal run, oldest-first. Used by the restart sweep. */
  listActiveRuns(): RunRecord[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM runs
             WHERE status NOT IN ('succeeded','failed','cancelled','interrupted-by-restart')
             ORDER BY created_at ASC, rowid ASC`,
        )
        .all() as RunRow[]
    ).map(rowToRun);
  }

  updateProgress(id: RunId, patch: ProgressPatch): RunRecord {
    const run = this.requireRun(id);
    if (isTerminalStatus(run.status)) {
      throw new RunLedgerError(
        "terminal",
        `run ${id} is ${run.status}; progress cannot be updated`,
      );
    }
    this.db
      .prepare(
        `UPDATE runs SET
           current_step = @currentStep,
           completed_steps = @completedSteps,
           total_steps = @totalSteps,
           updated_at = @updatedAt
         WHERE id = @id`,
      )
      .run({
        id,
        currentStep: patch.currentStep ?? run.currentStep,
        completedSteps: patch.completedSteps ?? run.completedSteps,
        totalSteps: patch.totalSteps ?? run.totalSteps,
        updatedAt: new Date().toISOString(),
      });
    return this.requireRun(id);
  }

  transitionRun(
    id: RunId,
    nextStatus: RunStatus,
    patch: TransitionPatch = {},
  ): RunRecord {
    const run = this.requireRun(id);
    this.assertTransition(run.status, nextStatus, id);

    const now = new Date().toISOString();
    const startedAt =
      run.startedAt ?? (nextStatus === "running" ? now : null);
    const terminal = isTerminalStatus(nextStatus);
    const endedAt = terminal ? now : run.endedAt;
    const duration = terminal
      ? durationMs(run.startedAt ?? run.createdAt, now)
      : run.durationMs;

    this.db
      .prepare(
        `UPDATE runs SET
           status = @status,
           started_at = @startedAt,
           ended_at = @endedAt,
           duration_ms = @durationMs,
           error_code = @errorCode,
           cancelled_by = @cancelledBy,
           current_step = @currentStep,
           completed_steps = @completedSteps,
           total_steps = @totalSteps,
           updated_at = @updatedAt
         WHERE id = @id`,
      )
      .run({
        id,
        status: nextStatus,
        startedAt,
        endedAt: endedAt ?? null,
        durationMs: duration ?? null,
        errorCode: patch.errorCode ?? run.errorCode,
        cancelledBy: patch.cancelledBy ?? run.cancelledBy,
        currentStep: patch.currentStep ?? run.currentStep,
        completedSteps: patch.completedSteps ?? run.completedSteps,
        totalSteps: patch.totalSteps ?? run.totalSteps,
        updatedAt: now,
      });

    this.emitChanged(id, nextStatus);
    return this.requireRun(id);
  }

  /**
   * Cancel a run and every non-terminal descendant (via parent_run_id), in a
   * single transaction. Already-terminal runs are left untouched.
   */
  cancelRun(id: RunId, by: RunCancelledBy): RunRecord {
    const root = this.requireRun(id);
    if (isTerminalStatus(root.status)) {
      throw new RunLedgerError(
        "terminal",
        `run ${id} is already ${root.status}; cannot cancel`,
      );
    }

    const now = new Date().toISOString();
    const childrenOf = this.db.prepare<[string], { id: string }>(
      `SELECT id FROM runs
         WHERE parent_run_id = ?
           AND status NOT IN ('succeeded','failed','cancelled','interrupted-by-restart')`,
    );
    const cancelOne = this.db.prepare(
      `UPDATE runs SET
         status = 'cancelled', cancelled_by = @by,
         ended_at = @now, updated_at = @now,
         duration_ms = CAST(
           (julianday(@now) - julianday(COALESCE(started_at, created_at))) * 86400000
           AS INTEGER)
       WHERE id = @id`,
    );

    const cancelled: RunId[] = [];
    const cascade = this.db.transaction(() => {
      const toVisit: RunId[] = [id];
      while (toVisit.length > 0) {
        const current = toVisit.pop()!;
        cancelOne.run({ id: current, by, now });
        cancelled.push(current);
        for (const child of childrenOf.all(current)) {
          toVisit.push(child.id);
        }
      }
    });
    cascade();

    for (const runId of cancelled) this.emitChanged(runId, "cancelled");
    return this.requireRun(id);
  }

  // ── Steps ───────────────────────────────────────────────────────────────

  appendStep(runId: RunId, input: AppendStepInput): RunStepRecord {
    this.requireRun(runId);
    const stepId = randomUUID();
    const status: RunStatus = input.status ?? "running";
    const now = new Date().toISOString();
    const nextIdx = this.db
      .prepare<[string], { idx: number }>(
        "SELECT COALESCE(MAX(idx), -1) + 1 AS idx FROM run_steps WHERE run_id = ?",
      )
      .get(runId)!.idx;

    this.db
      .prepare(
        `INSERT INTO run_steps (
           id, run_id, idx, kind, status, started_at, ended_at,
           capability_id, connector_id, agent_id, error_code
         ) VALUES (
           @id, @runId, @idx, @kind, @status, @startedAt, NULL,
           @capabilityId, @connectorId, @agentId, NULL)`,
      )
      .run({
        id: stepId,
        runId,
        idx: nextIdx,
        kind: input.kind,
        status,
        startedAt: status === "running" ? now : null,
        capabilityId: input.capabilityId ?? null,
        connectorId: input.connectorId ?? null,
        agentId: input.agentId ?? null,
      });

    return this.requireStep(stepId);
  }

  transitionStep(
    stepId: string,
    nextStatus: RunStatus,
    patch: { errorCode?: string | null } = {},
  ): RunStepRecord {
    const step = this.requireStep(stepId);
    this.assertTransition(step.status, nextStatus, stepId);
    const now = new Date().toISOString();

    this.db
      .prepare(
        `UPDATE run_steps SET
           status = @status,
           started_at = @startedAt,
           ended_at = @endedAt,
           error_code = @errorCode
         WHERE id = @id`,
      )
      .run({
        id: stepId,
        status: nextStatus,
        startedAt:
          step.startedAt ?? (nextStatus === "running" ? now : null),
        endedAt: isTerminalStatus(nextStatus) ? now : step.endedAt,
        errorCode: patch.errorCode ?? step.errorCode,
      });

    return this.requireStep(stepId);
  }

  listSteps(runId: RunId): RunStepRecord[] {
    return (
      this.db
        .prepare<[string], RunStepRow>(
          "SELECT * FROM run_steps WHERE run_id = ? ORDER BY idx ASC",
        )
        .all(runId)
    ).map(rowToStep);
  }

  // ── External refs ───────────────────────────────────────────────────────

  addExternalRef(runId: RunId, ref: ExternalRef): void {
    this.requireRun(runId);
    this.db
      .prepare(
        `INSERT INTO external_refs (run_id, system, ref_kind, ref_id, scope, created_at)
         VALUES (@runId, @system, @kind, @id, @scope, @createdAt)`,
      )
      .run({
        runId,
        system: ref.system,
        kind: ref.kind,
        id: ref.id,
        scope: ref.scope ?? null,
        createdAt: new Date().toISOString(),
      });
  }

  listExternalRefs(runId: RunId): ExternalRef[] {
    return (
      this.db
        .prepare<[string], ExternalRefRow>(
          "SELECT system, ref_kind, ref_id, scope FROM external_refs WHERE run_id = ? ORDER BY id ASC",
        )
        .all(runId)
    ).map((r) => ({
      system: r.system,
      kind: r.ref_kind,
      id: r.ref_id,
      ...(r.scope !== null ? { scope: r.scope } : {}),
    }));
  }

  /** Find the run(s) that carry an external reference — e.g. a Hermes task. */
  findRunsByExternalRef(
    system: string,
    id: string,
    opts: { kind?: string; scope?: string } = {},
  ): RunRecord[] {
    const where = ["e.system = ?", "e.ref_id = ?"];
    const params: unknown[] = [system, id];
    if (opts.kind !== undefined) {
      where.push("e.ref_kind = ?");
      params.push(opts.kind);
    }
    if (opts.scope !== undefined) {
      where.push("e.scope = ?");
      params.push(opts.scope);
    }
    const sql =
      `SELECT r.* FROM runs r
         JOIN external_refs e ON e.run_id = r.id
         WHERE ${where.join(" AND ")}
         ORDER BY r.created_at DESC, r.rowid DESC`;
    return (this.db.prepare(sql).all(...params) as RunRow[]).map(rowToRun);
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private requireRun(id: RunId): RunRecord {
    const run = this.getRun(id);
    if (!run) throw new RunLedgerError("not-found", `run ${id} not found`);
    return run;
  }

  private requireStep(stepId: string): RunStepRecord {
    const row = this.db
      .prepare<[string], RunStepRow>("SELECT * FROM run_steps WHERE id = ?")
      .get(stepId);
    if (!row) {
      throw new RunLedgerError("not-found", `run step ${stepId} not found`);
    }
    return rowToStep(row);
  }

  private assertTransition(
    from: RunStatus,
    to: RunStatus,
    subjectId: string,
  ): void {
    if (isTerminalStatus(from)) {
      throw new RunLedgerError(
        "terminal",
        `${subjectId} is ${from} (terminal); cannot transition to ${to}`,
      );
    }
    if (!ALLOWED_TRANSITIONS[from].has(to)) {
      throw new RunLedgerError(
        "invalid-transition",
        `${subjectId}: ${from} -> ${to} is not a permitted transition`,
      );
    }
  }
}

// ── Singleton accessor ──────────────────────────────────────────────────────

let singleton: RunLedger | null = null;

/** The process-wide RunLedger, backed by the singleton state DB. */
export async function getRunLedger(): Promise<RunLedger> {
  if (singleton) return singleton;
  singleton = new RunLedger(await getStateDb());
  return singleton;
}

/** Drop the cached ledger — pair with `closeStateDbForTests()` in tests. */
export function resetRunLedgerForTests(): void {
  singleton = null;
}
