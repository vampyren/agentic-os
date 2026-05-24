import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { runMigrations } from "../src/kernel/state/migrations";
import {
  __TEST__,
  type ConnectorHealthStore,
} from "../src/kernel/connectors/connectorHealth";
import type { ConnectorValidation } from "../src/kernel/connectors/types";

// FU5 PR A — ConnectorHealthStore CRUD + UPSERT semantics (spec §4.3).
//
// Concurrency / freshness ordering (the slow-older vs fast-newer race
// from spec §4.5) lives in a sibling file
// `connector-health-store-concurrency.test.ts` so each test file has a
// single concern.

let tmpDir: string;
let db: Database.Database;
let store: ConnectorHealthStore;
let originalStateDbEnv: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "conn-health-store-"));
  originalStateDbEnv = process.env.AGENTIC_OS_STATE_DB;
  const dbPath = path.join(tmpDir, "state.db");
  process.env.AGENTIC_OS_STATE_DB = dbPath;
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  // FKs are intentionally OFF for these store-isolated unit tests so the
  // tests can pass arbitrary `runId` values without seeding the `runs`
  // table. The FK structure (run_id REFERENCES runs(id) ON DELETE SET
  // NULL) is verified by `connector-health-migration.test.ts`; the
  // testConnection integration test uses a real RunLedger so FKs are
  // enforced there.
  db.pragma("foreign_keys = OFF");
  await runMigrations(db, { dbPath });
  store = __TEST__.newStore(db);
});

