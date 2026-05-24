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
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import { stateDbPath } from "./paths";
import { runMigrations, type MigrationResult } from "./migrations";

/**
 * Test-mode guard (FU5 PR A). Refuses to open the operator's real
 * `~/.agentic-os/state.db` from a vitest process. Forces every test to
 * point `AGENTIC_OS_STATE_DB` at a tmp file explicitly.
 *
 * Background: M4a-FU5 PR A added a second persistence singleton
 * (`getConnectorHealthStore()`) that fans out to `getStateDb()`. Several
 * pre-existing test files set `AGENTIC_OS_AUDIT_DIR` / `AGENTIC_OS_CONFIG`
 * but not `AGENTIC_OS_STATE_DB`, so during the test run a kernel path
 * resolved the state-DB singleton against the real file and ran the new
 * v2 migration there. The migration was non-destructive (additive
 * `CREATE TABLE IF NOT EXISTS`), but writing to the operator's home dir
 * from tests is a hard no.
 *
 * The guard fires only when:
 *   - we're inside a vitest process (`VITEST` env), AND
 *   - the resolved path is the default `~/.agentic-os/state.db`.
 * `AGENTIC_OS_STATE_DB` always wins — set it to a tmp path and the
 * guard is silent.
 */
function isVitest(): boolean {
  return Boolean(process.env.VITEST) || process.env.NODE_ENV === "test";
}

function assertNotRealDbInTests(resolvedPath: string): void {
  if (!isVitest()) return;
  const defaultPath = path.join(homedir(), ".agentic-os", "state.db");
  if (resolvedPath === defaultPath) {
    throw new Error(
      "test isolation violation: getStateDb() resolved to the operator's real "
        + `~/.agentic-os/state.db (${resolvedPath}). Set process.env.AGENTIC_OS_STATE_DB `
        + "to a tmp path in beforeEach (and restore in afterEach) before calling any "
        + "kernel path that may resolve a state-DB singleton — e.g. getRunLedger(), "
        + "getConnectorHealthStore(), or any API route that does so internally.",
    );
  }
}

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
  assertNotRealDbInTests(dbPath);

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
      let db: Database.Database | undefined;
      try {
        mkdirSync(path.dirname(dbPath), { recursive: true });
        db = new Database(dbPath);
        db.pragma("journal_mode = WAL");
        db.pragma("foreign_keys = ON");
        lastMigration = await runMigrations(db, { dbPath });
        G.__agenticStateDb = { db, dbPath };
        return db;
      } catch (err) {
        // Init failed — forward guard, corrupt DB, or a migration error.
        // Drop the half-open handle and clear the singleton so a later
        // getStateDb() (e.g. after the operator repoints AGENTIC_OS_STATE_DB)
        // retries cleanly instead of being stuck on the rejected promise.
        if (db) {
          try { db.close(); } catch { /* ignore */ }
        }
        G.__agenticStateDb = undefined;
        G.__agenticStateDbInit = undefined;
        lastMigration = null;
        throw err;
      }
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
