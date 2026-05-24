// ConnectorHealthStore — denormalised current-state projection of the last
// connector test outcome per connector instance. Spec: M4a-FU5 §4.1/§4.3/§4.5.
//
// Shape and posture:
//
//   - One row per connector instance, keyed by connectorId. UPSERTed on
//     every runConnectorTest completion (testConnection.ts).
//   - The UPSERT carries a freshness guard (`WHERE excluded.test_started_at
//     >= connector_health.test_started_at`) so a slow older test cannot
//     clobber a newer faster test for the same connector — see §4.5.
//   - Audit JSONL remains source-of-truth (ADR-0009 / ADR-0014). A health
//     write failure is logged neutrally and swallowed by the caller; the
//     run record still transitions, the audit line still writes, and the
//     operator gets the live validation back from the function return.
//   - Shares the existing state.db connection. There is NO second SQLite
//     handle — `getConnectorHealthStore()` is backed by `getStateDb()`.
//
// Non-leak invariants (§9):
//
//   - No raw env var name, no secret value, no Authorization header, no
//     baseUrl, no raw provider response, no settings blob lives on disk
//     here. Only status / errorCode / neutral message / timing / config
//     fingerprint cross.
//   - `config_hash` is server-internal and never exposed via the API
//     (asserted by `tests/api-connectors-hydration.test.ts` in PR B).

import type DatabaseType from "better-sqlite3";
import { getStateDb } from "../state/db";
import {
  CONNECTOR_ERROR_CODE_SET,
  type ConnectorErrorCode,
  type ConnectorValidation,
} from "./types";

type Db = DatabaseType.Database;

/** The closed set of `ConnectorValidation.status` values. Mirrors §4.1's
 *  contract that the route validates against a closed union before
 *  projecting; if a row is ever malformed (e.g. a future code change
 *  drops a status) `parseValidationRow` treats it as "not tested". */
const VALID_STATUSES: ReadonlySet<ConnectorValidation["status"]> = new Set([
  "valid",
  "invalid",
  "unreachable",
  "misconfigured",
  "unknown",
]);

/** The deserialised projection of one `connector_health` row. */
export interface ConnectorHealthRow {
  connectorId: string;
  /** The full neutral ConnectorValidation — status / errorCode / message /
   *  testedAt / durationMs. Round-trips through serialise+parse. */
  validation: ConnectorValidation;
  /** Denormalised copy of runs.created_at — used as the freshness source
   *  for the UPSERT guard. Set BEFORE the family's testConnection
   *  executes, so a slow older test cannot clobber a newer faster test. */
  testStartedAt: string;
  /** SHA-256 hex of the canonical validation-relevant config at the time
   *  this row was written. See connectorFingerprint.ts. */
  configHash: string;
  /** The run that produced this row, or NULL when the test ran with a
   *  degraded / unavailable ledger. */
  runId: string | null;
  /** Last write time — the row's own updated_at, not the test's. */
  updatedAt: string;
}

/** Input shape for recordTest — caller assembles from testConnection's
 *  local state (validation), the producing run record (testStartedAt +
 *  runId), and the fingerprint helper (configHash). */
export interface RecordTestInput {
  connectorId: string;
  validation: ConnectorValidation;
  testStartedAt: string;
  configHash: string;
  runId: string | null;
}

// ── Serialisation ─────────────────────────────────────────────────────────

interface ConnectorHealthDbRow {
  connector_id: string;
  status: string;
  error_code: string | null;
  message: string | null;
  tested_at: string;
  duration_ms: number;
  test_started_at: string;
  config_hash: string;
  run_id: string | null;
  updated_at: string;
}

/**
 * Round-tripper for the validation slice of the row. Validates the status
 * and errorCode against their closed unions; a corrupt row (impossible via
 * recordTest, but defensive for a hand-edited DB) parses as null and the
 * caller treats it as "not tested" rather than crashing the hydration.
 */
export function parseValidationRow(
  row: Pick<
    ConnectorHealthDbRow,
    "status" | "error_code" | "message" | "tested_at" | "duration_ms"
  >,
): ConnectorValidation | null {
  if (!VALID_STATUSES.has(row.status as ConnectorValidation["status"])) {
    return null;
  }
  const errorCode =
    row.error_code !== null
    && CONNECTOR_ERROR_CODE_SET.has(row.error_code as ConnectorErrorCode)
      ? (row.error_code as ConnectorErrorCode)
      : undefined;
  return {
    status: row.status as ConnectorValidation["status"],
    ...(errorCode ? { errorCode } : {}),
    ...(row.message !== null ? { message: row.message } : {}),
    testedAt: row.tested_at,
    durationMs: row.duration_ms,
  };
}

function rowToHealth(r: ConnectorHealthDbRow): ConnectorHealthRow | null {
  const validation = parseValidationRow(r);
  if (!validation) return null;
  return {
    connectorId: r.connector_id,
    validation,
    testStartedAt: r.test_started_at,
    configHash: r.config_hash,
    runId: r.run_id,
    updatedAt: r.updated_at,
  };
}

