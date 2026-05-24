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

let tmpDir: string;
let db: Database.Database;
let ledger: RunLedger;
let connectorHealth: ConnectorHealthStore;
let originalAuditEnv: string | undefined;
let originalStateDbEnv: string | undefined;

// Test isolation guard (FU5 PR A): every singleton this test could
// accidentally resolve points at the tmp DB, NEVER the operator's real
// `~/.agentic-os/state.db`. Three layers of defence:
//
//   1. Tests inject `ledger` + `connectorHealth` into `runConnectorTest`
//      so the production singletons are never reached on the happy path.
//   2. `AGENTIC_OS_STATE_DB` is redirected to the tmp file for the
//      duration of the test, so any singleton that DID resolve would go
//      to the tmp DB anyway (defence in depth).
//   3. All state singletons (`getStateDb`, `RunLedger`, the new
//      `ConnectorHealthStore`) are reset in beforeEach AND afterEach so a
//      leaked handle from a prior suite can't survive into this one.
//
// The accidental v2-migration of the real state.db that triggered this
// guard is documented in the M4a-FU5 PR A worklog.
beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "conn-test-run-"));
  originalAuditEnv = process.env.AGENTIC_OS_AUDIT_DIR;
  originalStateDbEnv = process.env.AGENTIC_OS_STATE_DB;
  process.env.AGENTIC_OS_AUDIT_DIR = path.join(tmpDir, "audit");
  await fs.mkdir(process.env.AGENTIC_OS_AUDIT_DIR, { recursive: true });
  const dbPath = path.join(tmpDir, "state.db");
  process.env.AGENTIC_OS_STATE_DB = dbPath;

  // Reset any singletons left over from earlier suites so the guard's
  // env-var redirect actually takes effect on the next resolution.
  closeStateDbForTests();
  resetRunLedgerForTests();
  resetConnectorHealthStoreForTests();

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  await runMigrations(db, { dbPath });
  ledger = new RunLedger(db);
  connectorHealth = healthTest.newStore(db);
});

