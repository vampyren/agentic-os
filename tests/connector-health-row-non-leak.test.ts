import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import Database from "better-sqlite3";
import { runMigrations } from "../src/kernel/state/migrations";
import {
  closeStateDbForTests,
} from "../src/kernel/state/db";
import {
  RunLedger,
  resetRunLedgerForTests,
} from "../src/kernel/state/runLedger";
import { __TEST__ as registryTest } from "../src/kernel/connectors/registry";
import { runConnectorTest } from "../src/kernel/connectors/testConnection";
import {
  __TEST__ as healthTest,
  resetConnectorHealthStoreForTests,
  type ConnectorHealthStore,
} from "../src/kernel/connectors/connectorHealth";
import { appConfigSchema, type AppConfig } from "../src/kernel/schemas/appConfig";
import type {
  ConnectorFamilyDefinition,
  ConnectorValidation,
} from "../src/kernel/connectors/types";

// FU5 PR A — non-leak sweep against the `connector_health` table contents
// as written to disk (§9). The marker-string discipline mirrors M4a-5 PR
// AB / PR C: set a recognisable test-only value as a connector secret /
// baseUrl / env-var-name; run a test that writes to connector_health;
// dump every row + every column to one big string and assert the marker
// is absent.

let tmpDir: string;
let db: Database.Database;
let dbPath: string;
let ledger: RunLedger;
let connectorHealth: ConnectorHealthStore;
let originalAuditEnv: string | undefined;
let originalStateDbEnv: string | undefined;
let originalEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "conn-health-nonleak-"));
  originalAuditEnv = process.env.AGENTIC_OS_AUDIT_DIR;
  originalStateDbEnv = process.env.AGENTIC_OS_STATE_DB;
  process.env.AGENTIC_OS_AUDIT_DIR = path.join(tmpDir, "audit");
  await fs.mkdir(process.env.AGENTIC_OS_AUDIT_DIR, { recursive: true });
  dbPath = path.join(tmpDir, "state.db");
  process.env.AGENTIC_OS_STATE_DB = dbPath;

  closeStateDbForTests();
  resetRunLedgerForTests();
  resetConnectorHealthStoreForTests();

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  await runMigrations(db, { dbPath });
  ledger = new RunLedger(db);
  connectorHealth = healthTest.newStore(db);

  originalEnv = {};
});

