import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import Database from "better-sqlite3";
import { runMigrations } from "../src/kernel/state/migrations";
import { RunLedger } from "../src/kernel/state/runLedger";
import { runMission } from "../src/features/scheduler/missions/runner";
import { __TEST__ as registryTest } from "../src/features/scheduler/missions/registry";
import { appConfigSchema, type AppConfig } from "../src/kernel/schemas/appConfig";
import type {
  MissionDefinition,
  MissionRunResult,
} from "../src/features/scheduler/missions/types";

// The runner is exercised with an INJECTED ledger (overrides.ledger) backed by
// a tmp-file state DB — production passes no overrides and gets the real one.

let tmpDir: string;
let db: Database.Database;
let ledger: RunLedger;
let auditDir: string;
let config: AppConfig;
let originalAuditEnv: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sched-ledger-"));
  auditDir = path.join(tmpDir, "audit");
  const vaultRoot = path.join(tmpDir, "vault");
  await fs.mkdir(auditDir, { recursive: true });
  await fs.mkdir(path.join(vaultRoot, "00_Inbox", "agentic-os"), {
    recursive: true,
  });
  originalAuditEnv = process.env.AGENTIC_OS_AUDIT_DIR;
  process.env.AGENTIC_OS_AUDIT_DIR = auditDir;
  config = appConfigSchema.parse({ vault: { root: vaultRoot } });

  const dbPath = path.join(tmpDir, "state.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  await runMigrations(db, { dbPath });
  ledger = new RunLedger(db);
});

afterEach(async () => {
  try { db.close(); } catch { /* a test may have closed it already */ }
  if (originalAuditEnv === undefined) delete process.env.AGENTIC_OS_AUDIT_DIR;
  else process.env.AGENTIC_OS_AUDIT_DIR = originalAuditEnv;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function testMission(overrides: Partial<MissionDefinition> = {}): MissionDefinition {
  return {
    id: "probe",
    title: "Probe",
    description: "test",
    enabledByDefault: true,
    manualRunnable: true,
    concurrency: "single",
    outputKind: "custom",
    optionsSchema: z.object({}).strict(),
    permissions: [],
    run: async (): Promise<MissionRunResult> => ({ status: "success" }),
    ...overrides,
  };
}

function registryWith(def: MissionDefinition) {
  const reg = registryTest.newRegistry();
  reg.register(def);
  return reg;
}

async function auditRunIds(): Promise<string[]> {
  const day = new Date().toISOString().slice(0, 10);
  const raw = await fs.readFile(path.join(auditDir, `${day}.jsonl`), "utf8");
  return raw
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { kind: string; runId?: string })
    .filter((e) => e.kind === "mission.run" && typeof e.runId === "string")
    .map((e) => e.runId!);
}

describe("scheduler runner -> run ledger", () => {
  it("persists a successful mission as one ledger row joined by runId", async () => {
    const result = await runMission(
      { missionId: "probe", trigger: "manual", rawOptions: {} },
      { registry: registryWith(testMission()), config, ledger },
    );
    expect(result.status).toBe("success");

    const rows = ledger.listRuns();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(result.runId);
    expect(rows[0]!.status).toBe("succeeded");
    expect(rows[0]!.kind).toBe("manual-mission");
    expect(rows[0]!.trigger).toBe("manual");

    // The audit JSONL line carries the same runId — the records join.
    expect(await auditRunIds()).toContain(result.runId);
  });

  it("uses kind scheduled-mission / trigger scheduled for a scheduled fire", async () => {
    const result = await runMission(
      { missionId: "probe", trigger: "scheduled", rawOptions: {} },
      { registry: registryWith(testMission()), config, ledger },
    );
    const run = ledger.getRun(result.runId)!;
    expect(run.kind).toBe("scheduled-mission");
    expect(run.trigger).toBe("scheduled");
  });

  it("records a thrown mission as a failed ledger row with the errorClass", async () => {
    const boom = testMission({
      run: async () => {
        throw new Error("boom");
      },
    });
    const result = await runMission(
      { missionId: "probe", trigger: "manual", rawOptions: {} },
      { registry: registryWith(boom), config, ledger },
    );
    expect(result.status).toBe("failed");

    const run = ledger.getRun(result.runId)!;
    expect(run.status).toBe("failed");
    expect(run.errorCode).toBe("mission-threw");
  });

  it("maps a skipped mission to succeeded with currentStep 'skipped', no errorCode", async () => {
    const skip = testMission({
      run: async (): Promise<MissionRunResult> => ({
        status: "skipped",
        reason: "nothing-to-do",
      }),
    });
    const result = await runMission(
      { missionId: "probe", trigger: "manual", rawOptions: {} },
      { registry: registryWith(skip), config, ledger },
    );
    expect(result.status).toBe("skipped");

    const run = ledger.getRun(result.runId)!;
    expect(run.status).toBe("succeeded");
    expect(run.currentStep).toBe("skipped");
    expect(run.errorCode).toBeNull();
  });

  it("a ledger write failure does not change the RunnerResult", async () => {
    db.close(); // the injected ledger is now backed by a closed DB
    const result = await runMission(
      { missionId: "probe", trigger: "manual", rawOptions: {} },
      { registry: registryWith(testMission()), config, ledger },
    );
    // The mission still completes — the ledger failure was swallowed.
    expect(result.status).toBe("success");
  });
});
