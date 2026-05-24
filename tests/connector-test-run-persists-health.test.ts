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
import { fingerprintConnectorConfig } from "../src/kernel/connectors/connectorFingerprint";
import { appConfigSchema, type AppConfig } from "../src/kernel/schemas/appConfig";
import type {
  ConnectorFamilyDefinition,
  ConnectorValidation,
} from "../src/kernel/connectors/types";

// FU5 PR A — runConnectorTest writes a connector_health row on every
// path (success + every failure) AND on every kind of failure swallows a
// connector_health write failure gracefully (audit JSONL stays
// source-of-truth; the run record still transitions; the operator gets
// the live validation back from the function return).
//
// Spec references: §4.3 (failure mode), §6 (testConnection.ts contract).

let tmpDir: string;
let db: Database.Database;
let ledger: RunLedger;
let connectorHealth: ConnectorHealthStore;
let originalAuditEnv: string | undefined;
let originalStateDbEnv: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "conn-persist-health-"));
  originalAuditEnv = process.env.AGENTIC_OS_AUDIT_DIR;
  originalStateDbEnv = process.env.AGENTIC_OS_STATE_DB;
  process.env.AGENTIC_OS_AUDIT_DIR = path.join(tmpDir, "audit");
  await fs.mkdir(process.env.AGENTIC_OS_AUDIT_DIR, { recursive: true });
  const dbPath = path.join(tmpDir, "state.db");
  process.env.AGENTIC_OS_STATE_DB = dbPath;

  // Reset any singletons left over from earlier suites so the env-var
  // redirect takes effect on the next resolution.
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

const validation = (
  o: Partial<ConnectorValidation>,
): ConnectorValidation => ({
  status: "valid",
  testedAt: new Date().toISOString(),
  durationMs: 1,
  ...o,
});

describe("runConnectorTest — persists connector_health on success", () => {
  it("a valid test writes a connector_health row with status='valid' and a 64-char configHash", async () => {
    const fam = family({
      testConnection: async () => validation({ status: "valid" }),
    });
    await runConnectorTest("my-c", {
      ledger, connectorHealth, registry: registryWith(fam), config: configWith(),
    });

    const row = connectorHealth.get("my-c");
    expect(row).toBeDefined();
    expect(row!.validation.status).toBe("valid");
    expect(row!.configHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.runId).toBeTruthy();
  });

  it("the row's runId matches the connector-test run the ledger opened", async () => {
    const fam = family({
      testConnection: async () => validation({ status: "valid" }),
    });
    await runConnectorTest("my-c", {
      ledger, connectorHealth, registry: registryWith(fam), config: configWith(),
    });
    const runs = ledger.listRuns({ kind: "connector-test" });
    expect(runs).toHaveLength(1);
    expect(connectorHealth.get("my-c")!.runId).toBe(runs[0]!.id);
  });

  it("test_started_at is captured BEFORE the family's testConnection executes (slow-test race ordering)", async () => {
    // Capture the moment testConnection starts running. The persisted
    // test_started_at must be <= that moment + a small slack, because it
    // was set at run-creation time (before testConnection executes).
    let testConnectionStartedAt: string | null = null;
    const fam = family({
      testConnection: async () => {
        testConnectionStartedAt = new Date().toISOString();
        // Give the clock a tick so test_started_at and the "test runs"
        // timestamp aren't equal by accident.
        await new Promise((resolve) => setTimeout(resolve, 5));
        return validation({ status: "valid" });
      },
    });
    await runConnectorTest("my-c", {
      ledger, connectorHealth, registry: registryWith(fam), config: configWith(),
    });
    const row = connectorHealth.get("my-c")!;
    expect(testConnectionStartedAt).toBeTruthy();
    // test_started_at <= testConnection-actually-ran moment, because
    // test_started_at is recorded before the family runs.
    expect(Date.parse(row.testStartedAt)).toBeLessThanOrEqual(
      Date.parse(testConnectionStartedAt!),
    );
  });

  it("testConnection fingerprints the SAME instance config it tested with (mid-test edit doesn't poison the row)", async () => {
    // The fingerprint persisted in the row must match what
    // fingerprintConnectorConfig would compute against the same
    // instance config the family received. We don't simulate a mid-test
    // config edit (loadConfig is already called once at the top of
    // runConnectorTest), so the assertion is the equality.
    const cfg = configWith();
    const fam = family({
      testConnection: async () => validation({ status: "valid" }),
    });
    await runConnectorTest("my-c", {
      ledger, connectorHealth, registry: registryWith(fam), config: cfg,
    });

    const row = connectorHealth.get("my-c")!;
    // Reconstruct the EFFECTIVE instance config the runtime built — for
    // `cli-acp-agent` with `settingsSchema: z.unknown()` and the test's
    // default settings, that's the same as what we computed above.
    const expected = fingerprintConnectorConfig("my-c", {
      typeFamily: "cli-acp-agent",
      presetId: null,
      settings: {}, // post-defaults-merge — empty here
      capabilities: ["agent.run"], // family default set; no narrowing
      allowLocalNetwork: false,
      authRef: undefined,
    });
    expect(row.configHash).toBe(expected);
  });
});