afterEach(async () => {
  // Restore any env we touched.
  for (const [k, v] of Object.entries(originalEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  closeStateDbForTests();
  resetRunLedgerForTests();
  resetConnectorHealthStoreForTests();
  try { db.close(); } catch { /* a test may have closed it */ }
  if (originalAuditEnv === undefined) delete process.env.AGENTIC_OS_AUDIT_DIR;
  else process.env.AGENTIC_OS_AUDIT_DIR = originalAuditEnv;
  if (originalStateDbEnv === undefined) delete process.env.AGENTIC_OS_STATE_DB;
  else process.env.AGENTIC_OS_STATE_DB = originalStateDbEnv;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function setEnv(name: string, value: string): void {
  if (!(name in originalEnv)) originalEnv[name] = process.env[name];
  process.env[name] = value;
}

function httpFamily(
  overrides: Partial<ConnectorFamilyDefinition> = {},
): ConnectorFamilyDefinition {
  return {
    id: "openai-compatible-llm",
    title: "Fake HTTP",
    kind: "ai-provider",
    transport: "http",
    capabilities: ["chat.generate"],
    sideEffects: ["external-api", "network"],
    defaultTrust: "first-party",
    settingsSchema: z
      .object({ baseUrl: z.string().url(), model: z.string().optional() })
      .passthrough(),
    defaultSettings: {},
    auth: { required: true, supportedRefs: ["env"] },
    invoke: async () => ({ status: "success" }),
    ...overrides,
  };
}

function registryWith(fam: ConnectorFamilyDefinition) {
  const reg = registryTest.newRegistry();
  reg.register(fam);
  return reg;
}

const validation = (
  o: Partial<ConnectorValidation>,
): ConnectorValidation => ({
  status: "valid",
  testedAt: new Date().toISOString(),
  durationMs: 1,
  ...o,
});

function dumpHealthTable(): string {
  // Read every column of every row as raw strings (the on-disk shape)
  // and concatenate so the marker-string sweep checks every byte.
  const rows = db
    .prepare("SELECT * FROM connector_health")
    .all() as Array<Record<string, unknown>>;
  return JSON.stringify(rows);
}

function rawRowBytes(): Buffer {
  // A defensive secondary sweep: read the raw SQLite file bytes too.
  // The DB file IS the disk surface; a leaked marker should show up in
  // there too if it leaked at all. (The WAL may carry the bytes during
  // a live process; we close and reopen to flush.)
  db.close();
  const bytes = require("node:fs").readFileSync(dbPath);
  // Reopen for any post-assertion checks.
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return bytes;
}

describe("connector_health row non-leak (§9)", () => {
  it("env var NAME and resolved secret value never appear in the table contents", async () => {
    const SECRET_VALUE = "sk-MARKER-secret-must-not-leak-XYZ";
    const ENV_NAME = "FU5_NONLEAK_TEST_KEY_AAAA";
    setEnv(ENV_NAME, SECRET_VALUE);

    const fam = httpFamily({
      testConnection: async () => validation({ status: "valid" }),
    });
    const cfg: AppConfig = appConfigSchema.parse({
      vault: { root: tmpDir },
      connectors: {
        "my-c": {
          enabled: true,
          typeFamily: "openai-compatible-llm",
          authRef: `env:${ENV_NAME}`,
          settings: { baseUrl: "http://localhost:11434", model: "m" },
          allowLocalNetwork: true,
        },
      },
    });
    await runConnectorTest("my-c", {
      ledger, connectorHealth, registry: registryWith(fam), config: cfg,
    });

    const dump = dumpHealthTable();
    expect(dump).not.toContain(SECRET_VALUE);
    expect(dump).not.toContain(ENV_NAME);

    // Secondary sweep — the raw DB file bytes.
    const bytes = rawRowBytes();
    expect(bytes.indexOf(Buffer.from(SECRET_VALUE))).toBe(-1);
    expect(bytes.indexOf(Buffer.from(ENV_NAME))).toBe(-1);
  });

  it("baseUrl does NOT appear in the connector_health row", async () => {
    const MARKER_URL = "http://fu5-nonleak-marker.example.test/api/v1";
    setEnv("OPENAI_API_KEY", "sk-anything");

    const fam = httpFamily({
      testConnection: async () => validation({ status: "valid" }),
    });
    const cfg: AppConfig = appConfigSchema.parse({
      vault: { root: tmpDir },
      connectors: {
        "my-c": {
          enabled: true,
          typeFamily: "openai-compatible-llm",
          authRef: "env:OPENAI_API_KEY",
          settings: { baseUrl: MARKER_URL, model: "m" },
          // The MARKER_URL is not an RFC1918 private; safe to test
          // without allowLocalNetwork. Use a real SSRF-allowed URL.
        },
      },
    });
    // SSRF will block this URL because it resolves nowhere — that's OK,
    // the test still completes (with status='misconfigured' /
    // 'blocked-network') and writes a connector_health row, which is
    // the surface we're sweeping.
    await runConnectorTest("my-c", {
      ledger, connectorHealth, registry: registryWith(fam), config: cfg,
    });

    const dump = dumpHealthTable();
    expect(dump).not.toContain(MARKER_URL);
    expect(dump).not.toContain("fu5-nonleak-marker.example.test");
  });

  it("the `settings` blob is NOT a column on connector_health", async () => {
    // The spec explicitly states (§9): "settings are NOT a column on
    // connector_health — only the SHA-256 of the canonical config
    // crosses." Schema-level assertion of that contract.
    const cols = (
      db.prepare("PRAGMA table_info(connector_health)").all() as Array<{
        name: string;
      }>
    ).map((c) => c.name);
    expect(cols).not.toContain("settings");
    expect(cols).not.toContain("settings_json");
    expect(cols).not.toContain("base_url");
    expect(cols).not.toContain("env_var_name");
    expect(cols).not.toContain("authref");
  });

  it("a leaky family `message` carrying secret / private path is NOT persisted in the row", async () => {
    // testConnection.ts re-derives `message` from neutral status +
    // errorCode (the M4a-1 review fix); the row should reflect that,
    // never the family-provided string.
    const LEAKY = "leaked sk-marker-XXX and /home/operator/private.json";
    const fam = httpFamily({
      testConnection: async () =>
        validation({ status: "invalid", errorCode: "auth-failed", message: LEAKY }),
    });
    const cfg = appConfigSchema.parse({
      vault: { root: tmpDir },
      connectors: {
        "my-c": {
          enabled: true,
          typeFamily: "openai-compatible-llm",
          authRef: "env:OPENAI_API_KEY",
          settings: { baseUrl: "http://localhost:11434", model: "m" },
          allowLocalNetwork: true,
        },
      },
    });
    setEnv("OPENAI_API_KEY", "sk-anything");
    await runConnectorTest("my-c", {
      ledger, connectorHealth, registry: registryWith(fam), config: cfg,
    });

    const dump = dumpHealthTable();
    expect(dump).not.toContain("sk-marker-XXX");
    expect(dump).not.toContain("/home/operator/private.json");
  });

  // ── Fix #1 — build-context failure paths must also be leak-free ─────
  //
  // After FU5 PR A's first round, runConnectorTest persists a row on
  // EVERY misconfigured path (missing auth, settings parse failure,
  // secret-looking key). The row's config_hash is computed by the
  // `fingerprintFromInstanceConfig` fallback, which redacts
  // secret-looking values before hashing. These tests prove the
  // redaction holds end-to-end against the on-disk row.

  it("secret-looking value in settings does NOT enter the row on build-failure path (fix #1)", async () => {
    // See `connector-test-run-persists-health.test.ts` for the
    // schema-bypass rationale: connectorInstanceConfigSchema's B4
    // screen rejects this at config-load in real usage; the
    // buildContext-internal B4 is the defensive layer this test
    // exercises. The cast bypasses appConfigSchema.parse so the test
    // can reach the build-context fallback fingerprint path.
    const SECRET_MARKER = "sk-fix1-nonleak-marker-must-not-leak";
    const cfg = {
      vault: { root: tmpDir },
      connectors: {
        "my-c": {
          enabled: true,
          typeFamily: "openai-compatible-llm" as const,
          settings: { apiKey: SECRET_MARKER },
        },
      },
    } as unknown as AppConfig;
    const fam = httpFamily({
      testConnection: async () => {
        throw new Error("must not reach family — settings should be rejected first");
      },
    });
    setEnv("OPENAI_API_KEY", "sk-anything");
    const result = await runConnectorTest("my-c", {
      ledger, connectorHealth, registry: registryWith(fam), config: cfg,
    });
    expect(result.status).toBe("misconfigured");
    expect(result.errorCode).toBe("config-invalid");

    // Marker absent from BOTH the table dump AND the raw DB bytes.
    const dump = dumpHealthTable();
    expect(dump).not.toContain(SECRET_MARKER);
    const bytes = rawRowBytes();
    expect(bytes.indexOf(Buffer.from(SECRET_MARKER))).toBe(-1);
  });

  it("auth-missing path: env var NAME does not appear in the row (fix #1)", async () => {
    const ENV_MARKER = "FU5_FIX1_AUTH_MISSING_MARKER_QWERTY";
    // Don't set the env var → resolveAuthRef returns auth-missing.
    const cfg = appConfigSchema.parse({
      vault: { root: tmpDir },
      connectors: {
        "my-c": {
          enabled: true,
          typeFamily: "openai-compatible-llm",
          authRef: `env:${ENV_MARKER}`,
          settings: { baseUrl: "https://1.1.1.1/v1", model: "m" },
        },
      },
    });
    const fam = httpFamily({
      // required: true forces the resolveAuthRef path; the missing env
      // var triggers auth-missing → build-failure → fallback fingerprint.
      auth: { required: true, supportedRefs: ["env"] },
      testConnection: async () => {
        throw new Error("must not reach family — auth should be unresolved");
      },
    });
    const result = await runConnectorTest("my-c", {
      ledger, connectorHealth, registry: registryWith(fam), config: cfg,
    });
    expect(result.status).toBe("misconfigured");
    expect(result.errorCode).toBe("auth-missing");

    // The env var NAME is hashed by the authRef-identity logic; never
    // plaintext in the row.
    const dump = dumpHealthTable();
    expect(dump).not.toContain(ENV_MARKER);
    const bytes = rawRowBytes();
    expect(bytes.indexOf(Buffer.from(ENV_MARKER))).toBe(-1);
  });
});