afterEach(async () => {
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

function family(
  overrides: Partial<ConnectorFamilyDefinition> = {},
): ConnectorFamilyDefinition {
  return {
    id: "cli-acp-agent",
    title: "Fake",
    kind: "managed-agent",
    transport: "subprocess",
    capabilities: ["agent.run"],
    sideEffects: ["local-process"],
    defaultTrust: "first-party",
    settingsSchema: z.unknown(),
    defaultSettings: {},
    auth: { required: false, supportedRefs: ["env"] },
    invoke: async () => ({ status: "success" }),
    ...overrides,
  };
}

function registryWith(fam: ConnectorFamilyDefinition) {
  const reg = registryTest.newRegistry();
  reg.register(fam);
  return reg;
}

function configWith(entry: Record<string, unknown> = {}): AppConfig {
  return appConfigSchema.parse({
    vault: { root: tmpDir },
    connectors: {
      "my-c": { enabled: true, typeFamily: "cli-acp-agent", ...entry },
    },
  });
}

const validation = (o: Partial<ConnectorValidation>): ConnectorValidation => ({
  status: "valid",
  testedAt: new Date().toISOString(),
  durationMs: 1,
  ...o,
});

async function auditText(): Promise<string> {
  const day = new Date().toISOString().slice(0, 10);
  return fs.readFile(
    path.join(process.env.AGENTIC_OS_AUDIT_DIR!, `${day}.jsonl`),
    "utf8",
  );
}

describe("runConnectorTest", () => {
  it("a valid test opens a succeeded connector-test Run", async () => {
    const fam = family({ testConnection: async () => validation({ status: "valid" }) });
    const result = await runConnectorTest("my-c", {
      ledger, connectorHealth, registry: registryWith(fam), config: configWith(),
    });
    expect(result.status).toBe("valid");

    const runs = ledger.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.kind).toBe("connector-test");
    expect(runs[0]!.status).toBe("succeeded");
    expect(runs[0]!.connectorId).toBe("my-c");
    expect(runs[0]!.inputSummary).toBe("connector test · my-c");
  });

  it("an invalid test fails the Run with the errorCode", async () => {
    const fam = family({
      testConnection: async () => validation({ status: "invalid", errorCode: "auth-failed" }),
    });
    const result = await runConnectorTest("my-c", {
      ledger, connectorHealth, registry: registryWith(fam), config: configWith(),
    });
    expect(result.status).toBe("invalid");
    const run = ledger.listRuns()[0]!;
    expect(run.status).toBe("failed");
    expect(run.errorCode).toBe("auth-failed");
  });

  it("normalizes an out-of-union errorCode to `unknown` (B13)", async () => {
    const fam = family({
      testConnection: async () =>
        validation({ status: "invalid", errorCode: "sk-LEAK" as never }),
    });
    const result = await runConnectorTest("my-c", {
      ledger, connectorHealth, registry: registryWith(fam), config: configWith(),
    });
    expect(result.errorCode).toBe("unknown");
    expect(ledger.listRuns()[0]!.errorCode).toBe("unknown");
  });

  it("no testConnection -> unknown / capability-unavailable -> failed run (req 2)", async () => {
    const result = await runConnectorTest("my-c", {
      ledger, connectorHealth, registry: registryWith(family()), config: configWith(),
    });
    expect(result.status).toBe("unknown");
    expect(result.errorCode).toBe("capability-unavailable");
    expect(ledger.listRuns()[0]!.status).toBe("failed");
  });

  it("a misconfigured instance fails the run without calling the connector", async () => {
    let called = false;
    const fam = family({
      auth: { required: true, supportedRefs: ["env"] },
      testConnection: async () => {
        called = true;
        return validation({});
      },
    });
    const result = await runConnectorTest("my-c", {
      ledger, connectorHealth, registry: registryWith(fam), config: configWith(),
    });
    expect(result.status).toBe("misconfigured");
    expect(called).toBe(false);
    expect(ledger.listRuns()[0]!.status).toBe("failed");
  });

  it("the resolved secret never appears in the audit line or the validation", async () => {
    process.env.CONN_TEST_SECRET = "sk-must-not-leak";
    const fam = family({
      auth: { required: true, supportedRefs: ["env"] },
      testConnection: async () => validation({ status: "valid" }),
    });
    const result = await runConnectorTest("my-c", {
      ledger,
      registry: registryWith(fam),
      config: configWith({ authRef: "env:CONN_TEST_SECRET" }),
    });
    delete process.env.CONN_TEST_SECRET;

    expect(result.status).toBe("valid");
    expect(JSON.stringify(result)).not.toContain("sk-must-not-leak");
    const audit = await auditText();
    expect(audit).toContain("connector.test");
    expect(audit).not.toContain("sk-must-not-leak");
  });

  it("a raw family `message` carrying a secret / private path is never surfaced", async () => {
    const LEAKY = "leaked sk-SECRET and /home/operator/private.json";
    const fam = family({
      testConnection: async () =>
        validation({ status: "invalid", errorCode: "auth-failed", message: LEAKY }),
    });
    const result = await runConnectorTest("my-c", {
      ledger, connectorHealth, registry: registryWith(fam), config: configWith(),
    });
    // Validation: errorCode survives (normalized), message is regenerated.
    expect(result.status).toBe("invalid");
    expect(result.errorCode).toBe("auth-failed");
    expect(JSON.stringify(result)).not.toContain("sk-SECRET");
    expect(JSON.stringify(result)).not.toContain("/home/operator/private.json");

    // The failed Run still carries the normalized errorCode.
    const run = ledger.listRuns()[0]!;
    expect(run.status).toBe("failed");
    expect(run.errorCode).toBe("auth-failed");

    // The audit line does not carry the leaked strings either.
    const audit = await auditText();
    expect(audit).toContain("connector.test");
    expect(audit).not.toContain("sk-SECRET");
    expect(audit).not.toContain("/home/operator/private.json");
  });

  it("a ledger failure does not break the test", async () => {
    db.close(); // the injected ledger is now backed by a closed DB
    const fam = family({ testConnection: async () => validation({ status: "valid" }) });
    const result = await runConnectorTest("my-c", {
      ledger, connectorHealth, registry: registryWith(fam), config: configWith(),
    });
    expect(result.status).toBe("valid");
  });
});

describe("runConnectorTest — HTTP SSRF wiring (B5)", () => {
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
        .object({
          baseUrl: z.string().url(),
          model: z.string().optional(),
        })
        .passthrough(),
      defaultSettings: {},
      auth: { required: false, supportedRefs: ["env"] },
      invoke: async () => ({ status: "success" }),
      ...overrides,
    };
  }

  function configWithHttp(
    instanceOverrides: Record<string, unknown> = {},
  ): AppConfig {
    return appConfigSchema.parse({
      vault: { root: tmpDir },
      connectors: {
        "my-c": {
          enabled: true,
          typeFamily: "openai-compatible-llm",
          settings: { baseUrl: "http://localhost:11434", model: "m" },
          ...instanceOverrides,
        },
      },
    });
  }

  it("blocks a private baseUrl when allowLocalNetwork is false; family.testConnection NOT called", async () => {
    let called = false;
    const fam = httpFamily({
      testConnection: async () => {
        called = true;
        return validation({ status: "valid" });
      },
    });
    const result = await runConnectorTest("my-c", {
      ledger,
      connectorHealth,
      registry: registryWith(fam),
      config: configWithHttp(), // allowLocalNetwork omitted -> false
    });
    expect(result.status).toBe("misconfigured");
    expect(result.errorCode).toBe("blocked-network");
    expect(called).toBe(false);
    const run = ledger.listRuns()[0]!;
    expect(run.status).toBe("failed");
    expect(run.errorCode).toBe("blocked-network");
  });

  it("reaches family.testConnection when allowLocalNetwork: true", async () => {
    let called = false;
    const fam = httpFamily({
      testConnection: async () => {
        called = true;
        return validation({ status: "valid" });
      },
    });
    const result = await runConnectorTest("my-c", {
      ledger,
      connectorHealth,
      registry: registryWith(fam),
      config: configWithHttp({ allowLocalNetwork: true }),
    });
    expect(result.status).toBe("valid");
    expect(called).toBe(true);
    expect(ledger.listRuns()[0]!.status).toBe("succeeded");
  });
});