// ── Store ─────────────────────────────────────────────────────────────────

export class ConnectorHealthStore {
  private readonly db: Db;

  /** Accepts the existing state.db connection — does NOT open a second
   *  SQLite connection. The state DB is opened once per process by
   *  `src/kernel/state/db.ts::getStateDb()` (M3); FU5 shares that handle
   *  so writes go through the same WAL + prepared-statement cache. */
  constructor(db: Db) {
    this.db = db;
  }

  /**
   * UPSERT with the §4.5 freshness guard. When the incoming
   * `testStartedAt` is older than the stored row's, the conflict is
   * recognised but the update is skipped — no exception thrown, no
   * separate transaction needed. Callers don't need to know they were
   * beaten by a newer test.
   *
   * Equal `testStartedAt` is allowed to overwrite ("ties favour the
   * latest writer"); ms-precision collisions are unlikely in practice.
   */
  recordTest(input: RecordTestInput): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO connector_health (
           connector_id, status, error_code, message, tested_at,
           duration_ms, test_started_at, config_hash, run_id, updated_at
         ) VALUES (
           @connectorId, @status, @errorCode, @message, @testedAt,
           @durationMs, @testStartedAt, @configHash, @runId, @updatedAt
         )
         ON CONFLICT(connector_id) DO UPDATE SET
           status          = excluded.status,
           error_code      = excluded.error_code,
           message         = excluded.message,
           tested_at       = excluded.tested_at,
           duration_ms     = excluded.duration_ms,
           test_started_at = excluded.test_started_at,
           config_hash     = excluded.config_hash,
           run_id          = excluded.run_id,
           updated_at      = excluded.updated_at
         WHERE excluded.test_started_at >= connector_health.test_started_at`,
      )
      .run({
        connectorId: input.connectorId,
        status: input.validation.status,
        errorCode: input.validation.errorCode ?? null,
        message: input.validation.message ?? null,
        testedAt: input.validation.testedAt,
        durationMs: input.validation.durationMs,
        testStartedAt: input.testStartedAt,
        configHash: input.configHash,
        runId: input.runId,
        updatedAt: now,
      });
  }

  /** Single-connector lookup. `undefined` when never tested (or when the
   *  row is malformed and treated as "not tested"). */
  get(connectorId: string): ConnectorHealthRow | undefined {
    const row = this.db
      .prepare<[string], ConnectorHealthDbRow>(
        "SELECT * FROM connector_health WHERE connector_id = ?",
      )
      .get(connectorId);
    if (!row) return undefined;
    return rowToHealth(row) ?? undefined;
  }

  /** Bulk fetch for `GET /api/connectors` (PR B). Returns a Map keyed by
   *  connectorId; missing ids are absent (not null). Empty input array
   *  short-circuits the query entirely. */
  getMany(
    connectorIds: ReadonlyArray<string>,
  ): Map<string, ConnectorHealthRow> {
    const out = new Map<string, ConnectorHealthRow>();
    if (connectorIds.length === 0) return out;
    // better-sqlite3 doesn't bind array params; build a parameter list.
    const placeholders = connectorIds.map(() => "?").join(",");
    const rows = this.db
      .prepare<string[], ConnectorHealthDbRow>(
        `SELECT * FROM connector_health WHERE connector_id IN (${placeholders})`,
      )
      .all(...connectorIds);
    for (const row of rows) {
      const health = rowToHealth(row);
      if (health) out.set(health.connectorId, health);
    }
    return out;
  }

  /** Drop the row for a connector that was deleted. Idempotent. Used by
   *  the M4a-6b DELETE handler (PR B reviewer note in §6); harmless if
   *  called on an unknown id. */
  delete(connectorId: string): void {
    this.db
      .prepare("DELETE FROM connector_health WHERE connector_id = ?")
      .run(connectorId);
  }
}

// ── Singleton accessor ────────────────────────────────────────────────────

let singleton: ConnectorHealthStore | null = null;

/** The process-wide ConnectorHealthStore, backed by the singleton state DB.
 *  Lazy-init mirrors `getRunLedger()` so the M3 migration runner has time
 *  to apply v2 before the store touches the table. */
export async function getConnectorHealthStore(): Promise<ConnectorHealthStore> {
  if (singleton) return singleton;
  singleton = new ConnectorHealthStore(await getStateDb());
  return singleton;
}

/** Drop the cached store — pair with `closeStateDbForTests()` in tests. */
export function resetConnectorHealthStoreForTests(): void {
  singleton = null;
}

// ── Test seam ─────────────────────────────────────────────────────────────

/** Test-only constructor that takes an injected DB handle. Mirrors the
 *  `__TEST__.newRegistry()` and `new RunLedger(db)` patterns; production
 *  code uses `getConnectorHealthStore()`. */
export const __TEST__ = {
  newStore: (db: Db): ConnectorHealthStore => new ConnectorHealthStore(db),
};