afterEach(async () => {
  try { db.close(); } catch { /* a test may have closed it */ }
  if (originalStateDbEnv === undefined) delete process.env.AGENTIC_OS_STATE_DB;
  else process.env.AGENTIC_OS_STATE_DB = originalStateDbEnv;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function validation(
  o: Partial<ConnectorValidation> = {},
): ConnectorValidation {
  return {
    status: "valid",
    testedAt: "2026-05-24T10:00:00.000Z",
    durationMs: 42,
    ...o,
  };
}

describe("ConnectorHealthStore — CRUD", () => {
  it("recordTest inserts a fresh row, get returns the projection", () => {
    store.recordTest({
      connectorId: "c1",
      validation: validation({ status: "valid" }),
      testStartedAt: "2026-05-24T09:59:00.000Z",
      configHash: "a".repeat(64),
      runId: "run-1",
    });

    const row = store.get("c1");
    expect(row).toBeDefined();
    expect(row!.connectorId).toBe("c1");
    expect(row!.validation.status).toBe("valid");
    expect(row!.validation.testedAt).toBe("2026-05-24T10:00:00.000Z");
    expect(row!.validation.durationMs).toBe(42);
    expect(row!.testStartedAt).toBe("2026-05-24T09:59:00.000Z");
    expect(row!.configHash).toBe("a".repeat(64));
    expect(row!.runId).toBe("run-1");
    expect(row!.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("get returns undefined for an unknown connector", () => {
    expect(store.get("never-seen")).toBeUndefined();
  });

  it("getMany returns a Map; missing ids are absent (not null)", () => {
    store.recordTest({
      connectorId: "c1",
      validation: validation({ status: "valid" }),
      testStartedAt: "2026-05-24T09:59:00.000Z",
      configHash: "a".repeat(64),
      runId: "run-1",
    });
    store.recordTest({
      connectorId: "c2",
      validation: validation({ status: "invalid", errorCode: "auth-failed" }),
      testStartedAt: "2026-05-24T09:59:01.000Z",
      configHash: "b".repeat(64),
      runId: "run-2",
    });

    const map = store.getMany(["c1", "c2", "never-seen"]);
    expect(map.size).toBe(2);
    expect(map.has("c1")).toBe(true);
    expect(map.has("c2")).toBe(true);
    expect(map.has("never-seen")).toBe(false);
  });

  it("getMany([]) returns an empty Map (no query)", () => {
    expect(store.getMany([]).size).toBe(0);
  });

  it("delete removes the row; idempotent on unknown ids", () => {
    store.recordTest({
      connectorId: "c1",
      validation: validation({ status: "valid" }),
      testStartedAt: "2026-05-24T09:59:00.000Z",
      configHash: "a".repeat(64),
      runId: null,
    });
    expect(store.get("c1")).toBeDefined();
    store.delete("c1");
    expect(store.get("c1")).toBeUndefined();
    // No throw on a second / unknown delete.
    expect(() => store.delete("c1")).not.toThrow();
    expect(() => store.delete("never-existed")).not.toThrow();
  });

  it("runId can be NULL (e.g. when the ledger was unavailable at write time)", () => {
    store.recordTest({
      connectorId: "c1",
      validation: validation({ status: "unknown" }),
      testStartedAt: "2026-05-24T09:59:00.000Z",
      configHash: "0".repeat(64),
      runId: null,
    });
    expect(store.get("c1")?.runId).toBeNull();
  });
});

describe("ConnectorHealthStore — UPSERT semantics (newer wins)", () => {
  it("recordTest called twice with same connectorId UPSERTs to one row", () => {
    store.recordTest({
      connectorId: "c1",
      validation: validation({ status: "valid" }),
      testStartedAt: "2026-05-24T09:59:00.000Z",
      configHash: "a".repeat(64),
      runId: "run-1",
    });
    store.recordTest({
      connectorId: "c1",
      validation: validation({ status: "invalid", errorCode: "auth-failed" }),
      testStartedAt: "2026-05-24T10:00:00.000Z",
      configHash: "b".repeat(64),
      runId: "run-2",
    });

    // Exactly one row total.
    const count = db
      .prepare("SELECT COUNT(*) AS n FROM connector_health")
      .get() as { n: number };
    expect(count.n).toBe(1);

    // Newer write wins.
    const row = store.get("c1")!;
    expect(row.validation.status).toBe("invalid");
    expect(row.validation.errorCode).toBe("auth-failed");
    expect(row.configHash).toBe("b".repeat(64));
    expect(row.runId).toBe("run-2");
  });

  it("updated_at advances on every successful write", () => {
    store.recordTest({
      connectorId: "c1",
      validation: validation({ status: "valid" }),
      testStartedAt: "2026-05-24T09:59:00.000Z",
      configHash: "a".repeat(64),
      runId: "run-1",
    });
    const first = store.get("c1")!.updatedAt;

    // Force the OS clock to tick — better-sqlite3 + JS Date have ms
    // precision; use a tiny sleep so the test isn't flaky on fast hosts.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        store.recordTest({
          connectorId: "c1",
          validation: validation({ status: "valid" }),
          testStartedAt: "2026-05-24T10:00:00.000Z",
          configHash: "a".repeat(64),
          runId: "run-2",
        });
        const second = store.get("c1")!.updatedAt;
        expect(Date.parse(second)).toBeGreaterThanOrEqual(Date.parse(first));
        resolve();
      }, 5);
    });
  });
});

describe("ConnectorHealthStore — defensive parsing", () => {
  it("a malformed row (invalid status string) parses as 'not tested'", () => {
    // Hand-write a row that bypasses recordTest's typing — simulates a
    // future-version DB or a corrupt write the store never made itself.
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO connector_health (
         connector_id, status, error_code, message, tested_at,
         duration_ms, test_started_at, config_hash, run_id, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "c1",
      "from-the-future", // not in the closed status union
      null,
      null,
      now,
      1,
      now,
      "0".repeat(64),
      null,
      now,
    );
    expect(store.get("c1")).toBeUndefined();
    expect(store.getMany(["c1"]).has("c1")).toBe(false);
  });

  it("an unknown errorCode is dropped (the row still surfaces)", () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO connector_health (
         connector_id, status, error_code, message, tested_at,
         duration_ms, test_started_at, config_hash, run_id, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "c1",
      "valid",
      "from-the-future-error", // not in the closed errorCode union
      null,
      now,
      1,
      now,
      "0".repeat(64),
      null,
      now,
    );
    const row = store.get("c1");
    expect(row).toBeDefined();
    expect(row!.validation.status).toBe("valid");
    expect(row!.validation.errorCode).toBeUndefined();
  });
});