// ── Regression: test isolation guard (FU5 PR A) ──────────────────────────
//
// Before FU5 PR A, the `connector-test-run.test.ts` suite injected
// `ledger` but not `connectorHealth`. When PR A added the new singleton
// call site in `testConnection.ts::finish()`, the production singleton
// resolved to `~/.agentic-os/state.db` (the operator's real DB), ran
// migration v2 against it, and wrote a row. This test catches the same
// class of bug if it ever recurs.
describe("runConnectorTest — test isolation guard (FU5 PR A)", () => {
  it("AGENTIC_OS_STATE_DB is redirected to a tmp path for every test", () => {
    // The env var MUST be set (beforeEach) and MUST NOT point at the
    // operator's home dir. Two assertions because either failure mode
    // would let a singleton resolve against the wrong file.
    const dbPath = process.env.AGENTIC_OS_STATE_DB;
    expect(dbPath).toBeDefined();
    expect(dbPath).not.toMatch(/^\/home\/[^/]+\/\.agentic-os\/state\.db$/);
    expect(dbPath).not.toMatch(/^\/Users\/[^/]+\/\.agentic-os\/state\.db$/);
    // Must live under the OS tmp dir we created in beforeEach.
    expect(dbPath?.startsWith(os.tmpdir())).toBe(true);
  });

  it("the injected connectorHealth store and the test DB share the same handle", () => {
    // If a future refactor accidentally constructed a new ConnectorHealthStore
    // from `getStateDb()` here instead of using `healthTest.newStore(db)`,
    // the singleton path would be touched and the env-var guard above
    // would be the only line of defence. Assert the contract directly.
    connectorHealth.recordTest({
      connectorId: "guard-c",
      validation: {
        status: "valid",
        testedAt: new Date().toISOString(),
        durationMs: 1,
      },
      testStartedAt: new Date().toISOString(),
      configHash: "0".repeat(64),
      runId: null,
    });
    // The row appears via the SAME db handle the test holds — proves the
    // store wraps the injected DB and not a singleton-resolved one.
    const row = db
      .prepare("SELECT connector_id FROM connector_health WHERE connector_id = ?")
      .get("guard-c") as { connector_id: string } | undefined;
    expect(row?.connector_id).toBe("guard-c");
  });
});
