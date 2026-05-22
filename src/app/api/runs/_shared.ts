// Shared helpers for the /api/runs platform routes (M3 PR3).
//
// The run ledger is platform infrastructure, not a feature — so these routes
// are CORS-gated (like every route) but NOT feature-gated. Responses are
// neutral: never a raw filesystem path, stack, SQL, or echoed input.

import { forbidden, originOk } from "@/app/api/_lib/cors";
import { RunLedgerError, type ListRunsFilter } from "@/kernel/state/runLedger";
import type {
  RunCancelledBy,
  RunKind,
  RunRecord,
  RunStatus,
  RunTrigger,
} from "@/kernel/state/runTypes";

const RUN_STATUSES: ReadonlySet<string> = new Set([
  "queued", "running", "waiting-approval", "waiting-clarification", "blocked",
  "succeeded", "failed", "cancelled", "interrupted-by-restart",
]);

const RUN_KINDS: ReadonlySet<string> = new Set([
  "scheduled-mission", "manual-mission", "capability-invoke", "connector-test",
  "external-work-bridge", "orchestration-phase", "artifact-generate",
  "approval-action", "user-action",
]);

/** A neutral JSON error — no raw paths, stacks, SQL, or echoed input. */
export function neutral(
  errorClass: string,
  message: string,
  status: number,
): Response {
  return Response.json({ ok: false, error: message, errorClass }, { status });
}

/** CORS gate — a 403 Response to short-circuit, or null to proceed. */
export function corsGate(req: Request): Response | null {
  return originOk(req) ? null : forbidden();
}

/** Map a RunLedgerError to its HTTP response; null for any other error. */
export function ledgerErrorResponse(err: unknown): Response | null {
  if (!(err instanceof RunLedgerError)) return null;
  switch (err.code) {
    case "not-found":
      return neutral("not-found", "run not found", 404);
    case "terminal":
      return neutral("terminal", "run is already in a terminal state", 409);
    case "invalid-transition":
      return neutral("invalid-transition", "run transition not permitted", 422);
    default:
      return neutral("internal-error", "run ledger error", 500);
  }
}

// inputSummary is meant to be audit-grade neutral text (the producer's
// contract), but /api/runs is the external surface — so redact defensively if
// a misbehaving producer ever wrote a path- or secret-like value.
const SUSPICIOUS_SUMMARY = /[/\\]|secret|token|password|api[_-]?key|bearer/i;

export function redactSummary(summary: string | null): string | null {
  if (summary === null) return null;
  return SUSPICIOUS_SUMMARY.test(summary) ? "[redacted]" : summary;
}

/**
 * The browser-facing projection of a run — a lean, display-safe subset of
 * RunRecord. No input_hash, no budget slots; inputSummary is redacted.
 */
export interface RunSummary {
  id: string;
  kind: RunKind;
  featureId: string;
  trigger: RunTrigger;
  status: RunStatus;
  parentRunId: string | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  updatedAt: string;
  durationMs: number | null;
  currentStep: string | null;
  totalSteps: number | null;
  completedSteps: number | null;
  errorCode: string | null;
  cancelledBy: RunCancelledBy | null;
  inputSummary: string | null;
}

export function toRunSummary(run: RunRecord): RunSummary {
  return {
    id: run.id,
    kind: run.kind,
    featureId: run.featureId,
    trigger: run.trigger,
    status: run.status,
    parentRunId: run.parentRunId,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    updatedAt: run.updatedAt,
    durationMs: run.durationMs,
    currentStep: run.currentStep,
    totalSteps: run.totalSteps,
    completedSteps: run.completedSteps,
    errorCode: run.errorCode,
    cancelledBy: run.cancelledBy,
    inputSummary: redactSummary(run.inputSummary),
  };
}

export type ParsedRunsQuery =
  | { ok: true; filter: ListRunsFilter }
  | { ok: false; response: Response };

/** Parse + validate the /api/runs query string into a ListRunsFilter. */
export function parseRunsQuery(url: URL): ParsedRunsQuery {
  const filter: ListRunsFilter = {};

  const status = url.searchParams.get("status");
  if (status !== null) {
    if (!RUN_STATUSES.has(status)) {
      return {
        ok: false,
        response: neutral("invalid-query", "unknown status filter", 400),
      };
    }
    filter.status = status as RunStatus;
  }

  const kind = url.searchParams.get("kind");
  if (kind !== null) {
    if (!RUN_KINDS.has(kind)) {
      return {
        ok: false,
        response: neutral("invalid-query", "unknown kind filter", 400),
      };
    }
    filter.kind = kind as RunKind;
  }

  const featureId = url.searchParams.get("featureId");
  if (featureId !== null) filter.featureId = featureId;

  const limit = url.searchParams.get("limit");
  if (limit !== null) {
    if (!/^\d+$/.test(limit)) {
      return {
        ok: false,
        response: neutral(
          "invalid-query",
          "limit must be a positive integer",
          400,
        ),
      };
    }
    filter.limit = Number(limit);
  }

  return { ok: true, filter };
}
