// SQLite state-DB migration runner (ADR-0014). The state DB grows table by
// table as milestones land; each milestone appends ONE migration and never
// edits a shipped one. M3 ships migration 1 — the run-ledger tables.
//
// Contract:
//   - a `stateDbVersion` row in the _meta table tracks the applied version;
//   - a FORWARD GUARD refuses to use a DB newer than this build understands;
//   - a WAL-safe `db.backup()` snapshot is taken before any migration applies
//     (skipped for a fresh DB — there is nothing to lose).

import type DatabaseType from "better-sqlite3";

type Db = DatabaseType.Database;

export interface Migration {
  version: number;
  name: string;
  up: (db: Db) => void;
}

export interface MigrationResult {
  fromVersion: number;
  toVersion: number;
  /** Versions applied this run, ascending. Empty when already current. */
  applied: number[];
  /** Path to the pre-migration backup, or null when none was taken. */
  backupPath: string | null;
}

const VERSION_KEY = "stateDbVersion";

const META_TABLE = `
CREATE TABLE IF NOT EXISTS _meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

// ── Migration 1 — run-ledger tables (M3) ──────────────────────────────────
// runs / run_steps / external_refs. Other v8 §7.2 tables (artifacts,
// approvals, connector_health, …) arrive in later milestones' migrations.
const MIGRATION_1_RUN_LEDGER = `
CREATE TABLE IF NOT EXISTS runs (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL,
  feature_id      TEXT NOT NULL,
  parent_run_id   TEXT REFERENCES runs(id) ON DELETE CASCADE,
  correlation_id  TEXT,
  trigger         TEXT NOT NULL,
  status          TEXT NOT NULL,
  current_step    TEXT,
  total_steps     INTEGER,
  completed_steps INTEGER,
  capability_id   TEXT,
  connector_id    TEXT,
  created_at      TEXT NOT NULL,
  started_at      TEXT,
  ended_at        TEXT,
  updated_at      TEXT NOT NULL,
  duration_ms     INTEGER,
  input_hash      TEXT,
  input_summary   TEXT,
  error_code      TEXT,
  cancelled_by    TEXT,
  on_restart      TEXT NOT NULL,
  max_iterations  INTEGER,
  max_duration_ms INTEGER,
  max_tool_calls  INTEGER,
  max_cost_usd    REAL
);
CREATE INDEX IF NOT EXISTS idx_runs_status        ON runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_feature_id    ON runs(feature_id);
CREATE INDEX IF NOT EXISTS idx_runs_created_at    ON runs(created_at);
CREATE INDEX IF NOT EXISTS idx_runs_parent_run_id ON runs(parent_run_id);

CREATE TABLE IF NOT EXISTS run_steps (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  idx           INTEGER NOT NULL,
  kind          TEXT NOT NULL,
  status        TEXT NOT NULL,
  started_at    TEXT,
  ended_at      TEXT,
  capability_id TEXT,
  connector_id  TEXT,
  agent_id      TEXT,
  error_code    TEXT
);
CREATE INDEX IF NOT EXISTS idx_run_steps_run_id ON run_steps(run_id, idx);

CREATE TABLE IF NOT EXISTS external_refs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id     TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  system     TEXT NOT NULL,
  ref_kind   TEXT NOT NULL,
  ref_id     TEXT NOT NULL,
  scope      TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_external_refs_run_id ON external_refs(run_id);
CREATE INDEX IF NOT EXISTS idx_external_refs_lookup
  ON external_refs(system, ref_kind, ref_id, scope);
`;

/** The ordered migration list. Append-only — never edit a shipped entry. */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "run-ledger",
    up: (db) => db.exec(MIGRATION_1_RUN_LEDGER),
  },
];

/** Highest schema version this build understands. */
export const LATEST_STATE_DB_VERSION: number = MIGRATIONS.reduce(
  (max, m) => Math.max(max, m.version),
  0,
);

function readVersion(db: Db): number {
  const row = db
    .prepare<[string], { value: string }>(
      "SELECT value FROM _meta WHERE key = ?",
    )
    .get(VERSION_KEY);
  if (!row) return 0;
  const n = Number(row.value);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(
      `state.db is corrupt: _meta.${VERSION_KEY} is not a valid version.`,
    );
  }
  return n;
}

/**
 * Bring `db` up to the latest schema version.
 *
 * @param opts.dbPath     resolved path to state.db — used to name the backup.
 * @param opts.migrations migration list override (tests only; defaults to
 *                        the production MIGRATIONS).
 */
export async function runMigrations(
  db: Db,
  opts: { dbPath: string; migrations?: readonly Migration[] },
): Promise<MigrationResult> {
  const migrations = [...(opts.migrations ?? MIGRATIONS)].sort(
    (a, b) => a.version - b.version,
  );
  const latest = migrations.reduce((max, m) => Math.max(max, m.version), 0);

  db.exec(META_TABLE);
  const fromVersion = readVersion(db);

  // Forward guard — a DB stamped newer than this build is refused outright.
  // Read-only up to here, so the DB is left exactly as found.
  if (fromVersion > latest) {
    throw new Error(
      `state.db is at version ${fromVersion} but this build understands only `
        + `up to version ${latest}. Upgrade Agentic OS — the database was left `
        + `untouched.`,
    );
  }

  if (fromVersion === latest) {
    return { fromVersion, toVersion: latest, applied: [], backupPath: null };
  }

  // WAL-safe backup before mutating anything. Skipped for a fresh DB
  // (version 0) — there is no prior state to protect.
  let backupPath: string | null = null;
  if (fromVersion > 0) {
    backupPath = `${opts.dbPath}.bak-v${fromVersion}`;
    await db.backup(backupPath);
  }

  const applied: number[] = [];
  for (const migration of migrations) {
    if (migration.version <= fromVersion) continue;
    // Each migration + its version bump is one transaction: a failure rolls
    // the whole step back, leaving the DB at the last good version.
    const apply = db.transaction(() => {
      migration.up(db);
      db.prepare(
        "INSERT INTO _meta (key, value) VALUES (?, ?) "
          + "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run(VERSION_KEY, String(migration.version));
    });
    apply();
    applied.push(migration.version);
  }

  return { fromVersion, toVersion: latest, applied, backupPath };
}
