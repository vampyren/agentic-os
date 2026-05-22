// Restart recovery — at server boot, reconcile runs the previous Node process
// left non-terminal. Runs before the scheduler starts (src/instrumentation.ts)
// so a run interrupted by a restart is never mistaken for a fresh one.
//
// Each run's `onRestart` policy decides its fate:
//   mark-interrupted -> status "interrupted-by-restart"
//   cancel           -> status "cancelled", cancelledBy "system"
//   resume           -> M3 has no runtime to resume into; treated as
//                       mark-interrupted (logged). True resume is a later
//                       milestone (spec §3.6 / §9).

import { getRunLedger, type RunLedger } from "./runLedger";
import { isTerminalStatus } from "./runTypes";

export interface RecoverySummary {
  interrupted: number;
  cancelled: number;
}

/**
 * Apply each active run's `onRestart` policy. Pure given an injected ledger —
 * the unit-testable core of restart recovery.
 */
export function sweepInterruptedRuns(ledger: RunLedger): RecoverySummary {
  let interrupted = 0;
  let cancelled = 0;

  for (const snapshot of ledger.listActiveRuns()) {
    // Re-read: a prior `cancel` policy may have cascade-cancelled this run
    // already (if it was a descendant), making it terminal.
    const run = ledger.getRun(snapshot.id);
    if (!run || isTerminalStatus(run.status)) continue;

    if (run.onRestart === "cancel") {
      ledger.cancelRun(run.id, "system");
      cancelled++;
    } else {
      // "mark-interrupted" and (M3 stub) "resume".
      ledger.transitionRun(run.id, "interrupted-by-restart");
      interrupted++;
    }
  }

  return { interrupted, cancelled };
}

/**
 * Boot entrypoint — resolve the process ledger and run the sweep. Never
 * throws: a recovery failure must not block server startup.
 */
export async function recoverRunsOnStartup(): Promise<RecoverySummary> {
  try {
    const summary = sweepInterruptedRuns(await getRunLedger());
    if (summary.interrupted + summary.cancelled > 0) {
      console.info(
        `[agentic-os] restart recovery: ${summary.interrupted} run(s) marked `
        + `interrupted, ${summary.cancelled} cancelled.`,
      );
    }
    return summary;
  } catch (err) {
    console.error("[agentic-os] restart recovery failed:", err);
    return { interrupted: 0, cancelled: 0 };
  }
}
