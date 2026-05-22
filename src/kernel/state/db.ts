// SQLite state DB — the first of Agentic OS's four persistence stores
// (v8 §7.2), at ~/.agentic-os/state.db. Holds the run ledger (M3) and, milestone
// by milestone, the rest of the mutable platform state. Opened once per Node
// process; the migration runner brings the schema up to date on open.
//
// Audit stays JSONL (src/kernel/audit.ts) and is NEVER moved into this DB.
//
// `getStateDb()` is async (the M3 spec sketched it sync) so the migration
// runner can take a WAL-safe `db.backup()` snapshot — mirrors the async
// getVaultIndex() in vaultIndex.ts.

import path from "node:path";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import { stateDbPath } from "./paths";
import { runMigrations, type MigrationResult } from "./migrations";

interface OpenState {
  db: Database.Database;
  dbPath: string;
}

// Stored on globalThis so Next.js's dev-mode module reloading does not open a
// second handle to the same file (same trick as vaultIndex.ts).
const G = globalThis as unknown as {
  __agenticStateDb?: OpenState;
  __agenticStateDbInit?: Promise<Database.Database>;
};

let lastMigration: MigrationResult | null = null;

/**
 * Open (once) and return the process-wide state DB handle. The singleton is
 * keyed by resolved DB path: if `AGENTIC_OS_STATE_DB` changed since the last
 * open (e.g. between test suites that forgot to reset), the stale handle is
 * closed and the DB reopened against the new path.
 */
export async function getStateDb(): Promise<Database.Database> {
  const dbPath = stateDbPath();

  const open = G.__agenticStateDb;
  if (open && open.dbPath === dbPath) return open.db;
  if (open) {
    // Path changed under us — drop the stale handle and reopen.
    try { open.db.close(); } catch { /* ignore */ }
    G.__agenticStateDb = undefined;
    G.__agenticStateDbInit = undefined;
  }

  if (!G.__agenticStateDbInit) {
    G.__agenticStateDbInit = (async () => {
      mkdirSync(path.dirname(dbPath), { recursive: true });
      const db = new Database(dbPath);
      db.pragma("journal_mode = WAL");
      db.pragma("foreign_keys = ON");
      lastMigration = await runMigrations(db, { dbPath });
      G.__agenticStateDb = { db, dbPath };
      return db;
    })();
  }
  return G.__agenticStateDbInit;
}

/** The result of the migration run from the last `getStateDb()` open. */
export function getLastMigrationResult(): MigrationResult | null {
  return lastMigration;
}

/**
 * Close the open state DB and clear the singleton. Tests that point
 * `AGENTIC_OS_STATE_DB` at a tmp file MUST call this in `afterEach` so the
 * next suite reopens against its own path. Safe to call when nothing is open.
 */
export function closeStateDbForTests(): void {
  const open = G.__agenticStateDb;
  if (open) {
    try { open.db.close(); } catch { /* ignore */ }
  }
  G.__agenticStateDb = undefined;
  G.__agenticStateDbInit = undefined;
  lastMigration = null;
}

export { closeStateDbForTests as resetStateDbForTests };
