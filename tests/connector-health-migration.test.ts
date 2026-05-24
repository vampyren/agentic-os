import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import {
  runMigrations,
  MIGRATIONS,
  LATEST_STATE_DB_VERSION,
} from "../src/kernel/state/migrations";
import { closeStateDbForTests } from "../src/kernel/state/db";

// FU5 PR A — migration v2 (connector_health). Symmetric in style with
// state-migrations.test.ts; this file scopes its assertions to the v2
// change so a regression in v1 surfaces in the original suite and a
// regression in v2 here.

let tmpDir: string;
let dbPath: string;
let originalStateDbEnv: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "conn-health-mig-"));
  dbPath = path.join(tmpDir, "state.db");
  originalStateDbEnv = process.env.AGENTIC_OS_STATE_DB;
  process.env.AGENTIC_OS_STATE_DB = dbPath;
  closeStateDbForTests();
});

afterEach(async () => {
  closeStateDbForTests();
  if (originalStateDbEnv === undefined) delete process.env.AGENTIC_OS_STATE_DB;
  else process.env.AGENTIC_OS_STATE_DB = originalStateDbEnv;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function openTmpDb(): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

function tableNames(db: Database.Database): string[] {
  return db
    .prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    )
    .all()
    .map((r) => r.name);
}

function columnNames(db: Database.Database, table: string): string[] {
  // `table` is a controlled test literal — PRAGMA cannot bind a table name.
  return (
    db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  ).map((c) => c.name);
}

function indexNames(db: Database.Database, table: string): string[] {
  return (
    db.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string }>
  ).map((r) => r.name);
}

describe("state DB migration v2 — connector_health", () => {
  it("v2 ships in MIGRATIONS as the latest version", () => {
    const v2 = MIGRATIONS.find((m) => m.version === 2);
    expect(v2).toBeDefined();
    expect(v2!.name).toBe("connector-health");
    expect(LATEST_STATE_DB_VERSION).toBeGreaterThanOrEqual(2);
  });

  it("creates the connector_health table on a fresh DB", async () => {
    const db = openTmpDb();
    await runMigrations(db, { dbPath });
    expect(tableNames(db)).toEqual(
      expect.arrayContaining(["connector_health"]),
    );
    db.close();
  });

  it("connector_health carries the expected columns (spec §4.1)", async () => {
    const db = openTmpDb();
    await runMigrations(db, { dbPath });
    expect(columnNames(db, "connector_health")).toEqual(
      expect.arrayContaining([
        "connector_id",
        "status",
        "error_code",
        "message",
        "tested_at",
        "duration_ms",
        "test_started_at",
        "config_hash",
        "run_id",
        "updated_at",
      ]),
    );
    db.close();
  });

  it("connector_health carries the updated_at index", async () => {
    const db = openTmpDb();
    await runMigrations(db, { dbPath });
    expect(indexNames(db, "connector_health")).toEqual(
      expect.arrayContaining(["connector_health_updated_at"]),
    );
    db.close();
  });

  it("connector_id is the primary key", async () => {
    const db = openTmpDb();
    await runMigrations(db, { dbPath });
    const info = db
      .prepare("PRAGMA table_info(connector_health)")
      .all() as Array<{ name: string; pk: number }>;
    const pkRow = info.find((c) => c.name === "connector_id");
    expect(pkRow?.pk).toBe(1);
    db.close();
  });

  it("run_id is a foreign key referencing runs(id) with ON DELETE SET NULL", async () => {
    const db = openTmpDb();
    await runMigrations(db, { dbPath });
    const fks = db
      .prepare("PRAGMA foreign_key_list(connector_health)")
      .all() as Array<{ table: string; from: string; to: string; on_delete: string }>;
    const runFk = fks.find((f) => f.from === "run_id");
    expect(runFk).toBeDefined();
    expect(runFk!.table).toBe("runs");
    expect(runFk!.to).toBe("id");
    expect(runFk!.on_delete).toBe("SET NULL");
    db.close();
  });

  it("is a no-op when run a second time on the same DB (idempotent)", async () => {
    const db = openTmpDb();
    await runMigrations(db, { dbPath });
    const second = await runMigrations(db, { dbPath });
    expect(second.applied).toEqual([]);
    expect(second.fromVersion).toBe(LATEST_STATE_DB_VERSION);
    expect(second.toVersion).toBe(LATEST_STATE_DB_VERSION);
    expect(second.backupPath).toBeNull();
    db.close();
  });

  it("applying v2 against a v1 DB writes a WAL-safe backup first", async () => {
    // Apply just v1.
    let db = openTmpDb();
    const v1Only = MIGRATIONS.filter((m) => m.version === 1);
    await runMigrations(db, { dbPath, migrations: v1Only });
    db.close();

    // Apply the full set — v2 should be applied with a v1 backup taken.
    db = openTmpDb();
    const result = await runMigrations(db, { dbPath });
    expect(result.fromVersion).toBe(1);
    expect(result.applied).toEqual([2]);
    expect(result.backupPath).toBe(`${dbPath}.bak-v1`);
    expect(tableNames(db)).toEqual(
      expect.arrayContaining(["connector_health"]),
    );
    db.close();

    // The backup must NOT contain the v2 table (it was taken first).
    const backup = new Database(`${dbPath}.bak-v1`);
    expect(tableNames(backup)).not.toContain("connector_health");
    backup.close();
  });

  it("forward guard refuses a DB stamped v3 against a v2 build", async () => {
    const db = openTmpDb();
    await runMigrations(db, { dbPath });
    const future = LATEST_STATE_DB_VERSION + 1;
    db.prepare(
      "INSERT INTO _meta (key, value) VALUES ('stateDbVersion', ?) "
        + "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(String(future));
    await expect(runMigrations(db, { dbPath })).rejects.toThrow(/version/i);
    // Table not dropped — forward guard is read-only after the version check.
    expect(tableNames(db)).toEqual(
      expect.arrayContaining(["connector_health"]),
    );
    db.close();
  });
});