describe("runConnectorTest — persists connector_health on failure", () => {
  it("an invalid test (auth-failed) writes a row with status='invalid' + errorCode preserved", async () => {
    const fam = family({
      testConnection: async () =>
        validation({ status: "invalid", errorCode: "auth-failed" }),
    });
    await runConnectorTest("my-c", {
      ledger, connectorHealth, registry: registryWith(fam), config: configWith(),
    });
    const row = connectorHealth.get("my-c");
    expect(row).toBeDefined();
    expect(row!.validation.status).toBe("invalid");
    expect(row!.validation.errorCode).toBe("auth-failed");
  });

  it("an unreachable test writes a row with status='unreachable'", async () => {
    const fam = family({
      testConnection: async () =>
        validation({ status: "unreachable", errorCode: "network-unreachable" }),
    });
    await runConnectorTest("my-c", {
      ledger, connectorHealth, registry: registryWith(fam), config: configWith(),
    });
    expect(connectorHealth.get("my-c")!.validation.status).toBe("unreachable");
  });

  it("no testConnection -> capability-unavailable still writes a row", async () => {
    // Family with no testConnection -> the kernel synthesises a
    // `unknown / capability-unavailable` validation; the row should still
    // reflect that (operators see "not tested" via the existing pill
    // logic, but the row exists for diagnostics).
    await runConnectorTest("my-c", {
      ledger, connectorHealth, registry: registryWith(family()), config: configWith(),
    });
    const row = connectorHealth.get("my-c");
    expect(row).toBeDefined();
    expect(row!.validation.status).toBe("unknown");
    expect(row!.validation.errorCode).toBe("capability-unavailable");
  });

  it("a thrown family exception -> status='invalid' + row still written", async () => {
    const fam = family({
      testConnection: async () => { throw new Error("boom"); },
    });
    await runConnectorTest("my-c", {
      ledger, connectorHealth, registry: registryWith(fam), config: configWith(),
    });
    const row = connectorHealth.get("my-c");
    expect(row).toBeDefined();
    expect(row!.validation.status).toBe("invalid");
    expect(row!.validation.errorCode).toBe("unknown");
  });
});

describe("runConnectorTest — connector_health write failure is swallowed", () => {
  it("a connector_health write failure does NOT break the test or the audit (spec §4.3)", async () => {
    // Inject a store that throws on every recordTest call. The class
    // has a private `db` field so a structural cast goes via `unknown`.
    const throwingStore = {
      recordTest: () => {
        throw new Error("simulated connector_health write failure");
      },
      get: connectorHealth.get.bind(connectorHealth),
      getMany: connectorHealth.getMany.bind(connectorHealth),
      delete: connectorHealth.delete.bind(connectorHealth),
    } as unknown as ConnectorHealthStore;

    const fam = family({
      testConnection: async () => validation({ status: "valid" }),
    });
    const result = await runConnectorTest("my-c", {
      ledger,
      connectorHealth: throwingStore,
      registry: registryWith(fam),
      config: configWith(),
    });

    // The test still returned its full validation.
    expect(result.status).toBe("valid");
    // The run record still transitioned to succeeded.
    expect(ledger.listRuns({ kind: "connector-test" })[0]!.status).toBe(
      "succeeded",
    );
    // The audit line was still written.
    const day = new Date().toISOString().slice(0, 10);
    const audit = await fs.readFile(
      path.join(process.env.AGENTIC_OS_AUDIT_DIR!, `${day}.jsonl`),
      "utf8",
    );
    expect(audit).toContain("connector.test");
    // The real connectorHealth handle never saw the row (the throwing
    // mock got the recordTest call instead).
    expect(connectorHealth.get("my-c")).toBeUndefined();
  });

  it("recordTest throws on a failure path too -> still returns the live validation", async () => {
    const throwingStore = {
      recordTest: () => { throw new Error("write fail"); },
      get: connectorHealth.get.bind(connectorHealth),
      getMany: connectorHealth.getMany.bind(connectorHealth),
      delete: connectorHealth.delete.bind(connectorHealth),
    } as unknown as ConnectorHealthStore;
    const fam = family({
      testConnection: async () =>
        validation({ status: "invalid", errorCode: "auth-failed" }),
    });
    const result = await runConnectorTest("my-c", {
      ledger,
      connectorHealth: throwingStore,
      registry: registryWith(fam),
      config: configWith(),
    });
    expect(result.status).toBe("invalid");
    expect(result.errorCode).toBe("auth-failed");
    expect(ledger.listRuns({ kind: "connector-test" })[0]!.status).toBe(
      "failed",
    );
  });
});

describe("runConnectorTest — connector_health write skipped when store is null", () => {
  it("explicitly passing connectorHealth: null skips the write entirely (no throw)", async () => {
    const fam = family({
      testConnection: async () => validation({ status: "valid" }),
    });
    const result = await runConnectorTest("my-c", {
      ledger,
      connectorHealth: null,
      registry: registryWith(fam),
      config: configWith(),
    });
    expect(result.status).toBe("valid");
    expect(connectorHealth.get("my-c")).toBeUndefined();
  });
});
