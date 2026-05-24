import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import {
  runMigrations,
  MIGRATIONS,
  LATEST_STATE_DB_VERSION,
  type Migration,
} from "../src/kernel/state/migrations";
import { getStateDb, closeStateDbForTests } from "../src/kernel/state/db";

// Every suite uses a tmp-file state.db via AGENTIC_OS_STATE_DB and resets the
// db.ts singleton in afterEach — never the real ~/.agentic-os/state.db.

let tmpDir: string;
let dbPath: string;
let originalEnv: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "state-mig-"));
  dbPath = path.join(tmpDir, "state.db");
  originalEnv = process.env.AGENTIC_OS_STATE_DB;
});

afterEach(async () => {
  closeStateDbForTests();
  if (originalEnv === undefined) delete process.env.AGENTIC_OS_STATE_DB;
  else process.env.AGENTIC_OS_STATE_DB = originalEnv;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function openTmpDb(): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

function readVersion(db: Database.Database): number | null {
  const row = db
    .prepare<[string], { value: string }>(
      "SELECT value FROM _meta WHERE key = ?",
    )
    .get("stateDbVersion");
  return row ? Number(row.value) : null;
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

describe("state DB migrations", () => {
  it("migrates a fresh DB from 0 to the latest version", async () => {
    const db = openTmpDb();
    const result = await runMigrations(db, { dbPath });
    expect(result.fromVersion).toBe(0);
    expect(result.toVersion).toBe(LATEST_STATE_DB_VERSION);
    expect(result.applied).toEqual(MIGRATIONS.map((m) => m.version));
    expect(result.backupPath).toBeNull();
    expect(readVersion(db)).toBe(LATEST_STATE_DB_VERSION);
    db.close();
  });

  it("creates the run-ledger tables (migration v1)", async () => {
    const db = openTmpDb();
    await runMigrations(db, { dbPath });
    expect(tableNames(db)).toEqual(
      expect.arrayContaining(["_meta", "runs", "run_steps", "external_refs"]),
    );
    db.close();
  });

  it("v1 tables carry the expected columns", async () => {
    const db = openTmpDb();
    await runMigrations(db, { dbPath });

    expect(columnNames(db, "runs")).toEqual(
      expect.arrayContaining([
        "id", "kind", "feature_id", "parent_run_id", "correlation_id",
        "trigger", "status", "current_step", "total_steps", "completed_steps",
        "capability_id", "connector_id", "created_at", "started_at",
        "ended_at", "updated_at", "duration_ms", "input_hash", "input_summary",
        "error_code", "cancelled_by", "on_restart", "max_iterations",
        "max_duration_ms", "max_tool_calls", "max_cost_usd",
      ]),
    );
    expect(columnNames(db, "run_steps")).toEqual(
      expect.arrayContaining([
        "id", "run_id", "idx", "kind", "status", "started_at", "ended_at",
        "capability_id", "connector_id", "agent_id", "error_code",
      ]),
    );
    expect(columnNames(db, "external_refs")).toEqual(
      expect.arrayContaining([
        "id", "run_id", "system", "ref_kind", "ref_id", "scope", "created_at",
      ]),
    );
    db.close();
  });

  it("is a no-op when run a second time on the same DB", async () => {
    const db = openTmpDb();
    await runMigrations(db, { dbPath });
    const second = await runMigrations(db, { dbPath });
    expect(second.fromVersion).toBe(LATEST_STATE_DB_VERSION);
    expect(second.toVersion).toBe(LATEST_STATE_DB_VERSION);
    expect(second.applied).toEqual([]);
    expect(second.backupPath).toBeNull();
    db.close();
  });

  it("forward guard refuses a DB newer than the code and leaves it untouched", async () => {
    const db = openTmpDb();
    await runMigrations(db, { dbPath });
    const future = LATEST_STATE_DB_VERSION + 5;
    db.prepare(
      "INSERT INTO _meta (key, value) VALUES ('stateDbVersion', ?) "
        + "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(String(future));

    await expect(runMigrations(db, { dbPath })).rejects.toThrow(/version/i);

    // DB untouched: version still the stamped future value, tables intact.
    expect(readVersion(db)).toBe(future);
    expect(tableNames(db)).toEqual(expect.arrayContaining(["runs"]));
    db.close();
  });

  it("writes a WAL-safe backup before applying a real migration", async () => {
    // Reach v1 with the production migration set.
    let db = openTmpDb();
    await runMigrations(db, { dbPath, migrations: [MIGRATIONS[0]!] });
    db.close();

    // A second (test-only) migration: fromVersion 1 > 0 triggers a backup.
    const fakeV2: Migration = {
      version: 2,
      name: "test-only-probe",
      up: (d) => d.exec("CREATE TABLE IF NOT EXISTS probe_v2 (x TEXT)"),
    };
    db = openTmpDb();
    const result = await runMigrations(db, {
      dbPath,
      migrations: [MIGRATIONS[0]!, fakeV2],
    });

    expect(result.fromVersion).toBe(1);
    expect(result.applied).toEqual([2]);
    expect(result.backupPath).toBe(`${dbPath}.bak-v1`);
    expect(existsSync(`${dbPath}.bak-v1`)).toBe(true);

    // The backup is a valid SQLite DB snapshotted at the pre-migration version.
    const backup = new Database(`${dbPath}.bak-v1`);
    const backedUp = backup
      .prepare<[string], { value: string }>(
        "SELECT value FROM _meta WHERE key = ?",
      )
      .get("stateDbVersion");
    expect(backedUp?.value).toBe("1");
    expect(tableNames(backup)).not.toContain("probe_v2");
    backup.close();
    db.close();
  });

  it("getStateDb opens the DB at the env path, migrates it, and is a singleton", async () => {
    process.env.AGENTIC_OS_STATE_DB = dbPath;
    const db = await getStateDb();
    expect(tableNames(db)).toEqual(
      expect.arrayContaining(["runs", "run_steps", "external_refs"]),
    );
    expect(readVersion(db)).toBe(LATEST_STATE_DB_VERSION);
    // Same handle on a second call.
    expect(await getStateDb()).toBe(db);
  });

  it("test-isolation guard: getStateDb() refuses to open ~/.agentic-os/state.db from a vitest process", async () => {
    // Force the resolved path to point at the operator's real DB by
    // clearing AGENTIC_OS_STATE_DB; the guard MUST throw before any
    // file open or migration runs. VITEST is set by the vitest runner;
    // we don't unset it here (this very test relies on vitest semantics).
    delete process.env.AGENTIC_OS_STATE_DB;
    closeStateDbForTests();
    await expect(getStateDb()).rejects.toThrow(
      /test isolation violation/i,
    );
  });

  it("getStateDb recovers in the same process after a failed init", async () => {
    // DB A — future-stamped so the forward guard rejects init.
    const futureDb = path.join(tmpDir, "future.db");
    {
      const seed = new Database(futureDb);
      seed.pragma("journal_mode = WAL");
      seed.exec(
        "CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
      );
      seed
        .prepare("INSERT INTO _meta (key, value) VALUES ('stateDbVersion', ?)")
        .run(String(LATEST_STATE_DB_VERSION + 5));
      seed.close();
    }
    process.env.AGENTIC_OS_STATE_DB = futureDb;
    await expect(getStateDb()).rejects.toThrow(/version/i);

    // The failed init must not leave a poisoned singleton — repointing at a
    // fresh DB and retrying succeeds in the same process.
    const freshDb = path.join(tmpDir, "fresh.db");
    process.env.AGENTIC_OS_STATE_DB = freshDb;
    const db = await getStateDb();
    expect(tableNames(db)).toEqual(
      expect.arrayContaining(["runs", "run_steps", "external_refs"]),
    );
    expect(readVersion(db)).toBe(LATEST_STATE_DB_VERSION);
  });
});
