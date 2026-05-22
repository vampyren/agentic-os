import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { runMigrations } from "../src/kernel/state/migrations";
import { RunLedger } from "../src/kernel/state/runLedger";
import { sweepInterruptedRuns } from "../src/kernel/state/restartRecovery";
import type { RunOnRestart } from "../src/kernel/state/runTypes";

let tmpDir: string;
let db: Database.Database;
let ledger: RunLedger;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "restart-rec-"));
  const dbPath = path.join(tmpDir, "state.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  await runMigrations(db, { dbPath });
  ledger = new RunLedger(db);
});

afterEach(async () => {
  db.close();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function activeRun(onRestart: RunOnRestart) {
  return ledger.createRun({
    kind: "scheduled-mission",
    featureId: "scheduler",
    trigger: "scheduled",
    onRestart,
  });
}

describe("restart recovery — sweepInterruptedRuns", () => {
  it("marks a mark-interrupted run as interrupted-by-restart", () => {
    const run = activeRun("mark-interrupted");
    const summary = sweepInterruptedRuns(ledger);
    expect(summary).toEqual({ interrupted: 1, cancelled: 0 });
    expect(ledger.getRun(run.id)?.status).toBe("interrupted-by-restart");
  });

  it("cancels a cancel-policy run with cancelledBy 'system'", () => {
    const run = activeRun("cancel");
    const summary = sweepInterruptedRuns(ledger);
    expect(summary).toEqual({ interrupted: 0, cancelled: 1 });
    const recovered = ledger.getRun(run.id);
    expect(recovered?.status).toBe("cancelled");
    expect(recovered?.cancelledBy).toBe("system");
  });

  it("treats a resume-policy run as interrupted (M3 has no resume runtime)", () => {
    const run = activeRun("resume");
    sweepInterruptedRuns(ledger);
    expect(ledger.getRun(run.id)?.status).toBe("interrupted-by-restart");
  });

  it("leaves already-terminal runs untouched", () => {
    const done = activeRun("mark-interrupted");
    ledger.transitionRun(done.id, "succeeded");

    const summary = sweepInterruptedRuns(ledger);
    expect(summary).toEqual({ interrupted: 0, cancelled: 0 });
    expect(ledger.getRun(done.id)?.status).toBe("succeeded");
  });

  it("returns an accurate summary across a mixed set of runs", () => {
    activeRun("mark-interrupted");
    activeRun("mark-interrupted");
    activeRun("cancel");
    activeRun("resume");
    const terminal = activeRun("mark-interrupted");
    ledger.transitionRun(terminal.id, "failed", { errorCode: "x" });

    expect(sweepInterruptedRuns(ledger)).toEqual({
      interrupted: 3, // 2 mark-interrupted + 1 resume
      cancelled: 1,
    });
  });
});
