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

// FU5 PR A — UPSERT freshness guard (spec §4.5).
//
// The race the guard prevents:
//
//   t=0  Operator clicks Test on connector "openai".
//        Run #A created (runs.created_at = 0); slow DNS.
//   t=2  Operator clicks Test again (impatient).
//        Run #B created (runs.created_at = 2); completes quickly,
//        writes status='valid' to connector_health at t=3.
//   t=5  Run #A finally completes with status='unreachable' and tries
//        to UPSERT. Without a guard it would overwrite the newer, more
//        accurate result from run #B.
//
// The guard: `recordTest`'s INSERT uses
// `ON CONFLICT … DO UPDATE … WHERE excluded.test_started_at >=
// connector_health.test_started_at`, so the older write is silently
// dropped.

let tmpDir: string;
let db: Database.Database;
let store: ConnectorHealthStore;
let originalStateDbEnv: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "conn-health-race-"));
  originalStateDbEnv = process.env.AGENTIC_OS_STATE_DB;
  const dbPath = path.join(tmpDir, "state.db");
  process.env.AGENTIC_OS_STATE_DB = dbPath;
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  // FKs OFF — same reasoning as `connector-health-store.test.ts` (the
  // freshness race is purely about the store's UPSERT-WHERE clause, not
  // the FK against `runs`; persists-health.test.ts exercises FK semantics
  // with a real RunLedger).
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

const validation = (
  o: Partial<ConnectorValidation>,
): ConnectorValidation => ({
  status: "valid",
  testedAt: "2026-05-24T10:00:00.000Z",
  durationMs: 1,
  ...o,
});

describe("ConnectorHealthStore — freshness guard (slow-older vs fast-newer)", () => {
  it("a slow older test cannot clobber a newer faster test (the §4.5 race)", () => {
    // Run #B — the FAST NEWER test — wins the race and writes first.
    store.recordTest({
      connectorId: "openai",
      validation: validation({ status: "valid" }),
      testStartedAt: "2026-05-24T10:00:02.000Z", // t=2
      configHash: "newer".padEnd(64, "0"),
      runId: "run-B",
    });

    // Run #A — the SLOW OLDER test — completes later but its
    // test_started_at is OLDER (t=0). The UPSERT must skip silently.
    store.recordTest({
      connectorId: "openai",
      validation: validation({
        status: "unreachable",
        errorCode: "network-unreachable",
      }),
      testStartedAt: "2026-05-24T10:00:00.000Z", // t=0 — older
      configHash: "older".padEnd(64, "0"),
      runId: "run-A",
    });

    // The newer write remains the row's content.
    const row = store.get("openai")!;
    expect(row.validation.status).toBe("valid");
    expect(row.testStartedAt).toBe("2026-05-24T10:00:02.000Z");
    expect(row.configHash).toBe("newer".padEnd(64, "0"));
    expect(row.runId).toBe("run-B");
  });

  it("an equal test_started_at is allowed to overwrite (ties favour the latest writer)", () => {
    store.recordTest({
      connectorId: "openai",
      validation: validation({ status: "valid" }),
      testStartedAt: "2026-05-24T10:00:00.000Z",
      configHash: "first".padEnd(64, "0"),
      runId: "run-1",
    });
    store.recordTest({
      connectorId: "openai",
      validation: validation({ status: "invalid", errorCode: "auth-failed" }),
      testStartedAt: "2026-05-24T10:00:00.000Z", // exactly equal
      configHash: "second".padEnd(64, "0"),
      runId: "run-2",
    });

    const row = store.get("openai")!;
    expect(row.validation.status).toBe("invalid");
    expect(row.configHash).toBe("second".padEnd(64, "0"));
    expect(row.runId).toBe("run-2");
  });

  it("a strictly-newer test overwrites the older row", () => {
    store.recordTest({
      connectorId: "openai",
      validation: validation({ status: "valid" }),
      testStartedAt: "2026-05-24T10:00:00.000Z",
      configHash: "old".padEnd(64, "0"),
      runId: "run-1",
    });
    store.recordTest({
      connectorId: "openai",
      validation: validation({ status: "invalid", errorCode: "auth-failed" }),
      testStartedAt: "2026-05-24T10:00:05.000Z", // newer
      configHash: "new".padEnd(64, "0"),
      runId: "run-2",
    });

    const row = store.get("openai")!;
    expect(row.validation.status).toBe("invalid");
    expect(row.testStartedAt).toBe("2026-05-24T10:00:05.000Z");
    expect(row.configHash).toBe("new".padEnd(64, "0"));
    expect(row.runId).toBe("run-2");
  });

  it("the older write does NOT throw — caller sees a silent skip", () => {
    store.recordTest({
      connectorId: "openai",
      validation: validation({ status: "valid" }),
      testStartedAt: "2026-05-24T10:00:02.000Z",
      configHash: "newer".padEnd(64, "0"),
      runId: "run-B",
    });
    expect(() =>
      store.recordTest({
        connectorId: "openai",
        validation: validation({ status: "unreachable" }),
        testStartedAt: "2026-05-24T10:00:00.000Z",
        configHash: "older".padEnd(64, "0"),
        runId: "run-A",
      }),
    ).not.toThrow();
  });

  it("the guard does NOT bleed across connectors (older write for c2 still lands)", () => {
    // c1 has a newer row.
    store.recordTest({
      connectorId: "c1",
      validation: validation({ status: "valid" }),
      testStartedAt: "2026-05-24T10:00:02.000Z",
      configHash: "c1-newer".padEnd(64, "0"),
      runId: "run-c1",
    });
    // c2 has no row yet — an older-by-c1-standards timestamp still inserts.
    store.recordTest({
      connectorId: "c2",
      validation: validation({ status: "valid" }),
      testStartedAt: "2026-05-24T10:00:00.000Z",
      configHash: "c2-row".padEnd(64, "0"),
      runId: "run-c2",
    });

    expect(store.get("c1")).toBeDefined();
    expect(store.get("c2")).toBeDefined();
    expect(store.get("c2")!.testStartedAt).toBe("2026-05-24T10:00:00.000Z");
  });
});
