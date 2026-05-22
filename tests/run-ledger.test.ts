import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { runMigrations } from "../src/kernel/state/migrations";
import {
  RunLedger,
  RunLedgerError,
  type RunChangedEvent,
} from "../src/kernel/state/runLedger";

// RunLedger is tested against an injected tmp-file DB — never the real
// ~/.agentic-os/state.db.

let tmpDir: string;
let db: Database.Database;
let ledger: RunLedger;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "run-ledger-"));
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

describe("RunLedger — runs", () => {
  it("createRun round-trips through getRun with sane defaults", () => {
    const created = ledger.createRun({
      kind: "scheduled-mission",
      featureId: "scheduler",
      trigger: "scheduled",
      onRestart: "mark-interrupted",
      inputSummary: "daily-summary · scheduled",
      maxIterations: 150,
    });

    expect(created.status).toBe("running");        // default
    expect(created.startedAt).toBe(created.createdAt); // running -> clock starts
    expect(created.endedAt).toBeNull();
    expect(created.durationMs).toBeNull();
    expect(created.id).toMatch(/[0-9a-f-]{36}/);

    const fetched = ledger.getRun(created.id);
    expect(fetched).toEqual(created);
    expect(fetched?.kind).toBe("scheduled-mission");
    expect(fetched?.inputSummary).toBe("daily-summary · scheduled");
    expect(fetched?.maxIterations).toBe(150);
  });

  it("a queued run has no startedAt until it transitions to running", () => {
    const run = ledger.createRun({
      kind: "manual-mission",
      featureId: "scheduler",
      trigger: "manual",
      onRestart: "mark-interrupted",
      status: "queued",
    });
    expect(run.status).toBe("queued");
    expect(run.startedAt).toBeNull();

    const running = ledger.transitionRun(run.id, "running");
    expect(running.status).toBe("running");
    expect(running.startedAt).not.toBeNull();
  });

  it("running -> succeeded sets endedAt and durationMs", () => {
    const run = makeRunningRun();
    const done = ledger.transitionRun(run.id, "succeeded");
    expect(done.status).toBe("succeeded");
    expect(done.endedAt).not.toBeNull();
    expect(done.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("running -> failed records the errorCode", () => {
    const run = makeRunningRun();
    const failed = ledger.transitionRun(run.id, "failed", {
      errorCode: "mission-threw",
    });
    expect(failed.status).toBe("failed");
    expect(failed.errorCode).toBe("mission-threw");
  });

  it("cancelRun sets status cancelled and cancelledBy", () => {
    const run = makeRunningRun();
    const cancelled = ledger.cancelRun(run.id, "user");
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelledBy).toBe("user");
    expect(cancelled.endedAt).not.toBeNull();
  });

  it("rejects an illegal transition from a terminal status", () => {
    const run = makeRunningRun();
    ledger.transitionRun(run.id, "succeeded");
    expect(() => ledger.transitionRun(run.id, "running")).toThrow(
      RunLedgerError,
    );
    try {
      ledger.transitionRun(run.id, "running");
    } catch (err) {
      expect((err as RunLedgerError).code).toBe("terminal");
    }
  });

  it("rejects an illegal transition (queued -> succeeded)", () => {
    const run = ledger.createRun({
      kind: "manual-mission",
      featureId: "scheduler",
      trigger: "manual",
      onRestart: "mark-interrupted",
      status: "queued",
    });
    try {
      ledger.transitionRun(run.id, "succeeded");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(RunLedgerError);
      expect((err as RunLedgerError).code).toBe("invalid-transition");
    }
  });

  it("cancelRun cascades to non-terminal children, leaving terminal ones untouched", () => {
    const parent = makeRunningRun();
    const childRunning = ledger.createRun({
      kind: "capability-invoke",
      featureId: "scheduler",
      trigger: "orchestrator",
      onRestart: "mark-interrupted",
      parentRunId: parent.id,
    });
    const childDone = ledger.createRun({
      kind: "capability-invoke",
      featureId: "scheduler",
      trigger: "orchestrator",
      onRestart: "mark-interrupted",
      parentRunId: parent.id,
    });
    ledger.transitionRun(childDone.id, "succeeded");

    ledger.cancelRun(parent.id, "user");

    expect(ledger.getRun(parent.id)?.status).toBe("cancelled");
    expect(ledger.getRun(childRunning.id)?.status).toBe("cancelled");
    expect(ledger.getRun(childDone.id)?.status).toBe("succeeded"); // untouched

    // The actor is recorded only on the root; cascade descendants record
    // "parent-run"; an already-terminal descendant keeps its null cancelledBy.
    expect(ledger.getRun(parent.id)?.cancelledBy).toBe("user");
    expect(ledger.getRun(childRunning.id)?.cancelledBy).toBe("parent-run");
    expect(ledger.getRun(childDone.id)?.cancelledBy).toBeNull();
  });

  it("cancelRun cascades through multiple levels (parent -> child -> grandchild)", () => {
    const parent = makeRunningRun();
    const child = ledger.createRun({
      kind: "capability-invoke", featureId: "scheduler",
      trigger: "orchestrator", onRestart: "mark-interrupted",
      parentRunId: parent.id,
    });
    const grandchild = ledger.createRun({
      kind: "capability-invoke", featureId: "scheduler",
      trigger: "orchestrator", onRestart: "mark-interrupted",
      parentRunId: child.id,
    });

    ledger.cancelRun(parent.id, "user");

    // Every level is cancelled; only the root records the actor, the cascade
    // descendants at every depth record "parent-run".
    expect(ledger.getRun(parent.id)?.status).toBe("cancelled");
    expect(ledger.getRun(parent.id)?.cancelledBy).toBe("user");
    expect(ledger.getRun(child.id)?.status).toBe("cancelled");
    expect(ledger.getRun(child.id)?.cancelledBy).toBe("parent-run");
    expect(ledger.getRun(grandchild.id)?.status).toBe("cancelled");
    expect(ledger.getRun(grandchild.id)?.cancelledBy).toBe("parent-run");
  });

  it("listRuns filters by status and featureId, newest-first", () => {
    const a = ledger.createRun({
      kind: "manual-mission", featureId: "scheduler",
      trigger: "manual", onRestart: "mark-interrupted",
    });
    const b = ledger.createRun({
      kind: "manual-mission", featureId: "scheduler",
      trigger: "manual", onRestart: "mark-interrupted",
    });
    const c = ledger.createRun({
      kind: "connector-test", featureId: "connectors",
      trigger: "manual", onRestart: "cancel",
    });

    expect(ledger.listRuns().map((r) => r.id)).toEqual([c.id, b.id, a.id]);
    expect(ledger.listRuns({ featureId: "scheduler" }).map((r) => r.id))
      .toEqual([b.id, a.id]);

    ledger.transitionRun(b.id, "succeeded");
    expect(ledger.listRuns({ status: "succeeded" }).map((r) => r.id))
      .toEqual([b.id]);
  });

  it("onRunChanged fires once per successful change and not on a rejected one", () => {
    const events: RunChangedEvent[] = [];
    const off = ledger.onRunChanged((e) => events.push(e));

    const run = makeRunningRun();              // create  -> 1
    ledger.transitionRun(run.id, "succeeded"); // transition -> 2
    expect(() => ledger.transitionRun(run.id, "running")).toThrow(); // rejected

    off();
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({ runId: run.id, status: "succeeded" });
  });
});

describe("RunLedger — steps", () => {
  it("appendStep and transitionStep persist and round-trip", () => {
    const run = makeRunningRun();
    const s0 = ledger.appendStep(run.id, { kind: "mission.run" });
    const s1 = ledger.appendStep(run.id, { kind: "capability.invoke" });
    expect(s0.index).toBe(0);
    expect(s1.index).toBe(1);

    const done = ledger.transitionStep(s0.id, "succeeded");
    expect(done.status).toBe("succeeded");
    expect(done.endedAt).not.toBeNull();

    const steps = ledger.listSteps(run.id);
    expect(steps.map((s) => s.id)).toEqual([s0.id, s1.id]);
  });
});

describe("RunLedger — external refs", () => {
  it("addExternalRef / listExternalRefs persist a Hermes task ref", () => {
    const run = makeRunningRun();
    ledger.addExternalRef(run.id, {
      system: "hermes", kind: "task", id: "task-42", scope: "kanban",
    });
    expect(ledger.listExternalRefs(run.id)).toEqual([
      { system: "hermes", kind: "task", id: "task-42", scope: "kanban" },
    ]);
  });

  it("findRunsByExternalRef returns the owning run, honouring kind/scope", () => {
    const run = makeRunningRun();
    ledger.addExternalRef(run.id, {
      system: "hermes", kind: "task", id: "task-99", scope: "kanban",
    });

    expect(ledger.findRunsByExternalRef("hermes", "task-99").map((r) => r.id))
      .toEqual([run.id]);
    expect(
      ledger.findRunsByExternalRef("hermes", "task-99", { kind: "task" })
        .map((r) => r.id),
    ).toEqual([run.id]);
    expect(
      ledger.findRunsByExternalRef("hermes", "task-99", { scope: "other" }),
    ).toEqual([]);
    expect(ledger.findRunsByExternalRef("hermes", "missing")).toEqual([]);
  });
});

function makeRunningRun() {
  return ledger.createRun({
    kind: "manual-mission",
    featureId: "scheduler",
    trigger: "manual",
    onRestart: "mark-interrupted",
  });
}
